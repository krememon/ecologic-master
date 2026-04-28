/**
 * Dashboard storage module
 * ────────────────────────
 * Focused data-access layer for the private internal dashboard. Kept separate
 * from the main `server/storage.ts` to avoid bloating the customer-app storage
 * interface with admin-only concerns.
 */

import { db } from "../db";
import { eq, desc, sql, and, isNull } from "drizzle-orm";
import {
  growthSubscribers,
  growthCampaigns,
  growthCreators,
  growthAccountAdmin,
  growthMobileEvents,
  companies,
  users,
  companyMembers,
  jobs,
  customers,
  invoices,
  payments,
  documents,
  conversations,
  messages,
  pendingSignups,
  ACCOUNT_ADMIN_STATUSES,
  type GrowthSubscriber,
  type GrowthCampaign,
  type GrowthCreator,
  type GrowthMobileEvent,
  type InsertGrowthCampaign,
  type InsertGrowthCreator,
  type InsertGrowthMobileEvent,
  type AccountAdminStatus,
} from "@shared/schema";
import {
  createBranchLink,
  isBranchConfigured,
  isBranchIntegrationEnabled,
  type CreateBranchLinkResult,
  type ParsedBranchEvent,
} from "../branch";
import { subscriptionPlans } from "@shared/subscriptionPlans";
import { getPlanKeyForPriceId } from "../billingService";

/** Normalize a referral code: trim, lowercase, collapse internal whitespace. */
export function normalizeReferralCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const v = String(code).trim().toLowerCase().replace(/\s+/g, "");
  return v.length ? v : null;
}

// ── Subscribers ────────────────────────────────────────────────────────────
export async function listGrowthSubscribers(): Promise<GrowthSubscriber[]> {
  return await db.select().from(growthSubscribers).orderBy(desc(growthSubscribers.createdAt));
}

/**
 * Subscribers list with the joined campaign name. Used by the dashboard
 * Subscribers page so it can show "Campaign: Joe Plumbing" instead of just
 * a numeric campaign_id.
 */
export interface SubscriberWithCampaign extends GrowthSubscriber {
  campaignName: string | null;
}

export async function listGrowthSubscribersWithCampaign(): Promise<SubscriberWithCampaign[]> {
  const rows = await db
    .select({
      sub: growthSubscribers,
      campaignName: growthCampaigns.name,
    })
    .from(growthSubscribers)
    .leftJoin(growthCampaigns, eq(growthCampaigns.id, growthSubscribers.campaignId))
    .orderBy(desc(growthSubscribers.createdAt));
  return rows.map((r) => ({ ...(r.sub as GrowthSubscriber), campaignName: r.campaignName ?? null }));
}

// ── Campaigns ──────────────────────────────────────────────────────────────
export async function listGrowthCampaigns(): Promise<GrowthCampaign[]> {
  return await db.select().from(growthCampaigns).orderBy(desc(growthCampaigns.createdAt));
}

/** Campaigns list with subscriber + mobile-event counts for the dashboard table. */
export interface CampaignWithMetrics extends GrowthCampaign {
  signups: number;
  mobileClicks: number;
  mobileInstalls: number;
  mobileOpens: number;
}

export async function listGrowthCampaignsWithMetrics(): Promise<CampaignWithMetrics[]> {
  // NOTE: `db.execute()` on the neon-serverless Pool driver returns a
  // QueryResult object — the rows live on `.rows`, NOT on the result itself.
  // Destructuring or iterating the result directly throws
  // "TypeError: (intermediate value) is not iterable".
  const subRes = await db.execute<{ id: number; signups: string }>(sql`
    SELECT campaign_id AS id, count(*)::text AS signups
    FROM growth_subscribers
    WHERE campaign_id IS NOT NULL
    GROUP BY campaign_id
  `);
  const subCounts = new Map<number, number>();
  for (const r of (subRes as any).rows ?? []) subCounts.set(Number(r.id), Number(r.signups));

  // Per-campaign mobile event counts. Pivoted in SQL so we get one row per
  // campaign with click / install / open buckets.
  const mobRes = await db.execute<{
    id: number;
    clicks: string;
    installs: string;
    opens: string;
  }>(sql`
    SELECT
      campaign_id AS id,
      count(*) FILTER (WHERE event_type = 'click')::text   AS clicks,
      count(*) FILTER (WHERE event_type = 'install')::text AS installs,
      count(*) FILTER (WHERE event_type = 'open')::text    AS opens
    FROM growth_mobile_events
    WHERE campaign_id IS NOT NULL
    GROUP BY campaign_id
  `);
  const mobCounts = new Map<number, { clicks: number; installs: number; opens: number }>();
  for (const r of (mobRes as any).rows ?? []) {
    mobCounts.set(Number(r.id), {
      clicks: Number(r.clicks ?? 0),
      installs: Number(r.installs ?? 0),
      opens: Number(r.opens ?? 0),
    });
  }

  const campaigns = await listGrowthCampaigns();
  return campaigns.map((c) => {
    const m = mobCounts.get(c.id);
    return {
      ...c,
      signups: subCounts.get(c.id) ?? 0,
      mobileClicks: m?.clicks ?? 0,
      mobileInstalls: m?.installs ?? 0,
      mobileOpens: m?.opens ?? 0,
    };
  });
}

/**
 * Look up an active campaign by referral code (case-insensitive).
 * Returns null if no campaign matches or if the matched campaign is not active.
 */
export async function findActiveCampaignByReferralCode(
  rawCode: string | null | undefined,
): Promise<GrowthCampaign | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  const [row] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.referralCode, code))
    .limit(1);
  if (!row) return null;
  if (row.status !== "active") return null;
  return row;
}

export async function createGrowthCampaign(input: InsertGrowthCampaign): Promise<GrowthCampaign> {
  const data = { ...input, referralCode: normalizeReferralCode(input.referralCode) ?? null };
  const [row] = await db.insert(growthCampaigns).values(data).returning();
  return row;
}

export async function updateGrowthCampaign(
  id: number,
  patch: Partial<InsertGrowthCampaign>
): Promise<GrowthCampaign | null> {
  const data: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if ("referralCode" in patch) {
    data.referralCode = normalizeReferralCode(patch.referralCode);
  }
  const [row] = await db
    .update(growthCampaigns)
    .set(data)
    .where(eq(growthCampaigns.id, id))
    .returning();
  return row ?? null;
}

// ── Creators ───────────────────────────────────────────────────────────────
export async function listGrowthCreators(): Promise<GrowthCreator[]> {
  return await db.select().from(growthCreators).orderBy(desc(growthCreators.createdAt));
}

export async function createGrowthCreator(input: InsertGrowthCreator): Promise<GrowthCreator> {
  const data = { ...input, referralCode: normalizeReferralCode(input.referralCode) ?? null };
  const [row] = await db.insert(growthCreators).values(data).returning();
  return row;
}

export async function updateGrowthCreator(
  id: number,
  patch: Partial<InsertGrowthCreator>
): Promise<GrowthCreator | null> {
  const data: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if ("referralCode" in patch) {
    data.referralCode = normalizeReferralCode(patch.referralCode);
  }
  const [row] = await db
    .update(growthCreators)
    .set(data)
    .where(eq(growthCreators.id, id))
    .returning();
  return row ?? null;
}

// ── Subscriber attribution save (first-touch wins) ─────────────────────────

export interface SaveSubscriberAttributionInput {
  userId?: string | null;
  companyId?: number | null;
  ownerEmail?: string | null;
  companyName?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  referralCode?: string | null;
  campaignId?: number | null;
  signupAt?: Date | null;
  onboardingCompletedAt?: Date | null;
}

/**
 * Create or update a growth_subscribers row for the given user/company,
 * preserving any existing attribution (first-touch wins).
 *
 *   • If a row already exists for this (companyId or userId) AND it already
 *     has a sourceType OR referralCode set, the row is left untouched and
 *     returned as-is.
 *   • If a row exists but has empty attribution, it is updated.
 *   • If no row exists, a new one is inserted.
 *
 * This function never throws — callers can fire-and-forget. Errors are logged
 * with the `[attribution]` prefix.
 */
export async function saveOrKeepSubscriberAttribution(
  input: SaveSubscriberAttributionInput,
): Promise<{ saved: boolean; row: GrowthSubscriber | null; reason?: string }> {
  try {
    const referralCode = normalizeReferralCode(input.referralCode);

    // Look up an existing row by companyId first, then by userId.
    let existing: GrowthSubscriber | null = null;
    if (input.companyId != null) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.companyId, input.companyId))
        .limit(1);
      if (r) existing = r;
    }
    if (!existing && input.userId) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.userId, input.userId))
        .limit(1);
      if (r) existing = r;
    }

    if (existing && (existing.sourceType || existing.referralCode || existing.campaignId)) {
      console.log(
        `[attribution] attribution already exists, keeping original subscriberId=${existing.id} sourceType=${existing.sourceType ?? "—"} referralCode=${existing.referralCode ?? "—"} campaignId=${existing.campaignId ?? "—"}`
      );
      return { saved: false, row: existing, reason: "first_touch_preserved" };
    }

    const baseValues = {
      userId: input.userId ?? null,
      companyId: input.companyId ?? null,
      ownerEmail: input.ownerEmail ?? null,
      companyName: input.companyName ?? null,
      sourceType: (input.sourceType ?? null) as any,
      sourceName: input.sourceName ?? null,
      referralCode,
      campaignId: input.campaignId ?? null,
      signupAt: input.signupAt ?? null,
      onboardingCompletedAt: input.onboardingCompletedAt ?? null,
    };

    if (existing) {
      const [updated] = await db
        .update(growthSubscribers)
        .set({ ...baseValues, updatedAt: new Date() })
        .where(eq(growthSubscribers.id, existing.id))
        .returning();
      console.log(
        `[attribution] saved subscriber attribution (updated empty row) subscriberId=${updated.id} campaignId=${updated.campaignId ?? "—"} sourceType=${updated.sourceType ?? "—"} referralCode=${updated.referralCode ?? "—"}`
      );
      return { saved: true, row: updated };
    }

    const [inserted] = await db
      .insert(growthSubscribers)
      .values(baseValues as any)
      .returning();
    console.log(
      `[attribution] saved subscriber attribution (new row) subscriberId=${inserted.id} campaignId=${inserted.campaignId ?? "—"} sourceType=${inserted.sourceType ?? "—"} referralCode=${inserted.referralCode ?? "—"}`
    );
    return { saved: true, row: inserted };
  } catch (err) {
    console.error("[attribution] failed to save attribution but onboarding continued:", err);
    return { saved: false, row: null, reason: "error" };
  }
}

