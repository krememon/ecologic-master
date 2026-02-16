import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

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
  const queuedRef = useRef<PendingSignatureMeta | null>(null);

  const { data: paymentSettings, isLoading: settingsLoading } = useQuery<{ requireSignatureAfterPayment: boolean }>({
    queryKey: ['/api/settings/payments'],
  });

  const isEnabled = paymentSettings?.requireSignatureAfterPayment === true;
  const settingsResolved = !settingsLoading && paymentSettings !== undefined;

  const openModal = useCallback(async (meta: PendingSignatureMeta) => {
    if (triggeredRef.current === meta.paymentId) {
      console.log("[SignatureAfterPay] already triggered for paymentId", meta.paymentId);
      return;
    }

    const { isPaid, hasSignature } = await verifyPaymentAndSignature(meta.paymentId);
    console.log("[SignatureAfterPay] shouldPrompt?", { requireSigSetting: true, isPaid, hasSignature, paymentId: meta.paymentId });

    if (!isPaid) {
      console.log("[SignatureAfterPay] payment not found/not paid, skipping");
      clearPendingFromStorage();
      return;
    }

    if (hasSignature) {
      console.log("[SignatureAfterPay] signature already exists, skipping");
      clearPendingFromStorage();
      return;
    }

    console.log("[SignatureAfterPay] opening signature modal");
    triggeredRef.current = meta.paymentId;
    setPendingPayment(meta);
    setPendingInStorage(meta);
    setIsModalOpen(true);
  }, []);

  const triggerSignature = useCallback(async (meta: PendingSignatureMeta) => {
    console.log("[SignatureAfterPay] triggerSignature called", meta);

    setPendingInStorage(meta);

    if (!settingsResolved) {
      console.log("[SignatureAfterPay] settings not yet loaded, queuing for later");
      queuedRef.current = meta;
      setPendingPayment(meta);
      return;
    }

    if (!isEnabled) {
      console.log("[SignatureAfterPay] setting is OFF, skipping");
      clearPendingFromStorage();
      return;
    }

    await openModal(meta);
  }, [settingsResolved, isEnabled, openModal]);

  useEffect(() => {
    if (!settingsResolved) return;

    if (queuedRef.current) {
      const queued = queuedRef.current;
      queuedRef.current = null;

      if (isEnabled) {
        console.log("[SignatureAfterPay] settings loaded, processing queued trigger", queued);
        openModal(queued);
      } else {
        console.log("[SignatureAfterPay] settings loaded but feature OFF, clearing queue");
        clearPendingFromStorage();
        setPendingPayment(null);
      }
    }
  }, [settingsResolved, isEnabled, openModal]);

  const onSignatureComplete = useCallback(() => {
    console.log("[SignatureAfterPay] signature completed, cleaning up");
    setIsModalOpen(false);
    setPendingPayment(null);
    clearPendingFromStorage();
    triggeredRef.current = null;
  }, []);

  const onModalDismiss = useCallback(() => {
  }, []);

  useEffect(() => {
    if (!settingsResolved || !isEnabled) return;

    const stored = getPendingFromStorage();
    if (!stored) return;
    if (triggeredRef.current === stored.paymentId) return;

    console.log("[SignatureAfterPay] found pending signature in storage on mount", stored);

    (async () => {
      const { hasSignature } = await verifyPaymentAndSignature(stored.paymentId);
      if (hasSignature) {
        console.log("[SignatureAfterPay] signature already captured, clearing pending");
        clearPendingFromStorage();
        return;
      }
      setPendingPayment(stored);
    })();
  }, [settingsResolved, isEnabled]);

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
    settingsLoading,
    isEnabled,
    triggerSignature,
    onSignatureComplete,
    onModalDismiss,
    openPendingModal,
  };
}
