import Stripe from "stripe";
import crypto from "crypto";
import { db } from "../db";
import { companies, jobReferrals, subcontractPayoutAudit, payments } from "../../shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-04-30.basil" as any,
});

export function isTransferEnabled(): boolean {
  return process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED === "true";
}

export async function createConnectedAccount(companyId: number, companyName: string, companyEmail?: string | null) {
  console.log(`[StripeConnect] Creating connected account for company ${companyId}: ${companyName}`);

  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    email: companyEmail || undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      ecologic_company_id: String(companyId),
      ecologic_company_name: companyName,
    },
  });

  await db.update(companies).set({
    stripeConnectAccountId: account.id,
    stripeConnectStatus: "pending_onboarding",
    stripeConnectChargesEnabled: account.charges_enabled,
    stripeConnectPayoutsEnabled: account.payouts_enabled,
    stripeConnectDetailsSubmitted: account.details_submitted,
    stripeConnectLastCheckedAt: new Date(),
  }).where(eq(companies.id, companyId));

  console.log(`[StripeConnect] Created account ${account.id} for company ${companyId}`);
  return account;
}

export async function createOnboardingLink(stripeAccountId: string, returnUrl: string, refreshUrl: string) {
  console.log(`[StripeConnect] Creating onboarding link for ${stripeAccountId}`);

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return accountLink;
}

export async function retrieveAccountStatus(stripeAccountId: string) {
  const account = await stripe.accounts.retrieve(stripeAccountId);
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    requirements: account.requirements,
  };
}

export async function syncAccountStatus(companyId: number, stripeAccountId: string) {
  console.log(`[StripeConnect] Syncing account status for company ${companyId}, account ${stripeAccountId}`);

  const account = await stripe.accounts.retrieve(stripeAccountId);

  let status = "pending_onboarding";
  if (account.charges_enabled && account.payouts_enabled) {
    status = "active";
  } else if (account.details_submitted) {
    status = "restricted";
  } else if (account.requirements?.disabled_reason) {
    status = "disabled";
  }

  const updateData: any = {
    stripeConnectStatus: status,
    stripeConnectChargesEnabled: account.charges_enabled,
    stripeConnectPayoutsEnabled: account.payouts_enabled,
    stripeConnectDetailsSubmitted: account.details_submitted,
    stripeConnectLastCheckedAt: new Date(),
  };

  if (account.charges_enabled && account.payouts_enabled) {
    updateData.stripeConnectOnboardedAt = new Date();
  }

  await db.update(companies).set(updateData).where(eq(companies.id, companyId));

  console.log(`[StripeConnect] Synced company ${companyId}: status=${status} charges=${account.charges_enabled} payouts=${account.payouts_enabled}`);

  return {
    status,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    requirements: account.requirements,
  };
}

export function isPayoutReady(company: {
  stripeConnectAccountId?: string | null;
  stripeConnectStatus?: string | null;
  stripeConnectChargesEnabled?: boolean | null;
  stripeConnectPayoutsEnabled?: boolean | null;
}): boolean {
  return (
    !!company.stripeConnectAccountId &&
    company.stripeConnectStatus === "active" &&
    company.stripeConnectChargesEnabled === true &&
    company.stripeConnectPayoutsEnabled === true
  );
}

export function computeSubcontractSplit(referral: {
  referralType: string;
  referralValue: string;
  contractorPayoutAmountCents?: number | null;
  companyShareAmountCents?: number | null;
  jobTotalAtAcceptanceCents?: number | null;
}, paymentAmountCents: number) {
  if (referral.referralType === "percent") {
    const pct = parseFloat(referral.referralValue) / 100;
    const contractorPayout = Math.round(paymentAmountCents * pct);
    const companyShare = paymentAmountCents - contractorPayout;
    return { contractorPayoutCents: contractorPayout, companyShareCents: companyShare };
  }

  if (referral.referralType === "flat") {
    const flatFeeCents = Math.round(parseFloat(referral.referralValue) * 100);
    if (referral.jobTotalAtAcceptanceCents && referral.jobTotalAtAcceptanceCents > 0) {
      const ratio = paymentAmountCents / referral.jobTotalAtAcceptanceCents;
      const scaledFee = Math.round(Math.min(flatFeeCents, referral.jobTotalAtAcceptanceCents) * ratio);
      const capped = Math.min(scaledFee, paymentAmountCents);
      return { contractorPayoutCents: paymentAmountCents - capped, companyShareCents: capped };
    }
    const scaledFee = Math.min(flatFeeCents, paymentAmountCents);
    return { contractorPayoutCents: paymentAmountCents - scaledFee, companyShareCents: scaledFee };
  }

  const companyShare = Math.round(paymentAmountCents * 0);
  return { contractorPayoutCents: paymentAmountCents, companyShareCents: companyShare };
}

