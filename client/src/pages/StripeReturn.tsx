import { useEffect } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";

export default function StripeReturn() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Diagnostic logging
    console.log("[StripeReturn] location.href", window.location.href);
    console.log("[StripeReturn] origin", window.location.origin);
    console.log("[StripeReturn] pathname", window.location.pathname);
    console.log("[StripeReturn] search", window.location.search);
    
    // Clear ALL payment-related state
    // Clear query params from URL without reload
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    
    // Invalidate relevant queries to get fresh data
    queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    
    // Clear any localStorage state that might cause issues
    localStorage.removeItem("selectedJobId");
    localStorage.removeItem("activeJobId");
    localStorage.removeItem("stripe_session");
    
    console.log("[StripeReturn] State cleaned, navigating to /jobs");
    
    // Navigate to jobs with replace to prevent back-button issues
    setLocation("/jobs", { replace: true });
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">Returning to your dashboard...</p>
      </div>
    </div>
  );
}
