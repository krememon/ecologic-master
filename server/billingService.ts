/**
 * billingService.ts
 * Stripe billing helpers for EcoLogic web subscriptions.
 * Handles plan → price ID mapping and syncing Stripe subscription state into the DB.
 */

import { db } from "./db";
import { companies } from "../shared/schema";
import { eq } from "drizzle-orm";
import { subscriptionPlans } from "../shared/subscriptionPlans";

// ── Plan → Stripe Price ID mapping ─────────────────────────────────────────
const PLAN_PRICE_IDS: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  team:    process.env.STRIPE_PRICE_TEAM,
  pro:     process.env.STRIPE_PRICE_PRO,
  scale:   process.env.STRIPE_PRICE_SCALE,
};

export const ALLOWED_PLAN_KEYS = Object.keys(subscriptionPlans);

export function getPriceIdForPlan(planKey: string): string | null {
  return PLAN_PRICE_IDS[planKey] ?? null;
}

/** Reverse lookup: Stripe Price ID → EcoLogic plan key */
export function getPlanKeyForPriceId(priceId: string): string | null {
  for (const [key, pid] of Object.entries(PLAN_PRICE_IDS)) {
    if (pid && pid === priceId) return key;
  }
  return null;
}

/** User limit for a plan key */
export function getMaxUsersForPlan(planKey: string): number {
  return subscriptionPlans[planKey]?.userLimit ?? 1;
}

// ── Statuses that allow app access ─────────────────────────────────────────
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * Sync a Stripe Subscription object into the EcoLogic companies table.
 * Call this from every subscription-related webhook event.
 */
export async function syncSubscriptionToCompany(
  companyId: number,
  sub: {
    id: string;
    status: string;
    current_period_end: number;
    cancel_at_period_end: boolean;
    trial_end?: number | null;
    items?: { data: Array<{ price: { id: string } }> };
    metadata?: Record<string, string>;
    customer?: string;
  }
) {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const planKey = priceId ? (getPlanKeyForPriceId(priceId) ?? sub.metadata?.planKey ?? null) : null;
  const subscriptionStatus = sub.status; // active, past_due, canceled, trialing, etc.

  // In Stripe API version 2025-04-30.basil, current_period_end moved from the top-level
  // subscription object to each subscription item (sub.items.data[0].current_period_end).
  // We try: item-level first, then sub-level as fallback for older API responses.
  const firstItem = sub.items?.data?.[0] as any;
  const periodEndFromItem = typeof firstItem?.current_period_end === "number" && !isNaN(firstItem.current_period_end)
    ? firstItem.current_period_end
    : null;
  const periodEndFromSub = typeof (sub as any).current_period_end === "number" && !isNaN((sub as any).current_period_end)
    ? (sub as any).current_period_end
    : null;
  const periodEndRaw = periodEndFromItem ?? periodEndFromSub ?? null;
  const currentPeriodEnd = periodEndRaw !== null ? new Date(periodEndRaw * 1000) : null;
  console.log(`[billing-sync-debug] subId=${sub.id} periodEndFromItem=${periodEndFromItem} periodEndFromSub=${periodEndFromSub} → raw=${periodEndRaw}`);

  const maxUsers = planKey ? getMaxUsersForPlan(planKey) : undefined;
  const customerId = typeof sub.customer === "string" ? sub.customer : null;

  const updates: Record<string, any> = {
    stripeSubscriptionId: sub.id,
    subscriptionStatus,
    stripePriceId: priceId,
    subscriptionCancelAtPeriodEnd: sub.cancel_at_period_end,
    billingUpdatedAt: new Date(),
    subscriptionPlatform: "stripe",
  };

  // Only write currentPeriodEnd if it is a valid date
  if (currentPeriodEnd !== null) updates.currentPeriodEnd = currentPeriodEnd;

  // Write trialEndsAt when the subscription is in a trial state so the billing resolver
  // can confirm the trial is still valid and grant access.
  if (subscriptionStatus === 'trialing' && typeof sub.trial_end === 'number' && sub.trial_end > 0) {
    updates.trialEndsAt = new Date(sub.trial_end * 1000);
    console.log(`[billing-sync] trialEndsAt set to ${updates.trialEndsAt.toISOString()} from sub.trial_end=${sub.trial_end}`);
  }

  if (planKey) updates.subscriptionPlan = planKey;
  if (maxUsers !== undefined) updates.maxUsers = maxUsers;
  if (customerId) updates.stripeCustomerId = customerId;

  // If subscription ended / canceled, block access
  if (!ACTIVE_STATUSES.has(subscriptionStatus)) {
    updates.subscriptionStatus = subscriptionStatus; // canceled, past_due, unpaid, etc.
  }

  console.log(
    `[billing-sync] companyId=${companyId} subId=${sub.id} status=${subscriptionStatus} plan=${planKey ?? "unknown"} periodEnd=${currentPeriodEnd?.toISOString() ?? "missing"}`
  );

  await db
    .update(companies)
    .set(updates)
    .where(eq(companies.id, companyId));
}

/**
 * Find company ID from a Stripe event object's metadata or stripeCustomerId.
 * Returns null if not found.
 */
export async function resolveCompanyFromStripeEvent(params: {
  customerId?: string | null;
  metadataCompanyId?: string | null;
}): Promise<number | null> {
  const { customerId, metadataCompanyId } = params;

  // Prefer explicit companyId from metadata
  if (metadataCompanyId) {
    const id = parseInt(metadataCompanyId, 10);
    if (!isNaN(id)) return id;
  }

  // Fall back to stripeCustomerId lookup
  if (customerId) {
    const [found] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.stripeCustomerId, customerId))
      .limit(1);
    if (found) return found.id;
  }

  return null;
}
