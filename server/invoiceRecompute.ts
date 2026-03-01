import { db } from "./db";
import { invoices, payments, jobs } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";

export async function recomputeInvoiceTotalsFromPayments(invoiceId: number): Promise<{ paidCents: number; owedCents: number; computedStatus: string; totalCents: number }> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) return { paidCents: 0, owedCents: 0, computedStatus: 'unpaid', totalCents: 0 };

  const totalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100);

  const [sumResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)` })
    .from(payments)
    .where(and(
      eq(payments.invoiceId, invoiceId),
      sql`LOWER(${payments.status}) IN ('paid', 'succeeded', 'completed')`
    ));

  const paidCents = Number(sumResult?.total || 0);
  const owedCents = Math.max(0, totalCents - paidCents);
  let computedStatus: string;
  if (owedCents === 0 && totalCents > 0) computedStatus = 'paid';
  else if (paidCents > 0) computedStatus = 'partial';
  else computedStatus = (invoice.status || 'unpaid').toLowerCase();

  console.log(`[recompute] invoice=${invoiceId} total=${totalCents} sumPaid=${paidCents} owed=${owedCents} status=${computedStatus}`);
  return { paidCents, owedCents, computedStatus, totalCents };
}

export async function persistRecomputedTotals(invoiceId: number): Promise<{ paidCents: number; owedCents: number; computedStatus: string }> {
  const result = await recomputeInvoiceTotalsFromPayments(invoiceId);
  const now = new Date();
  await db.update(invoices).set({
    paidAmountCents: result.paidCents,
    balanceDueCents: result.owedCents,
    status: result.computedStatus,
    ...(result.computedStatus === 'paid' ? { paidAt: now, paidDate: now.toISOString().split('T')[0] } : {}),
    updatedAt: now,
  }).where(eq(invoices.id, invoiceId));
  return result;
}

export async function recomputeJobPaymentAndMaybeArchive(
  jobId: number,
  via: string = 'unknown',
): Promise<{ archived: boolean; jobPaymentStatus: string }> {
  const jobInvoices = await db.select().from(invoices).where(eq(invoices.jobId, jobId));

  if (jobInvoices.length === 0) {
    return { archived: false, jobPaymentStatus: 'unpaid' };
  }

  let allPaid = true;
  let anyPaid = false;

  for (const inv of jobInvoices) {
    const totalCents = inv.totalCents > 0 ? inv.totalCents : Math.round(parseFloat(inv.amount) * 100);
    if (totalCents <= 0) continue;

    const [sumResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)` })
      .from(payments)
      .where(and(
        eq(payments.invoiceId, inv.id),
        sql`LOWER(${payments.status}) IN ('paid', 'succeeded', 'completed')`
      ));

    const paidCents = Number(sumResult?.total || 0);
    if (paidCents > 0) anyPaid = true;
    if (paidCents < totalCents) allPaid = false;
  }

  const jobPaymentStatus = allPaid ? 'paid' : anyPaid ? 'partial' : 'unpaid';
  const now = new Date();

  await db.update(jobs).set({
    paymentStatus: jobPaymentStatus,
    ...(jobPaymentStatus === 'paid' ? { paidAt: now } : {}),
    updatedAt: now,
  }).where(eq(jobs.id, jobId));

  let archived = false;
  if (allPaid) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (job && !job.archivedAt) {
      await db.update(jobs).set({
        status: 'archived',
        archivedAt: now,
        archivedReason: 'paid',
      }).where(and(eq(jobs.id, jobId), sql`archived_at IS NULL`));
      archived = true;
      console.log(`[archive] Job ${jobId} auto-archived (all invoices paid) via=${via}`);
    }
  }

  console.log(`[recomputeJob] jobId=${jobId} invoices=${jobInvoices.length} paymentStatus=${jobPaymentStatus} archived=${archived} via=${via}`);
  return { archived, jobPaymentStatus };
}
