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
  const native = isNativeMobile();
  console.log("[auth] fetching user from /api/auth/user", native ? "(native mobile)" : "(web)");

  const attempt = async (): Promise<Response> => {
    return fetch("/api/auth/user", {
      credentials: "include",
      cache: "no-store",
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

  console.log("[auth] mobile app user fetched", {
    id: user.id,
    email: user.email,
    companyId: user.company?.id ?? null,
    onboardingChoice: user.onboardingChoice ?? null,
  });

  if (user.company) {
    console.log("[auth] companyId detected:", user.company.id);
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
    console.log("[auth] native app start — forcing fresh user fetch");
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  }, [native, isLoading, queryClient]);

  useEffect(() => {
    if (!user) return;
    if (user.company) {
      console.log("[auth] redirecting to dashboard — companyId:", user.company.id);
    } else {
      console.log("[auth] no company found for user, onboarding flow will handle routing");
    }
  }, [user]);

  return {
    user: user ?? null,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}