// ── Stripe subscription → growth_subscribers sync ──────────────────────────
//
// Keeps the unified `growth_subscribers` row in step with the canonical
// Stripe subscription on `companies`. Called from every Stripe billing
// webhook (customer.subscription.*, invoice.paid, invoice.payment_failed)
// after the existing `syncSubscriptionToCompany` finishes its work, so the
// source-of-truth (companies) is always written first.
//
// Behavior:
//   • If no growth_subscribers row exists for this companyId, do nothing —
//     this only enriches existing attribution rows. We don't want to create
//     orphan subscriber rows for companies that came in without attribution.
//   • Trial: status=trialing, monthlyRevenue=0, plan=<planKey>, trialStartedAt
//     stamped once. Counted as "Trialing" in the dashboard, NOT as MRR.
//   • Paid: status=active, monthlyRevenue=<plan price>, becamePaidAt stamped
//     once on first transition into a paid status.
//   • Canceled / past_due / unpaid / expired: status passed through, monthly
//     revenue zeroed for canceled/expired, canceledAt stamped on canceled.
//   • onboardingCompletedAt stamped once when the row is first observed with
//     a Stripe subscription — by that point the user has gone through the
//     full onboarding wizard (they wouldn't have a subscription otherwise).
//
// Always best-effort: errors are logged but never thrown.
export interface StripeSubSyncInput {
  id: string;
  status: string;
  customer?: string | null;
  items?: { data: Array<{ price: { id: string } }> };
  trial_start?: number | null;
  trial_end?: number | null;
  metadata?: Record<string, string> | null;
}

const PAID_STATUSES = new Set(["active", "past_due"]);
const CLOSED_STATUSES = new Set(["canceled", "expired", "unpaid"]);

function mapStripeStatusToGrowth(status: string):
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "expired"
  | "unknown" {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
      return status as any;
    case "incomplete_expired":
      // Stripe's terminal "trial/setup never paid" state — treat as expired
      // so we zero MRR and don't keep counting it.
      return "expired";
    case "incomplete":
      return "unknown";
    default:
      return "unknown";
  }
}

// Apple StoreKit 2 status → growth status. We currently only invoke the sync
// from successful validation paths (active/trial), but mapping covers the full
// lifecycle for future server-notification webhook hooks.
function mapAppleStatusToGrowth(opts: { isTrial: boolean; expiresMs?: number | null }):
  | "trialing"
  | "active"
  | "expired"
  | "unknown" {
  if (opts.expiresMs && opts.expiresMs < Date.now()) return "expired";
  if (opts.isTrial) return "trialing";
  return "active";
}

// Google Play paymentState (1 received, 2 free trial) + subscription state
// → growth status. Validation only grants access for paymentState 1/2, so
// the sync is invoked in those two states. Cancellation/expiry will arrive
// via separate flows (RTDN webhook future work).
function mapGoogleStatusToGrowth(opts: {
  paymentState?: number | null;
  expiresMs?: number | null;
}): "trialing" | "active" | "expired" | "unknown" {
  if (opts.expiresMs && opts.expiresMs < Date.now()) return "expired";
  if (opts.paymentState === 2) return "trialing";
  if (opts.paymentState === 1) return "active";
  return "unknown";
}

/**
 * Load the minimum company + owner info required to seed a new growth_subscribers
 * row. Mirrors the seeding pattern used in updateAccountAttribution. Returns
 * null when the company can't be found (caller should skip create).
 */
async function loadCompanyMeta(companyId: number): Promise<{
  ownerId: string | null;
  ownerEmail: string | null;
  companyName: string;
  companyCreatedAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
} | null> {
  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      ownerId: companies.ownerId,
      createdAt: companies.createdAt,
      stripeCustomerId: companies.stripeCustomerId,
      stripeSubscriptionId: companies.stripeSubscriptionId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) return null;

  const [owner] = company.ownerId
    ? await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, company.ownerId))
        .limit(1)
    : [];

  return {
    ownerId: company.ownerId ?? null,
    ownerEmail: owner?.email ?? null,
    companyName: company.name,
    companyCreatedAt: company.createdAt ?? null,
    stripeCustomerId: company.stripeCustomerId ?? null,
    stripeSubscriptionId: company.stripeSubscriptionId ?? null,
  };
}

export async function syncStripeSubscriptionToGrowthSubscriber(
  companyId: number | null,
  sub: StripeSubSyncInput,
): Promise<void> {
  try {
    const customerId = typeof sub.customer === "string" ? sub.customer : null;

    console.log(
      `[growth-dashboard] Stripe webhook sync started subId=${sub.id} status=${sub.status} ` +
        `companyId=${companyId ?? "—"} customerId=${customerId ?? "—"}`
    );

    // Multi-key matching: try in order of specificity.
    //   1. companyId   (canonical — populated on every attribution row)
    //   2. stripeSubId (covers re-keyed companies + manual rows)
    //   3. customerId  (last-resort match for legacy/orphan rows)
    let existing: GrowthSubscriber | undefined;
    let matchedBy: "companyId" | "stripeSubId" | "stripeCustId" | null = null;

    if (companyId != null) {
      const [row] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.companyId, companyId))
        .limit(1);
      if (row) {
        existing = row;
        matchedBy = "companyId";
      }
    }
    // For sub-id and customer-id fallbacks, require company-consistency: when
    // the caller knows the companyId, the matched row's companyId must be null
    // (unattributed) or equal. Prevents updating a different company's row if
    // a Stripe customer/subscription id was reassigned or shared in legacy data.
    const isCompanyConsistent = (rowCompanyId: number | null): boolean =>
      companyId == null || rowCompanyId == null || rowCompanyId === companyId;

    if (!existing && sub.id) {
      // stripeSubscriptionId has a unique constraint, so at most one row.
      const [row] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.stripeSubscriptionId, sub.id))
        .limit(1);
      if (row && isCompanyConsistent(row.companyId)) {
        existing = row;
        matchedBy = "stripeSubId";
      } else if (row) {
        console.log(
          `[growth-dashboard] Stripe subscriber match conflict via stripeSubId — ` +
            `row.companyId=${row.companyId} != event.companyId=${companyId} — skipping`
        );
      }
    }
    if (!existing && customerId) {
      // stripeCustomerId is NOT unique — fetch all and reject ambiguity.
      const candidates = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.stripeCustomerId, customerId));
      const consistent = candidates.filter((c) => isCompanyConsistent(c.companyId));
      if (consistent.length === 1) {
        existing = consistent[0];
        matchedBy = "stripeCustId";
      } else if (consistent.length > 1) {
        console.log(
          `[growth-dashboard] Stripe subscriber match conflict via stripeCustomerId — ` +
            `${consistent.length} candidates for customerId=${customerId} companyId=${companyId ?? "—"} — skipping`
        );
      } else if (candidates.length > 0) {
        console.log(
          `[growth-dashboard] Stripe subscriber match conflict via stripeCustomerId — ` +
            `${candidates.length} rows but none consistent with companyId=${companyId ?? "—"} — skipping`
        );
      }
    }

    // ── Create-on-miss for unattributed Stripe signups ─────────────────
    // Previously we'd bail here so the dashboard only ever showed attributed
    // (referral / campaign) subscribers. The dashboard is now the all-in-one
    // subscriber view, so we create a row with sourceType=unknown for any
    // Stripe subscription whose company we can identify but doesn't already
    // have a growth_subscribers row.
    if (!existing) {
      if (companyId == null) {
        console.log(
          `[growth-dashboard] Stripe subscriber not found and no companyId — skipping ` +
            `subId=${sub.id} customerId=${customerId ?? "—"}`
        );
        return;
      }
      const meta = await loadCompanyMeta(companyId);
      if (!meta) {
        console.log(
          `[growth-dashboard] Stripe subscriber not found and company missing — skipping ` +
            `subId=${sub.id} companyId=${companyId}`
        );
        return;
      }
      const status = mapStripeStatusToGrowth(sub.status);
      const priceId = sub.items?.data?.[0]?.price?.id ?? null;
      const planKeyFromPrice = priceId ? getPlanKeyForPriceId(priceId) : null;
      const planKeyFromMeta = sub.metadata?.planKey ?? null;
      const planKey: string | null = planKeyFromPrice || planKeyFromMeta || null;
      const planPrice = planKey
        ? subscriptionPlans[planKey as keyof typeof subscriptionPlans]?.price ?? null
        : null;
      const mrr =
        status === "trialing"
          ? "0"
          : PAID_STATUSES.has(status)
          ? String(planPrice ?? 0)
          : "0";

      const [created] = await db
        .insert(growthSubscribers)
        .values({
          userId: meta.ownerId,
          companyId,
          ownerEmail: meta.ownerEmail,
          companyName: meta.companyName,
          sourceType: "unknown" as any,
          platform: "stripe" as any,
          plan: planKey,
          subscriptionStatus: status as any,
          monthlyRevenue: mrr as any,
          currency: "USD",
          stripeCustomerId: customerId ?? meta.stripeCustomerId,
          stripeSubscriptionId: sub.id,
          signupAt: meta.companyCreatedAt ?? new Date(),
          onboardingCompletedAt: new Date(),
          trialStartedAt:
            status === "trialing"
              ? sub.trial_start
                ? new Date(sub.trial_start * 1000)
                : new Date()
              : null,
          becamePaidAt: PAID_STATUSES.has(status) ? new Date() : null,
          canceledAt: status === "canceled" ? new Date() : null,
        } as any)
        .returning();
      console.log(
        `[growth-dashboard] Stripe subscriber created for unattributed company ` +
          `subscriberId=${created?.id} companyId=${companyId} sourceType=unknown ` +
          `plan=${planKey ?? "—"} status=${status} mrr=${mrr}`
      );
      return;
    }
    console.log(
      `[growth-dashboard] Stripe subscriber matched subscriberId=${existing.id} ` +
        `matchedBy=${matchedBy} companyId=${existing.companyId ?? "—"} userId=${existing.userId ?? "—"}`
    );

    const status = mapStripeStatusToGrowth(sub.status);
    const priceId = sub.items?.data?.[0]?.price?.id ?? null;

    // Plan resolution mirrors syncSubscriptionToCompany: priceId → metadata → existing.
    // Otherwise a valid event with an unknown price would clear the plan and zero MRR.
    const planKeyFromPrice = priceId ? getPlanKeyForPriceId(priceId) : null;
    const planKeyFromMeta = sub.metadata?.planKey ?? null;
    const planKey: string | null =
      planKeyFromPrice || planKeyFromMeta || existing.plan || null;
    const planPrice = planKey ? subscriptionPlans[planKey as keyof typeof subscriptionPlans]?.price ?? null : null;

    const updates: Partial<typeof growthSubscribers.$inferInsert> & { updatedAt: Date } = {
      platform: "stripe" as any,
      subscriptionStatus: status as any,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : existing.stripeCustomerId ?? null,
      stripeSubscriptionId: sub.id,
      updatedAt: new Date(),
    };

    if (planKey) updates.plan = planKey;

    // Monthly revenue rules — explicit for every status to avoid stale paid MRR
    // surviving a transition into a non-paid state:
    //   trialing                     → $0 (don't count trial dollars yet)
    //   active / past_due            → plan price (or 0 if unknown)
    //   canceled / expired / unpaid  → $0
    //   unknown / incomplete         → $0 (we don't know if it's billable)
    if (status === "trialing") {
      updates.monthlyRevenue = "0" as any;
    } else if (PAID_STATUSES.has(status)) {
      updates.monthlyRevenue = String(planPrice ?? 0) as any;
    } else {
      // CLOSED_STATUSES + 'unknown' all collapse to $0
      updates.monthlyRevenue = "0" as any;
    }

    // Lifecycle stamps (only set once)
    if (status === "trialing" && !existing.trialStartedAt) {
      updates.trialStartedAt = sub.trial_start ? new Date(sub.trial_start * 1000) : new Date();
    }
    if (PAID_STATUSES.has(status) && !existing.becamePaidAt) {
      updates.becamePaidAt = new Date();
    }
    if (status === "canceled" && !existing.canceledAt) {
      updates.canceledAt = new Date();
    }
    if (!existing.onboardingCompletedAt) {
      updates.onboardingCompletedAt = new Date();
      console.log(
        `[growth-dashboard] onboardingCompletedAt set subscriberId=${existing.id} companyId=${companyId}`
      );
    }

    await db
      .update(growthSubscribers)
      .set(updates as any)
      .where(eq(growthSubscribers.id, existing.id));

    console.log(
      `[growth-dashboard] Stripe subscriber updated subscriberId=${existing.id} ` +
        `platform=stripe plan=${planKey ?? "—"} status=${status} ` +
        `mrr=${updates.monthlyRevenue ?? "(unchanged)"} ` +
        `becamePaidAt=${updates.becamePaidAt ? "set" : "unchanged"} ` +
        `canceledAt=${updates.canceledAt ? "set" : "unchanged"} ` +
        `onboardingCompletedAt=${updates.onboardingCompletedAt ? "set" : "unchanged"}`
    );
  } catch (err) {
    console.error("[growth-dashboard] sync error (ignored):", err);
  }
}

