import { db } from "./db";
import { invoices, payments, jobs, jobReferrals } from "../shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

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
  // Fetch the job first to get its current companyId (it may have transferred via referral)
  const [currentJob] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!currentJob) {
    console.log(`[recomputeJob] jobId=${jobId} not found, skipping`);
    return { archived: false, jobPaymentStatus: 'unpaid' };
  }

  // Only consider invoices belonging to the job's CURRENT owner company.
  // This prevents old sender-company invoices (from before a referral transfer)
  // from blocking the allPaid check indefinitely.
  const jobInvoices = await db.select().from(invoices).where(
    and(eq(invoices.jobId, jobId), eq(invoices.companyId, currentJob.companyId))
  );

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
    if (!currentJob.archivedAt) {
      await db.update(jobs).set({
        status: 'archived',
        archivedAt: now,
        archivedReason: 'paid',
      }).where(and(eq(jobs.id, jobId), sql`archived_at IS NULL`));
      archived = true;
      console.log(`[archive] Job ${jobId} auto-archived (all invoices paid) via=${via}`);

      // Mark any accepted referral for this job as completed
      await markReferralCompleted(jobId, now);
    }
  }

  console.log(`[recomputeJob] jobId=${jobId} companyId=${currentJob.companyId} invoices=${jobInvoices.length} paymentStatus=${jobPaymentStatus} archived=${archived} via=${via}`);
  return { archived, jobPaymentStatus };
}

export async function markReferralCompleted(jobId: number, now?: Date): Promise<void> {
  try {
    const ts = now || new Date();

    // Fetch the referral BEFORE updating so we have payout details
    const [referral] = await db.select().from(jobReferrals)
      .where(and(eq(jobReferrals.jobId, jobId), sql`${jobReferrals.status} = 'accepted'`));

    await db.update(jobReferrals)
      .set({ status: 'completed' } as any)
      .where(and(eq(jobReferrals.jobId, jobId), sql`${jobReferrals.status} = 'accepted'`));

    console.log(`[referral] Job ${jobId} referral marked completed`);

    // Create receiver-side payout records so the receiver company has financial history
    if (referral?.receiverCompanyId && referral?.contractorPayoutAmountCents && referral.contractorPayoutAmountCents > 0) {
      await ensureReceiverPayoutRecord(jobId, referral, ts);
    }
  } catch (err: any) {
    console.error(`[referral] Failed to mark referral completed for job ${jobId}:`, err?.message);
  }
}

async function ensureReceiverPayoutRecord(
  jobId: number,
  referral: { receiverCompanyId: number | null; contractorPayoutAmountCents: number | null },
  now: Date,
): Promise<void> {
  try {
    const receiverCompanyId = referral.receiverCompanyId!;
    const payoutCents = referral.contractorPayoutAmountCents!;

    // Idempotency: skip if receiver already has an invoice for this job
    const [existing] = await db.select({ id: invoices.id }).from(invoices)
      .where(and(
        eq(invoices.jobId, jobId),
        eq(invoices.companyId, receiverCompanyId),
        isNull(invoices.deletedAt),
      ));

    if (existing) {
      console.log(`[payout-record] Job ${jobId} receiver company ${receiverCompanyId} already has invoice ${existing.id}, skipping`);
      return;
    }

    // Get job info for invoice context
    const [job] = await db.select({
      customerId: jobs.customerId,
      clientId: jobs.clientId,
      title: jobs.title,
    }).from(jobs).where(eq(jobs.id, jobId));

    const payoutDollars = (payoutCents / 100).toFixed(2);
    const invoiceNumber = `PAYOUT-${jobId}`;

    // Create a payout invoice for the receiver (represents their earned share)
    const [payoutInvoice] = await db.insert(invoices).values({
      companyId: receiverCompanyId,
      jobId,
      customerId: job?.customerId ?? null,
      clientId: job?.clientId ?? null,
      invoiceNumber,
      amount: payoutDollars,
      subtotalCents: payoutCents,
      taxCents: 0,
      totalCents: payoutCents,
      paidAmountCents: payoutCents,
      balanceDueCents: 0,
      status: 'paid',
      issueDate: now.toISOString().split('T')[0],
      paidAt: now,
      paidDate: now.toISOString().split('T')[0],
      notes: `Referral payout for job #${jobId} — subcontract earnings`,
      createdAt: now,
      updatedAt: now,
    } as any).returning();

    // Create a matching payment record for the receiver
    await db.insert(payments).values({
      companyId: receiverCompanyId,
      jobId,
      invoiceId: payoutInvoice.id,
      customerId: job?.customerId ?? null,
      amount: payoutDollars,
      amountCents: payoutCents,
      paymentMethod: 'stripe',
      status: 'paid',
      paidDate: now,
      notes: `Subcontract payout via Stripe transfer`,
      createdAt: now,
      updatedAt: now,
    } as any).returning();

    console.log(`[payout-record] Created receiver payout invoice ${payoutInvoice.id} + payment for company ${receiverCompanyId}, job ${jobId}, $${payoutDollars}`);
  } catch (err: any) {
    console.error(`[payout-record] Failed to create receiver payout record for job ${jobId}:`, err?.message);
  }
}
