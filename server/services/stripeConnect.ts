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
  if (referral.contractorPayoutAmountCents != null && referral.companyShareAmountCents != null && referral.jobTotalAtAcceptanceCents) {
    const ratio = paymentAmountCents / referral.jobTotalAtAcceptanceCents;
    const contractorPayout = Math.round(referral.contractorPayoutAmountCents * ratio);
    const companyShare = paymentAmountCents - contractorPayout;
    return { contractorPayoutCents: contractorPayout, companyShareCents: companyShare };
  }

  if (referral.referralType === "percent") {
    const pct = parseFloat(referral.referralValue) / 100;
    const companyShare = Math.round(paymentAmountCents * pct);
    const contractorPayout = paymentAmountCents - companyShare;
    return { contractorPayoutCents: contractorPayout, companyShareCents: companyShare };
  }

  const flatFeeCents = Math.round(parseFloat(referral.referralValue) * 100);
  const scaledFee = Math.min(flatFeeCents, paymentAmountCents);
  return {
    contractorPayoutCents: paymentAmountCents - scaledFee,
    companyShareCents: scaledFee,
  };
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

  console.log(`[SubPayExec] jobId=${jobId} invoiceId=${invoiceId} paymentId=${paymentId} paymentIntentId=${paymentIntentId}`);
  console.log(`[SubPayExec] subcontractAgreementId=${referral.id} source=${source}`);
  console.log(`[SubPayExec] transferEnabled=${transferEnabled}`);

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

  if (split.contractorPayoutCents <= 0) {
    console.log(`[SubPayExec] blockedReason=contractor_payout_zero_or_negative`);
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: referral.receiverCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Contractor payout is zero or negative",
    });
    console.log(`[SubPayExec] finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Contractor payout is zero or negative" };
  }

  if (split.companyShareCents < 0) {
    console.log(`[SubPayExec] blockedReason=negative_company_share`);
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: referral.receiverCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Negative company share",
    });
    console.log(`[SubPayExec] finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Negative company share" };
  }

  if (split.contractorPayoutCents > paymentAmountCents) {
    console.log(`[SubPayExec] blockedReason=payout_exceeds_collected`);
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: referral.receiverCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Payout exceeds collected amount",
    });
    console.log(`[SubPayExec] finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Payout exceeds collected amount" };
  }

  if (referral.contractorPayoutAmountCents) {
    const cumulativePaid = await getCumulativePayoutForReferral(referral.id);
    const maxPayout = referral.contractorPayoutAmountCents;
    const remaining = maxPayout - cumulativePaid;
    if (remaining <= 0) {
      console.log(`[SubPayExec] blockedReason=cumulative_overpayment cumulativePaid=${cumulativePaid} maxPayout=${maxPayout}`);
      const audit = await createPayoutAuditRecord({
        jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
        subcontractorCompanyId: referral.receiverCompanyId,
        referralId: referral.id,
        grossAmountCents: paymentAmountCents,
        contractorPayoutAmountCents: 0,
        companyShareAmountCents: paymentAmountCents,
        status: "blocked",
        idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
        failureReason: `Cumulative payout cap reached: paid=${cumulativePaid} max=${maxPayout}`,
      });
      console.log(`[SubPayExec] finalResult=blocked auditId=${audit.id}`);
      return { status: "blocked", auditId: audit.id, reason: "Cumulative payout cap reached" };
    }
    if (split.contractorPayoutCents > remaining) {
      console.log(`[SubPayExec] capping payout from ${split.contractorPayoutCents} to ${remaining} (cumulative protection)`);
      split.contractorPayoutCents = remaining;
      split.companyShareCents = paymentAmountCents - remaining;
    }
  }

  console.log(`[SubPayExec] grossCollectedAmount=${paymentAmountCents} contractorPayoutAmount=${split.contractorPayoutCents} companyShareAmount=${split.companyShareCents}`);

  let connectedAccountId: string | null = null;
  let subCompany: any = null;

  if (referral.receiverCompanyId) {
    const [sc] = await db.select().from(companies).where(eq(companies.id, referral.receiverCompanyId)).limit(1);
    subCompany = sc || null;
    connectedAccountId = sc?.stripeConnectAccountId || null;
  }

  console.log(`[SubPayExec] connectedAccountId=${connectedAccountId}`);

  if (!referral.receiverCompanyId || !subCompany) {
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: referral.receiverCompanyId,
      referralId: referral.id,
      grossAmountCents: paymentAmountCents,
      contractorPayoutAmountCents: split.contractorPayoutCents,
      companyShareAmountCents: split.companyShareCents,
      status: "blocked",
      idempotencyKey: generateDeterministicIdempotencyKey(paymentId, referral.id),
      failureReason: "Subcontractor company not found or not linked",
    });
    console.log(`[SubPayExec] blockedReason=no_subcontractor_company finalResult=blocked auditId=${audit.id}`);
    return { status: "blocked", auditId: audit.id, reason: "Subcontractor company not found" };
  }

  if (!connectedAccountId || !isPayoutReady(subCompany)) {
    const reason = !connectedAccountId
      ? "Subcontractor has no Stripe Connect account"
      : `Stripe Connect not payout-ready (status=${subCompany.stripeConnectStatus}, charges=${subCompany.stripeConnectChargesEnabled}, payouts=${subCompany.stripeConnectPayoutsEnabled})`;
    const audit = await createPayoutAuditRecord({
      jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
      subcontractorCompanyId: referral.receiverCompanyId,
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
      subcontractorCompanyId: referral.receiverCompanyId,
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
      },
    });
    console.log(`[SubPayExec] auditStatus=pending (transfers disabled) auditId=${audit.id}`);
    console.log(`[SubPayExec] finalResult=pending_disabled`);
    return { status: "pending", auditId: audit.id, reason: "Transfers disabled by config" };
  }

  const idempotencyKey = generateDeterministicIdempotencyKey(paymentId, referral.id);
  const audit = await createPayoutAuditRecord({
    jobId, invoiceId, paymentId, paymentIntentId, ownerCompanyId,
    subcontractorCompanyId: referral.receiverCompanyId,
    referralId: referral.id,
    grossAmountCents: paymentAmountCents,
    contractorPayoutAmountCents: split.contractorPayoutCents,
    companyShareAmountCents: split.companyShareCents,
    destinationAccountId: connectedAccountId,
    transferAmountCents: split.contractorPayoutCents,
    status: "processing",
    idempotencyKey,
    rawMeta: {
      referralType: referral.referralType,
      referralValue: referral.referralValue,
      source,
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
      amount: split.contractorPayoutCents,
      currency: "usd",
      destination: connectedAccountId,
      metadata: {
        jobId: String(jobId),
        invoiceId: invoiceId ? String(invoiceId) : "",
        paymentId: String(paymentId),
        referralId: String(referral.id),
        subcontractorCompanyId: String(referral.receiverCompanyId),
        ownerCompanyId: String(ownerCompanyId),
        paymentIntentId: paymentIntentId || "",
        auditId: String(audit.id),
      },
    };
    if (resolvedChargeId) {
      transferParams.source_transaction = resolvedChargeId;
    }

    console.log(`[SubPayExec] transfer_create: amount=${transferParams.amount} destination=${transferParams.destination} source_transaction=${resolvedChargeId || "NONE"}`);

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
