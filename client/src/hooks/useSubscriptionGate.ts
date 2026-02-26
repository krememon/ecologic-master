import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";

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
  userId,
}: {
  authed: boolean;
  loadingAuth: boolean;
  hasCompany: boolean;
  userId?: string;
}) {
  const loggedRef = useRef(false);

  const shouldFetch = !loadingAuth && authed && hasCompany && !!userId;

  const {
    data: subStatus,
    isLoading: loadingSub,
    isError,
    isFetched,
  } = useQuery<SubscriptionStatus | null>({
    queryKey: ["/api/subscriptions/status", userId || ""],
    queryFn: async () => {
      console.log("[sub-gate] checking subscription for user", userId);
      const res = await fetch("/api/subscriptions/status", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 401) {
        console.warn("[sub-gate] 401 from subscriptions/status — waiting for auth");
        return null;
      }
      if (!res.ok) {
        throw new Error(`${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      console.log("[sub-gate] status result", json);
      return json as SubscriptionStatus;
    },
    enabled: shouldFetch,
    retry: 1,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const gotValidResponse = isFetched && subStatus != null;
  const active = gotValidResponse && subStatus.active === true && !isError;
  const stillLoading = loadingAuth || !authed || !hasCompany || (shouldFetch && (loadingSub || (!gotValidResponse && !isError)));

  if (!loggedRef.current && isFetched) {
    loggedRef.current = true;
    console.log("[sub-gate] resolved", { active, stillLoading, gotValidResponse, isError, status: subStatus?.status });
  }

  return {
    active,
    loading: stillLoading,
    subStatus: gotValidResponse ? subStatus : undefined,
  };
}
