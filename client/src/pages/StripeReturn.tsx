import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useSignatureAfterPayment } from "@/hooks/useSignatureAfterPayment";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";

const MAX_POLL_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 700;

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

  useEffect(() => {
    if (hasRedirected || waitingForSignature || processedRef.current) {
      return;
    }

    processedRef.current = true;

    const processReturn = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get("session_id") || localStorage.getItem("stripe_session");

        console.log("[StripeReturn] session_id", sessionId);

        if (window.location.search) {
          window.history.replaceState({}, '', window.location.pathname);
        }

        if (!sessionId) {
          console.log("[StripeReturn] No session_id found, redirecting to /jobs");
          setStatus("Redirecting...");
          doRedirect();
          return;
        }

        setStatus("Confirming payment...");

        let invoiceId: number | null = null;
        let jobId: number | null = null;

        try {
          const sessionRes = await fetch(`/api/stripe/checkout-session/${sessionId}`, { credentials: 'include' });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            invoiceId = sessionData.invoiceId;
            jobId = sessionData.jobId || null;
            console.log("[StripeReturn] invoice", invoiceId, "job", jobId);

            if (sessionData.paymentStatus !== 'paid') {
              console.log("[StripeReturn] Session not yet paid, will poll for payment record");
            }
          }
        } catch (e) {
          console.error("[StripeReturn] Error fetching checkout session:", e);
        }

        if (!invoiceId) {
          console.log("[StripeReturn] No invoiceId from session, redirecting");
          invalidateAll();
          setStatus("Redirecting...");
          doRedirect();
          return;
        }

        setStatus("Waiting for payment confirmation...");
        console.log("[StripeReturn] waiting for payment...");

        let paymentId: number | null = null;
        let paymentStatus: string | null = null;

        for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
          console.log(`[StripeReturn] Poll attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS}`);

          try {
            const payRes = await fetch(`/api/payments/latest-for-invoice/${invoiceId}`, { credentials: 'include' });
            if (payRes.ok) {
              const payData = await payRes.json();
              if (payData.payment && payData.payment.status === 'paid') {
                paymentId = payData.payment.id;
                paymentStatus = payData.payment.status;
                console.log("[StripeReturn] payment found", paymentId, paymentStatus);
                break;
              }
            }
          } catch (e) {
            console.error("[StripeReturn] Poll error:", e);
          }

          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        invalidateAll();

        if (paymentId) {
          setStatus("Payment confirmed!");
          console.log("[StripeReturn] opening signature", paymentId);
          await triggerSignature({ paymentId, jobId: jobId || undefined, invoiceId: invoiceId || undefined });
          return;
        }

        console.log("[StripeReturn] Max poll attempts reached, redirecting to /jobs (recovery will handle signature)");
        setStatus("Redirecting...");
        doRedirect();

      } catch (error) {
        console.error("[StripeReturn] Error during processing:", error);
        setStatus("Error occurred, redirecting...");
        doRedirect();
      }
    };

    processReturn();
  }, [hasRedirected, waitingForSignature, triggerSignature, doRedirect, invalidateAll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!hasRedirected && !waitingForSignature) {
        console.log("[StripeReturn] Safety timeout triggered, forcing redirect");
        doRedirect();
      }
    }, 30000);

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
