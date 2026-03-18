import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, CheckCircle, LogOut, RotateCcw, Shield } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { subscriptionPlans } from "@/config/subscriptionPlans";
import type { PlanKey } from "@/config/subscriptionPlans";
import {
  isNativeIos,
  loadAppleProducts,
  purchaseAppleSubscription,
  restoreApplePurchases,
  type IapProduct,
} from "@/lib/nativeIap";

export default function OnboardingSubscription() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();

  // Subscription action states
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Native iOS detection + product loading
  const [nativeIos, setNativeIos] = useState(false);
  const [products, setProducts] = useState<IapProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const planKey = (user?.company?.subscriptionPlan as PlanKey) || "starter";
  const plan = subscriptionPlans[planKey] || subscriptionPlans.starter;

  // Detect native iOS once on mount
  useEffect(() => {
    const ios = isNativeIos();
    setNativeIos(ios);
    console.log("[onboarding-sub] nativeIos:", ios);
  }, []);

  // Load Apple products when on native iOS
  useEffect(() => {
    if (!nativeIos) return;
    setProductsLoading(true);
    loadAppleProducts().then((loaded) => {
      console.log("[onboarding-sub] Apple products loaded:", loaded.map(p => `${p.identifier}=${p.priceString}`).join(", "));
      setProducts(loaded);
      setProductsLoading(false);
    });
  }, [nativeIos]);

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

  // Find the Apple product for this plan (may be undefined if products haven't loaded yet)
  const appleProductId = plan.appleProductId;
  const appleProduct = products.find(p => p.identifier === appleProductId);
  const applePrice = appleProduct?.priceString ?? `$${plan.price}`;

  // ── Native iOS purchase flow ────────────────────────────────────────────────
  const handleApplePurchase = async () => {
    if (isLoading) return;
    setIsLoading(true);
    console.log("[onboarding-sub] Apple purchase started — productId:", appleProductId);

    try {
      // 1. Trigger native StoreKit 2 purchase sheet
      let jws: string;
      try {
        jws = await purchaseAppleSubscription(appleProductId);
        console.log("[onboarding-sub] JWS obtained, posting to backend...");
      } catch (err: any) {
        console.error("[onboarding-sub] Apple purchase failed:", err.message);
        throw new Error(err.message || "Purchase cancelled or failed");
      }

      // 2. Validate the JWS on the backend
      const res = await apiRequest("POST", "/api/subscriptions/validate", {
        platform: "apple",
        jwsTransaction: jws,
      });

      const data = await res.json();
      console.log("[onboarding-sub] Backend validation response:", data);

      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Subscription validation failed");
      }

      console.log("[onboarding-sub] Backend validation success — plan:", data.planKey);

      // 3. Refresh billing and auth state
      localStorage.removeItem("onboardingChoice");
      localStorage.removeItem("onboardingIndustry");
      await queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });

      toast({
        title: "Subscription active!",
        description: "Welcome to EcoLogic. You're all set.",
      });

      // 4. Route into the app
      setLocation("/jobs", { replace: true });

    } catch (error: any) {
      console.error("[onboarding-sub] Apple purchase error:", error.message);
      setIsLoading(false);
      toast({
        title: "Purchase failed",
        description: error.message || "Could not complete the purchase. Please try again.",
        variant: "destructive",
      });
    }
  };

  // ── Native iOS restore flow ─────────────────────────────────────────────────
  const handleAppleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    console.log("[onboarding-sub] Apple restore started");

    try {
      // 1. Ask StoreKit 2 for current entitlements
      const jws = await restoreApplePurchases();
      console.log("[onboarding-sub] restore JWS:", jws ? `obtained (${jws.length} chars)` : "null (nothing to restore)");

      if (!jws) {
        toast({
          title: "Nothing to restore",
          description: "No active EcoLogic subscription was found on this Apple ID.",
          variant: "destructive",
        });
        return;
      }

      // 2. Validate the restored JWS on the backend
      const res = await apiRequest("POST", "/api/subscriptions/validate", {
        platform: "apple",
        jwsTransaction: jws,
      });

      const data = await res.json();
      console.log("[onboarding-sub] restore backend response:", data);

      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Restore validation failed");
      }

      console.log("[onboarding-sub] restore success — plan:", data.planKey);

      // 3. Refresh billing and auth state
      await queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });

      toast({
        title: "Subscription restored!",
        description: "Your subscription has been restored successfully.",
      });

      localStorage.removeItem("onboardingChoice");
      localStorage.removeItem("onboardingIndustry");
      setLocation("/jobs", { replace: true });

    } catch (error: any) {
      console.error("[onboarding-sub] restore error:", error.message);
      toast({
        title: "Restore failed",
        description: error.message || "Could not restore purchases. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Web / non-iOS trial activation ─────────────────────────────────────────
  const handleStartTrial = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/subscriptions/dev-activate", {});
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to start subscription");
      }

      localStorage.removeItem("onboardingChoice");
      localStorage.removeItem("onboardingIndustry");
      await queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/jobs", { replace: true });
    } catch (error: any) {
      setIsLoading(false);
      toast({
        title: "Error",
        description: error.message || "Failed to start trial. Please try again.",
        variant: "destructive",
      });
    }
  };

  // ── Web restore stub ────────────────────────────────────────────────────────
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
        setLocation("/jobs", { replace: true });
      } else {
        toast({
          title: "No active subscription",
          description: "We couldn't find an active subscription for your account.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Restore failed",
        description: error.message || "Could not restore purchases. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  // Route handlers based on platform
  const handleSubscribe = nativeIos ? handleApplePurchase : handleStartTrial;
  const handleRestore = nativeIos ? handleAppleRestore : handleWebRestore;

  // Subscribe button label
  let subscribeBtnLabel: React.ReactNode;
  if (isLoading) {
    subscribeBtnLabel = (
      <>
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        {nativeIos ? "Processing..." : "Starting..."}
      </>
    );
  } else if (nativeIos) {
    subscribeBtnLabel = productsLoading
      ? "Loading..."
      : `Subscribe · ${applePrice}/mo`;
  } else {
    subscribeBtnLabel = "Start 7-Day Free Trial";
  }

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/logout", {});
      localStorage.removeItem("onboardingChoice");
      await queryClient.invalidateQueries();
      setLocation("/");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to log out",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-slate-800 dark:text-white">
              EcoLogic
            </h1>
            <p className="text-base text-slate-500 dark:text-slate-400 mt-2">Professional contractor management</p>
          </div>

          <div className="mb-6">
            <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: "100%" }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              Step 2 of 2
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Your plan is ready</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {user.company.name} is all set up
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white">{plan.label}</h3>
                  <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                    {nativeIos
                      ? `${applePrice}/mo`
                      : `7-day free trial, then $${plan.price}/mo`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-800 dark:text-white">
                    {applePrice}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">/month</p>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-600 pt-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span>Up to {plan.userLimit} {plan.userLimit === 1 ? "user" : "users"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>All core features included</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Shield className="w-4 h-4 text-purple-500" />
                  <span>{nativeIos ? "Billed securely via Apple" : "7-day free trial"}</span>
                </div>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleSubscribe}
              className="w-full"
              disabled={isLoading || (nativeIos && productsLoading)}
            >
              {subscribeBtnLabel}
            </Button>

            <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-3">
              {nativeIos
                ? "Manage anytime in App Store Settings"
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
            </div>
          </div>

          <div className="mt-6 text-center">
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500">
              <LogOut className="w-4 h-4 mr-2" />
              Log out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
