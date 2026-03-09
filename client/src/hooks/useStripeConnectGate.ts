import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export type StripeConnectReadiness =
  | "loading"
  | "not_connected"
  | "setup_incomplete"
  | "ready"
  | "needs_attention";

interface ConnectStatus {
  hasAccount: boolean;
  accountId?: string;
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

const STATUS_LABELS: Record<StripeConnectReadiness, string> = {
  loading: "Checking...",
  not_connected: "Not connected",
  setup_incomplete: "Setup incomplete",
  ready: "Ready to accept payments",
  needs_attention: "Needs attention",
};

const ACTION_LABELS: Record<StripeConnectReadiness, string> = {
  loading: "",
  not_connected: "Connect Stripe",
  setup_incomplete: "Finish setup",
  ready: "Continue to Payment",
  needs_attention: "Update Stripe",
};

function deriveReadiness(data: ConnectStatus | undefined): StripeConnectReadiness {
  if (!data) return "loading";
  if (!data.hasAccount) return "not_connected";
  if (data.chargesEnabled && data.payoutsEnabled && data.detailsSubmitted) return "ready";
  if (data.status === "restricted" || data.status === "disabled") return "needs_attention";
  return "setup_incomplete";
}

export function useStripeConnectGate() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showGateModal, setShowGateModal] = useState(false);
  const [showOwnerOnlyMessage, setShowOwnerOnlyMessage] = useState(false);
  const onReadyCallbackRef = useRef<(() => void) | null>(null);

  const role = (user as any)?.role?.toUpperCase?.() || "";
  const isOwner = role === "OWNER";

  const { data: statusData, isLoading: statusLoading } = useQuery<ConnectStatus>({
    queryKey: ["/api/stripe-connect/status"],
    enabled: !!user,
  });

  const readiness = statusLoading ? "loading" : deriveReadiness(statusData);
  const isReady = readiness === "ready";

  useEffect(() => {
    if (isReady && showGateModal) {
      const timer = setTimeout(() => {
        setShowGateModal(false);
        setShowOwnerOnlyMessage(false);
        if (onReadyCallbackRef.current) {
          onReadyCallbackRef.current();
          onReadyCallbackRef.current = null;
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isReady, showGateModal]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnStatus = params.get("stripe_connect_return");
    if (returnStatus) {
      params.delete("stripe_connect_return");
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, "", newUrl);

      if (isOwner) {
        syncAfterReturn();
      }
    }
  }, []);

  const syncAfterReturn = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/stripe-connect/sync");
      await queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      const freshData = await queryClient.fetchQuery<ConnectStatus>({
        queryKey: ["/api/stripe-connect/status"],
      });
      const freshReadiness = deriveReadiness(freshData);
      if (freshReadiness === "ready") {
        toast({ title: "Stripe setup complete! You can now accept card payments." });
      } else {
        toast({ title: "Stripe setup is still incomplete. Please finish your Stripe onboarding.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not verify Stripe status", variant: "destructive" });
    }
  }, [queryClient, toast, isOwner]);

  const ensureReady = useCallback(async (onReady?: () => void): Promise<boolean> => {
    if (isReady) return true;

    if (onReady) {
      onReadyCallbackRef.current = onReady;
    }

    if (!isOwner) {
      setShowOwnerOnlyMessage(true);
      setShowGateModal(true);
      return false;
    }

    setShowGateModal(true);
    return false;
  }, [isReady, isOwner]);

  const startOnboarding = useCallback(async (returnPath?: string) => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const res = await apiRequest("POST", "/api/stripe-connect/ensure-ready", {
        returnPath: returnPath || location,
      });
      const data = await res.json();

      if (data.ready) {
        await queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
        toast({ title: "Stripe is ready! You can now accept card payments." });
        return;
      }

      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      }
    } catch (err: any) {
      const errData = err?.message ? (() => { try { return JSON.parse(err.message); } catch { return null; } })() : null;
      if (errData?.ownerOnly) {
        setShowOwnerOnlyMessage(true);
      } else {
        toast({ title: "Failed to start Stripe setup", variant: "destructive" });
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, location, queryClient, toast]);

  const dismissGateModal = useCallback(() => {
    setShowGateModal(false);
    setShowOwnerOnlyMessage(false);
    onReadyCallbackRef.current = null;
  }, []);

  return {
    readiness,
    isReady,
    isLoading: statusLoading,
    isProcessing,
    isOwner,
    statusLabel: STATUS_LABELS[readiness],
    actionLabel: ACTION_LABELS[readiness],
    ensureReady,
    startOnboarding,
    showGateModal,
    showOwnerOnlyMessage,
    dismissGateModal,
  };
}
