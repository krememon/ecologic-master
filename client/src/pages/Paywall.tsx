import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Lock, Users, CheckCircle, Shield, LogOut, Loader2, RotateCcw, AlertCircle, Zap } from "lucide-react";
import { subscriptionPlans } from "@/config/subscriptionPlans";
import type { PlanKey } from "@/config/subscriptionPlans";
import { PlanSelectorChips } from "@/components/PlanSelectorChips";
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
} from "@/lib/nativeIap";

const PLAN_ORDER: PlanKey[] = ["starter", "team", "pro", "scale"];

export default function Paywall() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Platform detection
  const [nativeIos, setNativeIos] = useState(false);
  const [nativeAndroid, setNativeAndroid] = useState(false);

  // Store products (all 4 plans loaded at once)
  const [products, setProducts] = useState<IapProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  // Selected plan — native uses this for Apple/Google IAP
  const [selectedPlanKey, setSelectedPlanKey] = useState<PlanKey>("starter");

  // Selected plan — web Stripe checkout
  const companyPlanKey = (user?.company?.subscriptionPlan as PlanKey) || "starter";
  const [webSelectedPlanKey, setWebSelectedPlanKey] = useState<PlanKey>(
    (subscriptionPlans[companyPlanKey] ? companyPlanKey : "starter") as PlanKey
  );

  const isNativeApp = nativeIos || nativeAndroid;
  const storeLabel = nativeIos ? "Apple" : nativeAndroid ? "Google Play" : null;

  // Which plan to display
  const displayPlan = isNativeApp
    ? subscriptionPlans[selectedPlanKey] || subscriptionPlans.starter
    : subscriptionPlans[webSelectedPlanKey] || subscriptionPlans.starter;

  // Product IDs for the currently selected plan
  const appleProductId = displayPlan.appleProductId;
  const googleProductId = displayPlan.googlePlayProductId;

  // Find the store product for the selected plan
  const storeProduct = nativeIos
    ? products.find(p => p.identifier === appleProductId)
    : products.find(p => p.identifier === googleProductId);

  const storePrice = storeProduct?.priceString ?? `$${displayPlan.price}`;

  // True when Android/iOS finished loading but returned zero products at all
  const noProductsLoaded = isNativeApp && !productsLoading && products.length === 0;
  // True when products loaded, some came back, but the selected plan isn't among them
  const planUnavailable = isNativeApp && !productsLoading && products.length > 0 && !storeProduct;
  // Combined guard — purchase must be blocked whenever there's no real store product
  const purchaseBlocked = isNativeApp && (productsLoading || noProductsLoaded || planUnavailable);

  // Detect platform once on mount
  useEffect(() => {
    const ios = isNativeIos();
    const android = isNativeAndroid();
    setNativeIos(ios);
    setNativeAndroid(android);
    console.log("[ECOLOGIC-IAP] [paywall] platform detected — nativeIos:", ios, "nativeAndroid:", android);
  }, []);

  // Load store products when on a native platform
  useEffect(() => {
    if (!nativeIos && !nativeAndroid) return;
    setProductsLoading(true);

    if (nativeAndroid) {
      console.log("[ECOLOGIC-IAP] [paywall] Starting Android product load …");
      loadGooglePlayProducts().then((loaded) => {
        console.log(
          `[ECOLOGIC-IAP] [paywall] Android load done — ${loaded.length} product(s):`,
          loaded.map(p => `${p.identifier}=${p.priceString}`).join(", ") || "(none)"
        );
        setProducts(loaded);
        setProductsLoading(false);
      });
    } else {
      // iOS — unchanged
      console.log("[ECOLOGIC-IAP] [paywall] Starting Apple product load …");
      loadAppleProducts().then((loaded) => {
        console.log(
          `[ECOLOGIC-IAP] [paywall] Apple load done — ${loaded.length} product(s):`,
          loaded.map(p => `${p.identifier}=${p.priceString}`).join(", ") || "(none)"
        );
        setProducts(loaded);
        setProductsLoading(false);
      });
    }
  }, [nativeIos, nativeAndroid]);

  // ── Helper: post to backend and refresh billing ─────────────────────────────
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

    await queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
    await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });

    toast({ title: "Subscription active!", description: "Welcome back to EcoLogic." });
    setLocation("/", { replace: true });
  };

  // ── Apple purchase ──────────────────────────────────────────────────────────
  const handleApplePurchase = async () => {
    if (isLoading) return;
    setIsLoading(true);
    console.log("[paywall] Apple purchase started — productId:", appleProductId);

    try {
      let jws: string;
      try {
        jws = await purchaseAppleSubscription(appleProductId);
        console.log("[paywall] Apple JWS obtained, length:", jws.length);
      } catch (err: any) {
        console.error("[paywall] Apple purchase failed:", err.message);
        throw new Error(err.message || "Purchase cancelled or failed");
      }
      await finishNativePurchase("apple", { jwsTransaction: jws }, "paywall/apple", selectedPlanKey);
    } catch (err: any) {
      console.error("[paywall] Apple purchase error:", err.message);
      setIsLoading(false);
      toast({ title: "Purchase failed", description: err.message || "Could not complete the purchase. Please try again.", variant: "destructive" });
    }
  };

  // ── Apple restore ───────────────────────────────────────────────────────────
  const handleAppleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    console.log("[paywall] Apple restore started");

    try {
      const jws = await restoreApplePurchases();
      console.log("[paywall] Apple restore JWS:", jws ? `obtained (${jws.length} chars)` : "null");

      if (!jws) {
        toast({ title: "Nothing to restore", description: "No active EcoLogic subscription was found on this Apple ID.", variant: "destructive" });
        return;
      }
      await finishNativePurchase("apple", { jwsTransaction: jws }, "paywall/apple-restore");
    } catch (err: any) {
      console.error("[paywall] Apple restore error:", err.message);
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
      "[paywall] Google Play purchase — productId:", productId,
      "planIdentifier:", planId ?? "(fallback to monthly)"
    );

    try {
      let result;
      try {
        result = await purchaseGooglePlaySubscription(productId, planId, storeProduct?.offerToken);
        console.log("[paywall] Google Play purchase succeeded — token length:", result.purchaseToken.length);
      } catch (err: any) {
        console.error("[paywall] Google Play purchase failed:", err.message);
        throw new Error(err.message || "Purchase cancelled or failed");
      }
      await finishNativePurchase(
        "google_play",
        { purchaseToken: result.purchaseToken, productId: result.productId },
        "paywall/google-play"
      );
    } catch (err: any) {
      console.error("[paywall] Google Play purchase error:", err.message);
      setIsLoading(false);
      toast({ title: "Purchase failed", description: err.message || "Could not complete the purchase. Please try again.", variant: "destructive" });
    }
  };

  // ── Google Play restore ─────────────────────────────────────────────────────
  const handleAndroidRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    console.log("[paywall] Google Play restore started");

    try {
      const result = await restoreGooglePlayPurchases();
      console.log("[paywall] Google Play restore:", result ? `matched productId=${result.productId}` : "null");

      if (!result) {
        toast({ title: "Nothing to restore", description: "No active EcoLogic subscription was found on this Google account.", variant: "destructive" });
        return;
      }
      await finishNativePurchase(
        "google_play",
        { purchaseToken: result.purchaseToken, productId: result.productId },
        "paywall/google-play-restore"
      );
    } catch (err: any) {
      console.error("[paywall] Google Play restore error:", err.message);
      toast({ title: "Restore failed", description: err.message || "Could not restore purchases. Please try again.", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Web (direct Stripe checkout with selected plan) ──────────────────────────
  const handleWebSubscribe = async () => {
    if (isLoading) return;
    setIsLoading(true);
    console.log("[paywall] Web checkout — plan:", webSelectedPlanKey);
    try {
      const res = await apiRequest("POST", "/api/billing/create-checkout-session", { planKey: webSelectedPlanKey });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to create checkout session");
      window.location.href = data.url;
    } catch (err: any) {
      console.error("[paywall] Web checkout error:", err.message);
      toast({ title: "Checkout failed", description: err.message || "Could not start checkout. Please try again.", variant: "destructive" });
      setIsLoading(false);
    }
  };

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

  // ── Three-way platform dispatch ─────────────────────────────────────────────
  const handleSubscribe = nativeIos
    ? handleApplePurchase
    : nativeAndroid
    ? handleAndroidPurchase
    : handleWebSubscribe;

  const handleRestore = nativeIos
    ? handleAppleRestore
    : nativeAndroid
    ? handleAndroidRestore
    : null;

  // Subscribe button label
  let subscribeBtnLabel: React.ReactNode;
  if (isLoading) {
    subscribeBtnLabel = (
      <>
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Processing...
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
    subscribeBtnLabel = `Continue with ${displayPlan.label}`;
  }

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
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Professional contractor management
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Your subscription has expired</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Resubscribe to continue using EcoLogic
              </p>
            </div>

            {/* ── Plan selector — all platforms ──────────────────────────── */}
            <div className="mb-5">
              <PlanSelectorChips
                selected={isNativeApp ? selectedPlanKey : webSelectedPlanKey}
                onChange={isNativeApp ? setSelectedPlanKey : setWebSelectedPlanKey}
                disabled={isLoading || isRestoring}
                prices={isNativeApp
                  ? Object.fromEntries(PLAN_ORDER.map((key) => {
                      const p = subscriptionPlans[key];
                      const prod = nativeIos
                        ? products.find(x => x.identifier === p.appleProductId)
                        : products.find(x => x.identifier === p.googlePlayProductId);
                      return [key, prod?.priceString ?? `$${p.price}`];
                    })) as Partial<Record<PlanKey, string>>
                  : undefined
                }
                loadingPrices={isNativeApp && productsLoading}
              />
            </div>

            {/* ── Pricing card ─────────────────────────────────────────────── */}
            {(() => {
              const planBullets: Record<PlanKey, { icon: React.ReactNode; text: string }[]> = {
                starter: [
                  { icon: <Users className="w-4 h-4 text-blue-500 shrink-0" />, text: "Up to 1 user" },
                  { icon: <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />, text: "All core features included" },
                  { icon: <Shield className="w-4 h-4 text-purple-500 shrink-0" />, text: storeLabel ? `Billed securely via ${storeLabel}` : "Secure and reliable" },
                ],
                team: [
                  { icon: <Users className="w-4 h-4 text-blue-500 shrink-0" />, text: "Up to 5 users" },
                  { icon: <Zap className="w-4 h-4 text-amber-500 shrink-0" />, text: "Great for growing crews" },
                  { icon: <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />, text: "All core features included" },
                ],
                pro: [
                  { icon: <Users className="w-4 h-4 text-blue-500 shrink-0" />, text: "Up to 10 users" },
                  { icon: <Zap className="w-4 h-4 text-amber-500 shrink-0" />, text: "Advanced team operations" },
                  { icon: <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />, text: "All core features included" },
                ],
                scale: [
                  { icon: <Users className="w-4 h-4 text-blue-500 shrink-0" />, text: `Up to ${displayPlan.userLimit} users` },
                  { icon: <Zap className="w-4 h-4 text-amber-500 shrink-0" />, text: "Built for scaling operations" },
                  { icon: <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />, text: "All core features included" },
                ],
              };
              const activePlanKey = isNativeApp ? selectedPlanKey : webSelectedPlanKey;
              const bullets = planBullets[activePlanKey] ?? planBullets.starter;
              const hasTrialOffer = nativeAndroid && !!storeProduct?.hasTrial;
              const priceDisplay = isNativeApp
                ? (productsLoading ? "Loading…" : hasTrialOffer ? `7-day free trial, then ${storePrice}/mo` : `${storePrice}/mo`)
                : `$${displayPlan.price}/mo`;

              return (
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-5 mb-6 border-2 border-blue-200 dark:border-blue-800 transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-800 dark:text-white">{displayPlan.label}</h3>
                      <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">{priceDisplay}</p>
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
                    {bullets.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        {b.icon}
                        <span>{b.text}</span>
                      </div>
                    ))}
                  </div>

                  {noProductsLoaded && (
                    <div className="flex items-center gap-2 mt-3 p-2.5 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      <p className="text-xs text-red-700 dark:text-red-300">
                        Subscription plans could not be loaded from{nativeIos ? " App Store" : " Google Play"}. Please check your connection and try again.
                      </p>
                    </div>
                  )}
                  {planUnavailable && (
                    <div className="flex items-center gap-2 mt-3 p-2.5 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        This plan isn't available in the store right now.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            <Button
              type="button"
              onClick={handleSubscribe}
              className="w-full"
              disabled={isLoading || purchaseBlocked}
            >
              {subscribeBtnLabel}
            </Button>

            {isNativeApp && (
              <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-3">
                {nativeIos
                  ? "Manage anytime in App Store Settings"
                  : "Manage anytime in Google Play"}
              </p>
            )}

            {/* Restore Purchases — only shown on native platforms */}
            {handleRestore && (
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
            )}
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
