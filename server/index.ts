import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db-init";
import path from "path";
import fs from "fs";
import Stripe from "stripe";
import { db } from "./db";
import { invoices, payments, customers, companies, jobs, notifications } from "../shared/schema";
import { eq, and, sql, lt, isNull, ne } from "drizzle-orm";
import { notifyManagers } from "./notificationService";

const app = express();

// PUBLIC STATIC FILES - MUST be registered FIRST before any middleware
// Using /public/uploads path to avoid SPA routing conflicts
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve files at BOTH /uploads and /public/uploads for compatibility
const serveUploadedFile = (req: express.Request, res: express.Response) => {
  const filename = req.params.filename;
  // Security: prevent path traversal
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).send("Invalid filename");
  }
  
  const filePath = path.join(uploadsDir, filename);
  
  if (!fs.existsSync(filePath)) {
    console.log(`[Static] File not found: ${filePath}`);
    return res.status(404).send("File not found");
  }
  
  // Determine content type
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";
  
  res.setHeader("Content-Type", contentType);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=31536000");
  res.sendFile(filePath);
};

app.get("/uploads/:filename", serveUploadedFile);
app.get("/public/uploads/:filename", serveUploadedFile);
console.log("[Static] Public upload routes registered: /uploads/:filename and /public/uploads/:filename");

// Disable ETags to prevent 304 responses which break JSON parsing
app.set("etag", false);

// Initialize Stripe for webhook (needs to be before JSON parsing)
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-04-30.basil" as any })
  : null;

// QuickBooks access token helper for webhook context
async function getQboAccessTokenForWebhook(companyId: number): Promise<string | null> {
  try {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company?.qboAccessToken || !company?.qboRefreshToken || !company?.qboRealmId) {
      return null;
    }

    // Check if token is expired (with 5-minute buffer)
    const expiresAt = company.qboTokenExpiresAt;
    const now = new Date();
    const bufferMs = 5 * 60 * 1000;

    if (expiresAt && new Date(expiresAt).getTime() - bufferMs < now.getTime()) {
      // Token is expired or about to expire, refresh it
      const clientId = process.env.QB_CLIENT_ID;
      const clientSecret = process.env.QB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        console.log('[QB-PAY] Missing QB client credentials for refresh');
        return null;
      }

      const refreshResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: company.qboRefreshToken,
        }).toString(),
      });

      if (!refreshResponse.ok) {
        console.error('[QB-PAY] Token refresh failed:', await refreshResponse.text());
        return null;
      }

      const tokens = await refreshResponse.json();
      const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await db.update(companies).set({
        qboAccessToken: tokens.access_token,
        qboRefreshToken: tokens.refresh_token,
        qboTokenExpiresAt: newExpiresAt,
        updatedAt: new Date(),
      }).where(eq(companies.id, companyId));

      return tokens.access_token;
    }

    return company.qboAccessToken;
  } catch (error) {
    console.error('[QB-PAY] Error getting access token:', error);
    return null;
  }
}

