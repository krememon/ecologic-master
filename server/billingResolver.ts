export interface BillingAccess {
  allowed: boolean;
  source: 'override_free_access' | 'override_bypass' | 'stripe' | 'trial' | 'blocked';
  effectivePlan: string | null;
  seatLimit: number;
  notes: string[];
}

export function getEffectiveBillingAccess(company: any): BillingAccess {
  const now = new Date();

  const overrideExpired =
    company.adminOverrideExpiresAt && new Date(company.adminOverrideExpiresAt) < now;

  // 1. Free access override (highest priority)
  if (company.adminFreeAccess && !overrideExpired) {
    return {
      allowed: true,
      source: 'override_free_access',
      effectivePlan: company.adminPlanOverride || company.subscriptionPlan || 'pro',
      seatLimit: company.adminUnlimitedSeats
        ? 9999
        : company.adminSeatLimitOverride ?? company.maxUsers ?? 9999,
      notes: ['admin_free_access_override'],
    };
  }

  // 2. Bypass subscription gate override
  if (company.adminBypassSubscription && !overrideExpired) {
    return {
      allowed: true,
      source: 'override_bypass',
      effectivePlan: company.adminPlanOverride || company.subscriptionPlan || null,
      seatLimit: company.adminUnlimitedSeats
        ? 9999
        : company.adminSeatLimitOverride ?? company.maxUsers ?? 1,
      notes: ['admin_bypass_subscription'],
    };
  }

  // 3. Normal Stripe / trial billing
  const periodEnd = company.currentPeriodEnd || company.trialEndsAt || null;
  const expired = periodEnd ? new Date(periodEnd) < now : false;
  const statusInDb = company.subscriptionStatus || 'inactive';
  const isActiveInDb = statusInDb === 'active' || statusInDb === 'trialing';
  const active = isActiveInDb && !expired;

  if (active) {
    return {
      allowed: true,
      source: statusInDb === 'trialing' ? 'trial' : 'stripe',
      effectivePlan: company.subscriptionPlan || null,
      seatLimit: company.maxUsers || 1,
      notes: [],
    };
  }

  // 4. Blocked
  return {
    allowed: false,
    source: 'blocked',
    effectivePlan: null,
    seatLimit: 0,
    notes: [],
  };
}
