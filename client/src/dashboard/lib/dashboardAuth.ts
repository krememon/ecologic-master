/**
 * Client-side dashboard auth gate.
 * Returns one of: 'loading' | 'unauthenticated' | 'forbidden' | 'allowed'.
 *
 * The server-side check is the source of truth — this hook just mirrors it
 * so the SPA can render the right view (login redirect, access denied, app).
 */

import { useQuery } from "@tanstack/react-query";

export type DashboardAccessState = "loading" | "unauthenticated" | "forbidden" | "allowed";

interface MeResponse {
  allowed: boolean;
  email: string | null;
  reason?: string;
}

export function useDashboardAccess(): {
  state: DashboardAccessState;
  email: string | null;
} {
  const { data, isLoading, error } = useQuery<MeResponse>({
    queryKey: ["/api/admin/dashboard/me"],
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading) return { state: "loading", email: null };

  // 401 from /api/admin/dashboard/me → not signed in
  if (error) {
    const status = (error as any)?.status ?? null;
    if (status === 401) return { state: "unauthenticated", email: null };
    return { state: "forbidden", email: null };
  }

  if (!data) return { state: "loading", email: null };
  if (!data.allowed) return { state: "forbidden", email: data.email };
  return { state: "allowed", email: data.email };
}
