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
  companies,
  users,
  companyMembers,
  ACCOUNT_ADMIN_STATUSES,
  type GrowthSubscriber,
  type GrowthCampaign,
  type GrowthCreator,
  type InsertGrowthCampaign,
  type InsertGrowthCreator,
  type AccountAdminStatus,
} from "@shared/schema";
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

/** Campaigns list with subscriber counts for the dashboard table. */
export interface CampaignWithMetrics extends GrowthCampaign {
  signups: number;
}

export async function listGrowthCampaignsWithMetrics(): Promise<CampaignWithMetrics[]> {
  // NOTE: `db.execute()` on the neon-serverless Pool driver returns a
  // QueryResult object — the rows live on `.rows`, NOT on the result itself.
  // Destructuring or iterating the result directly throws
  // "TypeError: (intermediate value) is not iterable".
  const result = await db.execute<{ id: number; signups: string }>(sql`
    SELECT campaign_id AS id, count(*)::text AS signups
    FROM growth_subscribers
    WHERE campaign_id IS NOT NULL
    GROUP BY campaign_id
  `);
  const rows = (result as any).rows ?? [];

  const counts = new Map<number, number>();
  for (const r of rows) counts.set(Number(r.id), Number(r.signups));

  const campaigns = await listGrowthCampaigns();
  return campaigns.map((c) => ({ ...c, signups: counts.get(c.id) ?? 0 }));
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

    if (!existing) {
      console.log(
        `[growth-dashboard] Stripe subscriber not found subId=${sub.id} ` +
          `companyId=${companyId ?? "—"} customerId=${customerId ?? "—"} — skipping`
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
