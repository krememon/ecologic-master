import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
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
    trialEndsAt?: string | null;
  };
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: 2,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  return {
    user,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}