// ── Apple IAP → growth_subscribers sync ────────────────────────────────────
//
// Mirrors the Stripe sync but is invoked by the in-app /api/subscriptions/validate
// endpoint after Apple StoreKit 2 JWS verification + companies update succeeds.
// Match keys in priority order:
//   1. companyId
//   2. userId
//   3. appleOriginalTransactionId (unique)
//   4. appleTransactionId
// On miss → create a row with sourceType=unknown, platform=apple. Attribution
// (sourceType / sourceName / referralCode / campaignId) is NEVER overwritten
// on update.
export interface AppleSubSyncInput {
  companyId: number;
  userId: string | null;
  originalTransactionId: string;
  transactionId?: string | null;
  planKey: string;
  isTrial: boolean;
  expiresDate?: Date | null;
}

export async function syncAppleSubscriptionToGrowthSubscriber(
  input: AppleSubSyncInput,
): Promise<void> {
  try {
    console.log(
      `[growth-dashboard] Apple subscription sync started companyId=${input.companyId} ` +
        `userId=${input.userId ?? "—"} planKey=${input.planKey} isTrial=${input.isTrial} ` +
        `origTxId=${input.originalTransactionId}`
    );

    const expiresMs = input.expiresDate ? input.expiresDate.getTime() : null;
    const status = mapAppleStatusToGrowth({ isTrial: input.isTrial, expiresMs });
    const planPrice = subscriptionPlans[input.planKey as keyof typeof subscriptionPlans]?.price ?? null;
    const mrr = status === "active" ? String(planPrice ?? 0) : "0";

    let existing: GrowthSubscriber | undefined;
    let matchedBy: string | null = null;

    if (input.companyId != null) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.companyId, input.companyId))
        .orderBy(desc(growthSubscribers.createdAt), desc(growthSubscribers.id))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "companyId";
      }
    }
    if (!existing && input.userId) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.userId, input.userId))
        .orderBy(desc(growthSubscribers.createdAt), desc(growthSubscribers.id))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "userId";
      }
    }
    if (!existing && input.originalTransactionId) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.appleOriginalTransactionId, input.originalTransactionId))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "appleOriginalTransactionId";
      }
    }
    if (!existing && input.transactionId) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.appleTransactionId, input.transactionId))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "appleTransactionId";
      }
    }

    if (!existing) {
      const meta = await loadCompanyMeta(input.companyId);
      if (!meta) {
        console.warn(
          `[growth-dashboard] Apple subscriber not found and company missing companyId=${input.companyId} — skipping`
        );
        return;
      }
      const [created] = await db
        .insert(growthSubscribers)
        .values({
          userId: input.userId ?? meta.ownerId,
          companyId: input.companyId,
          ownerEmail: meta.ownerEmail,
          companyName: meta.companyName,
          sourceType: "unknown" as any,
          platform: "apple" as any,
          plan: input.planKey,
          subscriptionStatus: status as any,
          monthlyRevenue: mrr as any,
          currency: "USD",
          appleOriginalTransactionId: input.originalTransactionId,
          appleTransactionId: input.transactionId ?? null,
          signupAt: meta.companyCreatedAt ?? new Date(),
          onboardingCompletedAt: new Date(),
          trialStartedAt: status === "trialing" ? new Date() : null,
          becamePaidAt: status === "active" ? new Date() : null,
        } as any)
        .returning();
      console.log(
        `[growth-dashboard] Apple subscriber created subscriberId=${created?.id} ` +
          `companyId=${input.companyId} sourceType=unknown plan=${input.planKey} ` +
          `status=${status} mrr=${mrr}`
      );
      return;
    }

    console.log(
      `[growth-dashboard] Apple subscriber matched subscriberId=${existing.id} ` +
        `matchedBy=${matchedBy} companyId=${existing.companyId ?? "—"} userId=${existing.userId ?? "—"}`
    );

    const updates: Partial<typeof growthSubscribers.$inferInsert> & { updatedAt: Date } = {
      platform: "apple" as any,
      plan: input.planKey,
      subscriptionStatus: status as any,
      monthlyRevenue: mrr as any,
      appleOriginalTransactionId: input.originalTransactionId,
      appleTransactionId: input.transactionId ?? existing.appleTransactionId ?? null,
      updatedAt: new Date(),
    };
    if (status === "trialing" && !existing.trialStartedAt) updates.trialStartedAt = new Date();
    if (status === "active" && !existing.becamePaidAt) updates.becamePaidAt = new Date();
    if (status === "expired" && !existing.canceledAt) updates.canceledAt = new Date();
    if (!existing.onboardingCompletedAt) updates.onboardingCompletedAt = new Date();
    // Backfill ownerEmail / companyName / userId / signupAt if the row was
    // seeded earlier with a partial shape (e.g. attribution-only landing rows).
    if (!existing.ownerEmail || !existing.companyName || !existing.userId || !existing.signupAt) {
      const meta = await loadCompanyMeta(input.companyId);
      if (meta) {
        if (!existing.ownerEmail) updates.ownerEmail = meta.ownerEmail;
        if (!existing.companyName) updates.companyName = meta.companyName;
        if (!existing.userId) updates.userId = input.userId ?? meta.ownerId;
        if (!existing.signupAt) updates.signupAt = meta.companyCreatedAt ?? new Date();
      }
    }

    await db
      .update(growthSubscribers)
      .set(updates as any)
      .where(eq(growthSubscribers.id, existing.id));
    console.log(
      `[growth-dashboard] Apple subscriber updated subscriberId=${existing.id} ` +
        `plan=${input.planKey} status=${status} mrr=${mrr} ` +
        `trialStartedAt=${updates.trialStartedAt ? "set" : "unchanged"} ` +
        `becamePaidAt=${updates.becamePaidAt ? "set" : "unchanged"}`
    );
  } catch (err) {
    console.error("[growth-dashboard] Apple sync error (ignored):", err);
  }
}