export function generateDeterministicIdempotencyKey(paymentId: number, referralId: number): string {
  return `subpay_${paymentId}_${referralId}`;
}

export async function getAcceptedReferralForJob(jobId: number) {
  const [referral] = await db
    .select()
    .from(jobReferrals)
    .where(and(eq(jobReferrals.jobId, jobId), inArray(jobReferrals.status, ["accepted", "completed"])))
    .limit(1);
  return referral || null;
}

export async function checkExistingPayout(paymentId: number, referralId: number) {
  const [existing] = await db
    .select()
    .from(subcontractPayoutAudit)
    .where(
      and(
        eq(subcontractPayoutAudit.paymentId, paymentId),
        eq(subcontractPayoutAudit.referralId, referralId),
      )
    )
    .limit(1);
  return existing || null;
}

async function getCumulativePayoutForReferral(referralId: number): Promise<number> {
  const [result] = await db
    .select({ total: sql<number>`COALESCE(SUM(${subcontractPayoutAudit.contractorPayoutAmountCents}), 0)` })
    .from(subcontractPayoutAudit)
    .where(
      and(
        eq(subcontractPayoutAudit.referralId, referralId),
        eq(subcontractPayoutAudit.status, "completed"),
      )
    );
  return Number(result?.total || 0);
}

async function getCumulativeGrossForReferral(referralId: number): Promise<number> {
  const [result] = await db
    .select({ total: sql<number>`COALESCE(SUM(${subcontractPayoutAudit.grossAmountCents}), 0)` })
    .from(subcontractPayoutAudit)
    .where(
      and(
        eq(subcontractPayoutAudit.referralId, referralId),
        eq(subcontractPayoutAudit.status, "completed"),
      )
    );
  return Number(result?.total || 0);
}

export async function createPayoutAuditRecord(data: {
  jobId: number;
  invoiceId?: number | null;
  paymentId: number;
  paymentIntentId?: string | null;
  chargeId?: string | null;
  ownerCompanyId: number;
  subcontractorCompanyId?: number | null;
  referralId: number;
  grossAmountCents: number;
  contractorPayoutAmountCents: number;
  companyShareAmountCents: number;
  stripeFeeAmountCents?: number | null;
  netRetainedAmountCents?: number | null;
  transferAmountCents?: number | null;
  stripeTransferId?: string | null;
  destinationAccountId?: string | null;
  secondTransferAmountCents?: number | null;
  secondStripeTransferId?: string | null;
  secondDestinationAccountId?: string | null;
  secondSubcontractorCompanyId?: number | null;
  status: string;
  idempotencyKey: string;
  failureReason?: string | null;
  rawMeta?: any;
}) {
  const [record] = await db.insert(subcontractPayoutAudit).values({
    ...data,
    rawMeta: data.rawMeta || null,
  }).returning();
  return record;
}

async function updatePayoutAuditRecord(id: number, data: Partial<{
  status: string;
  stripeTransferId: string | null;
  transferAmountCents: number | null;
  destinationAccountId: string | null;
  secondTransferAmountCents: number | null;
  secondStripeTransferId: string | null;
  secondDestinationAccountId: string | null;
  secondSubcontractorCompanyId: number | null;
  failureReason: string | null;
  idempotencyKey: string | null;
  rawMeta: any;
  updatedAt: Date;
}>) {
  const [updated] = await db.update(subcontractPayoutAudit)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(subcontractPayoutAudit.id, id))
    .returning();
  return updated;
}

