import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";

// Log immediately when module loads
console.log("[StripeReturn] Module loaded at", new Date().toISOString());

export default function StripeReturn() {
  // Log immediately when component mounts
  console.log("[StripeReturn] Component rendering, href:", window.location.href);
  
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState("Returning to your dashboard...");
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    console.log("[StripeReturn] useEffect running");
    
    // Safety: prevent double redirect
    if (hasRedirected) {
      console.log("[StripeReturn] Already redirected, skipping");
      return;
    }
    
    try {
      // Diagnostic logging
      console.log("[StripeReturn] location.href", window.location.href);
      console.log("[StripeReturn] origin", window.location.origin);
      console.log("[StripeReturn] pathname", window.location.pathname);
      console.log("[StripeReturn] search", window.location.search);
      
      // Clear query params from URL without reload
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      
      // Invalidate relevant queries to get fresh data
      try {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      } catch (e) {
        console.error("[StripeReturn] Query invalidation error:", e);
      }
      
      // Clear any localStorage state that might cause issues
      try {
        localStorage.removeItem("selectedJobId");
        localStorage.removeItem("activeJobId");
        localStorage.removeItem("stripe_session");
      } catch (e) {
        console.error("[StripeReturn] localStorage clear error:", e);
      }
      
      console.log("[StripeReturn] State cleaned, navigating to /jobs");
      setStatus("Redirecting to Jobs...");
      setHasRedirected(true);
      
      // Navigate to jobs with replace to prevent back-button issues
      setLocation("/jobs", { replace: true });
      
    } catch (error) {
      console.error("[StripeReturn] Error during cleanup:", error);
      setStatus("Error occurred, redirecting...");
      // Safety fallback - redirect anyway
      setHasRedirected(true);
      setLocation("/jobs", { replace: true });
    }
  }, [setLocation, hasRedirected]);

  // Safety timeout - if redirect hasn't happened in 2 seconds, force it
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!hasRedirected) {
        console.log("[StripeReturn] Safety timeout triggered, forcing redirect");
        setHasRedirected(true);
        setLocation("/jobs", { replace: true });
      }
    }, 2000);
    
    return () => clearTimeout(timeout);
  }, [setLocation, hasRedirected]);

  // Always render visible content - never blank
  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      backgroundColor: '#f9fafb',
      padding: '16px'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '2px solid #3b82f6',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 16px'
        }} />
        <p style={{ color: '#6b7280', fontSize: '16px' }}>{status}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
