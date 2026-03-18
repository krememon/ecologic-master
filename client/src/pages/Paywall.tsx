import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Lock, Users, CheckCircle, Shield, LogOut, Loader2, RotateCcw } from "lucide-react";
import { subscriptionPlans } from "@/config/subscriptionPlans";
import type { PlanKey } from "@/config/subscriptionPlans";
import {
  isNativeIos,
  loadAppleProducts,
  purchaseAppleSubscription,
  restoreApplePurchases,
  type IapProduct,
} from "@/lib/nativeIap";

export default function Paywall() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

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
    console.log("[paywall] nativeIos:", ios);
  }, []);

  // Load Apple products when on native iOS
  useEffect(() => {
    if (!nativeIos) return;
    setProductsLoading(true);
    loadAppleProducts().then((loaded) => {
      console.log("[paywall] Apple products loaded:", loaded.map(p => `${p.identifier}=${p.priceString}`).join(", "));
      setProducts(loaded);
      setProductsLoading(false);
    });
  }, [nativeIos]);

  // Apple product for this plan
  const appleProductId = plan.appleProductId;
  const appleProduct = products.find(p => p.identifier === appleProductId);
  const applePrice = appleProduct?.priceString ?? `$${plan.price}`;

  // ── Native iOS purchase flow ────────────────────────────────────────────────
  const handleApplePurchase = async () => {
    if (isLoading) return;
    setIsLoading(true);
    console.log("[paywall] Apple purchase started — productId:", appleProductId);

    try {
      let jws: string;
      try {
        jws = await purchaseAppleSubscription(appleProductId);
        console.log("[paywall] JWS obtained, posting to backend...");
      } catch (err: any) {
        console.error("[paywall] Apple purchase failed:", err.message);
        throw new Error(err.message || "Purchase cancelled or failed");
      }

      const res = await apiRequest("POST", "/api/subscriptions/validate", {
        platform: "apple",
        jwsTransaction: jws,
      });

      const data = await res.json();
      console.log("[paywall] backend validation response:", data);

      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Subscription validation failed");
      }

      console.log("[paywall] validation success — plan:", data.planKey);

      await queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });

      toast({
        title: "Subscription active!",
        description: "Welcome back to EcoLogic.",
      });

      setLocation("/jobs", { replace: true });

    } catch (error: any) {
      console.error("[paywall] Apple purchase error:", error.message);
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
    console.log("[paywall] Apple restore started");

    try {
      const jws = await restoreApplePurchases();
      console.log("[paywall] restore JWS:", jws ? `obtained (${jws.length} chars)` : "null");

      if (!jws) {
        toast({
          title: "Nothing to restore",
          description: "No active EcoLogic subscription was found on this Apple ID.",
          variant: "destructive",
        });
        return;
      }

      const res = await apiRequest("POST", "/api/subscriptions/validate", {
        platform: "apple",
        jwsTransaction: jws,
      });

      const data = await res.json();
      console.log("[paywall] restore backend response:", data);

      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Restore validation failed");
      }

      console.log("[paywall] restore success — plan:", data.planKey);

      await queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });

      toast({
        title: "Subscription restored!",
        description: "Your subscription has been restored successfully.",
      });

      setLocation("/jobs", { replace: true });

    } catch (error: any) {
      console.error("[paywall] restore error:", error.message);
      toast({
        title: "Restore failed",
        description: error.message || "Could not restore purchases. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Web flow — route to onboarding/subscription ─────────────────────────────
  const handleWebSubscribe = () => {
    setLocation("/onboarding/subscription", { replace: true });
  };

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

  // Subscribe button label
  let subscribeBtnLabel: React.ReactNode;
  if (isLoading) {
    subscribeBtnLabel = (
      <>
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Processing...
      </>
    );
  } else if (nativeIos) {
    subscribeBtnLabel = productsLoading ? "Loading..." : `Subscribe · ${applePrice}/mo`;
  } else {
    subscribeBtnLabel = "Resubscribe Now";
  }

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

            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white">{plan.label}</h3>
                  <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                    {nativeIos ? `${applePrice}/mo` : `$${plan.price}/mo`}
                  </p>
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
                  <span>{nativeIos ? "Billed securely via Apple" : "Secure and reliable"}</span>
                </div>
              </div>
            </div>

            <Button
              type="button"
              onClick={nativeIos ? handleApplePurchase : handleWebSubscribe}
              className="w-full"
              disabled={isLoading || (nativeIos && productsLoading)}
            >
              {subscribeBtnLabel}
            </Button>

            {nativeIos && (
              <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-3">
                Manage anytime in App Store Settings
              </p>
            )}

            {/* Restore Purchases — shown on native iOS and also as a subtle option on web */}
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
              {nativeIos ? (
                <button
                  type="button"
                  onClick={handleAppleRestore}
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
              ) : null}
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
