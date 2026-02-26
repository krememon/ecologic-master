import { useQuery } from "@tanstack/react-query";
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

async function fetchAuthUser(): Promise<AuthUser | null> {
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

  return res.json();
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAuthUser,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  return {
    user: user ?? null,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}
