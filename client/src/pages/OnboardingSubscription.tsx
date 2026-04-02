import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, CheckCircle, LogOut, RotateCcw, Shield, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { subscriptionPlans } from "@/config/subscriptionPlans";
import type { PlanKey } from "@/config/subscriptionPlans";
import { appleProductIdToPlanKey } from "@shared/subscriptionPlans";
import {
  isNativeIos,
  isNativeAndroid,
  loadAppleProducts,
  loadGooglePlayProducts,
  purchaseAppleSubscription,
  purchaseGooglePlaySubscription,
  restoreApplePurchases,
  restoreGooglePlayPurchases,
  type IapProduct,
  type ApplePurchaseResult,
} from "@/lib/nativeIap";

const PLAN_ORDER: PlanKey[] = ["starter", "team", "pro", "scale"];

export default function OnboardingSubscription() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Platform detection
  const [nativeIos, setNativeIos] = useState(false);
  const [nativeAndroid, setNativeAndroid] = useState(false);

  // Store products (all 4 plans loaded at once)
  const [products, setProducts] = useState<IapProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  // Company plan — derived from subscriptionPlan written at company creation (which maps from team size)
  const companyPlanKey: PlanKey = (
    user?.company?.subscriptionPlan && PLAN_ORDER.includes(user.company.subscriptionPlan as PlanKey)
      ? user.company.subscriptionPlan
      : "starter"
  ) as PlanKey;
  const companyPlan = subscriptionPlans[companyPlanKey] || subscriptionPlans.starter;

  // Selected plan — native only; initialised from companyPlanKey so it matches the owner's team-size choice
  const [selectedPlanKey, setSelectedPlanKey] = useState<PlanKey>(companyPlanKey);

  // One-time sync: if user data loads after mount (async auth), update the native preselection
  const nativePlanSynced = useRef(false);
  useEffect(() => {
    if (
      !nativePlanSynced.current &&
      user?.company?.subscriptionPlan &&
      PLAN_ORDER.includes(user.company.subscriptionPlan as PlanKey)
    ) {
      setSelectedPlanKey(user.company.subscriptionPlan as PlanKey);
      nativePlanSynced.current = true;
      console.log("[onboarding-sub] native plan preselected from company size:", user.company.subscriptionPlan);
    }
  }, [user?.company?.subscriptionPlan]);

  const isNativeApp = nativeIos || nativeAndroid;
  const storeLabel = nativeIos ? "Apple" : nativeAndroid ? "Google Play" : null;

  // Which plan to display — native uses selectedPlanKey, web uses company plan
  const displayPlan = isNativeApp
    ? subscriptionPlans[selectedPlanKey] || subscriptionPlans.starter
    : companyPlan;

  // Product IDs for the currently selected plan
  const appleProductId = displayPlan.appleProductId;
  const googleProductId = displayPlan.googlePlayProductId;

  // Find the store product for the selected plan
  const storeProduct = nativeIos
    ? products.find(p => p.identifier === appleProductId)
    : products.find(p => p.identifier === googleProductId);

  const storePrice = storeProduct?.priceString ?? `$${displayPlan.price}`;

  // If products finished loading but the selected plan isn't available in the store
  const noProductsLoaded = isNativeApp && !productsLoading && products.length === 0;
  const planUnavailable = isNativeApp && !productsLoading && products.length > 0 && !storeProduct;
  const purchaseBlocked = isNativeApp && (productsLoading || noProductsLoaded || planUnavailable);

  // Detect platform once on mount
  useEffect(() => {
    const ios = isNativeIos();
    const android = isNativeAndroid();
    setNativeIos(ios);
    setNativeAndroid(android);
    console.log("[ECOLOGIC-IAP] [onboarding-sub] platform detected — nativeIos:", ios, "nativeAndroid:", android);
  }, []);

  // Load store products when on a native platform
  useEffect(() => {
    if (!nativeIos && !nativeAndroid) return;
    setProductsLoading(true);

    if (nativeAndroid) {
      console.log("[ECOLOGIC-IAP] [onboarding-sub] Starting Android product load …");
      loadGooglePlayProducts().then((loaded) => {
        console.log(
          `[ECOLOGIC-IAP] [onboarding-sub] Android load done — ${loaded.length} product(s):`,
          loaded.map(p => `${p.identifier}=${p.priceString}`).join(", ") || "(none)"
        );
        setProducts(loaded);
        setProductsLoading(false);
      });
    } else {
      console.log("[ECOLOGIC-IAP] [onboarding-sub] Starting Apple product load …");
      loadAppleProducts().then((loaded) => {
        console.log(
          `[ECOLOGIC-IAP] [onboarding-sub] Apple load done — ${loaded.length} product(s):`,
          loaded.map(p => `${p.identifier}=${p.priceString}`).join(", ") || "(none)"
        );
        setProducts(loaded);
        setProductsLoading(false);
      });
    }
  }, [nativeIos, nativeAndroid]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user?.company) {
    setLocation("/onboarding/company", { replace: true });
    return null;
  }

  if (user.company.onboardingCompleted && user.company.subscriptionStatus === "active") {
    setLocation("/", { replace: true });
    return null;
  }

  // ── Helper: post JWS or purchaseToken to backend ────────────────────────────
  const finishNativePurchase = async (
    platform: "apple" | "google_play",
    payload: Record<string, string>,
    logTag: string,
    expectedPlanKey?: string
  ) => {
    const res = await apiRequest("POST", "/api/subscriptions/validate", {
      platform,
      ...payload,
      ...(expectedPlanKey ? { expectedPlanKey } : {}),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Subscription validation failed");
    }

    localStorage.removeItem("onboardingChoice");
    localStorage.removeItem("onboardingIndustry");
    await queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
    await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });

    toast({ title: "Subscription active!", description: "Welcome to EcoLogic. You're all set." });
    setLocation("/", { replace: true });
  };

  // ── Apple purchase ──────────────────────────────────────────────────────────
  const handleApplePurchase = async () => {
    if (isLoading) return;
    setIsLoading(true);
    console.log("[onboarding-sub] Apple purchase started — productId:", appleProductId);

    try {
      let result: ApplePurchaseResult;
      try {
        result = await purchaseAppleSubscription(appleProductId);
        console.log(
          `[onboarding-sub] Apple JWS obtained — actualProductId=${result.actualProductId}` +
          ` (clicked=${appleProductId}) length=${result.jwsTransaction.length}`
        );
      } catch (err: any) {
        console.error("[onboarding-sub] Apple purchase failed:", err.message);
        throw new Error(err.message || "Purchase cancelled or failed");
      }

      // Always derive expectedPlanKey from the actual entitlement — never
      // force the clicked planKey when Apple returned a different product.
      const effectivePlanKey = appleProductIdToPlanKey[result.actualProductId] ?? selectedPlanKey;
      if (result.actualProductId !== appleProductId) {
        console.log(
          `[onboarding-sub] entitlement mismatch — clicked=${appleProductId} (plan=${selectedPlanKey})` +
          ` chosen=${result.actualProductId} (plan=${effectivePlanKey})` +
          ` — validating as ${effectivePlanKey}`
        );
      }

      await finishNativePurchase("apple", { jwsTransaction: result.jwsTransaction }, "onboarding-sub/apple", effectivePlanKey);
    } catch (err: any) {
      console.error("[onboarding-sub] Apple purchase error:", err.message);
      setIsLoading(false);
      toast({ title: "Purchase failed", description: err.message || "Could not complete the purchase. Please try again.", variant: "destructive" });
    }
  };

  // ── Apple restore ───────────────────────────────────────────────────────────
  const handleAppleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    console.log("[onboarding-sub] Apple restore started");

    try {
      const jws = await restoreApplePurchases();
      console.log("[onboarding-sub] Apple restore JWS:", jws ? `obtained (${jws.length} chars)` : "null");

      if (!jws) {
        toast({ title: "Nothing to restore", description: "No active EcoLogic subscription was found on this Apple ID.", variant: "destructive" });
        return;
      }
      await finishNativePurchase("apple", { jwsTransaction: jws }, "onboarding-sub/apple-restore");
    } catch (err: any) {
      console.error("[onboarding-sub] Apple restore error:", err.message);
      toast({ title: "Restore failed", description: err.message || "Could not restore purchases. Please try again.", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Google Play purchase ────────────────────────────────────────────────────
  const handleAndroidPurchase = async () => {
    if (isLoading) return;
    setIsLoading(true);

    // Use the loaded store product's identifier + planIdentifier when available
    const productId = storeProduct?.identifier ?? googleProductId;
    const planId = storeProduct?.planIdentifier;
    console.log(
      "[onboarding-sub] Google Play purchase — productId:", productId,
      "planIdentifier:", planId ?? "(fallback to monthly)"
    );

    try {
      let result;
      try {
        result = await purchaseGooglePlaySubscription(productId, planId, storeProduct?.offerToken);
        console.log("[onboarding-sub] Google Play purchase succeeded — token length:", result.purchaseToken.length);
      } catch (err: any) {
        console.error("[onboarding-sub] Google Play purchase failed:", err.message);
        throw new Error(err.message || "Purchase cancelled or failed");
      }
      await finishNativePurchase(
        "google_play",
        { purchaseToken: result.purchaseToken, productId: result.productId },
        "onboarding-sub/google-play"
      );
    } catch (err: any) {
      console.error("[onboarding-sub] Google Play purchase error:", err.message);
      setIsLoading(false);
      toast({ title: "Purchase failed", description: err.message || "Could not complete the purchase. Please try again.", variant: "destructive" });
    }
  };

  // ── Google Play restore ─────────────────────────────────────────────────────
  const handleAndroidRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    console.log("[onboarding-sub] Google Play restore started");

    try {
      const result = await restoreGooglePlayPurchases();
      console.log("[onboarding-sub] Google Play restore:", result ? `matched productId=${result.productId}` : "null");

      if (!result) {
        toast({ title: "Nothing to restore", description: "No active EcoLogic subscription was found on this Google account.", variant: "destructive" });
        return;
      }
      await finishNativePurchase(
        "google_play",
        { purchaseToken: result.purchaseToken, productId: result.productId },
        "onboarding-sub/google-play-restore"
      );
    } catch (err: any) {
      console.error("[onboarding-sub] Google Play restore error:", err.message);
      toast({ title: "Restore failed", description: err.message || "Could not restore purchases. Please try again.", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Web Stripe Checkout (7-day free trial via create-checkout-session) ────────
  const handleStartTrial = async () => {
    if (isLoading) return;
    setIsLoading(true);
    console.log("[onboarding-sub] Web checkout — plan:", companyPlanKey);
    try {
      const res = await apiRequest("POST", "/api/billing/create-checkout-session", { planKey: companyPlanKey });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to create checkout session");
      window.location.href = data.url;
    } catch (error: any) {
      console.error("[onboarding-sub] Web checkout error:", error.message);
      setIsLoading(false);
      toast({ title: "Checkout failed", description: error.message || "Could not start checkout. Please try again.", variant: "destructive" });
    }
  };

  // ── Web restore stub (unchanged) ────────────────────────────────────────────
  const handleWebRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    try {
      const res = await apiRequest("POST", "/api/subscriptions/restore", {});
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "No active subscription found");
      }
      const data = await res.json();
      if (data.active) {
        await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
        localStorage.removeItem("onboardingChoice");
        localStorage.removeItem("onboardingIndustry");
        setLocation("/", { replace: true });
      } else {
        toast({ title: "No active subscription", description: "We couldn't find an active subscription for your account.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Restore failed", description: error.message || "Could not restore purchases. Please try again.", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Three-way platform dispatch ─────────────────────────────────────────────
  const handleSubscribe = nativeIos
    ? handleApplePurchase
    : nativeAndroid
    ? handleAndroidPurchase
    : handleStartTrial;

  const handleRestore = nativeIos
    ? handleAppleRestore
    : nativeAndroid
    ? handleAndroidRestore
    : handleWebRestore;

  // Subscribe button label
  let subscribeBtnLabel: React.ReactNode;
  if (isLoading) {
    subscribeBtnLabel = (
      <>
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        {isNativeApp ? "Processing..." : "Starting..."}
      </>
    );
  } else if (isNativeApp) {
    const hasTrialOffer = nativeAndroid && !!storeProduct?.hasTrial;
    subscribeBtnLabel = productsLoading
      ? "Loading plans..."
      : noProductsLoaded
      ? "Plans Unavailable"
      : planUnavailable
      ? "Not Available"
      : hasTrialOffer
      ? "Start 7-Day Free Trial"
      : `Subscribe · ${storePrice}/mo`;
  } else {
    subscribeBtnLabel = "Start 7-Day Free Trial";
  }

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/logout", {});
      localStorage.removeItem("onboardingChoice");
      await queryClient.invalidateQueries();
      setLocation("/");
    } catch {
      toast({ title: "Error", description: "Failed to log out", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1
              className="text-6xl mx-auto mb-2 text-[#0B0B0D] dark:text-white"
              style={{
                fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
                fontWeight: 800,
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
              }}
            >
              EcoLogic
            </h1>
            <p className="text-base text-slate-500 dark:text-slate-400 mt-2">Professional contractor management</p>
          </div>

          <div className="mb-6">
            <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: "100%" }} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">Step 2 of 2</p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Your plan is ready</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{user.company.name} is all set up</p>
            </div>

            {/* ── Plan selector — native only ─────────────────────────────── */}
            {isNativeApp && (
              <div className="mb-4">
                <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2 text-center">
                  Choose your plan
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {PLAN_ORDER.map((key) => {
                    const p = subscriptionPlans[key];
                    const isSelected = key === selectedPlanKey;
                    const prod = nativeIos
                      ? products.find(x => x.identifier === p.appleProductId)
                      : products.find(x => x.identifier === p.googlePlayProductId);
                    const priceStr = prod?.priceString ?? `$${p.price}`;
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedPlanKey(key)}
                        disabled={isLoading || isRestoring}
                        className={`flex-shrink-0 flex flex-col items-center px-4 py-2.5 rounded-xl border-2 transition-all text-left disabled:opacity-60 ${
                          isSelected
                            ? "border-blue-600 bg-blue-600 text-white shadow-md"
                            : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-300 dark:hover:border-blue-600"
                        }`}
                      >
                        <span className="text-sm font-semibold leading-none">{p.label}</span>
                        <span className={`text-xs mt-1 leading-none ${isSelected ? "text-blue-100" : "text-slate-400 dark:text-slate-400"}`}>
                          {productsLoading ? "…" : priceStr}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Pricing card ────────────────────────────────────────────── */}
            <div className={`bg-slate-50 dark:bg-slate-700/50 rounded-xl p-5 mb-6 border-2 transition-all ${
              isNativeApp ? "border-blue-200 dark:border-blue-800" : "border-transparent"
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white">{displayPlan.label}</h3>
                  <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                    {isNativeApp
                      ? productsLoading ? "Loading price…"
                        : (nativeAndroid && storeProduct?.hasTrial)
                          ? `7-day free trial, then ${storePrice}/mo`
                          : `${storePrice}/mo`
                      : `7-day free trial, then $${displayPlan.price}/mo`}
                  </p>
                </div>
                {isNativeApp && (
                  <div className="text-right">
                    {productsLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-slate-400 ml-auto" />
                    ) : (
                      <>
                        <p className="text-2xl font-bold text-slate-800 dark:text-white">{storePrice}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">/month</p>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 dark:border-slate-600 pt-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Users className="w-4 h-4 text-blue-500 shrink-0" />
                  <span>Up to {displayPlan.userLimit} {displayPlan.userLimit === 1 ? "user" : "users"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                  <span>All core features included</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Shield className="w-4 h-4 text-purple-500 shrink-0" />
                  <span>
                    {storeLabel
                      ? (nativeAndroid && storeProduct?.hasTrial)
                        ? `7-day free trial, then billed via ${storeLabel}`
                        : `Billed securely via ${storeLabel}`
                      : "7-day free trial"}
                  </span>
                </div>
              </div>

              {/* No products at all — Play Console / tester setup issue */}
              {noProductsLoaded && (
                <div className="flex items-center gap-2 mt-3 p-2.5 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Subscription plans could not be loaded from{storeLabel ? ` ${storeLabel}` : " the store"}. Please check your connection and try again.
                  </p>
                </div>
              )}
              {/* Plan unavailable warning */}
              {planUnavailable && (
                <div className="flex items-center gap-2 mt-3 p-2.5 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    This plan isn't available in the store right now.
                  </p>
                </div>
              )}
            </div>

            <Button
              type="button"
              onClick={handleSubscribe}
              className="w-full"
              disabled={isLoading || purchaseBlocked}
            >
              {subscribeBtnLabel}
            </Button>

            <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-3">
              {nativeIos
                ? "Manage anytime in App Store Settings"
                : nativeAndroid
                ? "Manage anytime in Google Play"
                : "Cancel anytime in App Store / Google Play"}
            </p>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={handleRestore}
                disabled={isRestoring || isLoading}
                className="w-full flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors py-2 disabled:opacity-50"
              >
                {isRestoring ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
                {isRestoring ? "Restoring..." : "Restore Purchases"}
              </button>

              {/* Android-only: logout sits directly below Restore Purchases,
                  clear of the system nav bar */}
              {nativeAndroid && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors py-2 mt-1"
                >
                  <LogOut className="w-4 h-4" />
                  Log out
                </button>
              )}
            </div>
          </div>

          {/* Log out — hidden on Android (moved above into the Restore section) */}
          {!nativeAndroid && (
            <div className="mt-6 text-center">
              <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500">
                <LogOut className="w-4 h-4 mr-2" />
                Log out
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
