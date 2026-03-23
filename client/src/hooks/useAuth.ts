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

async function fetchAuthUser(): Promise<AuthUser | null> {
  const attempt = async (): Promise<Response> => {
    // Include the native Bearer token when it is stored in localStorage.
    // This is required because Capacitor WebViews always carry a stale
    // connect.sid cookie, so we cannot rely on cookie-based session auth
    // after a cross-domain Google OAuth exchange on the production server.
    const headers: Record<string, string> = {};
    try {
      const sid = typeof localStorage !== "undefined"
        ? localStorage.getItem("nativeSessionId")
        : null;
      if (sid) headers["Authorization"] = `Bearer ${sid}`;
    } catch {}
    return fetch("/api/auth/user", {
      credentials: "include",
      cache: "no-store",
      headers,
    });
  };

  let res = await attempt();

  if (res.status === 401) {
    await new Promise((r) => setTimeout(r, 600));
    res = await attempt();
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
