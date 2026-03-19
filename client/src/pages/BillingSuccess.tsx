import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CheckCircle, Loader2, Clock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

interface BillingStatus {
  ok: boolean;
  billingAllowed: boolean;
  subscriptionStatus: string | null;
  effectivePlan: string | null;
}

export default function BillingSuccess() {
  const [, setLocation] = useLocation();
  const [polls, setPolls] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const verifyCalledRef = useRef(false);

  const sessionId = new URLSearchParams(window.location.search).get("session_id");
  console.log(`[billing/success] render — isAuthenticated=${isAuthenticated} authLoading=${authLoading} sessionId=${sessionId ? sessionId.slice(0, 12) + "…" : "none"}`);

  const { data: billing, refetch } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    refetchInterval: confirmed ? false : 3000,
    enabled: isAuthenticated === true,
    retry: 2,
  });

  // On first authenticated render, call verify-checkout-session to patch DB directly
  // from Stripe's API. This is a webhook fallback: if the webhook secret is wrong or
  // Stripe delivery is slow, this guarantees the subscription is written to the DB.
  useEffect(() => {
    if (!isAuthenticated || !sessionId || verifyCalledRef.current) return;
    verifyCalledRef.current = true;

    console.log(`[billing/success] calling verify-checkout-session for sessionId=${sessionId.slice(0, 12)}…`);
    apiRequest("POST", "/api/billing/verify-checkout-session", { sessionId })
      .then(async (res) => {
        const data = await res.json();
        console.log(`[billing/success] verify-checkout-session → synced=${data.synced} status=${data.status} ok=${data.ok}`);
        if (data.synced && (data.status === "active" || data.status === "trialing")) {
          // Subscription confirmed from Stripe directly — no need to wait for the next poll.
          console.log(`[billing/success] ✅ direct confirm via verify — status=${data.status}`);
          queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          setConfirmed(true);
        } else if (data.synced) {
          // Synced but status might be unusual — trigger a refetch to let the poll confirm
          queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
          refetch();
        } else {
          console.warn(`[billing/success] verify returned synced=false, reason=${data.reason} — falling back to polling`);
        }
      })
      .catch((err) => {
        console.warn(`[billing/success] verify-checkout-session error:`, err?.message);
        console.warn(`[billing/success] falling back to polling`);
      });
  }, [isAuthenticated, sessionId]);

  // Also invalidate global subscription caches on first auth
  useEffect(() => {
    if (!isAuthenticated) return;
    queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!billing) return;
    console.log(`[billing/success] poll #${polls} — billingAllowed=${billing.billingAllowed} status=${billing.subscriptionStatus} plan=${billing.effectivePlan}`);
    if (billing.billingAllowed && (billing.subscriptionStatus === "active" || billing.subscriptionStatus === "trialing")) {
      setConfirmed(true);
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
      queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
    }
    setPolls((p) => p + 1);
  }, [billing]);

  const isTimedOut = polls >= 12 && !confirmed;

  const handleContinue = () => {
    queryClient.invalidateQueries();
    setLocation("/jobs", { replace: true });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Loading…</h1>
          <p className="text-slate-500 dark:text-slate-400">Restoring your session after checkout.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Payment Complete!</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-6">
            Your payment was successful. Sign in to activate your EcoLogic subscription.
          </p>
          <Button className="w-full" onClick={() => setLocation("/login", { replace: true })}>
            <LogIn className="w-4 h-4 mr-2" />
            Sign In to Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center">
        {confirmed ? (
          <>
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
              You're all set!
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              Your{" "}
              <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">
                {billing?.effectivePlan ?? "EcoLogic"}
              </span>{" "}
              subscription is now active.
            </p>
            <Button className="w-full" onClick={handleContinue}>
              Go to Dashboard
            </Button>
          </>
        ) : isTimedOut ? (
          <>
            <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center mx-auto mb-6">
              <Clock className="w-10 h-10 text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
              Almost there…
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              Your payment went through, but confirmation is taking a little longer than usual.
              This typically resolves within a minute. You can try refreshing or check back shortly.
            </p>
            <div className="flex flex-col gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setPolls(0);
                  refetch();
                }}
              >
                Check Again
              </Button>
              <Button variant="ghost" onClick={handleContinue}>
                Continue to App
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
              Confirming your subscription…
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              Your payment was successful. We're activating your subscription now.
              This usually takes just a few seconds.
            </p>
            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-1000"
                style={{ width: `${Math.min(100, (polls / 12) * 100)}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
