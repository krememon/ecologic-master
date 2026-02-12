import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Landmark, Loader2, Unplug } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PlaidStatus {
  connected: boolean;
  connectedAt?: string;
  institutionName?: string;
  maskLast4?: string;
}

export function ConnectBankCard() {
  const { toast } = useToast();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<PlaidStatus>({
    queryKey: ["/api/plaid/status"],
  });

  const createLinkToken = async () => {
    const res = await apiRequest("POST", "/api/plaid/create-link-token");
    const data = await res.json();
    setLinkToken(data.link_token);
  };

  const exchangeMutation = useMutation({
    mutationFn: async (payload: { public_token: string; institution?: any; account?: any }) => {
      const res = await apiRequest("POST", "/api/plaid/exchange-public-token", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bank Connected", description: "Your bank account has been linked successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/status"] });
      setLinkToken(null);
    },
    onError: (err: Error) => {
      toast({ title: "Connection Failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/plaid/disconnect");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bank Disconnected", description: "Your bank account has been unlinked." });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Disconnect Failed", description: err.message, variant: "destructive" });
    },
  });

  const onSuccess = useCallback(
    (publicToken: string, metadata: any) => {
      exchangeMutation.mutate({
        public_token: publicToken,
        institution: metadata.institution,
        account: metadata.accounts?.[0],
      });
    },
    [exchangeMutation]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setLinkToken(null),
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  const connected = status?.connected === true;
  const isConnecting = !!linkToken || exchangeMutation.isPending;
  const isDisconnecting = disconnectMutation.isPending;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 sm:p-6">
      <div className="flex flex-col gap-4">
        {/* Row 1: Icon + title on left, status pill on right */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Landmark className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Bank connection</h3>
              {connected && status?.institutionName && (
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                  {status.institutionName}
                  {status.maskLast4 && ` ····${status.maskLast4}`}
                </p>
              )}
            </div>
          </div>
          <div className="flex-none">
            {statusLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400 mt-1" />
            ) : connected ? (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600">
                Not connected
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Helper text on left, action button on right */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-6">
          <div className="flex-1">
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">
              Used for payments and refunds.
              {connected && status?.connectedAt && (
                <span className="block sm:inline sm:ml-0"> Connected {new Date(status.connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              )}
            </p>
          </div>
          <div className="flex-none">
            {connected ? (
              <Button
                variant="outline"
                className="h-10 px-4 rounded-lg font-semibold text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20 w-full sm:w-auto"
                onClick={() => disconnectMutation.mutate()}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Unplug className="h-4 w-4 mr-2" />
                )}
                {isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <Button
                className="h-10 px-4 rounded-lg font-semibold bg-teal-600 hover:bg-teal-700 text-white w-full sm:w-auto"
                onClick={createLinkToken}
                disabled={isConnecting || statusLoading}
              >
                {isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Landmark className="h-4 w-4 mr-2" />
                )}
                {isConnecting ? "Connecting…" : "Connect bank"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
