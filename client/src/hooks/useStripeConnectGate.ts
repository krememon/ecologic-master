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

let stripePollInterval: ReturnType<typeof setInterval> | null = null;
let stripePollTimeout: ReturnType<typeof setTimeout> | null = null;

function stopStripePolling() {
  if (stripePollInterval) { clearInterval(stripePollInterval); stripePollInterval = null; }
  if (stripePollTimeout) { clearTimeout(stripePollTimeout); stripePollTimeout = null; }
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
  const toastRef = useRef(toast);
  const queryClientRef = useRef(queryClient);
  toastRef.current = toast;
  queryClientRef.current = queryClient;

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
        syncStripeStatus();
      }
    }
  }, []);

  const syncStripeStatus = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/stripe-connect/sync");
      await queryClientRef.current.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      const freshData = await queryClientRef.current.fetchQuery<ConnectStatus>({
        queryKey: ["/api/stripe-connect/status"],
      });
      const freshReadiness = deriveReadiness(freshData);
      if (freshReadiness === "ready") {
        toastRef.current({ title: "Stripe setup complete! You can now accept card payments." });
      } else {
        toastRef.current({ title: "Stripe setup is still incomplete. Please finish your Stripe onboarding.", variant: "destructive" });
      }
    } catch {
      toastRef.current({ title: "Could not verify Stripe status", variant: "destructive" });
    }
  }, []);

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
      console.log("[stripe-connect] Calling ensure-ready...");
      const res = await apiRequest("POST", "/api/stripe-connect/ensure-ready", {
        returnPath: returnPath || location,
      });
      const data = await res.json();
      console.log("[stripe-connect] ensure-ready response:", { ready: data.ready, hasUrl: !!data.onboardingUrl, status: data.status });

      if (data.ready) {
        await queryClientRef.current.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
        toastRef.current({ title: "Stripe is ready! You can now accept card payments." });
        return;
      }

      if (!data.onboardingUrl) {
        console.error("[stripe-connect] No onboarding URL returned");
        toastRef.current({ title: "Failed to get Stripe setup link", variant: "destructive" });
        return;
      }

      let useNative = false;
      try {
        const { isNativePlatform } = await import("@/lib/capacitor");
        useNative = isNativePlatform();
        console.log("[stripe-connect] Platform check: native =", useNative);
      } catch (e) {
        console.log("[stripe-connect] Platform check failed, using web:", e);
      }

      if (useNative) {
        try {
          const { Browser } = await import("@capacitor/browser");
          console.log("[stripe-connect] Opening in native browser...");

          stopStripePolling();
          let resolved = false;
          let pollInFlight = false;

          const onBrowserDone = async () => {
            if (resolved) return;
            resolved = true;
            console.log("[stripe-connect] Browser done, syncing status...");
            stopStripePolling();
            await syncStripeStatus();
          };

          let closedListener: any = null;
          try {
            closedListener = await Browser.addListener("browserFinished", () => {
              console.log("[stripe-connect] browserFinished event");
              onBrowserDone();
            });
          } catch (e) {
            console.warn("[stripe-connect] Could not add browserFinished listener:", e);
          }

          await Browser.open({ url: data.onboardingUrl, presentationStyle: "fullscreen" });
          console.log("[stripe-connect] Browser.open succeeded");

          stripePollInterval = setInterval(async () => {
            if (pollInFlight || resolved) return;
            pollInFlight = true;
            try {
              await apiRequest("POST", "/api/stripe-connect/sync");
              const statusRes = await fetch("/api/stripe-connect/status", { credentials: "include" });
              const pollData: ConnectStatus = await statusRes.json();
              console.log("[stripe-connect] Poll:", pollData.status, "charges:", pollData.chargesEnabled);

              if (pollData.chargesEnabled && pollData.payoutsEnabled && pollData.detailsSubmitted) {
                console.log("[stripe-connect] Ready detected via poll!");
                resolved = true;
                stopStripePolling();
                try { await Browser.close(); } catch {}
                try { closedListener?.remove(); } catch {}
                await syncStripeStatus();
              }
            } catch (e) {
              console.error("[stripe-connect] Poll error:", e);
            } finally {
              pollInFlight = false;
            }
          }, 3000);

          stripePollTimeout = setTimeout(() => {
            stopStripePolling();
            if (!resolved) {
              resolved = true;
              console.log("[stripe-connect] Poll timeout, syncing final state");
              try { closedListener?.remove(); } catch {}
              syncStripeStatus();
            }
          }, 5 * 60 * 1000);

          return;
        } catch (nativeErr) {
          console.error("[stripe-connect] Native browser failed, falling back to web redirect:", nativeErr);
        }
      }

      console.log("[stripe-connect] Using web redirect");
      window.location.href = data.onboardingUrl;

    } catch (err: any) {
      console.error("[stripe-connect] startOnboarding error:", err);
      const errData = err?.message ? (() => { try { return JSON.parse(err.message); } catch { return null; } })() : null;
      if (errData?.ownerOnly) {
        setShowOwnerOnlyMessage(true);
      } else {
        toastRef.current({ title: "Failed to start Stripe setup", variant: "destructive" });
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, location, syncStripeStatus]);

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
