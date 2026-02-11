import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5" />
          Bank Connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Status</p>
            {statusLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : connected ? (
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-green-600 hover:bg-green-700">Connected</Badge>
                {status?.institutionName && (
                  <span className="text-sm text-muted-foreground">
                    {status.institutionName}
                    {status.maskLast4 && ` ····${status.maskLast4}`}
                  </span>
                )}
              </div>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </div>

          {connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Unplug className="h-4 w-4 mr-2" />
              )}
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={createLinkToken}
              disabled={!!linkToken || exchangeMutation.isPending}
            >
              {exchangeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Landmark className="h-4 w-4 mr-2" />
              )}
              Connect Bank
            </Button>
          )}
        </div>

        {connected && status?.connectedAt && (
          <p className="text-xs text-muted-foreground">
            Connected on {new Date(status.connectedAt).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
