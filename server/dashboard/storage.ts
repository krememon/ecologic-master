/**
 * Dashboard storage module
 * ────────────────────────
 * Focused data-access layer for the private internal dashboard. Kept separate
 * from the main `server/storage.ts` to avoid bloating the customer-app storage
 * interface with admin-only concerns.
 */

import { db } from "../db";
import { eq, desc, sql, and } from "drizzle-orm";
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

// ── Campaigns ──────────────────────────────────────────────────────────────
export async function listGrowthCampaigns(): Promise<GrowthCampaign[]> {
  return await db.select().from(growthCampaigns).orderBy(desc(growthCampaigns.createdAt));
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

  const [counts] = await db.execute<{
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
  `) as unknown as Array<{
    total: string;
    trialing: string;
    paid: string;
    canceled: string;
    current_mrr: string | null;
    total_revenue: string | null;
  }>;

  const topSourceRows = (await db.execute<{ source_type: string | null; cnt: string }>(sql`
    SELECT source_type, count(*)::text AS cnt
    FROM growth_subscribers
    GROUP BY source_type
    ORDER BY count(*) DESC NULLS LAST
    LIMIT 1
  `)) as unknown as Array<{ source_type: string | null; cnt: string }>;

  const topCampaignRows = (await db.execute<{ campaign_id: number | null; name: string | null; cnt: string }>(sql`
    SELECT s.campaign_id, c.name, count(*)::text AS cnt
    FROM growth_subscribers s
    LEFT JOIN growth_campaigns c ON c.id = s.campaign_id
    WHERE s.campaign_id IS NOT NULL
    GROUP BY s.campaign_id, c.name
    ORDER BY count(*) DESC
    LIMIT 1
  `)) as unknown as Array<{ campaign_id: number | null; name: string | null; cnt: string }>;

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
  monthlyRevenue: number;
}

export async function getSourceBreakdown(): Promise<SourceRow[]> {
  const rows = (await db.execute<{
    source_type: string | null;
    subs: string;
    trialing: string;
    paid: string;
    mrr: string | null;
  }>(sql`
    SELECT
      source_type,
      count(*)::text AS subs,
      count(*) FILTER (WHERE subscription_status = 'trialing')::text AS trialing,
      count(*) FILTER (WHERE subscription_status IN ('active','past_due'))::text AS paid,
      coalesce(sum(monthly_revenue) FILTER (WHERE subscription_status IN ('active','trialing','past_due')), 0)::text AS mrr
    FROM growth_subscribers
    GROUP BY source_type
    ORDER BY count(*) DESC
  `)) as unknown as Array<{
    source_type: string | null;
    subs: string;
    trialing: string;
    paid: string;
    mrr: string | null;
  }>;

  return rows.map((r) => ({
    sourceType: r.source_type,
    subscribers: Number(r.subs),
    trialing: Number(r.trialing),
    paid: Number(r.paid),
    monthlyRevenue: Number(r.mrr ?? 0),
  }));
}
