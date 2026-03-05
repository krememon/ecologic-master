import { db } from "./db";
import { payments, invoices, customers, companies } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { sendPaymentReceiptEmail } from "./email";
import { recomputeInvoiceTotalsFromPayments } from "./invoiceRecompute";
import { storage } from "./storage";
import fs from "fs";

export async function sendReceiptForPayment(paymentId: number): Promise<{ success: boolean; messageId?: string; error?: string }> {
  console.log('[receipt] attempt', { paymentId });

  try {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) {
      console.log('[receipt] payment not found', { paymentId });
      return { success: false, error: 'payment_not_found' };
    }

    if (payment.receiptEmailSentAt) {
      console.log('[receipt] already sent', { paymentId, sentAt: payment.receiptEmailSentAt });
      return { success: true, messageId: payment.receiptMessageId || undefined };
    }

    const paidStatuses = ['paid', 'succeeded', 'completed'];
    if (!paidStatuses.includes((payment.status || '').toLowerCase())) {
      console.log('[receipt] payment not in paid status', { paymentId, status: payment.status });
      return { success: false, error: 'payment_not_paid' };
    }

    const effectiveInvoiceId = payment.invoiceId;
    if (!effectiveInvoiceId) {
      console.log('[receipt] no invoiceId on payment', { paymentId });
      await db.update(payments).set({ receiptError: 'missing_invoice_id' }).where(eq(payments.id, paymentId));
      return { success: false, error: 'missing_invoice_id' };
    }

    const invoice = await storage.getInvoice(effectiveInvoiceId);
    if (!invoice) {
      console.log('[receipt] invoice not found', { paymentId, invoiceId: effectiveInvoiceId });
      await db.update(payments).set({ receiptError: 'invoice_not_found' }).where(eq(payments.id, paymentId));
      return { success: false, error: 'invoice_not_found' };
    }

    const customer = invoice.customerId ? await storage.getCustomer(invoice.customerId) : null;
    const customerEmail = customer?.email;
    if (!customerEmail) {
      console.log('[receipt] missing customer email', { paymentId, invoiceId: effectiveInvoiceId, customerId: invoice.customerId });
      await db.update(payments).set({ receiptError: 'missing_customer_email' }).where(eq(payments.id, paymentId));
      return { success: false, error: 'missing_customer_email' };
    }

    const company = await storage.getCompany(payment.companyId);
    const companyName = company?.name || 'Your contractor';
    const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Valued Customer';

    const amountCents = payment.amountCents || Math.round(parseFloat(payment.amount) * 100);
    const amountFormatted = `$${(amountCents / 100).toFixed(2)}`;

    const paidDate = payment.paidDate
      ? new Date(payment.paidDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const computed = await recomputeInvoiceTotalsFromPayments(effectiveInvoiceId);
    const isPartial = computed.owedCents > 0;
    const balanceRemainingFormatted = `$${(computed.owedCents / 100).toFixed(2)}`;

    let pdfAttachment: { filename: string; content: Buffer } | null = null;

    if (invoice.pdfUrl) {
      try {
        const pdfPath = invoice.pdfUrl.startsWith('/') ? invoice.pdfUrl.substring(1) : invoice.pdfUrl;
        if (fs.existsSync(pdfPath)) {
          const pdfBuffer = fs.readFileSync(pdfPath);
          pdfAttachment = {
            filename: `Invoice_${(invoice.invoiceNumber || '').replace(/-/g, '_')}.pdf`,
            content: pdfBuffer,
          };
          console.log('[receipt] reusing existing PDF', { path: pdfPath, size: pdfBuffer.length });
        }
      } catch (pdfErr: any) {
        console.log('[receipt] existing PDF read failed:', pdfErr?.message);
      }
    }

    const meta = (payment.meta && typeof payment.meta === 'object') ? payment.meta as Record<string, any> : {};
    const discountInfo = meta.discount && meta.discount.enabled ? {
      type: meta.discount.type as 'amount' | 'percent',
      value: meta.discount.value as number,
      amountCents: meta.discount.amountCents as number,
      reason: meta.discount.reason as string | null,
    } : undefined;

    console.log('[receipt] sending', { paymentId, invoiceId: effectiveInvoiceId, to: customerEmail, isPartial, hasDiscount: !!discountInfo });

    const messageId = await sendPaymentReceiptEmail({
      to: customerEmail,
      customerName,
      companyName,
      invoiceNumber: invoice.invoiceNumber || `INV-${effectiveInvoiceId}`,
      amountFormatted,
      paymentMethod: payment.paymentMethod || 'other',
      paidDate,
      pdfAttachment,
      balanceRemainingFormatted: isPartial ? balanceRemainingFormatted : undefined,
      isPartial,
      discount: discountInfo,
    });

    await db
      .update(payments)
      .set({
        receiptEmailSentAt: new Date(),
        receiptEmailTo: customerEmail,
        receiptMessageId: messageId || null,
        receiptError: null,
      })
      .where(and(eq(payments.id, paymentId), sql`receipt_email_sent_at IS NULL`));

    console.log('[receipt] sent', { paymentId, messageId, to: customerEmail });
    return { success: true, messageId: messageId || undefined };
  } catch (err: any) {
    const errorMsg = (err?.message || String(err)).substring(0, 500);
    console.error('[receipt] failed', { paymentId, error: errorMsg });

    try {
      await db.update(payments).set({ receiptError: errorMsg }).where(eq(payments.id, paymentId));
    } catch {}

    return { success: false, error: errorMsg };
  }
}
