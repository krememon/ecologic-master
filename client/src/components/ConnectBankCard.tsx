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
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
            <Landmark className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div className="min-w-0">
            {statusLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                <span className="text-sm text-slate-500 dark:text-slate-400">Checking status…</span>
              </div>
            ) : connected ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                    Connected
                  </span>
                  {status?.institutionName && (
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {status.institutionName}
                      {status.maskLast4 && ` ····${status.maskLast4}`}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Used for payments and refunds
                  {status?.connectedAt && (
                    <span> · Connected {new Date(status.connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  )}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600">
                    Not connected
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Used for payments and refunds
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex-shrink-0">
          {connected ? (
            <Button
              variant="outline"
              size="sm"
              className="h-10 rounded-lg text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20"
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
              size="sm"
              className="h-10 rounded-lg bg-teal-600 hover:bg-teal-700 text-white"
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
  );
}
