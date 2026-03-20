import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle,
  Users,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { subscriptionPlans } from "@/config/subscriptionPlans";
import type { PlanKey } from "@/config/subscriptionPlans";
import {
  isNativeIos,
  isNativeAndroid,
  loadAppleProducts,
  loadGooglePlayProducts,
  purchaseAppleSubscription,
  purchaseGooglePlaySubscription,
  type IapProduct,
} from "@/lib/nativeIap";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// UI display order — ascending by price/tier (Starter first, Scale last).
// NOTE: This is NOT Apple's subscription group level order. Apple levels in
// App Store Connect must be ordered highest-to-lowest (Scale=1, Starter=4)
// so that Starter→Team is treated as an immediate upgrade, not a deferred
// downgrade. This array only controls card rendering and the "lower tier"
// gray-out logic in the UI.
const PLAN_ORDER: PlanKey[] = ["starter", "team", "pro", "scale"];

interface BillingStatus {
  ok: boolean;
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  subscriptionPlatform: string | null;
  effectivePlan: string | null;
  billingSource: string;
  billingAllowed: boolean;
  hasStripeCustomer: boolean;
  seatLimit: number | null;
}

const PLAN_BULLETS: Record<PlanKey, string[]> = {
  starter: ["1 user", "Job management", "Invoicing", "Client messaging"],
  team:    ["Up to 5 users", "Everything in Starter", "Scheduling", "Timesheets"],
  pro:     ["Up to 10 users", "Everything in Team", "Estimates", "QuickBooks sync"],
  scale:   ["Up to 15 users", "Everything in Pro", "Stripe Connect payouts", "Bulk campaigns"],
};