export async function executeSubcontractPayout(params: {
  jobId: number;
  invoiceId: number | null;
  paymentId: number;
  paymentIntentId: string | null;
  paymentAmountCents: number;
  ownerCompanyId: number;
  source: string;
  chargeId?: string | null;
}): Promise<{ status: string; auditId?: number; transferId?: string; secondTransferId?: string; reason?: string } | null> {
  const { jobId, invoiceId, paymentId, paymentIntentId, paymentAmountCents, ownerCompanyId, source, chargeId: providedChargeId } = params;
  const transferEnabled = isTransferEnabled();

  const referral = await getAcceptedReferralForJob(jobId);
  if (!referral) {
    return null;
  }

  const senderCompanyId = referral.senderCompanyId;
  const receiverCompanyId = referral.receiverCompanyId;

  console.log(`[SubPayExec] DUAL-TRANSFER jobId=${jobId} invoiceId=${invoiceId} paymentId=${paymentId} paymentIntentId=${paymentIntentId}`);
  console.log(`[SubPayExec] referralId=${referral.id} source=${source} transferEnabled=${transferEnabled}`);
  console.log(`[SubPayExec] senderCompanyId=${senderCompanyId} receiverCompanyId=${receiverCompanyId} ownerCompanyId=${ownerCompanyId}`);

  const existing = await checkExistingPayout(paymentId, referral.id);
  if (existing) {
    if (existing.status === "completed" || existing.status === "duplicate_skipped") {
      console.log(`[SubPayExec] duplicateDetected=true existingAuditId=${existing.id} status=${existing.status}`);
      return { status: "duplicate_skipped", auditId: existing.id, transferId: existing.stripeTransferId || undefined };
    }
    if (existing.status === "preview" || existing.status === "blocked" || existing.status === "failed" || existing.status === "pending") {
      console.log(`[SubPayExec] superseding existing audit id=${existing.id} status=${existing.status}`);
      await updatePayoutAuditRecord(existing.id, {
        status: "duplicate_skipped",
        failureReason: `Superseded by re-execution from ${source}`,
        idempotencyKey: `superseded_${existing.id}_${Date.now()}`,
      });
    }
  }

  const split = computeSubcontractSplit(referral, paymentAmountCents);

  console.log(`[SubPayExec] splitCalc: paymentAmountCents=${paymentAmountCents} referralType=${referral.referralType} referralValue=${referral.referralValue}`);
  console.log(`[SubPayExec] splitCalc: contractorPayout=${split.contractorPayoutCents} (receiver gets) companyShare=${split.companyShareCents} (sender keeps)`);

  if (split.contractorPayoutCents < 0 || split.companyShareCents < 0) {
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: receiverCompanyId,
      secondSubcontractorCompanyId: senderCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Split produced negative amounts",
    });
    console.log(`[SubPayExec] blockedReason=negative_split finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Split produced negative amounts" };
  }

  if (split.contractorPayoutCents + split.companyShareCents > paymentAmountCents) {
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: receiverCompanyId,
      secondSubcontractorCompanyId: senderCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Combined transfers exceed collected amount",
    });
    console.log(`[SubPayExec] blockedReason=combined_exceeds_collected finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Combined transfers exceed collected amount" };
  }

  const [senderRow] = senderCompanyId
    ? await db.select().from(companies).where(eq(companies.id, senderCompanyId)).limit(1)
    : [null];
  const [receiverRow] = receiverCompanyId
    ? await db.select().from(companies).where(eq(companies.id, receiverCompanyId)).limit(1)
    : [null];

  const senderAccountId = senderRow?.stripeConnectAccountId || null;
  const receiverAccountId = receiverRow?.stripeConnectAccountId || null;
  const senderReady = senderRow && isPayoutReady(senderRow);
  const receiverReady = receiverRow && isPayoutReady(receiverRow);

  console.log(`[SubPayExec] sender: companyId=${senderCompanyId} accountId=${senderAccountId} ready=${senderReady}`);
  console.log(`[SubPayExec] receiver: companyId=${receiverCompanyId} accountId=${receiverAccountId} ready=${receiverReady}`);

  const blockReasons: string[] = [];
  if (split.companyShareCents > 0 && (!senderAccountId || !senderReady)) {
    blockReasons.push(`Sender company ${senderCompanyId} not Stripe-connected or not ready`);
  }
  if (split.contractorPayoutCents > 0 && (!receiverAccountId || !receiverReady)) {
    blockReasons.push(`Receiver company ${receiverCompanyId} not Stripe-connected or not ready`);
  }

  if (blockReasons.length > 0) {
    const reason = blockReasons.join("; ");
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: receiverCompanyId,
      secondSubcontractorCompanyId: senderCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      destinationAccountId: receiverAccountId,
      secondDestinationAccountId: senderAccountId,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: reason,
    });
    console.log(`[SubPayExec] blockedReason=${reason} finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason };
  }

  if (!transferEnabled) {
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: receiverCompanyId,
      secondSubcontractorCompanyId: senderCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      destinationAccountId: receiverAccountId,
      secondDestinationAccountId: senderAccountId,
      transferAmountCents: split.contractorPayoutCents,
      secondTransferAmountCents: split.companyShareCents,
      status: "pending",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Transfer execution disabled (STRIPE_SUBCONTRACT_TRANSFERS_ENABLED != true)",
      rawMeta: {
        dualTransfer: true,
        referralType: referral.referralType,
        referralValue: referral.referralValue,
        receiverTransfer: { amount: split.contractorPayoutCents, destination: receiverAccountId, companyId: receiverCompanyId },
        senderTransfer: { amount: split.companyShareCents, destination: senderAccountId, companyId: senderCompanyId },
      },
    });
    console.log(`[SubPayExec] auditStatus=pending (transfers disabled) auditId=${audit.id}`);
    return { status: "pending", auditId: audit.id, reason: "Transfers disabled by config" };
  }

  const idempotencyKey = generateDeterministicIdempotencyKey(paymentId, referral.id);
  const audit = await createPayoutAuditRecord({
    jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
    subcontractorCompanyId: receiverCompanyId,
    secondSubcontractorCompanyId: senderCompanyId,
    referralId: referral.id,
    grossAmountCents: paymentAmountCents,
    contractorPayoutAmountCents: split.contractorPayoutCents,
    companyShareAmountCents: split.companyShareCents,
    destinationAccountId: receiverAccountId,
    secondDestinationAccountId: senderAccountId,
    transferAmountCents: split.contractorPayoutCents,
    secondTransferAmountCents: split.companyShareCents,
    status: "processing",
    idempotencyKey,
    rawMeta: {
      dualTransfer: true,
      referralType: referral.referralType,
      referralValue: referral.referralValue,
      source,
    },
  });

  console.log(`[SubPayExec] auditStatus=processing auditId=${audit.id}, executing DUAL transfers...`);

  let resolvedChargeId: string | null = providedChargeId || null;
  if (!resolvedChargeId && paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.latest_charge) {
        resolvedChargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id;
      }
    } catch (e: any) {
      console.warn(`[SubPayExec] Could not resolve chargeId from PI ${paymentIntentId}: ${e.message}`);
    }
  }
  console.log(`[SubPayExec] resolvedChargeId=${resolvedChargeId}`);

  try {
    let transfer1: Stripe.Transfer | null = null;
    let transfer2: Stripe.Transfer | null = null;

    if (split.contractorPayoutCents > 0) {
      const t1Params: any = {
        amount: split.contractorPayoutCents,
        currency: "usd",
        destination: receiverAccountId!,
        metadata: {
          jobId: String(jobId),
          invoiceId: invoiceId ? String(invoiceId) : "",
          paymentId: String(paymentId),
          referralId: String(referral.id),
          targetCompanyId: String(receiverCompanyId),
          role: "receiver_contractor_payout",
          auditId: String(audit.id),
          splitOf: "dual",
        },
      };
      if (resolvedChargeId) {
        t1Params.source_transaction = resolvedChargeId;
      }

      console.log(`[SubPayExec] transfer1_create: amount=${t1Params.amount} dest=${t1Params.destination} role=receiver_contractor_payout`);
      transfer1 = await stripe.transfers.create(t1Params, {
        idempotencyKey: `transfer_recv_${idempotencyKey}`,
      });
      console.log(`[SubPayExec] transfer1_done: id=${transfer1.id} amount=${transfer1.amount}`);
    }

    if (split.companyShareCents > 0) {
      const t2Params: any = {
        amount: split.companyShareCents,
        currency: "usd",
        destination: senderAccountId!,
        metadata: {
          jobId: String(jobId),
          invoiceId: invoiceId ? String(invoiceId) : "",
          paymentId: String(paymentId),
          referralId: String(referral.id),
          targetCompanyId: String(senderCompanyId),
          role: "sender_company_share",
          auditId: String(audit.id),
          splitOf: "dual",
        },
      };
      if (resolvedChargeId) {
        t2Params.source_transaction = resolvedChargeId;
      }

      console.log(`[SubPayExec] transfer2_create: amount=${t2Params.amount} dest=${t2Params.destination} role=sender_company_share`);
      transfer2 = await stripe.transfers.create(t2Params, {
        idempotencyKey: `transfer_send_${idempotencyKey}`,
      });
      console.log(`[SubPayExec] transfer2_done: id=${transfer2.id} amount=${transfer2.amount}`);
    }

    await updatePayoutAuditRecord(audit.id, {
      status: "completed",
      stripeTransferId: transfer1?.id || null,
      transferAmountCents: transfer1?.amount || 0,
      destinationAccountId: transfer1 ? (transfer1.destination as string) : receiverAccountId,
      secondStripeTransferId: transfer2?.id || null,
      secondTransferAmountCents: transfer2?.amount || 0,
      secondDestinationAccountId: transfer2 ? (transfer2.destination as string) : senderAccountId,
      secondSubcontractorCompanyId: senderCompanyId,
      rawMeta: {
        dualTransfer: true,
        referralType: referral.referralType,
        referralValue: referral.referralValue,
        source,
        transfer1: transfer1 ? { id: transfer1.id, amount: transfer1.amount, destination: transfer1.destination } : null,
        transfer2: transfer2 ? { id: transfer2.id, amount: transfer2.amount, destination: transfer2.destination } : null,
      },
    });

    console.log(`[SubPayExec] DUAL TRANSFER COMPLETE auditId=${audit.id}`);
    console.log(`[SubPayExec]   receiver(${receiverCompanyId}): ${transfer1?.amount || 0} cents → ${receiverAccountId}`);
    console.log(`[SubPayExec]   sender(${senderCompanyId}): ${transfer2?.amount || 0} cents → ${senderAccountId}`);
    console.log(`[SubPayExec]   platform retained: 0 cents`);
    return {
      status: "completed",
      auditId: audit.id,
      transferId: transfer1?.id,
      secondTransferId: transfer2?.id,
    };
  } catch (err: any) {
    const errorMsg = err?.message || "Unknown transfer error";
    console.error(`[SubPayExec] transfer FAILED: ${errorMsg}`);

    await updatePayoutAuditRecord(audit.id, {
      status: "failed",
      failureReason: errorMsg,
    });

    console.log(`[SubPayExec] auditStatus=failed auditId=${audit.id}`);
    return { status: "failed", auditId: audit.id, reason: errorMsg };
  }
}

export async function checkBothPartiesConnected(jobId: number): Promise<{
  isReferralJob: boolean;
  allReady: boolean;
  senderReady: boolean;
  receiverReady: boolean;
  senderCompanyId: number | null;
  receiverCompanyId: number | null;
  senderAccountId: string | null;
  receiverAccountId: string | null;
  blockReason: string | null;
}> {
  const referral = await getAcceptedReferralForJob(jobId);
  if (!referral) {
    return { isReferralJob: false, allReady: true, senderReady: true, receiverReady: true, senderCompanyId: null, receiverCompanyId: null, senderAccountId: null, receiverAccountId: null, blockReason: null };
  }

  const [senderRow] = referral.senderCompanyId
    ? await db.select().from(companies).where(eq(companies.id, referral.senderCompanyId)).limit(1)
    : [null];
  const [receiverRow] = referral.receiverCompanyId
    ? await db.select().from(companies).where(eq(companies.id, referral.receiverCompanyId)).limit(1)
    : [null];

  const senderReady = !!(senderRow && isPayoutReady(senderRow));
  const receiverReady = !!(receiverRow && isPayoutReady(receiverRow));
  const allReady = senderReady && receiverReady;

  const reasons: string[] = [];
  if (!senderReady) reasons.push(`Sender company (${referral.senderCompanyId}) needs to complete Stripe Connect setup`);
  if (!receiverReady) reasons.push(`Receiver company (${referral.receiverCompanyId}) needs to complete Stripe Connect setup`);

  return {
    isReferralJob: true,
    allReady,
    senderReady,
    receiverReady,
    senderCompanyId: referral.senderCompanyId,
    receiverCompanyId: referral.receiverCompanyId || null,
    senderAccountId: senderRow?.stripeConnectAccountId || null,
    receiverAccountId: receiverRow?.stripeConnectAccountId || null,
    blockReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

export async function getPayoutAuditForJob(jobId: number) {
  const records = await db
    .select()
    .from(subcontractPayoutAudit)
    .where(eq(subcontractPayoutAudit.jobId, jobId))
    .orderBy(subcontractPayoutAudit.createdAt);
  return records;
}

export async function getPayoutAuditForPayment(paymentId: number) {
  const records = await db
    .select()
    .from(subcontractPayoutAudit)
    .where(eq(subcontractPayoutAudit.paymentId, paymentId))
    .orderBy(subcontractPayoutAudit.createdAt);
  return records;
}

/**
 * Backfill: find all completed/accepted referrals whose Stripe payments
 * succeeded but never produced a payout audit record, and trigger the payout now.
 * Safe to run at startup — idempotency guard in executeSubcontractPayout prevents duplicates.
 */
export async function backfillMissingSubcontractPayouts(): Promise<void> {
  console.log("[SubPayBackfill] Starting backfill scan for missing subcontract payouts...");

  const referrals = await db
    .select()
    .from(jobReferrals)
    .where(inArray(jobReferrals.status, ["accepted", "completed"]));

  if (!referrals.length) {
    console.log("[SubPayBackfill] No accepted/completed referrals found. Skipping.");
    return;
  }

  let checked = 0;
  let recovered = 0;
  let skipped = 0;
  let failed = 0;

  for (const referral of referrals) {
    const jobId = referral.jobId;
    if (!jobId) continue;

    const jobPayments = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.jobId, jobId),
          eq(payments.status, "succeeded"),
          sql`${payments.stripePaymentIntentId} IS NOT NULL`,
        )
      );

    for (const payment of jobPayments) {
      checked++;
      const existingAudit = await checkExistingPayout(payment.id, referral.id);
      if (existingAudit) {
        console.log(`[SubPayBackfill] jobId=${jobId} paymentId=${payment.id} referralId=${referral.id} — audit exists (${existingAudit.status}), skipping`);
        skipped++;
        continue;
      }

      console.log(`[SubPayBackfill] jobId=${jobId} paymentId=${payment.id} referralId=${referral.id} — no audit, triggering payout`);
      try {
        const result = await executeSubcontractPayout({
          jobId,
          invoiceId: payment.invoiceId || null,
          paymentId: payment.id,
          paymentIntentId: payment.stripePaymentIntentId || null,
          paymentAmountCents: payment.amountCents || Math.round(parseFloat(String(payment.amount)) * 100),
          ownerCompanyId: payment.companyId,
          source: "startup-backfill",
        });
        if (result) {
          console.log(`[SubPayBackfill] jobId=${jobId} paymentId=${payment.id} referralId=${referral.id} — payout result: ${result.status} auditId=${result.auditId}`);
          recovered++;
        }
      } catch (err: any) {
        console.error(`[SubPayBackfill] jobId=${jobId} paymentId=${payment.id} referralId=${referral.id} — ERROR: ${err?.message}`);
        failed++;
      }
    }
  }

  console.log(`[SubPayBackfill] Complete. checked=${checked} recovered=${recovered} skipped=${skipped} failed=${failed}`);
}
