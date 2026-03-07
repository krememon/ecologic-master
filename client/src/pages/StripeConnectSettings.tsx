import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, CreditCard, CheckCircle2, AlertTriangle, XCircle, RefreshCw, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface ConnectStatus {
  hasAccount: boolean;
  accountId?: string;
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardedAt?: string;
  lastCheckedAt?: string;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    not_started: { label: "Not Connected", variant: "outline" },
    pending_onboarding: { label: "Onboarding Incomplete", variant: "secondary" },
    active: { label: "Active", variant: "default" },
    restricted: { label: "Restricted", variant: "destructive" },
    disabled: { label: "Disabled", variant: "destructive" },
  };
  const c = config[status] || { label: status, variant: "outline" as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "active") return <CheckCircle2 className="h-10 w-10 text-green-500" />;
  if (status === "restricted" || status === "disabled") return <XCircle className="h-10 w-10 text-red-500" />;
  if (status === "pending_onboarding") return <AlertTriangle className="h-10 w-10 text-amber-500" />;
  return <CreditCard className="h-10 w-10 text-muted-foreground" />;
}

export default function StripeConnectSettings() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: statusData, isLoading } = useQuery<ConnectStatus>({
    queryKey: ["/api/stripe-connect/status"],
  });

  const createAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe-connect/create-account");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      toast({ title: "Stripe account created", description: "Now complete onboarding to start receiving payouts." });
      startOnboarding();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to create Stripe account", variant: "destructive" });
    },
  });

  const onboardingLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe-connect/onboarding-link");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank");
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to create onboarding link", variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe-connect/sync");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      toast({ title: "Status synced", description: `Account status: ${data.status}` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to sync status", variant: "destructive" });
    },
  });

  function startOnboarding() {
    onboardingLinkMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = statusData?.status || "not_started";
  const hasAccount = statusData?.hasAccount || false;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/settings")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">Stripe Payouts</h1>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusIcon status={status} />
              <div>
                <CardTitle className="text-base">Payout Account</CardTitle>
                <CardDescription className="text-sm">
                  {status === "active"
                    ? "Your account is connected and ready to receive payouts."
                    : status === "pending_onboarding"
                    ? "Complete onboarding to start receiving payouts."
                    : status === "restricted"
                    ? "Your account has restrictions. Please update your information."
                    : "Connect your Stripe account to receive subcontractor payouts."}
                </CardDescription>
              </div>
            </div>
            <StatusBadge status={status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasAccount && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Charges Enabled</span>
                <span>{statusData?.chargesEnabled ? "Yes" : "No"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payouts Enabled</span>
                <span>{statusData?.payoutsEnabled ? "Yes" : "No"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Details Submitted</span>
                <span>{statusData?.detailsSubmitted ? "Yes" : "No"}</span>
              </div>
              {statusData?.onboardedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connected Since</span>
                  <span>{new Date(statusData.onboardedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {!hasAccount && (
              <Button
                onClick={() => createAccountMutation.mutate()}
                disabled={createAccountMutation.isPending}
                className="flex-1 gap-2"
              >
                {createAccountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Connect Stripe
              </Button>
            )}

            {hasAccount && status !== "active" && (
              <Button
                onClick={startOnboarding}
                disabled={onboardingLinkMutation.isPending}
                className="flex-1 gap-2"
              >
                {onboardingLinkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {status === "pending_onboarding" ? "Complete Onboarding" : "Update Information"}
              </Button>
            )}

            {hasAccount && (
              <Button
                variant="outline"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="gap-2"
              >
                {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-muted-foreground">
            When you accept a subcontracted job, the referring company's share is automatically calculated based on the agreed terms. Once your Stripe account is active, payouts will be processed automatically when customer payments are received.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
