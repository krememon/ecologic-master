import { useEffect } from "react";
import { useLocation } from "wouter";

export default function StripeReturn() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const invoiceId = urlParams.get("invoiceId");
    const canceled = urlParams.get("canceled");
    const sessionId = urlParams.get("session_id");

    if (!invoiceId) {
      console.log("[StripeReturn] No invoiceId, redirecting to /jobs");
      setLocation("/jobs", { replace: true });
      return;
    }

    if (canceled === "1") {
      setLocation(`/invoice/${invoiceId}/pay?canceled=1`, { replace: true });
    } else {
      const params = new URLSearchParams({ success: "1" });
      if (sessionId) params.set("session_id", sessionId);
      setLocation(`/invoice/${invoiceId}/pay?${params.toString()}`, { replace: true });
    }
  }, [setLocation]);

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
        <p style={{ color: '#6b7280', fontSize: '16px' }}>Redirecting...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
