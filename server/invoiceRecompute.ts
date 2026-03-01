import { db } from "./db";
import { invoices, payments } from "../shared/schema";
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
