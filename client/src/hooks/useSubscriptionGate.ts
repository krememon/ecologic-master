import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn } from "@/lib/queryClient";

interface SubscriptionStatus {
  active: boolean;
  status: string;
  planKey: string | null;
  userLimit: number;
  currentPeriodEnd: string | null;
}

export function useSubscriptionGate({
  authed,
  loadingAuth,
  hasCompany,
}: {
  authed: boolean;
  loadingAuth: boolean;
  hasCompany: boolean;
}) {
  const [location, setLocation] = useLocation();

  const {
    data: subStatus,
    isLoading: loadingSub,
    isError,
  } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscriptions/status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: authed && !loadingAuth && hasCompany,
    retry: 1,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const isSubPage = location === "/onboarding/subscription";
  const isPaywall = location === "/paywall";

  const active = subStatus?.active === true;
  const checkDone = !loadingAuth && (!authed || !hasCompany || !loadingSub);

  useEffect(() => {
    if (loadingAuth || !authed || !hasCompany) return;
    if (loadingSub) return;

    if (isSubPage || isPaywall) return;

    if (!active && !isError) {
      setLocation("/onboarding/subscription", { replace: true });
    }
    if (isError) {
      setLocation("/onboarding/subscription", { replace: true });
    }
  }, [loadingAuth, authed, hasCompany, loadingSub, active, isError, isSubPage, isPaywall, setLocation]);

  return {
    active,
    loading: !checkDone,
    subStatus,
  };
}
