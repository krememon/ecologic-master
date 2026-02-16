import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useSignatureAfterPayment } from "@/hooks/useSignatureAfterPayment";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";

const MAX_POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 2000;

export default function StripeReturn() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState("Verifying payment...");
  const [hasRedirected, setHasRedirected] = useState(false);
  const processedRef = useRef(false);
  const pollCountRef = useRef(0);

  const {
    isModalOpen: sigModalOpen,
    pendingPayment: sigPendingPayment,
    triggerSignature,
    onSignatureComplete,
  } = useSignatureAfterPayment();

  const waitingForSignature = sigModalOpen || (sigPendingPayment !== null && !hasRedirected);

  const doRedirect = useCallback(() => {
    try {
      localStorage.removeItem("selectedJobId");
      localStorage.removeItem("activeJobId");
      localStorage.removeItem("stripe_session");
    } catch (e) {
      console.error("[StripeReturn] localStorage clear error:", e);
    }
    setHasRedirected(true);
    setLocation("/jobs", { replace: true });
  }, [setLocation]);

  const invalidateAll = useCallback(() => {
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
  }, []);

  const checkSession = useCallback(async (sessionId: string): Promise<{ paymentId: number | null; jobId?: number; invoiceId?: number; isPaid: boolean }> => {
    try {
      const response = await fetch(`/api/payments/session/${sessionId}`, { credentials: 'include' });
      const data = await response.json();
      console.log("[StripeReturn] Session poll response:", data);
      
      if (data.paymentStatus === 'paid' && data.paymentId) {
        return {
          paymentId: data.paymentId,
          jobId: data.jobId ? parseInt(data.jobId) : undefined,
          invoiceId: data.invoiceId ? parseInt(data.invoiceId) : undefined,
          isPaid: true,
        };
      }
      
      if (data.paymentStatus === 'paid' && !data.paymentId) {
        return { paymentId: null, isPaid: true };
      }
      
      return { paymentId: null, isPaid: false };
    } catch (e) {
      console.error("[StripeReturn] Session check error:", e);
      return { paymentId: null, isPaid: false };
    }
  }, []);

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
        
        if (!sessionId) {
          setStatus("Redirecting to Jobs...");
          doRedirect();
          return;
        }

        setStatus("Confirming payment...");
        
        let result = await checkSession(sessionId);
        
        if (result.isPaid && result.paymentId) {
          setStatus("Payment confirmed!");
          invalidateAll();
          await triggerSignature({ paymentId: result.paymentId, jobId: result.jobId, invoiceId: result.invoiceId });
          return;
        }
        
        if (!result.isPaid || !result.paymentId) {
          setStatus("Waiting for payment confirmation...");
          
          const pollForPayment = async (): Promise<void> => {
            while (pollCountRef.current < MAX_POLL_ATTEMPTS) {
              pollCountRef.current++;
              console.log(`[StripeReturn] Polling attempt ${pollCountRef.current}/${MAX_POLL_ATTEMPTS}`);
              
              await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
              
              result = await checkSession(sessionId);
              
              if (result.isPaid && result.paymentId) {
                setStatus("Payment confirmed!");
                invalidateAll();
                await triggerSignature({ paymentId: result.paymentId, jobId: result.jobId, invoiceId: result.invoiceId });
                return;
              }
            }
            
            console.log("[StripeReturn] Max poll attempts reached, redirecting");
            invalidateAll();
            setStatus("Redirecting to Jobs...");
            doRedirect();
          };
          
          await pollForPayment();
          return;
        }
        
        invalidateAll();
        setStatus("Redirecting to Jobs...");
        doRedirect();
        
      } catch (error) {
        console.error("[StripeReturn] Error during processing:", error);
        setStatus("Error occurred, redirecting...");
        doRedirect();
      }
    };

    processReturn();
  }, [hasRedirected, waitingForSignature, triggerSignature, doRedirect, invalidateAll, checkSession]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!hasRedirected && !waitingForSignature) {
        console.log("[StripeReturn] Safety timeout triggered, forcing redirect");
        doRedirect();
      }
    }, 25000);
    
    return () => clearTimeout(timeout);
  }, [hasRedirected, waitingForSignature, doRedirect]);

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