export default function UpgradePlan() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [nativeIos, setNativeIos] = useState(false);
  const [nativeAndroid, setNativeAndroid] = useState(false);
  const [products, setProducts] = useState<IapProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [purchasing, setPurchasing] = useState<PlanKey | null>(null);

  useEffect(() => {
    const ios = isNativeIos();
    const android = isNativeAndroid();
    setNativeIos(ios);
    setNativeAndroid(android);
  }, []);

  const { data: billing, isLoading } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    staleTime: 30_000,
  });

  // Load store products on native platforms
  useEffect(() => {
    if (!nativeIos && !nativeAndroid) return;
    setProductsLoading(true);
    const loader = nativeIos ? loadAppleProducts() : loadGooglePlayProducts();
    loader.then((loaded) => {
      setProducts(loaded);
      setProductsLoading(false);
    });
  }, [nativeIos, nativeAndroid]);

  const isNativeApp = nativeIos || nativeAndroid;
  const currentPlanKey = (billing?.subscriptionPlan || billing?.effectivePlan) as PlanKey | null;
  const currentPlanIndex = currentPlanKey ? PLAN_ORDER.indexOf(currentPlanKey) : -1;
  const currentPlan = currentPlanKey ? subscriptionPlans[currentPlanKey] : null;
  const isFreeAccess = billing?.billingSource === "free_access" || billing?.billingSource === "user_bypass";

  const getStorePrice = (plan: typeof subscriptionPlans[PlanKey], planKey: PlanKey): string => {
    const identifier = nativeIos ? plan.appleProductId : plan.googlePlayProductId;
    const product = products.find(p => p.identifier === identifier);
    return product?.priceString ?? `$${plan.price}`;
  };

  // ── Validate a native purchase with the backend ──────────────────────────
  const finishNativePurchase = async (
    platform: "apple" | "google_play",
    payload: Record<string, string>,
    targetPlanKey: PlanKey,
  ) => {
    const res = await apiRequest("POST", "/api/subscriptions/validate", { platform, ...payload, expectedPlanKey: targetPlanKey });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || "Subscription validation failed");

    // Refresh billing state immediately so Settings shows the new plan.
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["/api/billing/status"] }),
      queryClient.refetchQueries({ queryKey: ["/api/subscriptions/status"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }),
    ]);

    const confirmedPlanKey = (data.verifiedPlanKey ?? data.planKey) as PlanKey;
    const confirmedPlan = subscriptionPlans[confirmedPlanKey] ?? subscriptionPlans[targetPlanKey];
    toast({
      title: "Plan upgraded!",
      description: `You are now on the ${confirmedPlan.label} plan.`,
    });
    setLocation("/settings");
  };

  // ── Handle plan selection ─────────────────────────────────────────────────
  const handleSelectPlan = async (planKey: PlanKey) => {
    const plan = subscriptionPlans[planKey];
    setPurchasing(planKey);

    try {
      if (nativeIos) {
        const jws = await purchaseAppleSubscription(plan.appleProductId);
        await finishNativePurchase("apple", { jwsTransaction: jws }, planKey);

      } else if (nativeAndroid) {
        const result = await purchaseGooglePlaySubscription(plan.googlePlayProductId);
        await finishNativePurchase("google_play", { purchaseToken: result.purchaseToken, productId: result.productId }, planKey);

      } else {
        const res = await apiRequest("POST", "/api/billing/create-checkout-session", { planKey });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.url) throw new Error(data.message || "Could not start checkout");
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({
        title: "Upgrade failed",
        description: err.message || "Could not complete the upgrade. Please try again.",
        variant: "destructive",
      });
      setPurchasing(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 -ml-2"
          onClick={() => setLocation("/settings")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Settings
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Upgrade Your Plan</h1>
        {currentPlan ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            You're currently on the <span className="font-medium text-slate-700 dark:text-slate-300">{currentPlan.label}</span> plan.
            {isFreeAccess && " (Admin access — no charge)"}
          </p>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Choose a plan to get started.</p>
        )}
        {isNativeApp && !productsLoading && products.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Could not load store prices — showing list prices.
          </p>
        )}
      </div>

      {/* ── Platform note ─────────────────────────────────────────── */}
      {isNativeApp && (
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
          {nativeIos
            ? "Purchases are handled by the Apple App Store."
            : "Purchases are handled by Google Play."}
        </div>
      )}

      {/* ── Plan cards ───────────────────────────────────────────── */}
      <div className="space-y-3">
        {PLAN_ORDER.map((planKey, idx) => {
          const plan = subscriptionPlans[planKey];
          const isCurrent = planKey === currentPlanKey;
          const isLower = currentPlanKey !== null && idx < currentPlanIndex;
          const isDisabled = isCurrent || isLower || !!purchasing;
          const isPurchasing = purchasing === planKey;

          const priceStr = isNativeApp && products.length > 0
            ? getStorePrice(plan, planKey)
            : `$${plan.price}`;

          return (
            <Card
              key={planKey}
              className={[
                "transition-all border",
                isCurrent
                  ? "border-blue-500 dark:border-blue-500 bg-blue-50/60 dark:bg-blue-950/30"
                  : isLower
                  ? "opacity-40 border-slate-200 dark:border-slate-700"
                  : "border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500",
              ].join(" ")}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Plan info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 dark:text-white text-base">
                        {plan.label}
                      </span>
                      {isCurrent && (
                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs">
                          Current Plan
                        </Badge>
                      )}
                      {isLower && (
                        <Badge variant="secondary" className="text-xs opacity-60">
                          Lower tier
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-lg font-bold text-slate-800 dark:text-slate-100">
                        {priceStr}
                      </span>
                      {!isNativeApp && (
                        <span className="text-xs text-slate-400">/month</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                      <Users className="h-3 w-3" />
                      Up to {plan.userLimit} {plan.userLimit === 1 ? "user" : "users"}
                    </div>

                    <ul className="mt-2 space-y-0.5">
                      {PLAN_BULLETS[planKey].map((bullet) => (
                        <li key={bullet} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <CheckCircle className={`h-3 w-3 shrink-0 ${isCurrent ? "text-blue-400" : "text-slate-300 dark:text-slate-600"}`} />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Action */}
                  <div className="shrink-0 self-center">
                    {isCurrent ? (
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">✓ Active</span>
                    ) : isLower ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <Button
                        size="sm"
                        disabled={isDisabled}
                        onClick={() => handleSelectPlan(planKey)}
                        className="whitespace-nowrap"
                      >
                        {isPurchasing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            Upgrade
                            <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Downgrade note ───────────────────────────────────────── */}
      {currentPlanKey && currentPlanKey !== "starter" && (
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
          To downgrade,{" "}
          {!isNativeApp
            ? "use the Manage Billing option in Settings."
            : `manage your subscription in your ${nativeIos ? "Apple" : "Google Play"} account settings.`}
        </p>
      )}

    </div>
  );
}