// ── Google Play → growth_subscribers sync ──────────────────────────────────
//
// Mirrors the Apple sync. Match keys: companyId → userId → googlePurchaseToken
// → googleOrderId. On miss → create with sourceType=unknown, platform=google_play.
export interface GoogleSubSyncInput {
  companyId: number;
  userId: string | null;
  purchaseToken: string;
  orderId?: string | null;
  planKey: string;
  paymentState: number; // 1=received, 2=trial
  expiresDate?: Date | null;
  autoRenewing?: boolean | null;
}

export async function syncGoogleSubscriptionToGrowthSubscriber(
  input: GoogleSubSyncInput,
): Promise<void> {
  try {
    console.log(
      `[growth-dashboard] Google Play subscription sync started companyId=${input.companyId} ` +
        `userId=${input.userId ?? "—"} planKey=${input.planKey} paymentState=${input.paymentState} ` +
        `orderId=${input.orderId ?? "—"} tokenPrefix=${input.purchaseToken.slice(0, 12)}…`
    );

    const expiresMs = input.expiresDate ? input.expiresDate.getTime() : null;
    const status = mapGoogleStatusToGrowth({ paymentState: input.paymentState, expiresMs });
    const planPrice = subscriptionPlans[input.planKey as keyof typeof subscriptionPlans]?.price ?? null;
    const mrr = status === "active" ? String(planPrice ?? 0) : "0";

    let existing: GrowthSubscriber | undefined;
    let matchedBy: string | null = null;

    if (input.companyId != null) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.companyId, input.companyId))
        .orderBy(desc(growthSubscribers.createdAt), desc(growthSubscribers.id))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "companyId";
      }
    }
    if (!existing && input.userId) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.userId, input.userId))
        .orderBy(desc(growthSubscribers.createdAt), desc(growthSubscribers.id))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "userId";
      }
    }
    if (!existing && input.purchaseToken) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.googlePurchaseToken, input.purchaseToken))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "googlePurchaseToken";
      }
    }
    if (!existing && input.orderId) {
      const [r] = await db
        .select()
        .from(growthSubscribers)
        .where(eq(growthSubscribers.googleOrderId, input.orderId))
        .limit(1);
      if (r) {
        existing = r;
        matchedBy = "googleOrderId";
      }
    }

    if (!existing) {
      const meta = await loadCompanyMeta(input.companyId);
      if (!meta) {
        console.warn(
          `[growth-dashboard] Google Play subscriber not found and company missing companyId=${input.companyId} — skipping`
        );
        return;
      }
      const [created] = await db
        .insert(growthSubscribers)
        .values({
          userId: input.userId ?? meta.ownerId,
          companyId: input.companyId,
          ownerEmail: meta.ownerEmail,
          companyName: meta.companyName,
          sourceType: "unknown" as any,
          platform: "google_play" as any,
          plan: input.planKey,
          subscriptionStatus: status as any,
          monthlyRevenue: mrr as any,
          currency: "USD",
          googlePurchaseToken: input.purchaseToken,
          googleOrderId: input.orderId ?? null,
          signupAt: meta.companyCreatedAt ?? new Date(),
          onboardingCompletedAt: new Date(),
          trialStartedAt: status === "trialing" ? new Date() : null,
          becamePaidAt: status === "active" ? new Date() : null,
        } as any)
        .returning();
      console.log(
        `[growth-dashboard] Google Play subscriber created subscriberId=${created?.id} ` +
          `companyId=${input.companyId} sourceType=unknown plan=${input.planKey} ` +
          `status=${status} mrr=${mrr}`
      );
      return;
    }

    console.log(
      `[growth-dashboard] Google Play subscriber matched subscriberId=${existing.id} ` +
        `matchedBy=${matchedBy} companyId=${existing.companyId ?? "—"} userId=${existing.userId ?? "—"}`
    );

    const updates: Partial<typeof growthSubscribers.$inferInsert> & { updatedAt: Date } = {
      platform: "google_play" as any,
      plan: input.planKey,
      subscriptionStatus: status as any,
      monthlyRevenue: mrr as any,
      googlePurchaseToken: input.purchaseToken,
      googleOrderId: input.orderId ?? existing.googleOrderId ?? null,
      updatedAt: new Date(),
    };
    if (status === "trialing" && !existing.trialStartedAt) updates.trialStartedAt = new Date();
    if (status === "active" && !existing.becamePaidAt) updates.becamePaidAt = new Date();
    if (status === "expired" && !existing.canceledAt) updates.canceledAt = new Date();
    if (!existing.onboardingCompletedAt) updates.onboardingCompletedAt = new Date();
    if (!existing.ownerEmail || !existing.companyName || !existing.userId || !existing.signupAt) {
      const meta = await loadCompanyMeta(input.companyId);
      if (meta) {
        if (!existing.ownerEmail) updates.ownerEmail = meta.ownerEmail;
        if (!existing.companyName) updates.companyName = meta.companyName;
        if (!existing.userId) updates.userId = input.userId ?? meta.ownerId;
        if (!existing.signupAt) updates.signupAt = meta.companyCreatedAt ?? new Date();
      }
    }

    await db
      .update(growthSubscribers)
      .set(updates as any)
      .where(eq(growthSubscribers.id, existing.id));
    console.log(
      `[growth-dashboard] Google Play subscriber updated subscriberId=${existing.id} ` +
        `plan=${input.planKey} status=${status} mrr=${mrr} ` +
        `trialStartedAt=${updates.trialStartedAt ? "set" : "unchanged"} ` +
        `becamePaidAt=${updates.becamePaidAt ? "set" : "unchanged"}`
    );
  } catch (err) {
    console.error("[growth-dashboard] Google Play sync error (ignored):", err);
  }
}

/**
 * One-time backfill: for every growth_subscribers row that has a matching
 * company with a Stripe subscription, sync the row from the company's
 * canonical billing fields. Safe to call repeatedly — uses the same idempotent
 * helper above. Logged but never throws.
 */
export async function backfillGrowthSubscribersFromCompanies(): Promise<{ scanned: number; updated: number }> {
  const rows = await db
    .select({
      subId: growthSubscribers.id,
      companyId: companies.id,
      stripeSubId: companies.stripeSubscriptionId,
      stripeCustId: companies.stripeCustomerId,
      status: companies.subscriptionStatus,
      planKey: companies.subscriptionPlan,
      priceId: companies.stripePriceId,
      trialEndsAt: companies.trialEndsAt,
    })
    .from(growthSubscribers)
    .innerJoin(companies, eq(companies.id, growthSubscribers.companyId));

  let updated = 0;
  for (const r of rows) {
    if (!r.stripeSubId) continue;
    await syncStripeSubscriptionToGrowthSubscriber(r.companyId, {
      id: r.stripeSubId,
      status: r.status ?? "unknown",
      customer: r.stripeCustId ?? null,
      items: r.priceId ? { data: [{ price: { id: r.priceId } }] } : undefined,
      trial_start: r.trialEndsAt
        ? Math.floor((new Date(r.trialEndsAt).getTime() - 7 * 24 * 60 * 60 * 1000) / 1000)
        : null,
      trial_end: r.trialEndsAt ? Math.floor(new Date(r.trialEndsAt).getTime() / 1000) : null,
    });
    updated += 1;
  }
  console.log(
    `[growth-dashboard] backfill complete — scanned=${rows.length} updated=${updated}`
  );
  return { scanned: rows.length, updated };
}

// ── Overview aggregates ────────────────────────────────────────────────────
export interface DashboardOverview {
  totalSubscribers: number;
  trialing: number;
  paid: number;          // active or past_due
  canceled: number;      // canceled or expired
  currentMrr: number;    // sum monthlyRevenue where subscriptionStatus in ('active','trialing','past_due')
  totalRevenue: number;  // sum totalRevenue all-time
  topSource: { sourceType: string | null; count: number } | null;
  topCampaign: { campaignId: number | null; name: string | null; count: number } | null;
  generatedAt: string;
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  // We use a single round-trip to keep the dashboard snappy when the table
  // is small, and individual aggregates so the SQL stays portable. If the
  // dataset grows, fold these into a single CTE.

  // NOTE: neon-serverless `db.execute()` returns a QueryResult — rows are on
  // `.rows`, the result itself is NOT an iterable.
  const countsResult = await db.execute<{
    total: string;
    trialing: string;
    paid: string;
    canceled: string;
    current_mrr: string | null;
    total_revenue: string | null;
  }>(sql`
    SELECT
      count(*)::text AS total,
      count(*) FILTER (WHERE subscription_status = 'trialing')::text AS trialing,
      count(*) FILTER (WHERE subscription_status IN ('active','past_due'))::text AS paid,
      count(*) FILTER (WHERE subscription_status IN ('canceled','expired'))::text AS canceled,
      coalesce(sum(monthly_revenue) FILTER (WHERE subscription_status IN ('active','past_due')), 0)::text AS current_mrr,
      coalesce(sum(total_revenue), 0)::text AS total_revenue
    FROM growth_subscribers
  `);
  const counts = ((countsResult as any).rows ?? [])[0] as
    | { total: string; trialing: string; paid: string; canceled: string; current_mrr: string | null; total_revenue: string | null; }
    | undefined;

