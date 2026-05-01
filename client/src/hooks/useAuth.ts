import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { resolveApiUrl } from "@/lib/queryClient";

interface AuthUser extends User {
  role?: 'OWNER' | 'SUPERVISOR' | 'TECHNICIAN' | null;
  company?: {
    id: number;
    name: string;
    logo?: string | null;
    primaryColor: string;
    secondaryColor: string;
    onboardingCompleted?: boolean;
    subscriptionStatus?: string;
    subscriptionPlan?: string | null;
    teamSizeRange?: string | null;
    maxUsers?: number;
    trialEndsAt?: string | null;
    currentPeriodEnd?: string | null;
  };
}

function isNativeMobile(): boolean {
  try {
    const cap = (window as any).Capacitor;
    const platform = cap?.getPlatform?.();
    return !!platform && platform !== "web";
  } catch {
    return false;
  }
}

// Returns true ONLY when:
//   1. We're running in a Capacitor native (iOS/Android) WebView, AND
//   2. We actually have a stored `nativeSessionId` to send.
//
// Sending an empty Authorization header just produces a guaranteed 401 and
// then forces a redundant retry inside fetchAuthUser (the visible
// "auth/user looping" symptom on iOS pre-login). When there's no token, fall
// back to the cookie-only request — same outcome (401), one fewer round-trip.
function shouldAttachBearer(): boolean {
  try {
    const cap = (window as any).Capacitor;
    const isNative = !!(cap?.getPlatform?.() && cap.getPlatform() !== "web");
    if (!isNative) return false;
    const sid = typeof localStorage !== "undefined"
      ? localStorage.getItem("nativeSessionId")
      : null;
    return !!sid;
  } catch {
    return false;
  }
}

async function fetchAuthUser(): Promise<AuthUser | null> {
  const native = isNativeMobile();
  const useBearer = shouldAttachBearer();
  const hasNativeSession = typeof localStorage !== "undefined" && !!localStorage.getItem("nativeSessionId");
  console.log(`[auth/user][client] source=useAuth.ts native=${native} origin=${window.location.origin} hasNativeSession=${hasNativeSession} attachBearer=${useBearer}`);

  const doFetch = async (withBearer: boolean): Promise<Response | null> => {
    const headers: Record<string, string> = {};
    if (withBearer) {
      try {
        const sid = typeof localStorage !== "undefined"
          ? localStorage.getItem("nativeSessionId")
          : null;
        // Only attach a Bearer header when we actually have a token.
        // Sending an empty/undefined Bearer just produces a 401 anyway and
        // would force a second redundant retry on native (see retry block
        // below).
        if (sid) headers["Authorization"] = `Bearer ${sid}`;
      } catch {}
    }
    // Append a timestamp to the URL to defeat WKWebView's aggressive HTTP disk
    // cache, which can serve a stale 401 response even after a new session is
    // established.  TanStack Query keys this query by "/api/auth/user" (not the
    // timestamped URL), so the client-side cache is not affected.
    //
    // resolveApiUrl prepends an absolute host when the WebView is loading
    // from a non-http origin (capacitor://localhost in CAP_LOCAL_DEBUG
    // builds). Without this, the fetch hangs against a non-existent server
    // and the auth/user query never resolves.
    const url = resolveApiUrl(`/api/auth/user?_t=${Date.now()}`);
    // Hard 6s per-request timeout. WKWebView can silently hang requests
    // (e.g. CORS preflight on capacitor:// origin without server-side
    // allowlist), which would leave isLoading=true forever and trigger
    // the 8s UI safety gate over and over.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      return await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers,
        signal: ctrl.signal,
      });
    } catch (e: any) {
      const reason = e?.name === "AbortError" ? "timeout" : (e?.message || "network_error");
      console.warn(`[auth/user][client] fetch failed reason=${reason} url=${url}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doFetch(useBearer);
  // If the request itself failed (network/timeout/aborted), treat the user
  // as unauthenticated rather than throwing — this lets the sign-in page
  // render instead of leaving the app stuck in the loading placeholder.
  if (!res) {
    return null;
  }

  if (res.status === 401) {
    // Native: only worth retrying with a Bearer if we actually have a stored
    // session id. With no nativeSessionId, the second attempt would just send
    // the same headerless request and get the same 401 — wasting a round-trip
    // and producing the visible "auth/user looping" symptom.
    const sid = typeof localStorage !== "undefined"
      ? localStorage.getItem("nativeSessionId")
      : null;
    if (native && sid) {
      // Native + have token: wait briefly and retry — Capacitor WebViews may
      // lag before the session is ready.
      await new Promise((r) => setTimeout(r, 600));
      const retried = await doFetch(true);
      if (!retried) {
        return null;
      }
      res = retried;
    }
    // Web (or native with no session): no retry. The user simply isn't
    // authenticated yet — show the sign-in page.
  }

  if (res.status === 401) {
    console.log("[auth] user not authenticated (401)");
    return null;
  }

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    try {
      const err = JSON.parse(text);
      if (err.code === 'ACCOUNT_INACTIVE') {
        window.location.href = '/?error=account_inactive&message=' + encodeURIComponent(err.message || 'Your account was deactivated.');
        throw new Error(err.message);
      }
      if (err.code === 'SESSION_REVOKED') {
        window.location.href = '/?error=session_revoked&message=' + encodeURIComponent(err.message || 'Your session has ended.');
        throw new Error(err.message);
      }
    } catch (e) {
      if (e instanceof Error && (e.message.includes('deactivated') || e.message.includes('ended'))) throw e;
    }
    throw new Error(`${res.status}: ${text}`);
  }

  const user: AuthUser = await res.json();

  console.log(
    `[auth/user][client] payload received —` +
    ` userId=${user.id}` +
    ` hasCompany=${!!user.company}` +
    ` companyId=${user.company?.id ?? "null"}` +
    ` role=${user.role ?? "null"}` +
    ` onboardingChoice=${(user as any).onboardingChoice ?? "null"}` +
    ` onboardingCompleted=${user.company?.onboardingCompleted ?? "null"}`
  );

  if (user.company) {
    localStorage.removeItem("onboardingChoice");
    localStorage.removeItem("onboardingIndustry");
  }

  return user;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const native = isNativeMobile();
  const refreshedRef = useRef(false);

  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAuthUser,
    retry: false,
    refetchOnWindowFocus: native,
    staleTime: native ? 0 : 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!native || refreshedRef.current || isLoading) return;
    refreshedRef.current = true;
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  }, [native, isLoading, queryClient]);

  return {
    user: user ?? null,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}
