import Stripe from "stripe";
import crypto from "crypto";
import { db } from "../db";
import { companies, jobReferrals, subcontractPayoutAudit } from "../../shared/schema";
import { eq, and } from "drizzle-orm";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-02-24" as any,
});

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

  if (account.charges_enabled && account.payouts_enabled && !updateData.stripeConnectOnboardedAt) {
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

export function generateIdempotencyKey(paymentId: number, referralId: number): string {
  return `subpay_${paymentId}_${referralId}_${crypto.randomBytes(4).toString("hex")}`;
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

export async function processSubcontractPaymentDetection(params: {
  jobId: number;
  invoiceId: number | null;
  paymentId: number;
  paymentIntentId: string | null;
  paymentAmountCents: number;
  ownerCompanyId: number;
}) {
  const { jobId, invoiceId, paymentId, paymentIntentId, paymentAmountCents, ownerCompanyId } = params;

  const referral = await getAcceptedReferralForJob(jobId);
  if (!referral) {
    return null;
  }

  console.log(`[SubPaySetup] subcontract agreement found: referralId=${referral.id} jobId=${jobId}`);
  console.log(`[SubPaySetup] ownerCompanyId=${ownerCompanyId} subcontractorCompanyId=${referral.receiverCompanyId}`);
  console.log(`[SubPaySetup] feeType=${referral.referralType} feeValue=${referral.referralValue}`);

  const existing = await checkExistingPayout(paymentId, referral.id);
  if (existing) {
    console.log(`[SubPaySetup] payout audit already exists id=${existing.id} status=${existing.status}, skipping`);
    return existing;
  }

  const split = computeSubcontractSplit(referral, paymentAmountCents);

  console.log(`[SubPaySetup] grossAmount=${paymentAmountCents} contractorPayoutAmount=${split.contractorPayoutCents} companyShareAmount=${split.companyShareCents}`);

  let connectedAccountId: string | null = null;
  let chargesEnabled = false;
  let payoutsEnabled = false;

  if (referral.receiverCompanyId) {
    const [subCompany] = await db.select().from(companies).where(eq(companies.id, referral.receiverCompanyId)).limit(1);
    if (subCompany) {
      connectedAccountId = subCompany.stripeConnectAccountId || null;
      chargesEnabled = subCompany.stripeConnectChargesEnabled || false;
      payoutsEnabled = subCompany.stripeConnectPayoutsEnabled || false;
    }
  }

  console.log(`[SubPaySetup] connectedAccountId=${connectedAccountId} chargesEnabled=${chargesEnabled} payoutsEnabled=${payoutsEnabled}`);
  console.log(`[SubPaySetup] phase1 preview only, no transfer executed`);

  const idempotencyKey = generateDeterministicIdempotencyKey(paymentId, referral.id);

  const auditRecord = await createPayoutAuditRecord({
    jobId,
    invoiceId,
    paymentId,
    paymentIntentId,
    ownerCompanyId,
    subcontractorCompanyId: referral.receiverCompanyId,
    referralId: referral.id,
    grossAmountCents: paymentAmountCents,
    contractorPayoutAmountCents: split.contractorPayoutCents,
    companyShareAmountCents: split.companyShareCents,
    destinationAccountId: connectedAccountId,
    status: "preview",
    idempotencyKey,
    rawMeta: {
      phase: 1,
      referralType: referral.referralType,
      referralValue: referral.referralValue,
      connectedAccountReady: chargesEnabled && payoutsEnabled,
    },
  });

  console.log(`[SubPaySetup] created payout audit record id=${auditRecord.id} status=preview`);
  return auditRecord;
}