  const topSourceResult = await db.execute<{ source_type: string | null; cnt: string }>(sql`
    SELECT source_type, count(*)::text AS cnt
    FROM growth_subscribers
    GROUP BY source_type
    ORDER BY count(*) DESC NULLS LAST
    LIMIT 1
  `);
  const topSourceRows = ((topSourceResult as any).rows ?? []) as Array<{ source_type: string | null; cnt: string }>;

  const topCampaignResult = await db.execute<{ campaign_id: number | null; name: string | null; cnt: string }>(sql`
    SELECT s.campaign_id, c.name, count(*)::text AS cnt
    FROM growth_subscribers s
    LEFT JOIN growth_campaigns c ON c.id = s.campaign_id
    WHERE s.campaign_id IS NOT NULL
    GROUP BY s.campaign_id, c.name
    ORDER BY count(*) DESC
    LIMIT 1
  `);
  const topCampaignRows = ((topCampaignResult as any).rows ?? []) as Array<{ campaign_id: number | null; name: string | null; cnt: string }>;

  const c = counts || ({} as any);
  return {
    totalSubscribers: Number(c.total ?? 0),
    trialing: Number(c.trialing ?? 0),
    paid: Number(c.paid ?? 0),
    canceled: Number(c.canceled ?? 0),
    currentMrr: Number(c.current_mrr ?? 0),
    totalRevenue: Number(c.total_revenue ?? 0),
    topSource: topSourceRows[0]
      ? { sourceType: topSourceRows[0].source_type, count: Number(topSourceRows[0].cnt) }
      : null,
    topCampaign: topCampaignRows[0]
      ? {
          campaignId: topCampaignRows[0].campaign_id,
          name: topCampaignRows[0].name,
          count: Number(topCampaignRows[0].cnt),
        }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

// Source aggregation for the /sources page
export interface SourceRow {
  sourceType: string | null;
  subscribers: number;
  trialing: number;
  paid: number;
  canceled: number;
  monthlyRevenue: number;
  totalRevenue: number;
}

export async function getSourceBreakdown(): Promise<SourceRow[]> {
  // NOTE: neon-serverless `db.execute()` returns a QueryResult — rows are on
  // `.rows`, the result itself is NOT an iterable / does NOT have `.map`.
  const result = await db.execute<{
    source_type: string | null;
    subs: string;
    trialing: string;
    paid: string;
    canceled: string;
    mrr: string | null;
    total_rev: string | null;
  }>(sql`
    SELECT
      source_type,
      count(*)::text AS subs,
      count(*) FILTER (WHERE subscription_status = 'trialing')::text AS trialing,
      count(*) FILTER (WHERE subscription_status IN ('active','past_due'))::text AS paid,
      count(*) FILTER (WHERE subscription_status IN ('canceled','expired'))::text AS canceled,
      coalesce(sum(monthly_revenue) FILTER (WHERE subscription_status IN ('active','past_due')), 0)::text AS mrr,
      coalesce(sum(total_revenue), 0)::text AS total_rev
    FROM growth_subscribers
    GROUP BY source_type
    ORDER BY count(*) DESC
  `);
  const rows = ((result as any).rows ?? []) as Array<{
    source_type: string | null;
    subs: string;
    trialing: string;
    paid: string;
    canceled: string;
    mrr: string | null;
    total_rev: string | null;
  }>;

  return rows.map((r) => ({
    sourceType: r.source_type,
    subscribers: Number(r.subs),
    trialing: Number(r.trialing),
    paid: Number(r.paid),
    canceled: Number(r.canceled),
    monthlyRevenue: Number(r.mrr ?? 0),
    totalRevenue: Number(r.total_rev ?? 0),
  }));
}

// ── Platform breakdown for the /platforms page ─────────────────────────────
export interface PlatformRow {
  platform: string;
  subscribers: number;
  trialing: number;
  paid: number;
  canceled: number;
  monthlyRevenue: number;
}

export async function getPlatformBreakdown(): Promise<PlatformRow[]> {
  // Same shape as getSourceBreakdown — grouped by platform instead.
  const result = await db.execute<{
    platform: string | null;
    subs: string;
    trialing: string;
    paid: string;
    canceled: string;
    mrr: string | null;
  }>(sql`
    SELECT
      platform,
      count(*)::text AS subs,
      count(*) FILTER (WHERE subscription_status = 'trialing')::text AS trialing,
      count(*) FILTER (WHERE subscription_status IN ('active','past_due'))::text AS paid,
      count(*) FILTER (WHERE subscription_status IN ('canceled','expired'))::text AS canceled,
      coalesce(sum(monthly_revenue) FILTER (WHERE subscription_status IN ('active','past_due')), 0)::text AS mrr
    FROM growth_subscribers
    GROUP BY platform
    ORDER BY count(*) DESC
  `);
  const rows = ((result as any).rows ?? []) as Array<{
    platform: string | null;
    subs: string;
    trialing: string;
    paid: string;
    canceled: string;
    mrr: string | null;
  }>;
  return rows.map((r) => ({
    platform: r.platform ?? "unknown",
    subscribers: Number(r.subs),
    trialing: Number(r.trialing),
    paid: Number(r.paid),
    canceled: Number(r.canceled),
    monthlyRevenue: Number(r.mrr ?? 0),
  }));
}

// ── Accounts (private dashboard) ──────────────────────────────────────────
//
// The Accounts surface lists EVERY customer company — attributed or not —
// joined to its owner, internal admin metadata (status/notes), and any
// existing growth_subscribers attribution row. It is admin-only and never
// exposed to the customer app.

export interface AccountListRow {
  companyId: number;
  companyName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
  // Internal status (defaults to "active" when no admin row exists yet)
  accountStatus: AccountAdminStatus;
  // Subscription (read from growth_subscribers when present, else companies)
  subscriptionStatus: string | null;
  plan: string | null;
  platform: string | null;
  monthlyRevenue: string | null;
  // Attribution (from growth_subscribers)
  sourceType: string | null;
  sourceName: string | null;
  campaignId: number | null;
  campaignName: string | null;
  referralCode: string | null;
  // Lifecycle
  signupAt: Date | null;
  onboardingCompletedAt: Date | null;
  hasGrowthSubscriber: boolean;
}

/**
 * List every customer company with joined owner + attribution + admin info.
 *
 * Differs from the Subscribers list:
 *   • Subscribers iterates `growth_subscribers` (attribution-only).
 *   • Accounts iterates `companies` (every customer, attributed or not).
 *
 * `growth_subscribers.companyId` is NOT unique by schema, so we use a
 * DISTINCT ON subquery to deterministically pick the newest attribution row
 * per company. Otherwise a duplicate subscriber row would inflate the list.
 */
export async function listAccounts(): Promise<AccountListRow[]> {
  // NOTE: neon-serverless `db.execute()` returns a QueryResult — rows live on
  // `.rows`, not on the result itself.
  const result = await db.execute<{
    company_id: number;
    company_name: string;
    company_created_at: string | null;
    company_onboarding_completed: boolean | null;
    company_sub_status: string | null;
    company_plan: string | null;
    company_platform: string | null;
    owner_id: string | null;
    owner_email: string | null;
    owner_first_name: string | null;
    owner_last_name: string | null;
    admin_status: string | null;
    sub_id: number | null;
    sub_status: string | null;
    sub_plan: string | null;
    sub_platform: string | null;
    sub_mrr: string | null;
    sub_source_type: string | null;
    sub_source_name: string | null;
    sub_campaign_id: number | null;
    sub_referral_code: string | null;
    sub_signup_at: string | null;
    sub_onboarding_completed_at: string | null;
    campaign_name: string | null;
  }>(sql`
    WITH attribution AS (
      SELECT DISTINCT ON (company_id) *
      FROM growth_subscribers
      WHERE company_id IS NOT NULL
      ORDER BY company_id, created_at DESC NULLS LAST, id DESC
    )
    SELECT
      c.id                          AS company_id,
      c.name                        AS company_name,
      c.created_at                  AS company_created_at,
      c.onboarding_completed        AS company_onboarding_completed,
      c.subscription_status         AS company_sub_status,
      c.subscription_plan           AS company_plan,
      c.subscription_platform       AS company_platform,
      u.id                          AS owner_id,
      u.email                       AS owner_email,
      u.first_name                  AS owner_first_name,
      u.last_name                   AS owner_last_name,
      a.status                      AS admin_status,
      s.id                          AS sub_id,
      s.subscription_status         AS sub_status,
      s.plan                        AS sub_plan,
      s.platform                    AS sub_platform,
      s.monthly_revenue             AS sub_mrr,
      s.source_type                 AS sub_source_type,
      s.source_name                 AS sub_source_name,
      s.campaign_id                 AS sub_campaign_id,
      s.referral_code               AS sub_referral_code,
      s.signup_at                   AS sub_signup_at,
      s.onboarding_completed_at     AS sub_onboarding_completed_at,
      camp.name                     AS campaign_name
    FROM companies c
    LEFT JOIN users u                ON u.id = c.owner_id
    LEFT JOIN attribution s          ON s.company_id = c.id
    LEFT JOIN growth_campaigns camp  ON camp.id = s.campaign_id
    LEFT JOIN growth_account_admin a ON a.company_id = c.id
    ORDER BY c.created_at DESC NULLS LAST
  `);
  const rows = (result as any).rows ?? [];

  return rows.map((r: any) => ({
    companyId: Number(r.company_id),
    companyName: r.company_name,
    ownerName: [r.owner_first_name, r.owner_last_name].filter(Boolean).join(" ") || null,
    ownerEmail: r.owner_email ?? null,
    ownerUserId: r.owner_id ?? null,
    accountStatus: ((r.admin_status as AccountAdminStatus) ?? "active"),
    subscriptionStatus: r.sub_status ?? r.company_sub_status ?? null,
    plan: r.sub_plan ?? r.company_plan ?? null,
    platform: r.sub_platform ?? r.company_platform ?? null,
    monthlyRevenue: r.sub_mrr != null ? String(r.sub_mrr) : null,
    sourceType: r.sub_source_type ?? null,
    sourceName: r.sub_source_name ?? null,
    campaignId: r.sub_campaign_id != null ? Number(r.sub_campaign_id) : null,
    campaignName: r.campaign_name ?? null,
    referralCode: r.sub_referral_code ?? null,
    signupAt: r.sub_signup_at ?? r.company_created_at ?? null,
    onboardingCompletedAt:
      r.sub_onboarding_completed_at ??
      (r.company_onboarding_completed ? r.company_created_at ?? null : null),
    hasGrowthSubscriber: r.sub_id != null,
  }));
}

export interface AccountDetailMember {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  joinedAt: Date | null;
}

export interface AccountDetail extends AccountListRow {
  // Identifiers / billing IDs
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  appleOriginalTransactionId: string | null;
  appleTransactionId: string | null;
  googlePurchaseToken: string | null;
  googleOrderId: string | null;
  // Internal admin fields
  notes: string | null;
  // Team
  members: AccountDetailMember[];
}

export async function getAccountDetail(companyId: number): Promise<AccountDetail | null> {
  const [row] = await db
    .select({
      companyId: companies.id,
      companyName: companies.name,
      companyCreatedAt: companies.createdAt,
      companyOnboardingCompleted: companies.onboardingCompleted,
      companySubStatus: companies.subscriptionStatus,
      companyPlan: companies.subscriptionPlan,
      companyPlatform: companies.subscriptionPlatform,
      companyStripeCustId: companies.stripeCustomerId,
      companyStripeSubId: companies.stripeSubscriptionId,
      ownerId: users.id,
      ownerEmail: users.email,
      ownerFirstName: users.firstName,
      ownerLastName: users.lastName,
      adminStatus: growthAccountAdmin.status,
      adminNotes: growthAccountAdmin.notes,
      subId: growthSubscribers.id,
      subStatus: growthSubscribers.subscriptionStatus,
      subPlan: growthSubscribers.plan,
      subPlatform: growthSubscribers.platform,
      subMrr: growthSubscribers.monthlyRevenue,
      subSourceType: growthSubscribers.sourceType,
      subSourceName: growthSubscribers.sourceName,
      subCampaignId: growthSubscribers.campaignId,
      subReferralCode: growthSubscribers.referralCode,
      subSignupAt: growthSubscribers.signupAt,
      subOnboardingCompletedAt: growthSubscribers.onboardingCompletedAt,
      subStripeCustId: growthSubscribers.stripeCustomerId,
      subStripeSubId: growthSubscribers.stripeSubscriptionId,
      subAppleOrig: growthSubscribers.appleOriginalTransactionId,
      subAppleTx: growthSubscribers.appleTransactionId,
      subGoogleToken: growthSubscribers.googlePurchaseToken,
      subGoogleOrder: growthSubscribers.googleOrderId,
      campaignName: growthCampaigns.name,
    })
    .from(companies)
    .leftJoin(users, eq(users.id, companies.ownerId))
    .leftJoin(growthSubscribers, eq(growthSubscribers.companyId, companies.id))
    .leftJoin(growthCampaigns, eq(growthCampaigns.id, growthSubscribers.campaignId))
    .leftJoin(growthAccountAdmin, eq(growthAccountAdmin.companyId, companies.id))
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!row) return null;

  const memberRows = await db
    .select({
      userId: companyMembers.userId,
      role: companyMembers.role,
      joinedAt: companyMembers.createdAt,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(companyMembers)
    .leftJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId));

  return {
    companyId: row.companyId,
    companyName: row.companyName,
    ownerName: [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ") || null,
    ownerEmail: row.ownerEmail ?? null,
    ownerUserId: row.ownerId ?? null,
    accountStatus: ((row.adminStatus as AccountAdminStatus) ?? "active"),
    subscriptionStatus: row.subStatus ?? row.companySubStatus ?? null,
    plan: row.subPlan ?? row.companyPlan ?? null,
    platform: row.subPlatform ?? row.companyPlatform ?? null,
    monthlyRevenue: row.subMrr != null ? String(row.subMrr) : null,
    sourceType: row.subSourceType ?? null,
    sourceName: row.subSourceName ?? null,
    campaignId: row.subCampaignId ?? null,
    campaignName: row.campaignName ?? null,
    referralCode: row.subReferralCode ?? null,
    signupAt: row.subSignupAt ?? row.companyCreatedAt ?? null,
    onboardingCompletedAt:
      row.subOnboardingCompletedAt ??
      (row.companyOnboardingCompleted ? row.companyCreatedAt ?? null : null),
    hasGrowthSubscriber: row.subId != null,
    stripeCustomerId: row.subStripeCustId ?? row.companyStripeCustId ?? null,
    stripeSubscriptionId: row.subStripeSubId ?? row.companyStripeSubId ?? null,
    appleOriginalTransactionId: row.subAppleOrig ?? null,
    appleTransactionId: row.subAppleTx ?? null,
    googlePurchaseToken: row.subGoogleToken ?? null,
    googleOrderId: row.subGoogleOrder ?? null,
    notes: row.adminNotes ?? null,
    members: memberRows.map((m) => ({
      userId: m.userId,
      email: m.email ?? null,
      name: [m.firstName, m.lastName].filter(Boolean).join(" ") || null,
      role: String(m.role),
      joinedAt: m.joinedAt ?? null,
    })),
  };
}

/**
 * Manually set or update the attribution on a company. If the company already
 * has a growth_subscribers row we patch it in place; otherwise we create one
 * seeded from the company + owner so the row has the same shape as one
 * created naturally during onboarding. Idempotent.
 *
 * If a campaign with the supplied referralCode exists, its id wins over any
 * caller-supplied campaignId so the join in the Accounts/Subscribers UI lights
 * up correctly.
 */
export async function updateAccountAttribution(
  companyId: number,
  payload: {
    sourceType?: string | null;
    sourceName?: string | null;
    campaignId?: number | null;
    referralCode?: string | null;
  },
): Promise<{ created: boolean; row: GrowthSubscriber | null }> {
  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      createdAt: companies.createdAt,
      ownerId: companies.ownerId,
      stripeCustId: companies.stripeCustomerId,
      stripeSubId: companies.stripeSubscriptionId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) return { created: false, row: null };

  const [owner] = company.ownerId
    ? await db.select({ email: users.email }).from(users).where(eq(users.id, company.ownerId)).limit(1)
    : [];

  const code = normalizeReferralCode(payload.referralCode ?? null);
  const matchedCampaign = code ? await findActiveCampaignByReferralCode(code) : null;

  const baseAttribution: Record<string, any> = {
    sourceType: (payload.sourceType ?? null) as any,
    sourceName: payload.sourceName ?? null,
    referralCode: code,
    // Prefer matched campaign id when the code resolves; else accept caller's id.
    campaignId: matchedCampaign?.id ?? payload.campaignId ?? null,
    updatedAt: new Date(),
  };

  // companyId is not unique on growth_subscribers (no DB constraint), so we
  // deterministically pick the newest row to update — same row used by the
  // Accounts list query — instead of relying on insert order.
  const [existing] = await db
    .select()
    .from(growthSubscribers)
    .where(eq(growthSubscribers.companyId, companyId))
    .orderBy(desc(growthSubscribers.createdAt), desc(growthSubscribers.id))
    .limit(1);

  if (existing) {
    await db
      .update(growthSubscribers)
      .set(baseAttribution as any)
      .where(eq(growthSubscribers.id, existing.id));
    const [row] = await db
      .select()
      .from(growthSubscribers)
      .where(eq(growthSubscribers.id, existing.id))
      .limit(1);
    console.log(
      `[dashboard-accounts] updating attribution — companyId=${companyId} subscriberId=${existing.id} sourceType=${payload.sourceType ?? "—"} code=${code ?? "—"}`
    );
    return { created: false, row: row ?? null };
  }

  // Seed a fresh attribution row so the company shows up on Subscribers too.
  const [created] = await db
    .insert(growthSubscribers)
    .values({
      ...baseAttribution,
      userId: company.ownerId,
      companyId: company.id,
      ownerEmail: owner?.email ?? null,
      companyName: company.name,
      platform: "stripe" as any,
      subscriptionStatus: "unknown" as any,
      stripeCustomerId: company.stripeCustId ?? null,
      stripeSubscriptionId: company.stripeSubId ?? null,
      signupAt: company.createdAt ?? new Date(),
    } as any)
    .returning();
  console.log(
    `[dashboard-accounts] updating attribution — companyId=${companyId} created new growth_subscribers row id=${created?.id} sourceType=${payload.sourceType ?? "—"} code=${code ?? "—"}`
  );
  return { created: true, row: created ?? null };
}

async function upsertAccountAdmin(
  companyId: number,
  patch: { status?: AccountAdminStatus; notes?: string | null },
): Promise<typeof growthAccountAdmin.$inferSelect | null> {
  const [existing] = await db
    .select()
    .from(growthAccountAdmin)
    .where(eq(growthAccountAdmin.companyId, companyId))
    .limit(1);

  if (existing) {
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.notes !== undefined) updates.notes = patch.notes;
    await db.update(growthAccountAdmin).set(updates).where(eq(growthAccountAdmin.id, existing.id));
    const [row] = await db
      .select()
      .from(growthAccountAdmin)
      .where(eq(growthAccountAdmin.id, existing.id))
      .limit(1);
    return row ?? null;
  }

