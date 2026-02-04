import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getQueryFn } from "@/lib/queryClient";
import { User } from "@shared/schema";
import { syncUserLanguage } from "@/i18n/config";

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
  const didSyncRef = useRef(false);
  
  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: 2,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!isLoading && user && !didSyncRef.current) {
      didSyncRef.current = true;
      syncUserLanguage(user.language);
    }
  }, [user, isLoading]);

  return {
    user,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}
