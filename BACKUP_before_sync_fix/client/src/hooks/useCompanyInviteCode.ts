import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryClient } from "@/lib/queryClient";

interface CompanyInviteCode {
  inviteCode: string;
  inviteCodeVersion: number;
  inviteCodeRotatedAt: string;
}

export function useCompanyInviteCode() {
  const query = useQuery<CompanyInviteCode>({
    queryKey: ["/api/company/info"],
    queryFn: async () => {
      const response = await fetch("/api/company/info");
      if (!response.ok) {
        if (response.status === 403) {
          // User doesn't have permission to view invite code
          return null;
        }
        throw new Error("Failed to fetch invite code");
      }
      return response.json();
    },
    retry: false,
    staleTime: 0, // Always fetch fresh data
  });

  // Listen for WebSocket events to refresh when code rotates
  useEffect(() => {
    const handleInviteCodeRotated = (event: CustomEvent) => {
      // Invalidate the query to fetch the new code
      queryClient.invalidateQueries({ queryKey: ["/api/company/info"] });
    };

    window.addEventListener('invite_code_rotated', handleInviteCodeRotated as EventListener);

    return () => {
      window.removeEventListener('invite_code_rotated', handleInviteCodeRotated as EventListener);
    };
  }, []);

  return query;
}
