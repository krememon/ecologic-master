import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";

console.log("[StripeReturn] Module loaded at", new Date().toISOString());

export default function StripeReturn() {
  console.log("[StripeReturn] Component rendering, href:", window.location.href);
  
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState("Verifying payment...");
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    console.log("[StripeReturn] useEffect running");
    
    if (hasRedirected) {
      console.log("[StripeReturn] Already redirected, skipping");
      return;
    }
    
    const processReturn = async () => {
      try {
        console.log("[StripeReturn] location.href", window.location.href);
        
        if (window.location.search) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        
        const sessionId = localStorage.getItem("stripe_session");
        console.log("[StripeReturn] Session ID from localStorage:", sessionId);
        
        if (sessionId) {
          setStatus("Confirming payment...");
          try {
            const response = await fetch(`/api/payments/session/${sessionId}`, {
              credentials: 'include'
            });
            const data = await response.json();
            console.log("[StripeReturn] Session status:", data);
            
            if (data.paymentStatus === 'paid') {
              setStatus("Payment confirmed! Redirecting...");
            }
          } catch (e) {
            console.error("[StripeReturn] Session check error:", e);
          }
        }
        
        try {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
          queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
          queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        } catch (e) {
          console.error("[StripeReturn] Query invalidation error:", e);
        }
        
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
        
        setLocation("/jobs", { replace: true });
        
      } catch (error) {
        console.error("[StripeReturn] Error during cleanup:", error);
        setStatus("Error occurred, redirecting...");
        setHasRedirected(true);
        setLocation("/jobs", { replace: true });
      }
    };

    processReturn();
  }, [setLocation, hasRedirected]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!hasRedirected) {
        console.log("[StripeReturn] Safety timeout triggered, forcing redirect");
        setHasRedirected(true);
        setLocation("/jobs", { replace: true });
      }
    }, 5000);
    
    return () => clearTimeout(timeout);
  }, [setLocation, hasRedirected]);

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