// Sync payment to QuickBooks from webhook context (no req.user)
async function syncPaymentToQboFromWebhook(
  paymentId: number, 
  companyId: number,
  stripePaymentIntentId: string
): Promise<{ success: boolean; qboPaymentId?: string; error?: string }> {
  console.log('[QB-PAY] Payment sync triggered paymentId=' + paymentId);
  
  try {
    // Get payment record
    const [paymentRecord] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!paymentRecord) {
      console.log('[QB-PAY] Payment not found paymentId=' + paymentId);
      return { success: false, error: 'Payment not found' };
    }

    // Check if already synced (idempotent)
    if (paymentRecord.qboPaymentId) {
      console.log('[QB-PAY] Skipping, already synced qboPaymentId=' + paymentRecord.qboPaymentId);
      return { success: true, qboPaymentId: paymentRecord.qboPaymentId };
    }

    // Check if another process is syncing
    if (paymentRecord.qboPaymentSyncStatus === 'syncing') {
      console.log('[QB-PAY] Skipping, another process is syncing paymentId=' + paymentId);
      return { success: false, error: 'Already syncing' };
    }

    // Atomic compare-and-set: acquire lock
    const updateResult = await db.update(payments)
      .set({
        qboPaymentSyncStatus: 'syncing',
        updatedAt: new Date()
      })
      .where(
        and(
          eq(payments.id, paymentId),
          sql`(${payments.qboPaymentId} IS NULL)`,
          sql`(${payments.qboPaymentSyncStatus} IS NULL OR ${payments.qboPaymentSyncStatus} NOT IN ('syncing', 'synced'))`
        )
      )
      .returning({ id: payments.id });
    
    if (updateResult.length === 0) {
      console.log('[QB-PAY] Failed to acquire sync lock paymentId=' + paymentId);
      const [checkRecord] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (checkRecord?.qboPaymentId) {
        return { success: true, qboPaymentId: checkRecord.qboPaymentId };
      }
      return { success: false, error: 'Could not acquire sync lock' };
    }
    console.log('[QB-PAY] Acquired sync lock paymentId=' + paymentId);

    // Get company QB settings
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company?.qboRealmId) {
      console.log('[QB-PAY] QuickBooks not connected for companyId=' + companyId);
      await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: 'QuickBooks not connected', updatedAt: new Date() }).where(eq(payments.id, paymentId));
      return { success: false, error: 'QuickBooks not connected' };
    }

    // Get invoice
    if (!paymentRecord.invoiceId) {
      console.log('[QB-PAY] Payment has no invoice paymentId=' + paymentId);
      await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: 'Payment has no invoice', updatedAt: new Date() }).where(eq(payments.id, paymentId));
      return { success: false, error: 'Payment has no invoice' };
    }

    const [invoiceRecord] = await db.select().from(invoices).where(eq(invoices.id, paymentRecord.invoiceId)).limit(1);
    if (!invoiceRecord) {
      console.log('[QB-PAY] Invoice not found invoiceId=' + paymentRecord.invoiceId);
      await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: 'Invoice not found', updatedAt: new Date() }).where(eq(payments.id, paymentId));
      return { success: false, error: 'Invoice not found' };
    }

    console.log('[QB-PAY] Loaded invoice qboInvoiceId=' + (invoiceRecord.qboInvoiceId || 'null') + ' qboPaymentId=' + (paymentRecord.qboPaymentId || 'null'));

    // If invoice not yet synced to QBO, mark payment as waiting
    if (!invoiceRecord.qboInvoiceId) {
      console.log('[QB-PAY] Invoice not synced to QBO, marking payment as waiting invoiceId=' + paymentRecord.invoiceId);
      await db.update(payments).set({ qboPaymentSyncStatus: 'waiting', qboPaymentLastSyncError: 'Invoice not yet synced to QuickBooks', updatedAt: new Date() }).where(eq(payments.id, paymentId));
      return { success: false, error: 'Invoice not synced - payment marked waiting' };
    }

    // Get customer QBO ID
    let qboCustomerId: string | null = null;
    if (invoiceRecord.customerId) {
      const [customer] = await db.select().from(customers).where(eq(customers.id, invoiceRecord.customerId)).limit(1);
      if (customer?.qboCustomerId) {
        qboCustomerId = customer.qboCustomerId;
      }
    }

    if (!qboCustomerId) {
      console.log('[QB-PAY] Customer not synced to QuickBooks customerId=' + invoiceRecord.customerId);
      await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: 'Customer not synced to QuickBooks', updatedAt: new Date() }).where(eq(payments.id, paymentId));
      return { success: false, error: 'Customer not synced to QuickBooks' };
    }

    // Get access token
    const accessToken = await getQboAccessTokenForWebhook(companyId);
    if (!accessToken) {
      console.log('[QB-PAY] Could not get QuickBooks access token');
      await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: 'Could not get QuickBooks access token', updatedAt: new Date() }).where(eq(payments.id, paymentId));
      return { success: false, error: 'Could not get QuickBooks access token' };
    }

    const qboEnv = process.env.QB_ENV || 'sandbox';
    const baseUrl = qboEnv === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';

    // Calculate amount
    const amountDollars = paymentRecord.amountCents ? Number((paymentRecord.amountCents / 100).toFixed(2)) : Number(parseFloat(paymentRecord.amount).toFixed(2));

    // Build payment payload
    const qboPaymentData: any = {
      CustomerRef: { value: qboCustomerId },
      TotalAmt: amountDollars,
      TxnDate: new Date().toISOString().split('T')[0],
      PaymentMethodRef: { value: '3', name: 'Credit Card' },
      PaymentRefNum: stripePaymentIntentId ? stripePaymentIntentId.slice(-21) : undefined,
      PrivateNote: `EcoLogic Payment ID: ${paymentId} | Stripe: ${stripePaymentIntentId}`,
      Line: [{
        Amount: amountDollars,
        LinkedTxn: [{
          TxnId: invoiceRecord.qboInvoiceId,
          TxnType: 'Invoice'
        }]
      }]
    };

    // Try to get deposit account
    try {
      const accountQuery = encodeURIComponent("SELECT * FROM Account WHERE Name = 'Undeposited Funds' AND AccountType = 'Other Current Asset'");
      const accountResponse = await fetch(`${baseUrl}/v3/company/${company.qboRealmId}/query?query=${accountQuery}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
      });
      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        if (accountData.QueryResponse?.Account?.length > 0) {
          qboPaymentData.DepositToAccountRef = { value: accountData.QueryResponse.Account[0].Id, name: accountData.QueryResponse.Account[0].Name };
          console.log('[QB-PAY] Using deposit account:', accountData.QueryResponse.Account[0].Id);
        }
      }
    } catch (e) {
      console.log('[QB-PAY] Could not find deposit account, proceeding without');
    }

    // Check for existing QBO payment with same PaymentRefNum (de-duplication)
    if (stripePaymentIntentId) {
      try {
        const truncatedRef = stripePaymentIntentId.slice(-21);
        const dedupeQuery = encodeURIComponent(`SELECT * FROM Payment WHERE PaymentRefNum = '${truncatedRef}'`);
        const dedupeResponse = await fetch(`${baseUrl}/v3/company/${company.qboRealmId}/query?query=${dedupeQuery}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
        });
        if (dedupeResponse.ok) {
          const dedupeData = await dedupeResponse.json();
          if (dedupeData.QueryResponse?.Payment?.length > 0) {
            const existingPayment = dedupeData.QueryResponse.Payment[0];
            console.log('[QB-PAY] Found existing QBO payment with PaymentRefNum: ' + existingPayment.Id);
            await db.update(payments).set({ qboPaymentId: existingPayment.Id, qboPaymentSyncStatus: 'synced', qboPaymentLastSyncError: null, qboPaymentLastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(payments.id, paymentId));
            return { success: true, qboPaymentId: existingPayment.Id };
          }
        }
      } catch (e) {
        console.log('[QB-PAY] De-duplication check failed, proceeding with create');
      }
    }

    console.log('[QB-PAY] Creating QBO payment for invoice qboInvoiceId=' + invoiceRecord.qboInvoiceId);

    // Create QBO Payment
    const createResponse = await fetch(`${baseUrl}/v3/company/${company.qboRealmId}/payment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(qboPaymentData)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[QB-PAY] Payment creation failed status=' + createResponse.status + ':', errorText);
      await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: `QBO API error: ${createResponse.status}`, updatedAt: new Date() }).where(eq(payments.id, paymentId));
      return { success: false, error: `QBO API error: ${createResponse.status}` };
    }

    const createData = await createResponse.json();
    const newQboPaymentId = createData.Payment?.Id;

    if (newQboPaymentId) {
      await db.update(payments).set({ qboPaymentId: newQboPaymentId, qboPaymentSyncStatus: 'synced', qboPaymentLastSyncError: null, qboPaymentLastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(payments.id, paymentId));
      console.log('[QB-PAY] Created QBO payment: ' + newQboPaymentId);
      console.log('[QB-PAY] Saved qboPaymentId: ' + newQboPaymentId);
      return { success: true, qboPaymentId: newQboPaymentId };
    }

    console.log('[QB-PAY] No payment ID returned from QBO');
    await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: 'No payment ID returned from QBO', updatedAt: new Date() }).where(eq(payments.id, paymentId));
    return { success: false, error: 'No payment ID returned from QBO' };
  } catch (error: any) {
    console.error('[QB-PAY] Error syncing payment:', error);
    try {
      await db.update(payments).set({ qboPaymentSyncStatus: 'failed', qboPaymentLastSyncError: error.message || 'Unknown error', updatedAt: new Date() }).where(eq(payments.id, paymentId));
    } catch {}
    return { success: false, error: error.message || 'Unknown error' };
  }
}

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
        console.log(`[Stripe Webhook] Invoice ${invoiceId} already paid, checking for QBO sync`);
        
        // Even if invoice is already paid, check if QBO payment sync was missed
        const [existingPayment] = await db
          .select()
          .from(payments)
          .where(eq(payments.stripePaymentIntentId, session.payment_intent as string));
        
        if (existingPayment && !existingPayment.qboPaymentId && existingPayment.qboPaymentSyncStatus !== 'synced') {
          console.log(`[QB-PAY] Retrying QBO sync for missed payment paymentId=${existingPayment.id}`);
          syncPaymentToQboFromWebhook(existingPayment.id, existingInvoice.companyId, session.payment_intent as string)
            .then(result => {
              if (result.success) {
                console.log(`[QB-PAY] Retry sync success: ${result.qboPaymentId}`);
              } else {
                console.log(`[QB-PAY] Retry sync: ${result.error}`);
              }
            })
            .catch(err => console.error('[QB-PAY] Retry sync error:', err));
        }
        
        return res.json({ received: true, message: 'Already processed' });
      }

      // Calculate partial payment amounts
      const now = new Date();
      const amountCents = session.amount_total || 0;
      const invoiceTotalCents = existingInvoice.totalCents > 0 ? existingInvoice.totalCents : Math.round(parseFloat(existingInvoice.amount) * 100);
      const prevPaidCents = existingInvoice.paidAmountCents || 0;
      const newPaidAmountCents = Math.min(invoiceTotalCents, prevPaidCents + amountCents);
      const newBalanceDueCents = Math.max(0, invoiceTotalCents - newPaidAmountCents);
      const newStatus = newBalanceDueCents === 0 ? 'paid' : 'partial';

      // Update invoice with payment amounts and status
      await db
        .update(invoices)
        .set({
          status: newStatus,
          paidAmountCents: newPaidAmountCents,
          balanceDueCents: newBalanceDueCents,
          ...(newStatus === 'paid' ? {
            paidAt: now,
            paidDate: now.toISOString().split('T')[0],
          } : {}),
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.payment_intent as string,
          updatedAt: now,
        })
        .where(eq(invoices.id, parseInt(invoiceId)));

      // Update job paymentStatus
      if (existingInvoice.jobId) {
        const jobPaymentStatus = newStatus === 'paid' ? 'paid' : 'partial';
        await db
          .update(jobs)
          .set({ paymentStatus: jobPaymentStatus })
          .where(eq(jobs.id, existingInvoice.jobId));
        console.log(`[Stripe Webhook] Job ${existingInvoice.jobId} paymentStatus updated to '${jobPaymentStatus}'`);
      }
      const [existingPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, session.payment_intent as string));
      
      let paymentId: number | null = null;
      if (!existingPayment) {
        const [newPayment] = await db.insert(payments).values({
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
        }).returning({ id: payments.id });
        paymentId = newPayment.id;
        console.log(`[Stripe Webhook] Payment record created for invoice ${invoiceId} paymentId=${paymentId}`);
      } else {
        paymentId = existingPayment.id;
        console.log(`[Stripe Webhook] Payment already exists for payment intent ${session.payment_intent}`);
      }

      console.log(`[Stripe Webhook] Invoice ${invoiceId} marked as paid`);

      // Fire-and-forget: Sync payment to QuickBooks
      if (paymentId) {
        const targetCompanyId = companyId ? parseInt(companyId) : existingInvoice.companyId;
        console.log(`[QB-PAY] Triggered from Stripe webhook invoiceId=${invoiceId} stripeId=${session.payment_intent}`);
        
        syncPaymentToQboFromWebhook(paymentId, targetCompanyId, session.payment_intent as string)
          .then(result => {
            if (result.success) {
              console.log(`[QB-PAY] Stripe webhook payment synced: ${result.qboPaymentId}`);
            } else {
              console.log(`[QB-PAY] Stripe webhook payment sync: ${result.error}`);
            }
          })
          .catch(err => console.error('[QB-PAY] Stripe webhook sync error:', err));
      }
    } catch (error: any) {
      console.error('[Stripe Webhook] Error processing payment:', error);
      return res.status(500).send('Error processing payment');
    }
  }

  res.json({ received: true });
});

// Skip body parsers for multipart/form-data uploads (handled by multer)
app.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("multipart/form-data")) {
    return next();
  }
  express.json()(req, res, next);
});

app.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("multipart/form-data")) {
    return next();
  }
  express.urlencoded({ extended: false })(req, res, next);
});

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

  // Global error handler to prevent hard crashes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ message: "Server error", detail: err?.message });
  });

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
    startOverdueInvoiceChecker();
  });
})();

async function checkOverdueInvoices() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const overdueInvoices = await db
      .select({
        id: invoices.id,
        companyId: invoices.companyId,
        invoiceNumber: invoices.invoiceNumber,
        amount: invoices.amount,
        totalCents: invoices.totalCents,
        dueDate: invoices.dueDate,
        jobId: invoices.jobId,
      })
      .from(invoices)
      .where(
        and(
          lt(invoices.dueDate, today),
          ne(invoices.status, 'paid'),
          ne(invoices.status, 'cancelled')
        )
      );

    for (const inv of overdueInvoices) {
      const amountStr = inv.totalCents > 0
        ? `$${(inv.totalCents / 100).toFixed(2)}`
        : `$${parseFloat(inv.amount || '0').toFixed(2)}`;

      await notifyManagers(inv.companyId, {
        type: 'invoice_overdue',
        title: 'Invoice Overdue',
        body: `Invoice ${inv.invoiceNumber || `#${inv.id}`} for ${amountStr} is past due`,
        entityType: 'invoice',
        entityId: inv.id,
        linkUrl: inv.jobId ? `/jobs/${inv.jobId}` : undefined,
        dedupMinutes: 24 * 60,
      });
    }

    if (overdueInvoices.length > 0) {
      console.log(`[Overdue] Checked ${overdueInvoices.length} overdue invoices for notifications`);
    }
  } catch (error) {
    console.error('[Overdue] Error checking overdue invoices:', error);
  }
}

function startOverdueInvoiceChecker() {
  setTimeout(() => checkOverdueInvoices(), 60_000);
  setInterval(() => checkOverdueInvoices(), 6 * 60 * 60_000);
}