  const [created] = await db
    .insert(growthAccountAdmin)
    .values({
      companyId,
      status: patch.status ?? "active",
      notes: patch.notes ?? null,
    })
    .returning();
  return created ?? null;
}

export async function updateAccountStatus(
  companyId: number,
  status: AccountAdminStatus,
): Promise<typeof growthAccountAdmin.$inferSelect | null> {
  if (!(ACCOUNT_ADMIN_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid account status: ${status}`);
  }
  console.log(`[dashboard-accounts] updating account status — companyId=${companyId} status=${status}`);
  return upsertAccountAdmin(companyId, { status });
}

export async function updateAccountNotes(
  companyId: number,
  notes: string | null,
): Promise<typeof growthAccountAdmin.$inferSelect | null> {
  console.log(`[dashboard-accounts] updating notes — companyId=${companyId} length=${(notes ?? "").length}`);
  return upsertAccountAdmin(companyId, { notes });
}

/**
 * Re-fetch the company's Stripe subscription and re-run BOTH sync paths:
 *   1. syncSubscriptionToCompany   — refreshes companies.* billing fields
 *   2. syncStripeSubscriptionToGrowthSubscriber — refreshes growth_subscribers
 *
 * Read-only against Stripe; writes only to our own DB. No-op when the company
 * has no stripeSubscriptionId on file.
 */
export async function refreshAccountSubscription(
  companyId: number,
): Promise<{ refreshed: boolean; reason?: string; status?: string | null }> {
  console.log(`[dashboard-accounts] refreshing subscription — companyId=${companyId}`);
  const [company] = await db
    .select({
      id: companies.id,
      stripeSubId: companies.stripeSubscriptionId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) return { refreshed: false, reason: "company_not_found" };
  if (!company.stripeSubId) return { refreshed: false, reason: "no_stripe_subscription" };

  // Lazy imports to avoid a circular load at module-init time.
  const { default: Stripe } = await import("stripe");
  const { syncSubscriptionToCompany } = await import("../billingService");

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) return { refreshed: false, reason: "stripe_not_configured" };
  const stripe = new Stripe(apiKey);

  const sub = await stripe.subscriptions.retrieve(company.stripeSubId);
  await syncSubscriptionToCompany(company.id, sub as any);
  await syncStripeSubscriptionToGrowthSubscriber(company.id, {
    id: sub.id,
    status: sub.status,
    customer: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    items: sub.items as any,
    trial_start: sub.trial_start ?? null,
    trial_end: sub.trial_end ?? null,
    metadata: (sub.metadata as any) ?? null,
  });

  return { refreshed: true, status: sub.status };
}

// ─────────────────────────────────────────────────────────────────────────────
// Account deletion preview
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountDeletionPreview {
  exists: boolean;
  companyId: number;
  companyName: string | null;
  ownerEmail: string | null;
  counts: {
    members: number;
    jobs: number;
    customers: number;
    invoices: number;
    payments: number;
    documents: number;
    conversations: number;
    messages: number;
    growthSubscribers: number;
  };
  subscription: {
    platform: string | null;
    status: string | null;
    hasStripeSub: boolean;
    hasStripeCustomer: boolean;
    hasAppleSub: boolean;
    hasGoogleSub: boolean;
  };
  warnings: string[];
  /**
   * Per-user breakdown of what will happen to the auth/user records when
   * delete runs. The classification mirrors the logic inside
   * deleteCompanyDeep so the modal can warn the admin upfront.
   */
  users: {
    willDelete: Array<{ userId: string; email: string | null }>;
    willKeepBecauseOtherCompany: Array<{ userId: string; email: string | null }>;
    willKeepBecauseProtected: Array<{ userId: string; email: string | null }>;
  };
  /** Pending signup rows that will be removed (so the email is reusable). */
  pendingSignupsToDelete: number;
}

/**
 * Snapshot of what would be deleted if `deleteCompanyDeep(companyId)` ran now.
 * Read-only — does not modify any data. Used to populate the confirmation modal.
 */
export async function previewAccountDeletion(
  companyId: number,
  actorEmail?: string | null,
): Promise<AccountDeletionPreview> {
  console.log(`[dashboard-accounts] preview deletion — companyId=${companyId}`);

  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      ownerId: companies.ownerId,
      stripeSubscriptionId: companies.stripeSubscriptionId,
      stripeCustomerId: companies.stripeCustomerId,
      subscriptionPlatform: companies.subscriptionPlatform,
      subscriptionStatus: companies.subscriptionStatus,
      originalTransactionId: companies.originalTransactionId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) {
    return {
      exists: false,
      companyId,
      companyName: null,
      ownerEmail: null,
      counts: {
        members: 0,
        jobs: 0,
        customers: 0,
        invoices: 0,
        payments: 0,
        documents: 0,
        conversations: 0,
        messages: 0,
        growthSubscribers: 0,
      },
      subscription: {
        platform: null,
        status: null,
        hasStripeSub: false,
        hasStripeCustomer: false,
        hasAppleSub: false,
        hasGoogleSub: false,
      },
      warnings: [],
      users: {
        willDelete: [],
        willKeepBecauseOtherCompany: [],
        willKeepBecauseProtected: [],
      },
      pendingSignupsToDelete: 0,
    };
  }

  const [ownerRow] = company.ownerId
    ? await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, company.ownerId))
        .limit(1)
    : [{ email: null as string | null }];

  // Run count queries in parallel — read-only, safe to fan out.
  const countOf = (
    table: any,
    col: any,
  ): Promise<number> =>
    db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(table)
      .where(eq(col, companyId))
      .then((r) => Number(r[0]?.c ?? 0));

  // For messages, count via conversations subquery (no companyId on messages).
  const messagesCountPromise = db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(messages)
    .where(
      sql`${messages.conversationId} IN (SELECT id FROM ${conversations} WHERE company_id = ${companyId})`,
    )
    .then((r) => Number(r[0]?.c ?? 0));

  const [
    membersCount,
    jobsCount,
    customersCount,
    invoicesCount,
    paymentsCount,
    documentsCount,
    conversationsCount,
    messagesCount,
    growthSubsCount,
  ] = await Promise.all([
    countOf(companyMembers, companyMembers.companyId),
    countOf(jobs, jobs.companyId),
    countOf(customers, customers.companyId),
    countOf(invoices, invoices.companyId),
    countOf(payments, payments.companyId),
    countOf(documents, documents.companyId),
    countOf(conversations, conversations.companyId),
    messagesCountPromise,
    countOf(growthSubscribers, growthSubscribers.companyId),
  ]);

  const platform = (company.subscriptionPlatform || "").toLowerCase();
  const hasStripeSub = !!company.stripeSubscriptionId;
  const hasStripeCustomer = !!company.stripeCustomerId;
  const hasAppleSub = platform === "ios" && !!company.originalTransactionId;
  const hasGoogleSub = platform === "android" && !!company.originalTransactionId;

  const warnings: string[] = [];
  if (hasStripeSub) {
    warnings.push(
      "This account has an active Stripe subscription. Cancel billing in Stripe separately — local references will be removed but the subscription will not be auto-canceled.",
    );
  }
  if (hasStripeCustomer && !hasStripeSub) {
    warnings.push(
      "This account has a Stripe customer record. Local references will be removed but the customer will not be deleted from Stripe.",
    );
  }
  if (hasAppleSub) {
    warnings.push(
      "This account has an Apple in-app subscription. Apple subscriptions cannot be canceled server-side — they must be canceled by the user from their Apple ID.",
    );
  }
  if (hasGoogleSub) {
    warnings.push(
      "This account has a Google Play in-app subscription. Google subscriptions are not auto-canceled here — handle in Play Console if needed.",
    );
  }

  // ── Per-user breakdown ────────────────────────────────────────────────
  // Mirrors the live classification inside deleteCompanyDeep so the modal
  // can show "X users will be removed, Y will be kept (still in another
  // company), Z protected" before the admin types DELETE.
  const memberRows = await db
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(eq(companyMembers.companyId, companyId));
  const candidateUserIdSet = new Set<string>(memberRows.map((m) => m.userId));
  if (company.ownerId) candidateUserIdSet.add(company.ownerId);
  const candidateUserIds = Array.from(candidateUserIdSet);

  const userInfoRows = candidateUserIds.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(candidateUserIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];

  const protectedEmails = (() => {
    const set = new Set<string>(["pjpell077@gmail.com"]);
    for (const e of (process.env.DASHBOARD_ADMIN_EMAILS || "").split(/[,\s;]+/)) {
      const t = e.trim().toLowerCase();
      if (t) set.add(t);
    }
    // Mirror live behavior: deleteCompanyDeep also skips the acting admin so
    // they don't lock themselves out. Include the actor email here so the
    // modal doesn't falsely warn that the actor will be deleted.
    if (actorEmail) set.add(actorEmail.toLowerCase());
    return set;
  })();

  const willDelete: Array<{ userId: string; email: string | null }> = [];
  const willKeepBecauseOtherCompany: Array<{ userId: string; email: string | null }> = [];
  const willKeepBecauseProtected: Array<{ userId: string; email: string | null }> = [];

  // Run other-membership checks in parallel — read-only.
  const otherMembershipChecks = await Promise.all(
    userInfoRows.map(async (u) => {
      const other = await db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.userId, u.id),
            sql`${companyMembers.companyId} != ${companyId}`,
          ),
        )
        .limit(1);
      return { user: u, hasOther: other.length > 0 };
    }),
  );

  for (const { user: u, hasOther } of otherMembershipChecks) {
    const emailLower = u.email ? u.email.toLowerCase() : null;
    if (emailLower && protectedEmails.has(emailLower)) {
      willKeepBecauseProtected.push({ userId: u.id, email: u.email });
    } else if (hasOther) {
      willKeepBecauseOtherCompany.push({ userId: u.id, email: u.email });
    } else {
      willDelete.push({ userId: u.id, email: u.email });
    }
  }

  // Count pending signup rows that will be cleared (so the email is reusable).
  const willDeleteEmailsLower = willDelete
    .map((u) => u.email?.toLowerCase())
    .filter((e): e is string => !!e);
  let pendingSignupsToDelete = 0;
  if (willDeleteEmailsLower.length > 0) {
    const psRow = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(pendingSignups)
      .where(
        sql`LOWER(${pendingSignups.email}) IN (${sql.join(willDeleteEmailsLower.map((e) => sql`${e}`), sql`, `)})`,
      );
    pendingSignupsToDelete = Number(psRow[0]?.c ?? 0);
  }

  return {
    exists: true,
    companyId: company.id,
    companyName: company.name,
    ownerEmail: ownerRow?.email ?? null,
    counts: {
      members: membersCount,
      jobs: jobsCount,
      customers: customersCount,
      invoices: invoicesCount,
      payments: paymentsCount,
      documents: documentsCount,
      conversations: conversationsCount,
      messages: messagesCount,
      growthSubscribers: growthSubsCount,
    },
    subscription: {
      platform: company.subscriptionPlatform,
      status: company.subscriptionStatus,
      hasStripeSub,
      hasStripeCustomer,
      hasAppleSub,
      hasGoogleSub,
    },
    warnings,
    users: {
      willDelete,
      willKeepBecauseOtherCompany,
      willKeepBecauseProtected,
    },
    pendingSignupsToDelete,
  };
}

/**
 * Whether the dashboard "delete account" UI is enabled in this environment.
 * Defaults to OFF. Must be explicitly enabled per environment with
 * ALLOW_DASHBOARD_ACCOUNT_DELETION=true. The intent is staging-only for now.
 */
export function isAccountDeletionEnabled(): boolean {
  const v = (process.env.ALLOW_DASHBOARD_ACCOUNT_DELETION || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Whether an admin is allowed to delete a company they themselves are a member of.
 * Off by default — guard against an admin nuking their own active workspace by mistake.
 */
export function isSelfAccountDeleteAllowed(): boolean {
  const v = (process.env.ALLOW_SELF_ACCOUNT_DELETE || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

// ── Branch.io / mobile attribution ─────────────────────────────────────────
//
// Helpers for the dashboard Campaigns page to (a) generate Branch deep links
// per-campaign, (b) record mobile events from the webhook, and (c) resolve
// a Branch payload back to the right growth_campaigns row.
//
// All Branch network failures are surfaced to the caller as `{ ok: false }` —
// the calling route translates that into a friendly error response without
// breaking the rest of the dashboard.

export interface BranchLinkResult {
  ok: boolean;
  campaign?: GrowthCampaign;
  branchUrl?: string | null;
  error?: string;
}

/**
 * Generate a fresh Branch link for the given campaign and persist the result
 * onto the growth_campaigns row. Idempotent: re-running on a campaign with an
 * existing alias passes `overwrite=true` so Branch updates the link instead
 * of returning a 409.
 *
 * Pre-conditions enforced here (route also checks):
 *   • Branch must be configured (key + integration enabled).
 *   • Campaign must exist and have a non-empty referral code (we use that
 *     as the human-readable Branch alias).
 */
export async function createOrRegenerateBranchLinkForCampaign(
  campaignId: number,
  opts: { webFallbackUrl: string },
): Promise<BranchLinkResult> {
  if (!isBranchConfigured()) {
    return { ok: false, error: "Branch is not configured on this server" };
  }

  // Concurrency guard: two admins clicking "Regenerate" on the same row at
  // the same time would otherwise both call Branch and then race on the
  // UPDATE. We serialize per-campaign via a Postgres transaction-scoped
  // advisory lock. The first arg `33` is an arbitrary namespace constant for
  // "branch link regen"; the second is the campaign id. Lock is auto-released
  // when the transaction commits/rolls back.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(33, ${campaignId})`);

    // SELECT … FOR UPDATE so we read the latest row state under the lock.
    const lockedRows = await tx.execute<typeof growthCampaigns.$inferSelect>(sql`
      SELECT * FROM growth_campaigns WHERE id = ${campaignId} FOR UPDATE
    `);
    const campaign = (lockedRows as any).rows?.[0] as
      | typeof growthCampaigns.$inferSelect
      | undefined;
    if (!campaign) {
      return { ok: false, error: "Campaign not found" } as BranchLinkResult;
    }
    const referralCode = normalizeReferralCode(campaign.referralCode);
    if (!referralCode) {
      return {
        ok: false,
        error: "Campaign has no referral code — set one before generating a mobile link",
      } as BranchLinkResult;
    }

    const branchResult: CreateBranchLinkResult = await createBranchLink({
      referralCode,
      sourceType: campaign.sourceType,
      sourceName: campaign.sourceName,
      campaignId: campaign.id,
      campaignName: campaign.name,
      webFallbackUrl: opts.webFallbackUrl,
      // Always pass overwrite=true so re-generation updates instead of 409-ing.
      overwriteAlias: true,
    });

    if (!branchResult.ok || !branchResult.url) {
      return {
        ok: false,
        error: branchResult.error || "Branch did not return a link",
      } as BranchLinkResult;
    }

    const now = new Date();
    const [updated] = await tx
      .update(growthCampaigns)
      .set({
        branchLinkUrl: branchResult.url,
        branchLinkId: branchResult.branchLinkId ?? null,
        branchAlias: branchResult.alias ?? referralCode,
        mobileTrackingEnabled: true,
        branchChannel: branchResult.channel ?? null,
        branchFeature: branchResult.feature ?? null,
        branchCampaign: branchResult.campaign ?? null,
        branchCreatedAt: campaign.branchCreatedAt ?? now,
        branchUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(growthCampaigns.id, campaign.id))
      .returning();

    return { ok: true, campaign: updated, branchUrl: updated?.branchLinkUrl ?? null };
  });
}

