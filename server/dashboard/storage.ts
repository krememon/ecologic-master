/**
 * Dashboard storage module
 * ────────────────────────
 * Focused data-access layer for the private internal dashboard. Kept separate
 * from the main `server/storage.ts` to avoid bloating the customer-app storage
 * interface with admin-only concerns.
 */

import { db } from "../db";
import { eq, desc, sql } from "drizzle-orm";
import {
  growthSubscribers,
  growthCampaigns,
  growthCreators,
  type GrowthSubscriber,
  type GrowthCampaign,
  type GrowthCreator,
  type InsertGrowthCampaign,
  type InsertGrowthCreator,
} from "@shared/schema";

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
      coalesce(sum(monthly_revenue) FILTER (WHERE subscription_status IN ('active','trialing','past_due')), 0)::text AS current_mrr,
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
      coalesce(sum(monthly_revenue) FILTER (WHERE subscription_status IN ('active','trialing','past_due')), 0)::text AS mrr,
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
