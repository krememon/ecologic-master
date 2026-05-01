import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Backfill growth_subscribers from existing companies.
 *
 * The dashboard's overview/charts/accounts pages read counts and MRR from the
 * growth_subscribers table. That table only receives a row when a NEW signup
 * goes through the attribution-aware flow added later in development. Existing
 * production accounts (companies with real subscription_status / plan) had no
 * row, so the dashboard reported 0 subscribers / $0 MRR even when the business
 * had real customers.
 *
 * This backfill inserts ONE growth_subscribers row per company that doesn't
 * already have one. Attribution columns are left NULL — the dashboard renders
 * NULL source_type as "Unknown", which is the correct semantic for accounts
 * that pre-date attribution tracking.
 *
 * Idempotent: re-running is a no-op once every company has a row.
 *
 * Safety: if growth_subscribers does not exist (e.g. dev DB without growth
 * tables) the function logs a warning and returns 0 — it never throws.
 */
export async function backfillGrowthSubscribersFromCompanies(): Promise<number> {
  // Guard: skip silently if growth_subscribers table is not present.
  try {
    const tableCheck = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'growth_subscribers'
      ) AS exists
    `);
    const exists = ((tableCheck as any).rows ?? [])[0]?.exists;
    if (!exists) {
      console.log("[growth-backfill] growth_subscribers table not present — skipping backfill");
      return 0;
    }
  } catch (err: any) {
    console.warn("[growth-backfill] could not check table existence:", err?.message);
    return 0;
  }

  try {
    // Plan-key → monthly USD price (kept in sync with shared/subscriptionPlans.ts).
    // Embedded in SQL because growth_subscribers.monthly_revenue is set per-row
    // at insert time and depends on the plan column from the companies table.
    const result = await db.execute<{ inserted: string }>(sql`
      WITH inserted AS (
        INSERT INTO growth_subscribers (
          user_id, company_id, owner_email, company_name,
          source_type, source_name,
          platform, plan, subscription_status,
          monthly_revenue, total_revenue, currency,
          signup_at, onboarding_completed_at,
          trial_started_at, became_paid_at, canceled_at,
          stripe_customer_id, stripe_subscription_id,
          apple_original_transaction_id,
          created_at, updated_at
        )
        SELECT
          c.owner_id,
          c.id,
          u.email,
          c.name,
          NULL::growth_source_type,
          NULL,
          (CASE
            WHEN lower(coalesce(c.subscription_platform, '')) = 'stripe'                THEN 'stripe'
            WHEN lower(coalesce(c.subscription_platform, '')) = 'apple'                 THEN 'apple'
            WHEN lower(coalesce(c.subscription_platform, '')) IN ('google','google_play','googleplay') THEN 'google_play'
            WHEN lower(coalesce(c.subscription_platform, '')) = 'manual'                THEN 'manual'
            ELSE 'unknown'
          END)::growth_platform,
          c.subscription_plan,
          (CASE
            WHEN lower(coalesce(c.subscription_status, '')) IN ('active','trialing','canceled','past_due','unpaid','expired')
              THEN lower(c.subscription_status)
            ELSE 'unknown'
          END)::growth_sub_status,
          (CASE
            WHEN lower(coalesce(c.subscription_status, '')) IN ('active','past_due') THEN
              CASE lower(coalesce(c.subscription_plan, ''))
                WHEN 'starter' THEN 29.99
                WHEN 'team'    THEN 79.99
                WHEN 'pro'     THEN 159.99
                WHEN 'scale'   THEN 299.99
                ELSE 0
              END
            ELSE 0
          END)::numeric,
          0::numeric,
          'USD',
          c.created_at,
          CASE WHEN c.onboarding_completed = true THEN c.created_at ELSE NULL END,
          CASE WHEN lower(coalesce(c.subscription_status, '')) = 'trialing'             THEN c.created_at ELSE NULL END,
          CASE WHEN lower(coalesce(c.subscription_status, '')) IN ('active','past_due') THEN c.created_at ELSE NULL END,
          CASE WHEN lower(coalesce(c.subscription_status, '')) IN ('canceled','expired') THEN coalesce(c.updated_at, c.created_at) ELSE NULL END,
          c.stripe_customer_id_company,
          -- NULL out the stripe sub id if another growth_subscribers row already
          -- holds it, otherwise the unique index would reject the insert.
          CASE
            WHEN c.stripe_subscription_id IS NULL THEN NULL
            WHEN EXISTS (SELECT 1 FROM growth_subscribers gs2 WHERE gs2.stripe_subscription_id = c.stripe_subscription_id) THEN NULL
            ELSE c.stripe_subscription_id
          END,
          -- Same defensive NULL-out for the apple original tx id.
          CASE
            WHEN c.original_transaction_id IS NULL THEN NULL
            WHEN EXISTS (SELECT 1 FROM growth_subscribers gs3 WHERE gs3.apple_original_transaction_id = c.original_transaction_id) THEN NULL
            ELSE c.original_transaction_id
          END,
          now(),
          now()
        FROM companies c
        LEFT JOIN users u ON u.id = c.owner_id
        WHERE NOT EXISTS (
          SELECT 1 FROM growth_subscribers gs WHERE gs.company_id = c.id
        )
        RETURNING id
      )
      SELECT count(*)::text AS inserted FROM inserted
    `);

    const insertedCount = Number(((result as any).rows ?? [])[0]?.inserted ?? 0);

    const totals = await db.execute<{ companies: string; subscribers: string }>(sql`
      SELECT
        (SELECT count(*)::text FROM companies)           AS companies,
        (SELECT count(*)::text FROM growth_subscribers)  AS subscribers
    `);
    const t = ((totals as any).rows ?? [])[0] ?? { companies: "?", subscribers: "?" };

    if (insertedCount > 0) {
      console.log(
        `[growth-backfill] Inserted ${insertedCount} growth_subscribers row(s) from companies. ` +
          `Total companies=${t.companies}, total growth_subscribers=${t.subscribers}.`
      );
    } else {
      console.log(
        `[growth-backfill] No backfill needed — every company already has a growth_subscribers row. ` +
          `Total companies=${t.companies}, total growth_subscribers=${t.subscribers}.`
      );
    }
    return insertedCount;
  } catch (err: any) {
    console.error("[growth-backfill] ERROR during backfill:", err?.message || err);
    return 0;
  }
}
