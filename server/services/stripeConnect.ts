import Stripe from "stripe";
import crypto from "crypto";
import { db } from "../db";
import { companies, jobReferrals, subcontractPayoutAudit, payments } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";

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
    business_type: "company",
    company: {
      name: companyName,
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      ecologic_company_id: String(companyId),
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
    const companyShare = Math.round(paymentAmountCents * pct);
    const contractorPayout = paymentAmountCents - companyShare;
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
    .where(and(eq(jobReferrals.jobId, jobId), eq(jobReferrals.status, "accepted")))
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
}): Promise<{ status: string; auditId?: number; transferId?: string; reason?: string } | null> {
  const { jobId, invoiceId, paymentId, paymentIntentId, paymentAmountCents, ownerCompanyId, source, chargeId: providedChargeId } = params;
  const transferEnabled = isTransferEnabled();

  const referral = await getAcceptedReferralForJob(jobId);
  if (!referral) {
    return null;
  }

  const isReferralFee = ownerCompanyId === referral.receiverCompanyId;
  const payoutTargetCompanyId = isReferralFee ? referral.senderCompanyId : referral.receiverCompanyId;

  console.log(`[SubPayExec] jobId=${jobId} invoiceId=${invoiceId} paymentId=${paymentId} paymentIntentId=${paymentIntentId}`);
  console.log(`[SubPayExec] subcontractAgreementId=${referral.id} source=${source}`);
  console.log(`[SubPayExec] transferEnabled=${transferEnabled}`);
  console.log(`[SubPayExec] payoutDirection=${isReferralFee ? "referral_fee_to_sender" : "subcontract_to_receiver"} ownerCompanyId=${ownerCompanyId} senderCompanyId=${referral.senderCompanyId} receiverCompanyId=${referral.receiverCompanyId} payoutTargetCompanyId=${payoutTargetCompanyId}`);

  const existing = await checkExistingPayout(paymentId, referral.id);
  if (existing) {
    if (existing.status === "completed" || existing.status === "duplicate_skipped") {
      console.log(`[SubPayExec] duplicateDetected=true existingAuditId=${existing.id} status=${existing.status}`);
      console.log(`[SubPayExec] finalResult=duplicate_skipped`);
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

  const transferAmountCents = isReferralFee ? split.companyShareCents : split.contractorPayoutCents;
  const retainAmountCents = isReferralFee ? split.contractorPayoutCents : split.companyShareCents;

  console.log(`[SubPayExec] splitCalc: paymentAmountCents=${paymentAmountCents} referralType=${referral.referralType} referralValue=${referral.referralValue}`);
  console.log(`[SubPayExec] splitCalc: contractorPayout=${split.contractorPayoutCents} companyShare=${split.companyShareCents}`);
  console.log(`[SubPayExec] transferAmountCents=${transferAmountCents} (${isReferralFee ? "companyShare→sender as referral fee" : "contractorPayout→receiver as subcontract"}) retainAmountCents=${retainAmountCents}`);

  if (transferAmountCents <= 0) {
    console.log(`[SubPayExec] blockedReason=transfer_amount_zero_or_negative`);
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: payoutTargetCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Transfer amount is zero or negative",
    });
    console.log(`[SubPayExec] finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Transfer amount is zero or negative" };
  }

  if (transferAmountCents > paymentAmountCents) {
    console.log(`[SubPayExec] blockedReason=transfer_exceeds_collected`);
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: payoutTargetCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Transfer amount exceeds collected amount",
    });
    console.log(`[SubPayExec] finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Transfer amount exceeds collected amount" };
  }

  {
    const cumulativePaidOut = await getCumulativePayoutForReferral(referral.id);
    const cumulativeGross = await getCumulativeGrossForReferral(referral.id);

    const feePercent = referral.referralType === "percent" ? parseFloat(referral.referralValue) / 100 : 0;
    const totalGrossIncludingThis = cumulativeGross + paymentAmountCents;
    let dynamicMaxTransfer: number;
    if (referral.referralType === "percent") {
      dynamicMaxTransfer = isReferralFee
        ? Math.round(totalGrossIncludingThis * feePercent)
        : Math.round(totalGrossIncludingThis * (1 - feePercent));
    } else {
      dynamicMaxTransfer = referral.contractorPayoutAmountCents || transferAmountCents;
    }
    const remaining = dynamicMaxTransfer - cumulativePaidOut;

    console.log(`[SubPayExec] cumulativeCap: cumulativePaidOut=${cumulativePaidOut} cumulativeGross=${cumulativeGross} totalGrossIncludingThis=${totalGrossIncludingThis} feePercent=${feePercent} dynamicMaxTransfer=${dynamicMaxTransfer} remaining=${remaining}`);

    if (remaining <= 0) {
      console.log(`[SubPayExec] blockedReason=cumulative_overpayment cumulativePaid=${cumulativePaidOut} dynamicMax=${dynamicMaxTransfer}`);
      const audit = await createPayoutAuditRecord({
        jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
        subcontractorCompanyId: payoutTargetCompanyId,
        referralId: referral.id,
        grossAmountCents: paymentAmountCents,
        contractorPayoutAmountCents: 0,
        companyShareAmountCents: paymentAmountCents,
        status: "blocked",
        idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
        failureReason: `Cumulative payout cap reached: paid=${cumulativePaidOut} dynamicMax=${dynamicMaxTransfer}`,
      });
      console.log(`[SubPayExec] finalResult=blocked auditId=${audit.id}`);
      return { status: "blocked", auditId: audit.id, reason: "Cumulative payout cap reached" };
    }
  }

  console.log(`[SubPayExec] grossCollectedAmount=${paymentAmountCents} transferAmount=${transferAmountCents} retainAmount=${retainAmountCents}`);

  let connectedAccountId: string | null = null;
  let targetCompany: any = null;

  if (payoutTargetCompanyId) {
    const [tc] = await db.select().from(companies).where(eq(companies.id, payoutTargetCompanyId)).limit(1);
    targetCompany = tc || null;
    connectedAccountId = tc?.stripeConnectAccountId || null;
  }

  console.log(`[SubPayExec] payoutTargetCompanyId=${payoutTargetCompanyId} connectedAccountId=${connectedAccountId}`);

  if (!payoutTargetCompanyId || !targetCompany) {
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: payoutTargetCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Payout target company not found or not linked",
    });
    console.log(`[SubPayExec] blockedReason=no_payout_target_company finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Payout target company not found" };
  }

  if (!connectedAccountId || !isPayoutReady(targetCompany)) {
    const reason = !connectedAccountId
      ? `Payout target (company ${payoutTargetCompanyId}) has no Stripe Connect account`
      : `Stripe Connect not payout-ready for company ${payoutTargetCompanyId} (status=${targetCompany.stripeConnectStatus}, charges=${targetCompany.stripeConnectChargesEnabled}, payouts=${targetCompany.stripeConnectPayoutsEnabled})`;
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: payoutTargetCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      destinationAccountId: connectedAccountId,
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
      subcontractorCompanyId: payoutTargetCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      destinationAccountId: connectedAccountId,
      status: "pending",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Transfer execution disabled (STRIPE_SUBCONTRACT_TRANSFERS_ENABLED != true)",
      rawMeta: {
        referralType: referral.referralType,
        referralValue: referral.referralValue,
        connectedAccountReady: true,
        transferDisabled: true,
        payoutDirection: isReferralFee ? "referral_fee_to_sender" : "subcontract_to_receiver",
      },
    });
    console.log(`[SubPayExec] auditStatus=pending (transfers disabled) auditId=${audit.id}`);
    console.log(`[SubPayExec] finalResult=pending_disabled`);
    return { status: "pending", auditId: audit.id, reason: "Transfers disabled by config" };
  }

  const idempotencyKey = generateDeterministicIdempotencyKey(paymentId, referral.id);
  const audit = await createPayoutAuditRecord({
    jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
    subcontractorCompanyId: payoutTargetCompanyId,
    referralId: referral.id,
    grossAmountCents: paymentAmountCents,
    contractorPayoutAmountCents: split.contractorPayoutCents,
    companyShareAmountCents: split.companyShareCents,
    destinationAccountId: connectedAccountId,
    transferAmountCents: transferAmountCents,
    status: "processing",
    idempotencyKey,
    rawMeta: {
      referralType: referral.referralType,
      referralValue: referral.referralValue,
      source,
      payoutDirection: isReferralFee ? "referral_fee_to_sender" : "subcontract_to_receiver",
    },
  });

  console.log(`[SubPayExec] auditStatus=processing auditId=${audit.id}, executing transfer...`);

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
  console.log(`[SubPayExec] resolvedChargeId=${resolvedChargeId} (source_transaction for transfer)`);

  try {
    const transferParams: any = {
      amount: transferAmountCents,
      currency: "usd",
      destination: connectedAccountId,
      metadata: {
        jobId: String(jobId),
        invoiceId: invoiceId ? String(invoiceId) : "",
        paymentId: String(paymentId),
        referralId: String(referral.id),
        payoutTargetCompanyId: String(payoutTargetCompanyId),
        ownerCompanyId: String(ownerCompanyId),
        payoutDirection: isReferralFee ? "referral_fee_to_sender" : "subcontract_to_receiver",
        paymentIntentId: paymentIntentId || "",
        auditId: String(audit.id),
      },
    };
    if (resolvedChargeId) {
      transferParams.source_transaction = resolvedChargeId;
    }

    console.log(`[SubPayExec] transfer_create: amount=${transferParams.amount} destination=${transferParams.destination} direction=${isReferralFee ? "referral_fee" : "subcontract"} source_transaction=${resolvedChargeId || "NONE"}`);

    const transfer = await stripe.transfers.create(transferParams, {
      idempotencyKey: `transfer_${idempotencyKey}`,
    });

    await updatePayoutAuditRecord(audit.id, {
      status: "completed",
      stripeTransferId: transfer.id,
      transferAmountCents: transfer.amount,
      destinationAccountId: transfer.destination as string,
      rawMeta: {
        referralType: referral.referralType,
        referralValue: referral.referralValue,
        source,
        payoutDirection: isReferralFee ? "referral_fee_to_sender" : "subcontract_to_receiver",
        transferObject: { id: transfer.id, amount: transfer.amount, destination: transfer.destination },
      },
    });

    console.log(`[SubPayExec] transferId=${transfer.id} transferAmount=${transfer.amount}`);
    console.log(`[SubPayExec] auditStatus=completed auditId=${audit.id}`);
    console.log(`[SubPayExec] finalResult=completed`);
    return { status: "completed", auditId: audit.id, transferId: transfer.id };
  } catch (err: any) {
    const errorMsg = err?.message || "Unknown transfer error";
    console.error(`[SubPayExec] transfer FAILED: ${errorMsg}`);

    await updatePayoutAuditRecord(audit.id, {
      status: "failed",
      failureReason: errorMsg,
    });

    console.log(`[SubPayExec] auditStatus=failed auditId=${audit.id}`);
    console.log(`[SubPayExec] finalResult=failed`);
    return { status: "failed", auditId: audit.id, reason: errorMsg };
  }
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