/**
 * Best-effort resolution of a parsed Branch event back to a growth_campaigns
 * row. Strategy (in order):
 *
 *   1. Match on the explicit campaignId we put into the link's custom data.
 *   2. Match on the referralCode echoed back in the payload.
 *   3. Match on the saved branchLinkUrl that fired the event.
 *
 * Returns `null` when nothing matches — the event is still recorded with a
 * null campaign_id so we have a forensic record.
 */
export async function findCampaignForBranchPayload(
  parsed: ParsedBranchEvent,
): Promise<GrowthCampaign | null> {
  // 1. campaignId direct match
  if (parsed.metadata.campaignId && Number.isFinite(parsed.metadata.campaignId)) {
    const [byId] = await db
      .select()
      .from(growthCampaigns)
      .where(eq(growthCampaigns.id, parsed.metadata.campaignId))
      .limit(1);
    if (byId) return byId;
  }
  // 2. referralCode match (case-insensitive via normalize)
  const code = normalizeReferralCode(parsed.metadata.referralCode);
  if (code) {
    const [byCode] = await db
      .select()
      .from(growthCampaigns)
      .where(eq(growthCampaigns.referralCode, code))
      .limit(1);
    if (byCode) return byCode;
  }
  // 3. branchLinkUrl match
  if (parsed.metadata.branchLinkUrl) {
    const [byUrl] = await db
      .select()
      .from(growthCampaigns)
      .where(eq(growthCampaigns.branchLinkUrl, parsed.metadata.branchLinkUrl))
      .limit(1);
    if (byUrl) return byUrl;
  }
  return null;
}

