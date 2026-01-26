import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, Link2, CheckCircle2, XCircle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface QBStatus {
  connected: boolean;
  connectedAt: string | null;
  realmId: string | null;
}

export default function QuickBooksSettings() {
  const { isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  
  const hasPermission = can('customize.manage');

  // Hidden-not-disabled: redirect non-owners to home
  useEffect(() => {
    if (!authLoading && !hasPermission) {
      navigate('/');
    }
  }, [authLoading, hasPermission, navigate]);

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

  const handleConnect = () => {
    window.location.href = '/api/integrations/quickbooks/connect';
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectMutation.mutateAsync();
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Show loading while checking auth or redirecting non-owners
  if (authLoading || statusLoading || !hasPermission) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              status?.connected 
                ? 'bg-green-100 dark:bg-green-900/30' 
                : 'bg-slate-100 dark:bg-slate-700'
            }`}>
              <Link2 className={`h-6 w-6 ${
                status?.connected 
                  ? 'text-green-600 dark:text-green-400' 
                  : 'text-slate-500 dark:text-slate-400'
              }`} />
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
              
              <Button onClick={handleConnect} className="bg-green-600 hover:bg-green-700">
                <Link2 className="h-4 w-4 mr-2" />
                Connect QuickBooks
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
