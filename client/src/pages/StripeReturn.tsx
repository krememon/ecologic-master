import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useSignatureAfterPayment } from "@/hooks/useSignatureAfterPayment";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";

export default function StripeReturn() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState("Verifying payment...");
  const [hasRedirected, setHasRedirected] = useState(false);
  const processedRef = useRef(false);

  const {
    isModalOpen: sigModalOpen,
    pendingPayment: sigPendingPayment,
    triggerSignature,
    onSignatureComplete,
  } = useSignatureAfterPayment();

  const waitingForSignature = sigModalOpen || (sigPendingPayment !== null && !hasRedirected);

  const doRedirect = () => {
    try {
      localStorage.removeItem("selectedJobId");
      localStorage.removeItem("activeJobId");
      localStorage.removeItem("stripe_session");
    } catch (e) {
      console.error("[StripeReturn] localStorage clear error:", e);
    }
    setHasRedirected(true);
    setLocation("/jobs", { replace: true });
  };

  useEffect(() => {
    if (hasRedirected || waitingForSignature || processedRef.current) {
      return;
    }

    processedRef.current = true;
    
    const processReturn = async () => {
      try {
        if (window.location.search) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        
        const sessionId = localStorage.getItem("stripe_session");
        
        let paymentId: number | null = null;
        let jobId: number | undefined = undefined;
        let invoiceId: number | undefined = undefined;
        
        if (sessionId) {
          setStatus("Confirming payment...");
          try {
            const response = await fetch(`/api/payments/session/${sessionId}`, {
              credentials: 'include'
            });
            const data = await response.json();
            
            if (data.paymentStatus === 'paid') {
              setStatus("Payment confirmed!");
              paymentId = data.paymentId || null;
              jobId = data.jobId ? parseInt(data.jobId) : undefined;
              invoiceId = data.invoiceId ? parseInt(data.invoiceId) : undefined;
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
          queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/payments/breakdown"] });
          queryClient.invalidateQueries({ predicate: (query) => 
            Array.isArray(query.queryKey) && 
            typeof query.queryKey[0] === 'string' && 
            query.queryKey[0].includes('/api/customers/') && 
            query.queryKey[0].includes('/jobs')
          });
        } catch (e) {
          console.error("[StripeReturn] Query invalidation error:", e);
        }
        
        if (paymentId) {
          await triggerSignature({ paymentId, jobId, invoiceId });
          return;
        }
        
        setStatus("Redirecting to Jobs...");
        doRedirect();
        
      } catch (error) {
        console.error("[StripeReturn] Error during cleanup:", error);
        setStatus("Error occurred, redirecting...");
        doRedirect();
      }
    };

    processReturn();
  }, [setLocation, hasRedirected, waitingForSignature, triggerSignature]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!hasRedirected && !waitingForSignature) {
        doRedirect();
      }
    }, 10000);
    
    return () => clearTimeout(timeout);
  }, [setLocation, hasRedirected, waitingForSignature]);

  const handleSigDone = () => {
    onSignatureComplete();
    doRedirect();
  };

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
      {sigPendingPayment && (
        <SignatureCaptureModal
          open={sigModalOpen}
          onOpenChange={() => {}}
          paymentId={sigPendingPayment.paymentId}
          jobId={sigPendingPayment.jobId}
          invoiceId={sigPendingPayment.invoiceId}
          onComplete={handleSigDone}
          required
        />
      )}
    </div>
  );
}
