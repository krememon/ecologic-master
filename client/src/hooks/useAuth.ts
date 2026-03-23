import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User } from "@shared/schema";

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

// Returns true ONLY for Capacitor native (iOS/Android). Web always uses session cookies.
function shouldAttachBearer(): boolean {
  try {
    const cap = (window as any).Capacitor;
    return !!(cap?.getPlatform?.() && cap.getPlatform() !== "web");
  } catch {
    return false;
  }
}

async function fetchAuthUser(): Promise<AuthUser | null> {
  const native = isNativeMobile();
  const useBearer = shouldAttachBearer();
  const hasNativeSession = typeof localStorage !== "undefined" && !!localStorage.getItem("nativeSessionId");
  console.log(`[auth/user][client] source=useAuth.ts native=${native} origin=${window.location.origin} hasNativeSession=${hasNativeSession} attachBearer=${useBearer}`);

  const doFetch = (withBearer: boolean): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (withBearer) {
      try {
        const sid = typeof localStorage !== "undefined"
          ? localStorage.getItem("nativeSessionId")
          : null;
        if (sid) headers["Authorization"] = `Bearer ${sid}`;
      } catch {}
    }
    return fetch("/api/auth/user", { credentials: "include", cache: "no-store", headers });
  };

  let res = await doFetch(useBearer);

  if (res.status === 401) {
    if (native) {
      // Native: wait briefly and retry — Capacitor WebViews may lag before the session is ready.
      await new Promise((r) => setTimeout(r, 600));
      res = await doFetch(true);
    }
    // Web: no retry with Bearer — session cookies are the only auth mechanism on web.
    // If 401 on web, the user simply isn't authenticated (show sign-in page).
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
