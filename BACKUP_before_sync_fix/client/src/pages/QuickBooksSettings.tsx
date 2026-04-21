import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, Zap, RefreshCw } from "lucide-react";
import quickbooksLogo from "@/assets/logos/quickbooks-transparent.png";
import { Link, useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isNativePlatform, getApiBaseUrl } from "@/lib/capacitor";

interface QBStatus {
  connected: boolean;
  connectedAt: string | null;
  realmId: string | null;
}

interface TestResult {
  success: boolean;
  companyName?: string;
  testedAt: string;
  error?: string;
}

type ConnectState = "idle" | "launching" | "waiting" | "verifying" | "failed";

const STATE_LABEL: Record<ConnectState, string> = {
  idle: "Connect QuickBooks",
  launching: "Connecting…",
  waiting: "Waiting for QuickBooks…",
  verifying: "Finishing connection…",
  failed: "Try Again",
};

export default function QuickBooksSettings() {
  const { isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connectState, setConnectState] = useState<ConnectState>("idle");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Stores the cleanup function for the active connect flow so it runs on unmount
  const cleanupRef = useRef<(() => void) | null>(null);

  const hasPermission = can("customize.manage");

  // Cleanup listeners/timers if component unmounts while connecting
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  // Hidden-not-disabled: redirect non-owners to home
  useEffect(() => {
    if (!authLoading && !hasPermission) {
      navigate("/");
    }
  }, [authLoading, hasPermission, navigate]);

  // Handle OAuth callback query params (web flow — native uses deep link)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected === "true" || error) {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/status"] });
      if (error) {
        toast({
          title: "Connection Failed",
          description: "Could not connect to QuickBooks. Please try again.",
          variant: "destructive",
        });
      }
      window.history.replaceState({}, "", "/customize/quickbooks");
    }
  }, [search, toast]);

  const { data: status, isLoading: statusLoading } = useQuery<QBStatus>({
    queryKey: ["/api/integrations/quickbooks/status"],
    enabled: hasPermission,
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/integrations/quickbooks/disconnect");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to disconnect QuickBooks",
        variant: "destructive",
      });
    },
  });

  const handleConnect = async () => {
    if (connectState !== "idle" && connectState !== "failed") return;
    setConnectState("launching");

    try {
      console.log("[QB_AUTH] connect tapped — fetching OAuth URL");
      const res = await apiRequest("GET", "/api/integrations/quickbooks/connect-url");
      const data = await res.json();
      if (!data?.url) throw new Error("No OAuth URL returned");
      console.log("[QB_AUTH] OAuth URL received");

      if (!isNativePlatform()) {
        // Web: session cookie is present — redirect flows normally through the
        // backend callback and the /quickbooks-success bridge page.
        window.location.href = data.url;
        return;
      }

      // ── Native flow ─────────────────────────────────────────────────────────
      // Detection layers (redundant for reliability — iOS can suppress timers):
      //   1. qb-oauth-deeplink DOM event (App.tsx captures ecologic://quickbooks/connected)
      //   2. browserFinished Capacitor event (user dismissed or we closed the browser)
      //   3. appStateChange Capacitor event (app resumed from background)
      //   4. setInterval poll (fast path if SFSafariViewController doesn't throttle timers)
      //   5. 30-second hard timeout → error
      const { Browser } = await import("@capacitor/browser");
      const { App: CapApp } = await import("@capacitor/app");
      const baseUrl = getApiBaseUrl();

      let done = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let hardTimeout: ReturnType<typeof setTimeout> | null = null;
      let browserFinishedListener: any = null;
      let appStateListener: any = null;

      const cleanup = () => {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null; }
        if (browserFinishedListener) { try { browserFinishedListener.remove(); } catch {} browserFinishedListener = null; }
        if (appStateListener) { try { appStateListener.remove(); } catch {} appStateListener = null; }
        window.removeEventListener("qb-oauth-deeplink", onDeepLink as EventListener);
        cleanupRef.current = null;
      };

      const checkStatus = async (): Promise<boolean> => {
        const nativeSid = localStorage.getItem("nativeSessionId");
        const headers: Record<string, string> = nativeSid
          ? { Authorization: `Bearer ${nativeSid}` }
          : {};
        const r = await fetch(`${baseUrl}/api/integrations/quickbooks/status`, {
          credentials: "include",
          headers,
        });
        if (!r.ok) {
          console.log("[QB_AUTH] status check non-ok status=" + r.status);
          return false;
        }
        const s = await r.json();
        console.log("[QB_STATUS] poll result connected=" + s.connected);
        return !!s.connected;
      };

      const onConnected = async (closeBrowser: boolean) => {
        if (done) return;
        done = true;
        cleanup();
        setConnectState("verifying");
        console.log("[QB_AUTH] connected — closeBrowser=" + closeBrowser);
        if (closeBrowser) { try { await Browser.close(); } catch {} }
        // Brief verifying state, then invalidate and show success toast
        setTimeout(async () => {
          // One final authoritative check before celebrating
          try { await checkStatus(); } catch {}
          setConnectState("idle");
          queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/status"] });
          toast({
            title: "QuickBooks Connected",
            description: "Your QuickBooks account has been linked to EcoLogic.",
          });
        }, 600);
      };

      const onFailed = async (closeBrowser: boolean, reason: string) => {
        if (done) return;
        done = true;
        cleanup();
        console.log("[QB_AUTH] failed reason=" + reason);
        if (closeBrowser) { try { await Browser.close(); } catch {} }
        setConnectState("failed");
        toast({
          title: "QuickBooks Connection Failed",
          description: "The connection didn't complete. Please try again.",
          variant: "destructive",
        });
        // Auto-reset to idle after showing the error
        setTimeout(() => setConnectState("idle"), 5000);
      };

      // Run up to N polls at 300ms. On success: call onConnected. On exhaustion: call onFailed.
      const runVerifyPolls = async (closeBrowser: boolean, maxAttempts = 20) => {
        let attempts = 0;
        const verify = setInterval(async () => {
          if (done) { clearInterval(verify); return; }
          attempts++;
          try {
            if (await checkStatus()) {
              clearInterval(verify);
              await onConnected(closeBrowser);
              return;
            }
          } catch {}
          if (attempts >= maxAttempts) {
            clearInterval(verify);
            await onFailed(false, "verify-poll-exhausted");
          }
        }, 300);
      };

      // Layer 1: DOM event from App.tsx's appUrlOpen handler (most reliable on iOS)
      const onDeepLink = async (e: Event) => {
        const result = (e as CustomEvent).detail?.result;
        console.log("[QB_AUTH] deep link result=" + result);
        if (result === "connected") {
          if (done) return;
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null; }
          setConnectState("verifying");
          await runVerifyPolls(true, 10);
        } else {
          await onFailed(true, "deep-link-error");
        }
      };
      window.addEventListener("qb-oauth-deeplink", onDeepLink as EventListener);

      // Layer 2: browserFinished (user dismissed browser OR our Browser.close() call)
      browserFinishedListener = await Browser.addListener("browserFinished", async () => {
        console.log("[QB_AUTH] browserFinished done=" + done);
        if (done) return;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null; }
        setConnectState("verifying");
        await runVerifyPolls(false, 12);
      });

      // Layer 3: appStateChange — fires when app resumes from background (safety net)
      appStateListener = await CapApp.addListener("appStateChange", async ({ isActive }) => {
        if (!isActive || done) return;
        console.log("[QB_AUTH] appStateChange active — checking status");
        try {
          if (await checkStatus()) {
            if (!done) await onConnected(true);
          }
        } catch {}
      });

      console.log("[QB_AUTH] opening QB OAuth in system browser");
      setConnectState("waiting");
      // Use popover style (same as Google auth) — avoids fullscreen SFSafariViewController
      // which throttles background WKWebView JavaScript timers on iOS.
      await Browser.open({ url: data.url, presentationStyle: "popover" as any });

      // Layer 4: continuous poll at 500ms (works if timers aren't throttled)
      pollTimer = setInterval(async () => {
        if (done) return;
        try {
          if (await checkStatus()) {
            clearInterval(pollTimer!);
            pollTimer = null;
            await onConnected(true);
          }
        } catch (err) {
          console.error("[QB_AUTH] poll error:", err);
        }
      }, 500);

      // Layer 5: 30-second hard timeout
      hardTimeout = setTimeout(() => onFailed(true, "30s-timeout"), 30_000);

      // Store cleanup for unmount
      cleanupRef.current = cleanup;

    } catch (error: any) {
      console.error("[QB_AUTH] connect failed:", error);
      setConnectState("failed");
      toast({
        title: "Connection Failed",
        description: "Could not start QuickBooks connection. Please try again.",
        variant: "destructive",
      });
      setTimeout(() => setConnectState("idle"), 5000);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectMutation.mutateAsync();
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await apiRequest("POST", "/api/integrations/quickbooks/test");
      const data = await response.json();
      setTestResult({
        success: true,
        companyName: data.companyName,
        testedAt: data.testedAt,
      });
    } catch (error: any) {
      setTestResult({
        success: false,
        testedAt: new Date().toISOString(),
        error: error.message || "Connection test failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const formatTestTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/integrations/quickbooks/retry-unsynced-payments"),
    onSuccess: (data: any) => {
      if (data.triggered === 0) {
        toast({ title: "All payments already synced", description: "No unsynced payments were found." });
      } else {
        toast({
          title: "Payment sync started",
          description: `Syncing ${data.triggered} payment${data.triggered !== 1 ? "s" : ""} to QuickBooks.`,
        });
      }
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Could not start payment sync. Please try again.", variant: "destructive" });
    },
  });

  if (authLoading || statusLoading || !hasPermission) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const isConnecting = connectState !== "idle" && connectState !== "failed";

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/customize">
          <Button variant="ghost" size="sm" className="mb-4 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Customize
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          QuickBooks Integration
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Connect your QuickBooks Online account to sync invoices and payments
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center">
              <img src={quickbooksLogo} alt="QuickBooks" className="w-12 h-12 object-contain" />
            </div>
            <div>
              <CardTitle className="text-lg">QuickBooks Online</CardTitle>
              <CardDescription>
                {status?.connected ? "Connected to QuickBooks" : "Not connected"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {status?.connected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Connected</span>
              </div>

              {status.connectedAt && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Connected on {formatDate(status.connectedAt)}
                </p>
              )}

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  size="sm"
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Test Connection
                    </>
                  )}
                </Button>

                {testResult && (
                  <span
                    className={`text-sm ${
                      testResult.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {testResult.success
                      ? `Success: ${testResult.companyName} (${formatTestTime(testResult.testedAt)})`
                      : `Failed (${formatTestTime(testResult.testedAt)})`}
                  </span>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
              >
                {retryMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync Unsynced Payments
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 mr-2" />
                    Disconnect
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Connect your QuickBooks Online account to automatically sync your invoices,
                payments, and customer data.
              </p>

              <div className="space-y-2">
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isConnecting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <img
                      src={quickbooksLogo}
                      alt="QuickBooks"
                      className="w-5 h-5 mr-2 object-contain"
                    />
                  )}
                  {STATE_LABEL[connectState]}
                </Button>

                {connectState === "waiting" && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sign in to QuickBooks in the browser window, then return here.
                  </p>
                )}
                {connectState === "verifying" && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Finishing connection…
                  </p>
                )}
                {connectState === "failed" && (
                  <p className="text-xs text-red-500">
                    Connection didn't complete. Tap to try again.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
