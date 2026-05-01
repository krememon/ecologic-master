/**
 * Client-side dashboard auth gate.
 * Returns one of: 'loading' | 'unauthenticated' | 'forbidden' | 'allowed'.
 *
 * /api/admin/dashboard/me response shape:
 *   { authenticated: boolean; authorized: boolean; email: string | null }
 *
 * Mapping:
 *   401 (network/HTTP error)             → unauthenticated
 *   200 + authenticated=false             → unauthenticated
 *   200 + authenticated=true, authorized=false → forbidden (shows email)
 *   200 + authenticated=true, authorized=true  → allowed
 */

import { useQuery } from "@tanstack/react-query";

export type DashboardAccessState = "loading" | "unauthenticated" | "forbidden" | "allowed";

interface MeResponse {
  authenticated: boolean;
  authorized: boolean;
  email: string | null;
}

export function useDashboardAccess(): {
  state: DashboardAccessState;
  email: string | null;
  refetch: () => void;
} {
  const { data, isLoading, error, refetch } = useQuery<MeResponse>({
    queryKey: ["/api/admin/dashboard/me"],
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading) return { state: "loading", email: null, refetch };

  // Any HTTP/network error (including 401) means not authenticated.
  if (error) return { state: "unauthenticated", email: null, refetch };

  if (!data) return { state: "loading", email: null, refetch };

  // The server explicitly said the session is not authenticated.
  if (!data.authenticated) return { state: "unauthenticated", email: null, refetch };

  // Authenticated but not on the admin allow-list.
  if (!data.authorized) return { state: "forbidden", email: data.email, refetch };

  return { state: "allowed", email: data.email, refetch };
}
