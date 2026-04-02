import { useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface SubscriptionStatus {
  active: boolean;
  status: string;
  planKey: string | null;
  userLimit: number;
  currentPeriodEnd: string | null;
  bypass?: boolean;
  reason?: string;
}

function getNativeBearerHeader(): Record<string, string> {
  try {
    const sid = typeof localStorage !== "undefined"
      ? localStorage.getItem("nativeSessionId")
      : null;
    if (sid) return { Authorization: `Bearer ${sid}` };
  } catch {}
  return {};
}

function isNativePlatform(): boolean {
  try {
    const cap = (window as any).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
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
  const queryClient = useQueryClient();
  const native = isNativePlatform();

  const shouldFetch = !loadingAuth && authed && hasCompany && !!userId;

  const {
    data: subStatus,
    isLoading: loadingSub,
    isError,
    isFetched,
    refetch,
  } = useQuery<SubscriptionStatus | null>({
    queryKey: ["/api/subscriptions/status", userId || ""],
    queryFn: async () => {
      const platform = native ? "native" : "web";
      const t0 = Date.now();
      console.log(`[ECOLOGIC-SUB] [gate] fetch START — platform=${platform} userId=${userId}`);
      const res = await fetch("/api/subscriptions/status", {
        credentials: "include",
        cache: "no-store",
        headers: getNativeBearerHeader(),
      });
      const elapsed = Date.now() - t0;
      if (res.status === 401) {
        console.warn(`[ECOLOGIC-SUB] [gate] 401 after ${elapsed}ms — session expired or not authenticated`);
        return null;
      }
      if (!res.ok) {
        console.error(`[ECOLOGIC-SUB] [gate] error ${res.status} after ${elapsed}ms`);
        throw new Error(`${res.status}: ${res.statusText}`);
      }
      const json = await res.json() as SubscriptionStatus;
      // Full payload log — shows every field the billing resolver returned
      console.log(
        `[ECOLOGIC-SUB] [gate] payload — platform=${platform}` +
        ` active=${json.active}` +
        ` status=${json.status}` +
        ` plan=${json.planKey ?? "none"}` +
        ` currentPeriodEnd=${json.currentPeriodEnd ?? "null"}` +
        ` reason=${json.reason ?? "(none)"}` +
        ` bypass=${json.bypass ?? false}` +
        ` elapsed=${elapsed}ms`
      );
      if (json.active) {
        console.log(`[ECOLOGIC-SUB] [gate] ACCESS GRANTED — platform=${platform} status=${json.status} plan=${json.planKey ?? "none"} bypass=${json.bypass ?? false} elapsed=${elapsed}ms`);
      } else {
        console.log(`[ECOLOGIC-SUB] [gate] ACCESS DENIED — platform=${platform} status=${json.status} reason=${json.reason ?? "(none)"} elapsed=${elapsed}ms → routing to paywall`);
      }
      return json;
    },
    enabled: shouldFetch,
    retry: 1,
    staleTime: 0,           // Always fetch fresh — never trust cached billing state
    refetchOnMount: true,   // Re-check on every app entry / session restore
    refetchOnWindowFocus: true, // Web: re-check on window focus (tab switch / browser return)
  });

  // Native app: Capacitor `appStateChange` fires when the app comes to the foreground.
  // `refetchOnWindowFocus` doesn't fire reliably in a WebView on iOS/Android, so we add
  // an explicit listener that forces a fresh billing check every time the user resumes.
  useEffect(() => {
    if (!native || !shouldFetch) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const listener = await CapApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            console.log("[sub-gate] native app resumed — forcing fresh billing check");
            // Reset logged flag so we log the result of this re-check
            loggedRef.current = false;
            queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
          }
        });
        cleanup = () => listener.remove();
      } catch {
        // Capacitor not available (e.g. web dev build) — safe to ignore
      }
    })();

    return () => { cleanup?.(); };
  }, [native, shouldFetch, queryClient]);

  const gotValidResponse = isFetched && subStatus != null;
  const active = gotValidResponse && subStatus!.active === true && !isError;

  // Only "loading" while the query is actively in-flight and hasn't fetched yet.
  // Once isFetched=true (even if response was null/401), we are done loading.
  const stillLoading = loadingAuth || !authed || !hasCompany || (shouldFetch && !isFetched);

  if (!loggedRef.current && isFetched) {
    loggedRef.current = true;
    const platform = native ? "native" : "web";
    console.log(
      `[ECOLOGIC-SUB] [gate] resolved — platform=${platform}` +
      ` active=${active}` +
      ` source=${subStatus?.status ?? "none"}` +
      ` plan=${subStatus?.planKey ?? "none"}` +
      ` stillLoading=${stillLoading}`
    );
  }

  return {
    active,
    loading: stillLoading,
    subStatus: gotValidResponse ? subStatus : undefined,
    bypass: gotValidResponse && subStatus?.bypass === true,
  };
}
