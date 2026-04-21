export interface BillingAccess {
  allowed: boolean;
  source: 'free_access' | 'apple' | 'google_play' | 'stripe' | 'trial' | 'blocked';
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

  // ── 2. Active paid subscription (Apple, Google Play, or Stripe) ───────────
  //   Requires subscriptionStatus = 'active'.
  //   currentPeriodEnd is checked only when it IS present:
  //     - null/missing  → trust Stripe's 'active' status (e.g. fresh checkout before webhook sets the date)
  //     - future date   → grant access
  //     - past date     → blocked (subscription definitely expired and was not renewed)
  //   Source label is driven by subscriptionPlatform:
  //     'apple'        → Apple App Store subscription (iOS native)
  //     'google_play'  → Google Play subscription (Android native)
  //     'stripe'       → Stripe web subscription
  //     null / other   → Legacy record, defaults to 'stripe' for backward compatibility
  if (company.subscriptionStatus === 'active') {
    const periodEnd = company.currentPeriodEnd ? new Date(company.currentPeriodEnd) : null;
    // Allow if: period end is unknown (trust Stripe) OR period end is in the future
    const periodEndOk = periodEnd === null || periodEnd > now;
    if (periodEndOk) {
      const platform = (company.subscriptionPlatform as string | null | undefined) ?? null;
      let source: BillingAccess['source'];
      if (platform === 'apple') source = 'apple';
      else if (platform === 'google_play') source = 'google_play';
      else source = 'stripe'; // 'stripe' explicitly, or legacy null records

      return {
        allowed: true,
        source,
        effectivePlan: company.subscriptionPlan || null,
        seatLimit: company.maxUsers || 1,
        notes: [],
        blockReason: null,
      };
    }
    // Has 'active' status but currentPeriodEnd is set and definitively in the past
    return {
      allowed: false,
      source: 'blocked',
      effectivePlan: null,
      seatLimit: 0,
      notes: [],
      blockReason: 'subscription_expired',
    };
  }

  // ── 3. Active trial ──────────────────────────────────────────────────────
  //   Requires subscriptionStatus = 'trialing'.
  //   trialEndsAt is checked when present:
  //     - null/missing  → trust Stripe's 'trialing' status (parallel to how 'active' handles
  //                       missing currentPeriodEnd — e.g. fresh trial before sync sets the date)
  //     - future date   → grant access
  //     - past date     → blocked (trial definitively expired)
  //
  //   Google Play free trials are stored as 'trialing' + subscriptionPlatform='google_play'.
  //   They use source='google_play' so billing attribution stays consistent with paid Google
  //   Play subscriptions.  The legacy EcoLogic app signup trial (no platform) keeps source='trial'.
  if (company.subscriptionStatus === 'trialing') {
    const trialEnd = company.trialEndsAt ? new Date(company.trialEndsAt) : null;
    // Allow if: trial end is unknown (trust status) OR trial end is in the future
    const trialEndOk = trialEnd === null || trialEnd > now;
    if (trialEndOk) {
      const platform = (company.subscriptionPlatform as string | null | undefined) ?? null;
      // Google Play IAP trial → report as 'google_play' so billing identity is consistent
      const source: BillingAccess['source'] = platform === 'google_play' ? 'google_play' : 'trial';
      return {
        allowed: true,
        source,
        effectivePlan: company.subscriptionPlan || null,
        seatLimit: company.maxUsers || 1,
        notes: platform === 'google_play' ? ['google_play_trial'] : [],
        blockReason: null,
      };
    }
    return {
      allowed: false,
      source: 'blocked',
      effectivePlan: null,
      seatLimit: 0,
      notes: [],
      blockReason: 'trial_expired',
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
