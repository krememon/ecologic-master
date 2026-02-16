import { useState, useEffect, useCallback, useRef } from "react";

const PENDING_SIG_KEY = "pendingSignaturePaymentId";
const PENDING_SIG_META_KEY = "pendingSignatureMeta";

interface PendingSignatureMeta {
  paymentId: number;
  jobId?: number;
  invoiceId?: number;
}

function getPendingFromStorage(): PendingSignatureMeta | null {
  try {
    const raw = localStorage.getItem(PENDING_SIG_META_KEY);
    if (raw) return JSON.parse(raw);
    const legacyId = localStorage.getItem(PENDING_SIG_KEY);
    if (legacyId) return { paymentId: parseInt(legacyId, 10) };
  } catch {}
  return null;
}

function setPendingInStorage(meta: PendingSignatureMeta) {
  try {
    localStorage.setItem(PENDING_SIG_KEY, String(meta.paymentId));
    localStorage.setItem(PENDING_SIG_META_KEY, JSON.stringify(meta));
  } catch {}
}

function clearPendingFromStorage() {
  try {
    localStorage.removeItem(PENDING_SIG_KEY);
    localStorage.removeItem(PENDING_SIG_META_KEY);
  } catch {}
}

async function verifyPaymentAndSignature(paymentId: number): Promise<{ isPaid: boolean; hasSignature: boolean }> {
  try {
    const res = await fetch(`/api/payments/${paymentId}/signature`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return { isPaid: true, hasSignature: !!data.signature };
    }
    if (res.status === 404) {
      return { isPaid: false, hasSignature: false };
    }
  } catch {}
  return { isPaid: true, hasSignature: false };
}

export function useSignatureAfterPayment() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingSignatureMeta | null>(null);
  const triggeredRef = useRef<number | null>(null);

  const openModal = useCallback(async (meta: PendingSignatureMeta) => {
    if (triggeredRef.current === meta.paymentId) {
      return;
    }

    const { isPaid, hasSignature } = await verifyPaymentAndSignature(meta.paymentId);

    if (!isPaid) {
      clearPendingFromStorage();
      return;
    }

    if (hasSignature) {
      clearPendingFromStorage();
      return;
    }

    triggeredRef.current = meta.paymentId;
    setPendingPayment(meta);
    setPendingInStorage(meta);
    setIsModalOpen(true);
  }, []);

  const triggerSignature = useCallback(async (meta: PendingSignatureMeta) => {
    setPendingInStorage(meta);
    await openModal(meta);
  }, [openModal]);

  const onSignatureComplete = useCallback(() => {
    setIsModalOpen(false);
    setPendingPayment(null);
    clearPendingFromStorage();
    triggeredRef.current = null;
  }, []);

  const onModalDismiss = useCallback(() => {
  }, []);

  useEffect(() => {
    const stored = getPendingFromStorage();
    if (!stored) return;
    if (triggeredRef.current === stored.paymentId) return;

    (async () => {
      const { isPaid, hasSignature } = await verifyPaymentAndSignature(stored.paymentId);
      if (!isPaid || hasSignature) {
        clearPendingFromStorage();
        return;
      }
      setPendingPayment(stored);
    })();
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
