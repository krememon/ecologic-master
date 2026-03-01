import { useState, useCallback, useRef } from "react";

interface PendingSignatureMeta {
  paymentId: number;
  jobId?: number;
  invoiceId?: number;
}

async function checkInvoicePaidAndNoSignature(invoiceId: number, paymentId: number): Promise<{ isPaid: boolean; hasSignature: boolean }> {
  try {
    const [invRes, sigRes] = await Promise.all([
      fetch(`/api/payments/invoice/${invoiceId}`, { credentials: 'include' }),
      fetch(`/api/payments/${paymentId}/signature`, { credentials: 'include' }),
    ]);

    let isPaid = false;
    if (invRes.ok) {
      const invData = await invRes.json();
      const status = (invData.invoiceStatus || invData.computedStatus || invData.status || '').toLowerCase();
      isPaid = status === 'paid';
      console.log('[signature] check invoice', { invoiceId, invoiceStatus: status, isPaid });
    }

    let hasSignature = false;
    if (sigRes.ok) {
      const sigData = await sigRes.json();
      hasSignature = !!sigData.signature;
      console.log('[signature] check signature', { paymentId, hasSignature });
    }

    return { isPaid, hasSignature };
  } catch (err) {
    console.log('[signature] check error', err);
    return { isPaid: false, hasSignature: false };
  }
}

export function useSignatureAfterPayment() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingSignatureMeta | null>(null);
  const triggeredRef = useRef<number | null>(null);

  const triggerSignature = useCallback(async (meta: PendingSignatureMeta) => {
    if (triggeredRef.current === meta.paymentId) {
      console.log('[signature] already triggered for paymentId', meta.paymentId);
      return;
    }

    if (!meta.invoiceId) {
      console.log('[signature] no invoiceId, skipping');
      return;
    }

    console.log('[signature] polling for paid status', { invoiceId: meta.invoiceId, paymentId: meta.paymentId });

    for (let attempt = 0; attempt < 10; attempt++) {
      const { isPaid, hasSignature } = await checkInvoicePaidAndNoSignature(meta.invoiceId, meta.paymentId);

      if (isPaid && !hasSignature) {
        console.log('[signature] OPENING modal', { invoiceId: meta.invoiceId, paymentId: meta.paymentId, attempt });
        triggeredRef.current = meta.paymentId;
        setPendingPayment(meta);
        setIsModalOpen(true);
        return;
      }

      if (hasSignature) {
        console.log('[signature] signature already exists, skipping');
        return;
      }

      if (attempt < 9) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log('[signature] invoice not fully paid after polling, skipping modal');
  }, []);

  const onSignatureComplete = useCallback(() => {
    setIsModalOpen(false);
    setPendingPayment(null);
    triggeredRef.current = null;
    console.log('[signature] signature saved successfully');
  }, []);

  const onModalDismiss = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const hasPendingSignature = pendingPayment !== null && !isModalOpen;

  const openPendingModal = useCallback(() => {
    if (pendingPayment) {
      triggeredRef.current = pendingPayment.paymentId;
      setIsModalOpen(true);
    }
  }, [pendingPayment]);

  return {
    isModalOpen,
    pendingPayment,
    hasPendingSignature,
    triggerSignature,
    onSignatureComplete,
    onModalDismiss,
    openPendingModal,
  };
}
