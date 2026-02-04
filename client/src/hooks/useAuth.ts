import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getQueryFn } from "@/lib/queryClient";
import { User } from "@shared/schema";
import { initializeUserLanguage } from "@/i18n/config";

interface AuthUser extends User {
  role?: 'OWNER' | 'SUPERVISOR' | 'DISPATCHER' | 'ESTIMATOR' | 'TECHNICIAN' | null;
  company?: {
    id: number;
    name: string;
    logo?: string | null;
    primaryColor: string;
    secondaryColor: string;
    onboardingCompleted?: boolean;
    subscriptionStatus?: string;
    trialEndsAt?: string | null;
  };
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: 2, // Retry twice on failure (helps with temporary network issues after redirect)
    retryDelay: 1000, // Wait 1 second between retries
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  useEffect(() => {
    if (!isLoading) {
      initializeUserLanguage(user?.language);
    }
  }, [user?.language, isLoading]);

  return {
    user,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}
