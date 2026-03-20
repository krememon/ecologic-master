import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Users, RefreshCw, Loader2, AlertTriangle, ArrowUpRight, RotateCcw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { subscriptionPlans } from '@/config/subscriptionPlans';
import type { PlanKey } from '@/config/subscriptionPlans';
import {
  isNativeIos,
  isNativeAndroid,
  restoreApplePurchases,
  restoreGooglePlayPurchases,
} from '@/lib/nativeIap';
import { apiRequest } from '@/lib/queryClient';

// ── Billing status shape returned by /api/billing/status ──────────────────────
interface BillingStatus {
  ok: boolean;
  companyId: number;
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  subscriptionPlatform: string | null;
  stripePriceId: string | null;
  stripeSubscriptionId: string | null;
  hasStripeCustomer: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  billingAllowed: boolean;
  billingSource: string;
  effectivePlan: string | null;
  seatLimit: number | null;
  billingUpdatedAt: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function planLabel(planKey: string | null): string {
  if (!planKey) return 'None';
  const plan = subscriptionPlans[planKey as PlanKey];
  return plan?.label ?? planKey.charAt(0).toUpperCase() + planKey.slice(1);
}

function platformLabel(platform: string | null, source: string): string {
  if (source === 'free_access') return 'Free Access';
  if (source === 'user_bypass') return 'Admin Override';
  if (source === 'trial') return 'Trial';
  if (platform === 'apple' || source === 'apple') return 'Apple';
  if (platform === 'google_play' || source === 'google_play') return 'Google Play';
  if (platform === 'stripe' || source === 'stripe') return 'Web';
  return 'None';
}

function StatusBadge({ billing }: { billing: BillingStatus }) {
  const { subscriptionStatus, billingAllowed, billingSource } = billing;

  if (billingSource === 'free_access' || billingSource === 'user_bypass') {
    return <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400">Active</Badge>;
  }
  if (billingSource === 'trial' || subscriptionStatus === 'trialing') {
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400">Trial</Badge>;
  }
  if (subscriptionStatus === 'active') {
    return <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400">Active</Badge>;
  }
  if (subscriptionStatus === 'past_due') {
    return <Badge variant="destructive">Past Due</Badge>;
  }
  if (subscriptionStatus === 'canceled' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'inactive') {
    return <Badge variant="destructive">Cancelled</Badge>;
  }
  if (!billingAllowed) {
    return <Badge variant="destructive">Paywall Active</Badge>;
  }
  return <Badge variant="secondary">Inactive</Badge>;
}

// ── Local AuthUser shape (mirrors useAuth.ts — company is nested, NOT flat) ──
interface AuthUserWithCompany {
  id: string;
  email?: string | null;
  role?: string | null;
  company?: {
    id: number;
    name: string;
    subscriptionStatus?: string | null;
    subscriptionPlan?: string | null;
  } | null;
}

export function BillingSection() {
  // IMPORTANT: useAuth returns { user } where user.company.id is the company ID.
  // There is NO flat user.companyId field — that was the root cause of "No Company Found".
  const { user: rawUser } = useAuth();
  const user = rawUser as AuthUserWithCompany | null;

  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [nativeIos, setNativeIos] = useState(false);
  const [nativeAndroid, setNativeAndroid] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  useEffect(() => {
    setNativeIos(isNativeIos());
    setNativeAndroid(isNativeAndroid());
  }, []);

  const isNativeApp = nativeIos || nativeAndroid;

  // Company lives at user.company.id — user.companyId does NOT exist on this type
  const companyId = user?.company?.id ?? null;

  console.log('[billing-section] user.id=', user?.id, 'company.id=', companyId, 'role=', user?.role);

  // Fetch real billing status — same endpoint used by the paywall gate and Dev Tools.
  // Only fetch once we know the user has a company (avoids 404 noise for new accounts).
  const { data: billing, isLoading, isError, refetch } = useQuery<BillingStatus>({
    queryKey: ['/api/billing/status'],
    enabled: !!companyId,
    retry: 1,
    staleTime: 30_000,
  });

  console.log('[billing-section] billing fetch → isLoading=', isLoading, 'isError=', isError, 'ok=', billing?.ok, 'plan=', billing?.subscriptionPlan, 'source=', billing?.billingSource);

  // ── No company at all (user never completed onboarding) ─────────────────────
  // Only show this if user is loaded and truly has no company.
  if (!user) {
    return null; // still loading auth
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-slate-500" />
            Billing & Subscription
          </CardTitle>
          <CardDescription>Manage your subscription and billing information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-500 mb-3" />
            <h3 className="text-base font-semibold mb-1">No Company Found</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              You need to set up your company before managing billing.
            </p>
            <Button onClick={() => setLocation('/paywall')}>Choose Plan</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-slate-500" />
            Billing & Subscription
          </CardTitle>
          <CardDescription>Manage your subscription and billing information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading billing info…
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error / failed to load ────────────────────────────────────────────────
  if (isError || !billing?.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-slate-500" />
            Billing & Subscription
          </CardTitle>
          <CardDescription>Manage your subscription and billing information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Could not load billing status.
            <button onClick={() => refetch()} className="underline text-slate-500 hover:text-slate-700">Retry</button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Derived display values ────────────────────────────────────────────────
  const displayPlanKey = billing.subscriptionPlan || billing.effectivePlan;
  const plan = displayPlanKey ? subscriptionPlans[displayPlanKey as PlanKey] : null;
  const displayPlanLabel = planLabel(displayPlanKey);
  const displayPlatformLabel = platformLabel(billing.subscriptionPlatform, billing.billingSource);

  const isStripePlan = billing.subscriptionPlatform === 'stripe' || (billing.subscriptionPlatform == null && !!billing.stripeSubscriptionId);
  const isFreeAccess = billing.billingSource === 'free_access' || billing.billingSource === 'user_bypass';
  const hasPaidPlan = billing.subscriptionStatus === 'active' && !isFreeAccess;
  const isTrialing = billing.subscriptionStatus === 'trialing' || billing.billingSource === 'trial';

  // ── Native restore handler ────────────────────────────────────────────────
  const handleRestore = async () => {
    setIsRestoring(true);
    try {
      if (nativeIos) {
        const jws = await restoreApplePurchases();
        if (!jws) {
          toast({ title: 'Nothing to restore', description: 'No active EcoLogic subscription was found on this Apple ID.', variant: 'destructive' });
          return;
        }
        const res = await apiRequest('POST', '/api/subscriptions/validate', { platform: 'apple', jwsTransaction: jws });
        const data = await res.json();
        if (data.ok) {
          refetch();
          toast({ title: 'Restored', description: 'Your subscription has been restored.' });
        } else {
          throw new Error(data.message || 'Validation failed');
        }
      } else if (nativeAndroid) {
        const result = await restoreGooglePlayPurchases();
        if (!result) {
          toast({ title: 'Nothing to restore', description: 'No active EcoLogic subscription was found on this Google account.', variant: 'destructive' });
          return;
        }
        const res = await apiRequest('POST', '/api/subscriptions/validate', { platform: 'google_play', purchaseToken: result.purchaseToken, productId: result.productId });
        const data = await res.json();
        if (data.ok) {
          refetch();
          toast({ title: 'Restored', description: 'Your subscription has been restored.' });
        } else {
          throw new Error(data.message || 'Validation failed');
        }
      }
    } catch (e: any) {
      toast({ title: 'Restore failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Stripe billing portal handler (web only) ──────────────────────────────
  const handleOpenPortal = async () => {
    setIsOpeningPortal(true);
    try {
      const res = await apiRequest('POST', '/api/billing/create-portal-session');
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.message || 'Failed to open billing portal');
      }
    } catch (e: any) {
      toast({ title: 'Could not open billing portal', description: e.message, variant: 'destructive' });
    } finally {
      setIsOpeningPortal(false);
    }
  };

  // ── Platform source label for "Managed through..." ───────────────────────
  const managedThroughLabel = nativeIos
    ? 'Managed through Apple'
    : nativeAndroid
    ? 'Managed through Google Play'
    : 'Managed through Web Billing';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4 text-slate-500" />
          Billing & Subscription
        </CardTitle>
        <CardDescription>Manage your subscription and billing information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* ── Current Plan ─────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {displayPlanLabel} Plan
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {plan
                  ? `$${plan.price}/mo · Up to ${billing.seatLimit ?? '—'} users`
                  : billing.seatLimit
                  ? `Up to ${billing.seatLimit} users`
                  : 'No active plan'}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <StatusBadge billing={billing} />
          </div>
        </div>

        {/* ── Billing Details ───────────────────────────────────── */}
        <div className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Billing source</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{displayPlatformLabel}</span>
          </div>

          {(billing.currentPeriodEnd && hasPaidPlan) && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">
                {billing.cancelAtPeriodEnd ? 'Access until' : 'Renews'}
              </span>
              <span className={`font-medium ${billing.cancelAtPeriodEnd ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>
                {formatDate(billing.currentPeriodEnd)}
              </span>
            </div>
          )}

          {(isTrialing && billing.trialEndsAt) && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Trial ends</span>
              <span className="font-medium text-blue-600 dark:text-blue-400">{formatDate(billing.trialEndsAt)}</span>
            </div>
          )}

          {billing.cancelAtPeriodEnd && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Subscription is set to cancel — access ends {formatDate(billing.currentPeriodEnd)}.
            </div>
          )}

          {isFreeAccess && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-300">
              Full access enabled by admin. No payment required.
            </div>
          )}

          {!billing.billingAllowed && !isFreeAccess && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Subscription inactive. Subscribe to restore full access.
            </div>
          )}

          {/* "Managed through" note */}
          {(hasPaidPlan || isTrialing) && !isFreeAccess && (
            <p className="text-xs text-slate-400 dark:text-slate-500 pt-0.5">{managedThroughLabel}</p>
          )}
        </div>

        <Separator />

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Actions</p>
          <div className="flex flex-col gap-2">

            {/* Upgrade / Choose Plan — always shown */}
            <Button
              className="w-full"
              onClick={() => setLocation('/paywall')}
            >
              <ArrowUpRight className="h-4 w-4 mr-2" />
              {!billing.billingAllowed || !displayPlanKey
                ? 'Choose a Plan'
                : 'Upgrade Plan'}
            </Button>

            {/* Stripe billing portal — web only, only if there's a Stripe subscription */}
            {!isNativeApp && isStripePlan && billing.hasStripeCustomer && (
              <Button
                variant="outline"
                className="w-full"
                disabled={isOpeningPortal}
                onClick={handleOpenPortal}
              >
                {isOpeningPortal
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Opening…</>
                  : <><CreditCard className="h-4 w-4 mr-2" />Manage Billing</>
                }
              </Button>
            )}

            {/* Restore Purchases — native platforms only */}
            {isNativeApp && (
              <Button
                variant="outline"
                className="w-full"
                disabled={isRestoring}
                onClick={handleRestore}
              >
                {isRestoring
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Restoring…</>
                  : <><RotateCcw className="h-4 w-4 mr-2" />Restore Purchases</>
                }
              </Button>
            )}

            {/* Refresh */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-slate-500 dark:text-slate-400"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh Status
            </Button>

          </div>
        </div>

      </CardContent>
    </Card>
  );
}
