import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db-init";
import path from "path";
import fs from "fs";
import Stripe from "stripe";
import { db } from "./db";
import { invoices, payments, customers, companies, jobs, notifications, bankRefunds, refunds, stripeWebhookEvents } from "../shared/schema";
import { eq, and, sql, lt, isNull, ne } from "drizzle-orm";
import { notifyManagers, notifyOwners } from "./notificationService";
import { startJobScheduler } from "./jobScheduler";
import { sendReceiptForPayment } from "./receiptService";
import * as stripeConnectService from "./services/stripeConnect";

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

import { persistRecomputedTotals, recomputeInvoiceTotalsFromPayments, recomputeJobPaymentAndMaybeArchive } from "./invoiceRecompute";

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

  console.log(`[Stripe Webhook] Received event: ${event.id} ${event.type}`);

  try {
    await db.insert(stripeWebhookEvents).values({
      stripeEventId: event.id,
      eventType: event.type,
      invoiceId: (event.data.object as any)?.metadata?.invoiceId ? parseInt((event.data.object as any).metadata.invoiceId) : null,
      amountCents: (event.data.object as any)?.amount || (event.data.object as any)?.amount_total || null,
      metadata: (event.data.object as any)?.metadata || null,
    }).onConflictDoNothing();
  } catch (logErr) {
    console.error('[Stripe Webhook] Failed to log event:', logErr);
  }

  // Handle checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const { invoiceId, companyId, jobId } = session.metadata || {};

    console.log(`[Stripe Webhook] checkout.session.completed: sessionId=${session.id}, paymentIntent=${session.payment_intent}, amount=${session.amount_total}, metadata=${JSON.stringify(session.metadata)}`);

    if (!invoiceId) {
      console.error('[Stripe Webhook] No invoiceId in metadata');
      return res.status(400).send('Missing invoiceId in metadata');
    }

    const resolvedJobId = jobId ? parseInt(jobId) : null;

    try {
      const [existingInvoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, parseInt(invoiceId)));

      if (!existingInvoice) {
        console.error(`[Stripe Webhook] Invoice ${invoiceId} not found`);
        return res.status(404).send('Invoice not found');
      }

      const effectiveJobId = resolvedJobId || existingInvoice.jobId;
      console.log(`[Stripe Webhook] Resolved jobId: metadata=${resolvedJobId}, invoice.jobId=${existingInvoice.jobId}, effective=${effectiveJobId}`);

      if (!effectiveJobId) {
        console.log(`[Stripe Webhook] WARNING: No jobId found for invoice ${invoiceId} — archival cannot be triggered`);
      }

      if (existingInvoice.status?.toLowerCase() === 'paid') {
        console.log(`[Stripe Webhook] Invoice ${invoiceId} already paid, checking for QBO sync`);
        
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
        
        if (effectiveJobId) {
          const [jobCheck] = await db.select().from(jobs).where(eq(jobs.id, effectiveJobId));
          if (jobCheck && jobCheck.status === 'completed' && jobCheck.paymentStatus === 'paid' && !jobCheck.archivedAt) {
            const now = new Date();
            await db.update(jobs).set({
              status: 'archived',
              archivedAt: now,
              archivedReason: 'completed_and_paid',
            }).where(eq(jobs.id, effectiveJobId));
            console.log(`[Stripe Webhook] Job ${effectiveJobId} retroactively archived on idempotent webhook`);
          }
        }
        
        return res.json({ received: true, message: 'Already processed' });
      }

      const now = new Date();
      const amountCents = session.amount_total || 0;

      const [existingPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, session.payment_intent as string));
      
      let paymentId: number | null = null;
      if (!existingPayment) {
        const [newPayment] = await db.insert(payments).values({
          companyId: companyId ? parseInt(companyId) : existingInvoice.companyId,
          invoiceId: parseInt(invoiceId),
          jobId: effectiveJobId || null,
          customerId: existingInvoice.customerId || null,
          amount: (amountCents / 100).toFixed(2),
          amountCents: amountCents,
          paymentMethod: 'stripe',
          status: 'succeeded',
          stripePaymentIntentId: session.payment_intent as string,
          stripeCheckoutSessionId: session.id,
          paidDate: now,
        }).returning({ id: payments.id });
        paymentId = newPayment.id;
        console.log(`[Stripe Webhook] Payment record created for invoice ${invoiceId} paymentId=${paymentId} status=succeeded`);
      } else {
        paymentId = existingPayment.id;
        console.log(`[Stripe Webhook] Payment already exists for payment intent ${session.payment_intent}`);
      }

      const recomputed = await persistRecomputedTotals(parseInt(invoiceId));
      const newStatus = recomputed.computedStatus;
      console.log(`[Stripe Webhook] Invoice ${invoiceId} recomputed: paid=${recomputed.paidCents} owed=${recomputed.owedCents} status=${newStatus}`);

      await db.update(invoices).set({
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: session.payment_intent as string,
      }).where(eq(invoices.id, parseInt(invoiceId)));

      if (effectiveJobId) {
        await recomputeJobPaymentAndMaybeArchive(effectiveJobId, 'webhook-checkout');
      }

      const targetCompanyIdForNotif = companyId ? parseInt(companyId) : existingInvoice.companyId;
      const amountDollars = (amountCents / 100).toFixed(2);
      try {
        console.log(`[stripe] payment_succeeded companyId=${targetCompanyIdForNotif} invoiceId=${invoiceId} amount=$${amountDollars}`);
        await notifyOwners(targetCompanyIdForNotif, {
          type: 'invoice_paid',
          title: 'Payment Received',
          body: `Invoice paid – $${amountDollars}`,
          entityType: 'invoice',
          entityId: parseInt(invoiceId),
          linkUrl: `/invoicing/${invoiceId}`,
          meta: {
            invoiceId,
            amountCents: String(amountCents),
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent as string,
          },
        });
      } catch (notifErr) {
        console.error('[stripe] notification error:', notifErr);
      }

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

      if (paymentId) {
        sendReceiptForPayment(paymentId).catch(err =>
          console.error('[receipt] webhook checkout error:', err?.message));
      }

      if (paymentId && effectiveJobId) {
        let checkoutChargeId: string | null = null;
        try {
          if (session.payment_intent) {
            const piObj = await stripe.paymentIntents.retrieve(session.payment_intent as string);
            checkoutChargeId = piObj.latest_charge
              ? (typeof piObj.latest_charge === "string" ? piObj.latest_charge : piObj.latest_charge.id)
              : null;
          }
        } catch (e: any) {
          console.warn(`[SubPayExec] checkout: Could not resolve charge: ${e.message}`);
        }
        console.log(`[SubPayExec] checkout: invoiceId=${invoiceId} jobId=${effectiveJobId} paymentId=${paymentId} pi=${session.payment_intent} chargeId=${checkoutChargeId}`);

        stripeConnectService.executeSubcontractPayout({
          jobId: effectiveJobId,
          invoiceId: parseInt(invoiceId),
          paymentId,
          paymentIntentId: session.payment_intent as string || null,
          paymentAmountCents: amountCents,
          ownerCompanyId: companyId ? parseInt(companyId) : existingInvoice.companyId,
          source: "webhook-checkout",
          chargeId: checkoutChargeId,
        }).catch(err => console.error('[SubPayExec] webhook-checkout error:', err?.message));
      }
    } catch (error: any) {
      console.error('[Stripe Webhook] Error processing payment:', error);
      return res.status(500).send('Error processing payment');
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const { invoiceId, companyId, jobId } = paymentIntent.metadata || {};

    console.log('[webhook pi.succeeded]', { pi: paymentIntent.id, metaInvoiceId: paymentIntent.metadata?.invoiceId, metaCompanyId: paymentIntent.metadata?.companyId, amount: paymentIntent.amount });

    if (!invoiceId) {
      console.error('[Stripe Webhook] payment_intent.succeeded: No invoiceId in metadata');
      return res.json({ received: true, message: 'No invoiceId in metadata, skipping' });
    }

    const resolvedJobId = jobId ? parseInt(jobId) : null;

    try {
      const [existingInvoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, parseInt(invoiceId)));

      if (!existingInvoice) {
        console.error(`[Stripe Webhook] payment_intent.succeeded: Invoice ${invoiceId} not found`);
        return res.status(404).send('Invoice not found');
      }

      const effectiveJobId = resolvedJobId || existingInvoice.jobId;
      console.log(`[Stripe Webhook] payment_intent.succeeded: Resolved jobId: metadata=${resolvedJobId}, invoice.jobId=${existingInvoice.jobId}, effective=${effectiveJobId}`);

      const [existingPaymentCheck] = await db
        .select()
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, paymentIntent.id));

      if (existingPaymentCheck) {
        console.log('[webhook pi.succeeded] existing payment found', { paymentId: existingPaymentCheck.id, invoiceId: existingPaymentCheck.invoiceId, status: existingPaymentCheck.status });

        const wasProcessing = existingPaymentCheck.status !== 'succeeded';

        if (wasProcessing) {
          await db.update(payments).set({ status: 'succeeded', paidDate: new Date() }).where(eq(payments.id, existingPaymentCheck.id));
          console.log(`[Stripe Webhook] Upgraded payment ${existingPaymentCheck.id} status from '${existingPaymentCheck.status}' to 'succeeded'`);
          const recomputed = await persistRecomputedTotals(parseInt(invoiceId));
          const upgradedStatus = recomputed.computedStatus;

          await db.update(invoices).set({
            stripePaymentIntentId: paymentIntent.id,
          }).where(eq(invoices.id, parseInt(invoiceId)));

          if (effectiveJobId) {
            await recomputeJobPaymentAndMaybeArchive(effectiveJobId, 'webhook-pi-upgrade');
          }

          const amountDollars = ((existingPaymentCheck.amountCents || 0) / 100).toFixed(2);
          const targetCompanyIdForNotif = companyId ? parseInt(companyId) : existingInvoice.companyId;
          try {
            await notifyOwners(targetCompanyIdForNotif, {
              type: 'invoice_paid',
              title: 'Payment Received',
              body: `Invoice paid – $${amountDollars}`,
              entityType: 'invoice',
              entityId: parseInt(invoiceId),
              linkUrl: `/invoicing/${invoiceId}`,
              meta: {
                invoiceId,
                amountCents: String(existingPaymentCheck.amountCents || 0),
                stripePaymentIntentId: paymentIntent.id,
              },
            });
          } catch (notifErr) {
            console.error('[stripe] PI upgrade notification error:', notifErr);
          }
        }

        if (!existingPaymentCheck.qboPaymentId && existingPaymentCheck.qboPaymentSyncStatus !== 'synced') {
          console.log(`[QB-PAY] Retrying QBO sync for PI payment paymentId=${existingPaymentCheck.id}`);
          syncPaymentToQboFromWebhook(existingPaymentCheck.id, existingInvoice.companyId, paymentIntent.id)
            .then(result => {
              if (result.success) console.log(`[QB-PAY] Retry sync success: ${result.qboPaymentId}`);
              else console.log(`[QB-PAY] Retry sync: ${result.error}`);
            })
            .catch(err => console.error('[QB-PAY] Retry sync error:', err));
        }

        if (!wasProcessing && effectiveJobId) {
          await recomputeJobPaymentAndMaybeArchive(effectiveJobId, 'webhook-pi-idempotent');
        }

        if (wasProcessing) {
          sendReceiptForPayment(existingPaymentCheck.id).catch(err =>
            console.error('[receipt] webhook PI upgrade error:', err?.message));

          if (effectiveJobId) {
            const upgradeChargeId = paymentIntent.latest_charge
              ? (typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge.id)
              : null;
            console.log(`[SubPayExec] pi-upgrade: invoiceId=${invoiceId} jobId=${effectiveJobId} paymentId=${existingPaymentCheck.id} pi=${paymentIntent.id} chargeId=${upgradeChargeId}`);

            stripeConnectService.executeSubcontractPayout({
              jobId: effectiveJobId,
              invoiceId: parseInt(invoiceId),
              paymentId: existingPaymentCheck.id,
              paymentIntentId: paymentIntent.id,
              paymentAmountCents: existingPaymentCheck.amountCents || Math.round(parseFloat(existingPaymentCheck.amount) * 100),
              ownerCompanyId: companyId ? parseInt(companyId) : existingInvoice.companyId,
              source: "webhook-pi-upgrade",
              chargeId: upgradeChargeId,
            }).catch(err => console.error('[SubPayExec] webhook-pi-upgrade error:', err?.message));
          }
        }

        return res.json({ received: true, message: wasProcessing ? 'Upgraded to succeeded' : 'Already processed' });
      }

      const now = new Date();
      const amountCents = paymentIntent.amount || 0;

      const [newPayment] = await db.insert(payments).values({
        companyId: companyId ? parseInt(companyId) : existingInvoice.companyId,
        invoiceId: parseInt(invoiceId),
        jobId: effectiveJobId || null,
        customerId: existingInvoice.customerId || null,
        amount: (amountCents / 100).toFixed(2),
        amountCents: amountCents,
        paymentMethod: 'stripe',
        status: 'succeeded',
        stripePaymentIntentId: paymentIntent.id,
        paidDate: now,
      }).returning({ id: payments.id });

      const paymentId = newPayment.id;
      console.log('[WEBHOOK APPLY]', { invoiceId, paymentId, status: 'succeeded', amountCents, piId: paymentIntent.id });

      const recomputed = await persistRecomputedTotals(parseInt(invoiceId));
      const newStatus = recomputed.computedStatus;
      console.log('[webhook pi.succeeded] recomputed', { invoiceId, paidCents: recomputed.paidCents, owedCents: recomputed.owedCents, computedStatus: newStatus });

      await db.update(invoices).set({
        stripePaymentIntentId: paymentIntent.id,
      }).where(eq(invoices.id, parseInt(invoiceId)));

      if (effectiveJobId) {
        await recomputeJobPaymentAndMaybeArchive(effectiveJobId, 'webhook-pi');
      }

      const targetCompanyIdForNotif = companyId ? parseInt(companyId) : existingInvoice.companyId;
      const amountDollars = (amountCents / 100).toFixed(2);
      try {
        console.log(`[stripe] payment_intent.succeeded companyId=${targetCompanyIdForNotif} invoiceId=${invoiceId} amount=$${amountDollars}`);
        await notifyOwners(targetCompanyIdForNotif, {
          type: 'invoice_paid',
          title: 'Payment Received',
          body: `Invoice paid – $${amountDollars}`,
          entityType: 'invoice',
          entityId: parseInt(invoiceId),
          linkUrl: `/invoicing/${invoiceId}`,
          meta: {
            invoiceId,
            amountCents: String(amountCents),
            stripePaymentIntentId: paymentIntent.id,
          },
        });
      } catch (notifErr) {
        console.error('[stripe] PI notification error:', notifErr);
      }

      if (paymentId) {
        const targetCompanyId = companyId ? parseInt(companyId) : existingInvoice.companyId;
        console.log(`[QB-PAY] Triggered from PI webhook invoiceId=${invoiceId} stripeId=${paymentIntent.id}`);

        syncPaymentToQboFromWebhook(paymentId, targetCompanyId, paymentIntent.id)
          .then(result => {
            if (result.success) {
              console.log(`[QB-PAY] PI webhook payment synced: ${result.qboPaymentId}`);
            } else {
              console.log(`[QB-PAY] PI webhook payment sync: ${result.error}`);
            }
          })
          .catch(err => console.error('[QB-PAY] PI webhook sync error:', err));
      }

      sendReceiptForPayment(paymentId).catch(err =>
        console.error('[receipt] webhook PI new payment error:', err?.message));

      if (effectiveJobId) {
        const newPiChargeId = paymentIntent.latest_charge
          ? (typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge.id)
          : null;
        console.log(`[SubPayExec] pi-new: invoiceId=${invoiceId} jobId=${effectiveJobId} paymentId=${paymentId} pi=${paymentIntent.id} chargeId=${newPiChargeId}`);

        stripeConnectService.executeSubcontractPayout({
          jobId: effectiveJobId,
          invoiceId: parseInt(invoiceId),
          paymentId,
          paymentIntentId: paymentIntent.id,
          paymentAmountCents: amountCents,
          ownerCompanyId: companyId ? parseInt(companyId) : existingInvoice.companyId,
          source: "webhook-pi-new",
          chargeId: newPiChargeId,
        }).catch(err => console.error('[SubPayExec] webhook-pi-new error:', err?.message));
      }
    } catch (error: any) {
      console.error('[Stripe Webhook] Error processing payment_intent.succeeded:', error);
      return res.status(500).send('Error processing payment');
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const { invoiceId } = paymentIntent.metadata || {};
    const lastError = paymentIntent.last_payment_error;

    console.warn(`[Stripe Webhook] payment_intent.payment_failed: piId=${paymentIntent.id}, invoiceId=${invoiceId || 'none'}, error=${lastError?.message || 'unknown'}`);

    if (invoiceId) {
      try {
        const [existingPayment] = await db
          .select()
          .from(payments)
          .where(eq(payments.stripePaymentIntentId, paymentIntent.id));

        if (existingPayment) {
          await db.update(payments).set({
            status: 'failed',
          }).where(eq(payments.id, existingPayment.id));
          console.log(`[Stripe Webhook] Payment ${existingPayment.id} marked as failed`);
        }
      } catch (error: any) {
        console.error('[Stripe Webhook] Error processing payment_intent.payment_failed:', error.message);
      }
    }
  }

  if (event.type === 'charge.refunded' || event.type === 'charge.refund.updated') {
    const charge = event.data.object as Stripe.Charge;
    const chargeRefunds = charge.refunds?.data || [];
    console.log(`[Stripe Webhook] Refund event: ${event.type} chargeId=${charge.id} refundsCount=${chargeRefunds.length}`);

    try {
      for (const stripeRefund of chargeRefunds) {
        const [existingRefund] = await db.select().from(refunds).where(eq(refunds.stripeRefundId, stripeRefund.id));
        if (!existingRefund) {
          console.log(`[Stripe Webhook] No local refund found for stripeRefundId=${stripeRefund.id}, skipping`);
          continue;
        }

        const newStatus = stripeRefund.status === 'succeeded' ? 'succeeded'
          : stripeRefund.status === 'failed' ? 'failed'
          : stripeRefund.status === 'canceled' ? 'cancelled'
          : 'pending';

        if (existingRefund.status === newStatus) {
          console.log(`[Stripe Webhook] Refund ${existingRefund.id} already ${newStatus}, skipping`);
          continue;
        }

        const [updatedRow] = await db.update(refunds)
          .set({ status: newStatus as any })
          .where(and(eq(refunds.id, existingRefund.id), eq(refunds.status, existingRefund.status as any)))
          .returning();

        if (!updatedRow) {
          console.log(`[Stripe Webhook] Refund ${existingRefund.id} already transitioned from ${existingRefund.status}, skipping (concurrent)`);
          continue;
        }

        console.log(`[Stripe Webhook] Refund ${existingRefund.id} status updated: ${existingRefund.status} -> ${newStatus}`);

        if (newStatus === 'succeeded' && existingRefund.status === 'pending') {
          const [payment] = await db.select().from(payments).where(eq(payments.id, existingRefund.paymentId));
          if (payment) {
            const paymentAmountCents = payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100);
            const newRefundedTotal = (payment.refundedAmountCents || 0) + existingRefund.amountCents;
            let paymentStatus = 'paid';
            if (newRefundedTotal >= paymentAmountCents) paymentStatus = 'refunded';
            else if (newRefundedTotal > 0) paymentStatus = 'partially_refunded';

            await db
              .update(payments)
              .set({ refundedAmountCents: newRefundedTotal, status: paymentStatus })
              .where(eq(payments.id, payment.id));

            console.log(`[Stripe Webhook] Payment ${payment.id} updated: refunded=${newRefundedTotal}, status=${paymentStatus}`);

            if (payment.invoiceId) {
              const [invoice] = await db.select().from(invoices).where(eq(invoices.id, payment.invoiceId));
              if (invoice) {
                const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount || '0') * 100);
                const allPayments = await db.select().from(payments).where(eq(payments.invoiceId, payment.invoiceId));

                let totalPaymentsCents = 0;
                let totalRefundedOnPayments = 0;
                for (const p of allPayments) {
                  const pAmt = p.amountCents || Math.round(parseFloat(p.amount || '0') * 100);
                  totalPaymentsCents += pAmt;
                  totalRefundedOnPayments += (p.id === payment.id ? newRefundedTotal : (p.refundedAmountCents || 0));
                }

                const netPaid = totalPaymentsCents - totalRefundedOnPayments;
                const balanceDueCents = Math.max(0, invoiceTotalCents - netPaid);

                let invoiceStatus: string;
                if (totalPaymentsCents === 0) {
                  invoiceStatus = 'pending';
                } else if (totalRefundedOnPayments > 0 && netPaid <= 0) {
                  invoiceStatus = 'refunded';
                } else if (totalPaymentsCents < invoiceTotalCents) {
                  invoiceStatus = 'partial';
                } else if (totalRefundedOnPayments > 0) {
                  invoiceStatus = 'partially_refunded';
                } else {
                  invoiceStatus = 'paid';
                }

                await db.update(invoices).set({
                  paidAmountCents: Math.max(0, netPaid),
                  balanceDueCents,
                  status: invoiceStatus,
                  updatedAt: new Date(),
                } as any).where(eq(invoices.id, payment.invoiceId));

                if (invoice.jobId) {
                  const jobPaymentStatus = balanceDueCents === 0 && netPaid > 0 ? 'paid' : netPaid > 0 ? 'partial' : 'unpaid';
                  await db.update(jobs).set({ paymentStatus: jobPaymentStatus }).where(eq(jobs.id, invoice.jobId));
                }

                console.log(`[Stripe Webhook] Invoice ${payment.invoiceId} updated: status=${invoiceStatus}, balance=${balanceDueCents}`);
              }
            }
          }
        }
      }
    } catch (error: any) {
      console.error('[Stripe Webhook] Error processing refund event:', error.message);
    }
  }

  if (event.type === 'payout.paid' || event.type === 'payout.failed') {
    const payout = event.data.object as Stripe.Payout;
    const payoutId = payout.id;
    console.log(`[Stripe Webhook] Payout event: ${event.type} payoutId=${payoutId}`);

    try {
      const [bankRefund] = await db
        .select()
        .from(bankRefunds)
        .where(eq(bankRefunds.stripePayoutId, payoutId));

      if (bankRefund) {
        const newStatus = event.type === 'payout.paid' ? 'paid' : 'failed';

        if (bankRefund.status === newStatus) {
          console.log(`[Stripe Webhook] Bank refund ${bankRefund.id} already ${newStatus}, skipping`);
          return res.json({ received: true });
        }

        const failureReason = event.type === 'payout.failed' ? (payout.failure_message || 'Payout failed') : null;

        await db
          .update(bankRefunds)
          .set({ status: newStatus, failureReason, updatedAt: new Date() })
          .where(eq(bankRefunds.id, bankRefund.id));

        if (bankRefund.refundId) {
          const refundStatus = newStatus === 'paid' ? 'succeeded' : 'failed';
          await db
            .update(refunds)
            .set({ status: refundStatus })
            .where(eq(refunds.id, bankRefund.refundId));

          if (newStatus === 'paid') {
            const [refund] = await db
              .select()
              .from(refunds)
              .where(eq(refunds.id, bankRefund.refundId));

            if (refund) {
              const [payment] = await db
                .select()
                .from(payments)
                .where(eq(payments.id, refund.paymentId));

              if (payment) {
                const paymentAmountCents = payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100);
                const newRefundedTotal = (payment.refundedAmountCents || 0) + refund.amountCents;
                let paymentStatus = 'paid';
                if (newRefundedTotal >= paymentAmountCents) paymentStatus = 'refunded';
                else if (newRefundedTotal > 0) paymentStatus = 'partially_refunded';

                await db
                  .update(payments)
                  .set({ refundedAmountCents: newRefundedTotal, status: paymentStatus })
                  .where(eq(payments.id, payment.id));

                console.log(`[Stripe Webhook] Payment ${payment.id} updated: refunded=${newRefundedTotal}, status=${paymentStatus}`);
              }
            }
          }
        }

        console.log(`[Stripe Webhook] Bank refund ${bankRefund.id} updated to ${newStatus}`);
      } else {
        console.log(`[Stripe Webhook] No bank refund found for payout ${payoutId}`);
      }
    } catch (error: any) {
      console.error('[Stripe Webhook] Error processing payout event:', error.message);
    }
  }

  res.json({ received: true });
});

