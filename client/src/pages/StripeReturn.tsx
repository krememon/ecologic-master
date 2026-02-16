import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";

console.log("[StripeReturn] Module loaded at", new Date().toISOString());

export default function StripeReturn() {
  console.log("[StripeReturn] Component rendering, href:", window.location.href);
  
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState("Verifying payment...");
  const [hasRedirected, setHasRedirected] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [stripePaymentId, setStripePaymentId] = useState<number | null>(null);
  const [stripeJobId, setStripeJobId] = useState<number | undefined>(undefined);
  const [stripeInvoiceId, setStripeInvoiceId] = useState<number | undefined>(undefined);
  const [waitingForSignature, setWaitingForSignature] = useState(false);

  const { data: paymentSettings, isLoading: settingsLoading } = useQuery<{ requireSignatureAfterPayment: boolean }>({
    queryKey: ['/api/settings/payments'],
  });

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
    console.log("[StripeReturn] useEffect running");
    
    if (hasRedirected || waitingForSignature || settingsLoading) {
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
            console.log("[StripeReturn] Session status:", data);
            
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
        
        if (paymentId && paymentSettings?.requireSignatureAfterPayment) {
          setStripePaymentId(paymentId);
          setStripeJobId(jobId);
          setStripeInvoiceId(invoiceId);
          setWaitingForSignature(true);
          setSignatureModalOpen(true);
          return;
        }
        
        console.log("[StripeReturn] State cleaned, navigating to /jobs");
        setStatus("Redirecting to Jobs...");
        doRedirect();
        
      } catch (error) {
        console.error("[StripeReturn] Error during cleanup:", error);
        setStatus("Error occurred, redirecting...");
        doRedirect();
      }
    };

    processReturn();
  }, [setLocation, hasRedirected, waitingForSignature, settingsLoading, paymentSettings]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!hasRedirected && !waitingForSignature) {
        console.log("[StripeReturn] Safety timeout triggered, forcing redirect");
        doRedirect();
      }
    }, 8000);
    
    return () => clearTimeout(timeout);
  }, [setLocation, hasRedirected, waitingForSignature]);

  const handleSignatureComplete = () => {
    setSignatureModalOpen(false);
    setWaitingForSignature(false);
    doRedirect();
  };

  const handleSignatureClose = () => {
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
      {stripePaymentId && (
        <SignatureCaptureModal
          open={signatureModalOpen}
          onOpenChange={handleSignatureClose}
          paymentId={stripePaymentId}
          jobId={stripeJobId}
          invoiceId={stripeInvoiceId}
          onComplete={handleSignatureComplete}
          required
        />
      )}
    </div>
  );
}