/**
 * Insert a mobile event row. Idempotent on `branchEventId` — if Branch
 * re-delivers the same event id, the unique index throws a 23505 and we
 * swallow it (returning the existing row when possible, or null otherwise).
 *
 * Never throws on duplicate; other errors propagate to the route handler.
 */
export async function recordMobileEvent(
  input: InsertGrowthMobileEvent,
): Promise<{ inserted: boolean; row: GrowthMobileEvent | null }> {
  try {
    const [row] = await db.insert(growthMobileEvents).values(input).returning();
    return { inserted: true, row };
  } catch (err: any) {
    // Postgres unique-violation = 23505. Treat as duplicate (already recorded).
    if (err?.code === "23505") {
      const where = input.branchEventId
        ? eq(growthMobileEvents.branchEventId, input.branchEventId)
        : undefined;
      if (where) {
        const [existing] = await db.select().from(growthMobileEvents).where(where).limit(1);
        return { inserted: false, row: existing ?? null };
      }
      return { inserted: false, row: null };
    }
    throw err;
  }
}

/**
 * Lightweight metrics roll-up for a single campaign. Used by the regenerate
 * route response so the UI can update its row counters without re-fetching
 * the entire campaigns list.
 */
export async function getMobileMetricsByCampaign(
  campaignId: number,
): Promise<{ clicks: number; installs: number; opens: number }> {
  const res = await db.execute<{ clicks: string; installs: string; opens: string }>(sql`
    SELECT
      count(*) FILTER (WHERE event_type = 'click')::text   AS clicks,
      count(*) FILTER (WHERE event_type = 'install')::text AS installs,
      count(*) FILTER (WHERE event_type = 'open')::text    AS opens
    FROM growth_mobile_events
    WHERE campaign_id = ${campaignId}
  `);
  const row = (res as any).rows?.[0] ?? {};
  return {
    clicks: Number(row.clicks ?? 0),
    installs: Number(row.installs ?? 0),
    opens: Number(row.opens ?? 0),
  };
}

/** Re-export the Branch config probe so routes can show a helpful error msg. */
export { isBranchConfigured, isBranchIntegrationEnabled };