// Telnyx webhook endpoint - uses raw body for signature verification
app.post('/api/webhooks/telnyx/sms', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = req.body?.toString?.() || '';
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.log('[telnyx] webhook parse error');
      return res.status(400).send('Bad request');
    }

    const eventType = payload?.data?.event_type;
    const msgData = payload?.data?.payload;

    if (eventType === 'message.received') {
      const fromPhone = msgData?.from?.phone_number || '';
      const toPhone = msgData?.to?.[0]?.phone_number || msgData?.to || '';
      const msgId = msgData?.id || '';
      console.log(`[telnyx] inbound from=***${fromPhone.slice(-4)} to=***${toPhone.toString().slice(-4)} msgId=${msgId}`);
    } else if (eventType === 'message.sent' || eventType === 'message.finalized') {
      const msgId = msgData?.id || '';
      const toEntry = msgData?.to?.[0] || {};
      const status = toEntry?.status || msgData?.status || '';
      if (status === 'delivery_failed' || status === 'sending_failed') {
        const err0 = msgData?.errors?.[0] || msgData?.error || toEntry?.errors?.[0] || {};
        const errCode = err0?.code || msgData?.response?.status || msgData?.detail?.code || '';
        const errDetail = err0?.detail || err0?.message || msgData?.detail?.detail || msgData?.detail || msgData?.response?.body || '';
        const fromLast4 = (msgData?.from?.phone_number || '').slice(-4);
        const toLast4 = (toEntry?.phone_number || '').slice(-4);
        console.log(`[telnyx] ${status} msgId=${msgId} from=***${fromLast4} to=***${toLast4} code=${errCode} detail="${typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail)}"`);
      } else {
        console.log(`[telnyx] status update event=${eventType} msgId=${msgId} status=${status}`);
      }
    } else {
      console.log(`[telnyx] webhook event=${eventType || 'unknown'}`);
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[telnyx] webhook error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const allowed = [
      process.env.APP_BASE_URL,
      ...(process.env.REPLIT_DOMAINS || '').split(',').filter(Boolean).map(d => `https://${d}`),
    ].filter(Boolean);
    if (allowed.includes(origin) || origin.endsWith('.replit.dev') || origin.endsWith('.replit.app')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Client-Type');
    }
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(cookieParser());

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
    if (process.env.NODE_ENV !== 'production' && process.env.BYPASS_SUBSCRIPTION === '1') {
      console.log('[subscriptions] DEV BYPASS enabled');
    } else {
      console.log('[subscriptions] DEV BYPASS disabled');
    }
    startOverdueInvoiceChecker();
    startJobScheduler();
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
        totalCents: invoices.totalCents,
        balanceDueCents: invoices.balanceDueCents,
        amount: invoices.amount,
        dueDate: invoices.dueDate,
        jobId: invoices.jobId,
      })
      .from(invoices)
      .where(
        and(
          isNull(invoices.overdueNotifiedAt),
          lt(invoices.dueDate, today),
          ne(invoices.status, 'paid'),
          ne(invoices.status, 'cancelled'),
          sql`${invoices.balanceDueCents} > 0`,
          isNull(invoices.deletedAt)
        )
      );

    for (const inv of overdueInvoices) {
      try {
        const balanceDollars = (inv.balanceDueCents / 100).toFixed(2);

        await notifyManagers(inv.companyId, {
          type: 'invoice_overdue',
          title: 'Invoice Overdue',
          body: `${inv.invoiceNumber || `INV-${inv.id}`} • $${balanceDollars} past due`,
          entityType: 'invoice',
          entityId: inv.id,
          linkUrl: inv.jobId ? `/jobs/${inv.jobId}` : undefined,
        });

        await db.update(invoices)
          .set({ overdueNotifiedAt: new Date() })
          .where(eq(invoices.id, inv.id));
      } catch (err) {
        console.error(`[Overdue] Failed to notify for invoice ${inv.id}:`, err);
      }
    }

    if (overdueInvoices.length > 0) {
      console.log(`[Overdue] Sent ${overdueInvoices.length} overdue invoice notification(s)`);
    }
  } catch (error) {
    console.error('[Overdue] Error checking overdue invoices:', error);
  }
}

function startOverdueInvoiceChecker() {
  checkOverdueInvoices();
  setInterval(() => checkOverdueInvoices(), 24 * 60 * 60_000);
}
