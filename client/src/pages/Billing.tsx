import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CreditCard,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  ChevronRight,
  Users,
  Loader2,
  ExternalLink,
  Shield,
} from "lucide-react";
import { subscriptionPlans, type PlanKey } from "@/config/subscriptionPlans";
import { format } from "date-fns";

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
  seatLimit: number;
  billingUpdatedAt: string | null;
}

const PLAN_ORDER: PlanKey[] = ["starter", "team", "pro", "scale"];

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === "inactive") {
    return <Badge variant="secondary">No Subscription</Badge>;
  }
  const map: Record<string, { label: string; className: string }> = {
    active:     { label: "Active",     className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
    trialing:   { label: "Trial",      className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
    past_due:   { label: "Past Due",   className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300" },
    canceled:   { label: "Canceled",   className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
    unpaid:     { label: "Unpaid",     className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
    incomplete: { label: "Incomplete", className: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
    incomplete_expired: { label: "Expired", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-slate-100 text-slate-700" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}

function StatusIcon({ status }: { status: string | null }) {
  if (status === "active") return <CheckCircle className="w-5 h-5 text-green-500" />;
  if (status === "trialing") return <Clock className="w-5 h-5 text-blue-500" />;
  if (status === "past_due") return <AlertCircle className="w-5 h-5 text-amber-500" />;
  if (status === "canceled") return <XCircle className="w-5 h-5 text-red-500" />;
  return <CreditCard className="w-5 h-5 text-slate-400" />;
}

export default function Billing() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isOwner = user?.role === "OWNER";

  const [selectedPlanKey, setSelectedPlanKey] = useState<PlanKey | null>(null);

  const { data: billing, isLoading } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (planKey: string) => {
      const res = await apiRequest("POST", "/api/billing/create-checkout-session", { planKey });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to create checkout session");
      return data as { ok: true; url: string };
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Could not start checkout", variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/create-portal-session", {});
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to open billing portal");
      return data as { ok: true; url: string };
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Could not open billing portal", variant: "destructive" });
    },
  });

  const handleSubscribe = (planKey: PlanKey) => {
    if (!isOwner) {
      toast({ title: "Permission denied", description: "Only the company owner can manage billing.", variant: "destructive" });
      return;
    }
    setSelectedPlanKey(planKey);
    checkoutMutation.mutate(planKey);
  };

  const handleManageBilling = () => {
    if (!isOwner) {
      toast({ title: "Permission denied", description: "Only the company owner can manage billing.", variant: "destructive" });
      return;
    }
    portalMutation.mutate();
  };

  const hasActiveSub = billing?.subscriptionStatus === "active" || billing?.subscriptionStatus === "trialing";
  const isWebPlatform = !billing?.subscriptionPlatform || billing.subscriptionPlatform === "stripe";
  const isNativePlatform = billing?.subscriptionPlatform === "apple" || billing?.subscriptionPlatform === "google_play";
  const currentPlanKey = billing?.subscriptionPlan as PlanKey | null;
  const currentPlan = currentPlanKey ? subscriptionPlans[currentPlanKey] : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Billing & Subscription</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage your EcoLogic plan</p>
      </div>

      {/* Current subscription status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <StatusIcon status={billing?.subscriptionStatus ?? null} />
            Current Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800 dark:text-white text-lg">
                {currentPlan ? currentPlan.label : "No active plan"}
              </p>
              {currentPlan && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Up to {currentPlan.userLimit} {currentPlan.userLimit === 1 ? "user" : "users"}
                </p>
              )}
            </div>
            <StatusBadge status={billing?.subscriptionStatus ?? null} />
          </div>

          {billing?.currentPeriodEnd && (
            <div className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
              {billing.cancelAtPeriodEnd ? (
                <>
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>Cancels on {format(new Date(billing.currentPeriodEnd), "MMM d, yyyy")}</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                  <span>Renews on {format(new Date(billing.currentPeriodEnd), "MMM d, yyyy")}</span>
                </>
              )}
            </div>
          )}

          {billing?.trialEndsAt && billing.subscriptionStatus === "trialing" && (
            <div className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Trial ends {format(new Date(billing.trialEndsAt), "MMM d, yyyy")}</span>
            </div>
          )}

          {billing?.subscriptionPlatform && billing.subscriptionPlatform !== "stripe" && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Shield className="w-4 h-4 shrink-0" />
              <span>
                Billed via {billing.subscriptionPlatform === "apple" ? "Apple App Store" : "Google Play"}
                {" — "}
                manage in your device settings
              </span>
            </div>
          )}

          {/* Past due warning */}
          {billing?.subscriptionStatus === "past_due" && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Payment past due</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Update your payment method to keep access.
                </p>
              </div>
            </div>
          )}

          {/* Manage billing button — only for web/Stripe subscribers */}
          {isOwner && isWebPlatform && billing?.hasStripeCustomer && (
            <Button
              variant="outline"
              className="w-full mt-2"
              onClick={handleManageBilling}
              disabled={portalMutation.isPending}
            >
              {portalMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <ExternalLink className="w-4 h-4 mr-2" />
              )}
              Manage Billing &amp; Invoices
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Plan selector — show when: owner + web platform + (no active sub OR wants to change) */}
      {isOwner && !isNativePlatform && (
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-white mb-3">
            {hasActiveSub && isWebPlatform ? "Change Plan" : "Choose a Plan"}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {hasActiveSub && isWebPlatform
              ? "Select a plan below and you'll be taken to the Stripe portal to make changes."
              : "Select a plan to get started. You'll be redirected to Stripe Checkout."}
          </p>
          <div className="grid gap-3">
            {PLAN_ORDER.map((key) => {
              const plan = subscriptionPlans[key];
              const isCurrent = key === currentPlanKey && hasActiveSub;
              const isLoadingThis = checkoutMutation.isPending && selectedPlanKey === key;
              const isLoadingOther = checkoutMutation.isPending && selectedPlanKey !== key;
              return (
                <div
                  key={key}
                  className={`relative rounded-xl border-2 p-4 transition-all ${
                    isCurrent
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-950"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 dark:text-white">{plan.label}</span>
                        {isCurrent && (
                          <Badge className="bg-blue-600 text-white text-xs">Current</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          ${plan.price}/mo
                        </span>
                        <span className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                          <Users className="w-3 h-3" />
                          Up to {plan.userLimit} {plan.userLimit === 1 ? "user" : "users"}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isCurrent ? "outline" : "default"}
                      disabled={checkoutMutation.isPending || isLoadingOther}
                      onClick={() => handleSubscribe(key)}
                      className="ml-4 shrink-0"
                    >
                      {isLoadingThis ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isCurrent ? (
                        <>Current <ChevronRight className="w-4 h-4 ml-1" /></>
                      ) : hasActiveSub ? (
                        "Switch"
                      ) : (
                        "Subscribe"
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 text-center">
            All plans include all core EcoLogic features. Cancel anytime from the billing portal.
          </p>
        </div>
      )}

      {/* Non-owner view */}
      {!isOwner && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Shield className="w-4 h-4 text-slate-400 shrink-0" />
              <p>Only the company owner can manage billing. Contact your owner to make changes.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Native platform info */}
      {isNativePlatform && isOwner && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Shield className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-slate-800 dark:text-white">
                  {billing?.subscriptionPlatform === "apple" ? "Apple App Store" : "Google Play"} subscription
                </p>
                <p className="mt-1">
                  Your subscription is managed through the{" "}
                  {billing?.subscriptionPlatform === "apple" ? "App Store" : "Google Play Store"}.
                  Open your device settings to cancel or change your plan.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
