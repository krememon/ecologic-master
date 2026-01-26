import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db-init";
import path from "path";
import Stripe from "stripe";
import { db } from "./db";
import { invoices, payments } from "../shared/schema";
import { eq } from "drizzle-orm";

const app = express();

// Disable ETags to prevent 304 responses which break JSON parsing
app.set("etag", false);

// Initialize Stripe for webhook (needs to be before JSON parsing)
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-04-30.basil" as any })
  : null;

// Stripe webhook endpoint - MUST use raw body for signature verification
// This MUST be before express.json() middleware
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    console.error('[Stripe Webhook] Stripe not configured');
    return res.status(500).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Stripe Webhook] Webhook secret not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  // Handle checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const { invoiceId, companyId, jobId } = session.metadata || {};

    if (!invoiceId) {
      console.error('[Stripe Webhook] No invoiceId in metadata');
      return res.status(400).send('Missing invoiceId in metadata');
    }

    try {
      // Check if invoice is already paid (idempotency)
      const [existingInvoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, parseInt(invoiceId)));

      if (!existingInvoice) {
        console.error(`[Stripe Webhook] Invoice ${invoiceId} not found`);
        return res.status(404).send('Invoice not found');
      }

      if (existingInvoice.status?.toLowerCase() === 'paid') {
        console.log(`[Stripe Webhook] Invoice ${invoiceId} already paid, skipping`);
        return res.json({ received: true, message: 'Already processed' });
      }

      // Mark invoice as paid
      const now = new Date();
      await db
        .update(invoices)
        .set({
          status: 'paid',
          paidAt: now,
          paidDate: now.toISOString().split('T')[0],
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.payment_intent as string,
          updatedAt: now,
        })
        .where(eq(invoices.id, parseInt(invoiceId)));

      // Create payment record (idempotency: check for existing payment by paymentIntentId)
      const amountCents = session.amount_total || 0;
      const [existingPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, session.payment_intent as string));
      
      if (!existingPayment) {
        await db.insert(payments).values({
          companyId: companyId ? parseInt(companyId) : existingInvoice.companyId,
          invoiceId: parseInt(invoiceId),
          jobId: jobId ? parseInt(jobId) : existingInvoice.jobId,
          customerId: existingInvoice.customerId || null,
          amount: (amountCents / 100).toFixed(2),
          amountCents: amountCents,
          paymentMethod: 'stripe',
          status: 'paid',
          stripePaymentIntentId: session.payment_intent as string,
          stripeCheckoutSessionId: session.id,
          paidDate: now,
        });
        console.log(`[Stripe Webhook] Payment record created for invoice ${invoiceId}`);
      } else {
        console.log(`[Stripe Webhook] Payment already exists for payment intent ${session.payment_intent}`);
      }

      console.log(`[Stripe Webhook] Invoice ${invoiceId} marked as paid`);
    } catch (error: any) {
      console.error('[Stripe Webhook] Error processing payment:', error);
      return res.status(500).send('Error processing payment');
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// PUBLIC SIGNING ROUTE - must be registered BEFORE Vite middleware
// This route serves the public signing HTML page with NO authentication
app.get("/sign/:token", (req, res) => {
  console.log("[PublicSign] Serving public-sign.html for:", req.params.token?.substring(0, 8) + "...");
  const htmlPath = path.join(process.cwd(), "public", "public-sign.html");
  res.sendFile(htmlPath);
});

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize database constraints and triggers
  await initializeDatabase();
  
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[SERVER ERROR]", err);
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
