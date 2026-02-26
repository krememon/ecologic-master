import { useQuery } from "@tanstack/react-query";
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

  const active = subStatus?.active === true && !isError;
  const checkDone = !loadingAuth && (!authed || !hasCompany || !loadingSub);

  return {
    active,
    loading: !checkDone,
    subStatus,
  };
}
