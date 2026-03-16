import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, Zap } from "lucide-react";
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

export default function QuickBooksSettings() {
  const { isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  
  const hasPermission = can('customize.manage');

  // Hidden-not-disabled: redirect non-owners to home
  useEffect(() => {
    if (!authLoading && !hasPermission) {
      navigate('/');
    }
  }, [authLoading, hasPermission, navigate]);

  // Handle OAuth callback query params
  useEffect(() => {
    const params = new URLSearchParams(search);
    const connected = params.get('connected');
    const error = params.get('error');
    
    if (connected === 'true' || error) {
      // Refetch status after OAuth callback
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/status'] });
      
      // Show error toast only for errors
      if (error) {
        toast({
          title: "Connection Failed",
          description: "Could not connect to QuickBooks. Please try again.",
          variant: "destructive",
        });
      }
      
      // Clear URL params
      window.history.replaceState({}, '', '/customize/quickbooks');
    }
  }, [search, toast]);

  const { data: status, isLoading: statusLoading } = useQuery<QBStatus>({
    queryKey: ['/api/integrations/quickbooks/status'],
    enabled: hasPermission,
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/integrations/quickbooks/disconnect');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/status'] });
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
    setIsConnecting(true);
    try {
      console.log('[QB] connect tapped — fetching OAuth URL');
      const res = await apiRequest('GET', '/api/integrations/quickbooks/connect-url');
      const data = await res.json();
      if (!data?.url) throw new Error('No OAuth URL returned');
      console.log('[QB] OAuth URL received');

      if (isNativePlatform()) {
        // Native: open QuickBooks OAuth in the system browser (Safari on iOS),
        // then poll the status endpoint until the connection completes.
        // The callback stores tokens in the DB keyed by companyId embedded in
        // the signed state token — no native session context needed in the browser.
        const { Browser } = await import('@capacitor/browser');
        const baseUrl = getApiBaseUrl();

        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let pollTimeout: ReturnType<typeof setTimeout> | null = null;
        let done = false;
        let finishedListener: any = null;

        const cleanup = async (closeBrowser: boolean) => {
          if (done) return;
          done = true;
          if (pollInterval) clearInterval(pollInterval);
          if (pollTimeout) clearTimeout(pollTimeout);
          if (finishedListener) { try { finishedListener.remove(); } catch {} }
          if (closeBrowser) { try { await Browser.close(); } catch {} }
          setIsConnecting(false);
        };

        // Stop polling if the user manually closes Safari before completing auth
        finishedListener = await Browser.addListener('browserFinished', () => {
          console.log('[QB] native: browser closed by user');
          cleanup(false);
        });

        console.log('[QB] native: opening OAuth in system browser');
        await Browser.open({ url: data.url, presentationStyle: 'fullscreen' });

        // Poll status every 2 s — callback stores tokens server-side, so when
        // connected flips to true the native app can close the browser and update.
        pollInterval = setInterval(async () => {
          if (done) return;
          try {
            const nativeSid = localStorage.getItem('nativeSessionId');
            const headers: Record<string, string> = nativeSid
              ? { Authorization: `Bearer ${nativeSid}` }
              : {};
            const statusRes = await fetch(
              `${baseUrl}/api/integrations/quickbooks/status`,
              { credentials: 'include', headers },
            );
            const status = await statusRes.json();
            console.log('[QB] poll — connected:', status.connected);
            if (status.connected) {
              await cleanup(true);
              queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/status'] });
              toast({
                title: 'QuickBooks Connected',
                description: 'Your QuickBooks account has been connected successfully.',
              });
            }
          } catch (err) {
            console.error('[QB] poll error:', err);
          }
        }, 2000);

        // 5-minute hard timeout
        pollTimeout = setTimeout(async () => {
          await cleanup(true);
          toast({
            title: 'Connection Timed Out',
            description: 'QuickBooks connection did not complete. Please try again.',
            variant: 'destructive',
          });
        }, 5 * 60 * 1000);

      } else {
        // Web: navigate directly — session cookie is present so the backend
        // redirect flow completes normally and lands on ?connected=true.
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('[QB] Failed to start QuickBooks connect:', error);
      setIsConnecting(false);
      toast({
        title: 'Connection Failed',
        description: 'Could not start QuickBooks connection. Please try again.',
        variant: 'destructive',
      });
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
      const response = await apiRequest('POST', '/api/integrations/quickbooks/test');
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
        error: error.message || 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const formatTestTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Show loading while checking auth or redirecting non-owners
  if (authLoading || statusLoading || !hasPermission) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

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
                {status?.connected 
                  ? 'Connected to QuickBooks' 
                  : 'Not connected'
                }
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
                  <span className={`text-sm ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {testResult.success 
                      ? `Success: ${testResult.companyName} (${formatTestTime(testResult.testedAt)})`
                      : `Failed (${formatTestTime(testResult.testedAt)})`
                    }
                  </span>
                )}
              </div>
              
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
              
              <Button onClick={handleConnect} disabled={isConnecting} className="bg-green-600 hover:bg-green-700">
                {isConnecting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <img src={quickbooksLogo} alt="QuickBooks" className="w-5 h-5 mr-2 object-contain" />
                )}
                {isConnecting ? 'Connecting...' : 'Connect QuickBooks'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
