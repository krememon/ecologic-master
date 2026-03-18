export interface BillingAccess {
  allowed: boolean;
  source: 'free_access' | 'apple' | 'stripe' | 'trial' | 'blocked';
  effectivePlan: string | null;
  seatLimit: number;
  notes: string[];
  blockReason: string | null;
}

export function getEffectiveBillingAccess(company: any): BillingAccess {
  const now = new Date();

  // ── 0. Company-level pause (highest priority, overrides all billing) ─────
  if (company.adminPaused) {
    return {
      allowed: false,
      source: 'blocked',
      effectivePlan: null,
      seatLimit: 0,
      notes: ['company_paused'],
      blockReason: 'company_paused',
    };
  }

  const overrideExpired =
    company.adminOverrideExpiresAt && new Date(company.adminOverrideExpiresAt) < now;

  // ── 1. Free access override (adminFreeAccess OR adminBypassSubscription) ──
  if ((company.adminFreeAccess || company.adminBypassSubscription) && !overrideExpired) {
    return {
      allowed: true,
      source: 'free_access',
      effectivePlan: company.adminPlanOverride || company.subscriptionPlan || 'pro',
      seatLimit: company.adminUnlimitedSeats
        ? 9999
        : company.adminSeatLimitOverride ?? company.maxUsers ?? 9999,
      notes: ['admin_free_access_override'],
      blockReason: null,
    };
  }

  // ── 2. Active paid subscription (Apple or Stripe) ─────────────────────────
  //   Requires subscriptionStatus = 'active' AND a valid, future currentPeriodEnd.
  //   Missing currentPeriodEnd is treated as EXPIRED (not as "infinite").
  //   Source label is driven by subscriptionPlatform — defaults to 'stripe' for
  //   legacy records that pre-date the platform field.
  if (company.subscriptionStatus === 'active') {
    const periodEnd = company.currentPeriodEnd ? new Date(company.currentPeriodEnd) : null;
    if (periodEnd && periodEnd > now) {
      const platform = (company.subscriptionPlatform as string | null | undefined);
      return {
        allowed: true,
        source: platform === 'apple' ? 'apple' : 'stripe',
        effectivePlan: company.subscriptionPlan || null,
        seatLimit: company.maxUsers || 1,
        notes: [],
        blockReason: null,
      };
    }
    // Has 'active' status but period is expired or missing
    return {
      allowed: false,
      source: 'blocked',
      effectivePlan: null,
      seatLimit: 0,
      notes: [],
      blockReason: periodEnd ? 'subscription_expired' : 'active_no_period_end',
    };
  }

  // ── 3. Active trial ──────────────────────────────────────────────────────
  //   Requires subscriptionStatus = 'trialing' AND a valid, future trialEndsAt.
  //   Missing trialEndsAt is treated as EXPIRED.
  if (company.subscriptionStatus === 'trialing') {
    const trialEnd = company.trialEndsAt ? new Date(company.trialEndsAt) : null;
    if (trialEnd && trialEnd > now) {
      return {
        allowed: true,
        source: 'trial',
        effectivePlan: company.subscriptionPlan || null,
        seatLimit: company.maxUsers || 1,
        notes: [],
        blockReason: null,
      };
    }
    return {
      allowed: false,
      source: 'blocked',
      effectivePlan: null,
      seatLimit: 0,
      notes: [],
      blockReason: trialEnd ? 'trial_expired' : 'trialing_no_end_date',
    };
  }

  // ── 4. No valid billing → blocked ────────────────────────────────────────
  return {
    allowed: false,
    source: 'blocked',
    effectivePlan: null,
    seatLimit: 0,
    notes: [],
    blockReason: 'no_active_subscription',
  };
}
