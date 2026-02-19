import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CreditCard, Users, CheckCircle, LogOut } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { subscriptionPlans } from "@/config/subscriptionPlans";
import type { PlanKey } from "@/config/subscriptionPlans";

export default function OnboardingSubscription() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const planKey = (user?.company?.subscriptionPlan as PlanKey) || "starter";
  const plan = subscriptionPlans[planKey] || subscriptionPlans.starter;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user?.company) {
    setLocation("/onboarding/company", { replace: true });
    return null;
  }

  if (user.company.onboardingCompleted) {
    setLocation("/", { replace: true });
    return null;
  }

  const handleContinueToPayment = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/subscriptions/start-trial", {});

      if (!res.ok) {
        const data = await res.json();
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        throw new Error(data.message || "Failed to start subscription");
      }

      localStorage.removeItem("onboardingChoice");
      localStorage.removeItem("onboardingIndustry");

      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/jobs", { replace: true });
    } catch (error: any) {
      setIsLoading(false);
      toast({
        title: "Error",
        description: error.message || "Failed to continue. Please try again.",
        variant: "destructive",
      });
    }
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
                  <p className="text-sm text-slate-500 dark:text-slate-400">Monthly subscription</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-800 dark:text-white">${plan.price}</p>
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
                  <CreditCard className="w-4 h-4 text-purple-500" />
                  <span>14-day free trial</span>
                </div>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleContinueToPayment}
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Starting...
                </>
              ) : (
                "Start Free Trial"
              )}
            </Button>

            <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-3">
              No charge today. Cancel anytime during trial.
            </p>
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
