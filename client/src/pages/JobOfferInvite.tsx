import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, MapPin, Calendar, DollarSign, FileText, CheckCircle2, XCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface InviteData {
  referralId: number;
  status: string;
  referralType: string;
  referralValue: string;
  message: string | null;
  allowPriceChange: boolean;
  senderCompanyName: string | null;
  senderCompanyCity: string | null;
  senderCompanyState: string | null;
  job: {
    id: number;
    title: string;
    status: string;
    description: string | null;
    scheduledDate: string | null;
    scheduledTime: string | null;
    estimatedCost: string | null;
    notes: string | null;
  } | null;
  customerName: string | null;
  customerAddress: string | null;
}

export default function JobOfferInvite() {
  const [, params] = useRoute("/referrals/invite/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = params?.token || "";
  const [actionTaken, setActionTaken] = useState<"accepted" | "declined" | null>(null);
  const [acceptedJobId, setAcceptedJobId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<InviteData>({
    queryKey: ["/api/referrals/invite", token],
    queryFn: async () => {
      const res = await fetch(`/api/referrals/invite/${token}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw { status: res.status, ...body };
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/referrals/invite/${token}/accept`);
      return res.json();
    },
    onSuccess: (result) => {
      setActionTaken("accepted");
      setAcceptedJobId(result.job?.id || null);
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/invite", token] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/incoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/outgoing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job accepted", description: "The job has been transferred to your company." });
    },
    onError: () => {
      toast({ title: "Failed to accept", description: "Something went wrong. Please try again.", variant: "destructive" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/referrals/invite/${token}/decline`);
      return res.json();
    },
    onSuccess: () => {
      setActionTaken("declined");
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/invite", token] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/incoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/outgoing"] });
      toast({ title: "Job declined" });
    },
    onError: () => {
      toast({ title: "Failed to decline", description: "Something went wrong. Please try again.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const err = error as any;
  if (err) {
    if (err.status === 410 || err.status === "expired") {
      return (
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-8 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Invite Expired</h2>
              <p className="text-muted-foreground text-sm">This job offer link has expired. Please contact the sender for a new invitation.</p>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (err.status === 403) {
      return (
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-8 text-center">
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Not For Your Company</h2>
              <p className="text-muted-foreground text-sm">This job offer was sent to a different company. Make sure you're logged in with the correct account.</p>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (err.status === 400 && err.status) {
      const finalStatus = err.status === "accepted" ? "accepted" : err.status === "declined" ? "declined" : err.status;
      return (
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-8 text-center">
              {finalStatus === "accepted" ? (
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              ) : (
                <XCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              )}
              <h2 className="text-lg font-semibold mb-2">
                {finalStatus === "accepted" ? "Already Accepted" : "Already Declined"}
              </h2>
              <p className="text-muted-foreground text-sm">
                This job offer has already been {finalStatus}.
              </p>
              <Button variant="outline" className="mt-4" onClick={() => setLocation("/subcontractors")}>
                Go to Contractors
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Error</h2>
            <p className="text-muted-foreground text-sm">{err.error || "Failed to load this invite. Please try again."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (actionTaken === "accepted") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Job Accepted!</h2>
            <p className="text-muted-foreground text-sm mb-6">
              The job has been transferred to your company. You can now manage it from your jobs list.
            </p>
            {acceptedJobId && (
              <Button onClick={() => setLocation(`/jobs/${acceptedJobId}`)} className="gap-2">
                Go to Job <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (actionTaken === "declined") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 text-center">
            <XCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Offer Declined</h2>
            <p className="text-muted-foreground text-sm mb-6">
              You've declined this job offer. The sender will be notified.
            </p>
            <Button variant="outline" onClick={() => setLocation("/subcontractors")}>
              Back to Contractors
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const feeDisplay = data.referralType === "percent"
    ? `${data.referralValue}%`
    : `$${parseFloat(data.referralValue).toFixed(2)}`;

  const senderLocation = [data.senderCompanyCity, data.senderCompanyState].filter(Boolean).join(", ");

  return (
    <div className="min-h-[60vh] px-4 py-6 max-w-lg mx-auto">
      <div className="text-center mb-6">
        <Badge variant="secondary" className="mb-3 text-sm px-3 py-1">Job Offer</Badge>
        <h1 className="text-2xl font-bold text-foreground">You've received a job offer</h1>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">{data.senderCompanyName || "Unknown Company"}</CardTitle>
              {senderLocation && (
                <p className="text-sm text-muted-foreground">{senderLocation}</p>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {data.job && (
        <Card className="mb-4">
          <CardContent className="pt-5 space-y-4">
            <div>
              <h3 className="font-semibold text-base mb-1">{data.job.title}</h3>
              {data.job.description && (
                <p className="text-sm text-muted-foreground">{data.job.description}</p>
              )}
            </div>

            {data.customerName && (
              <div className="flex items-start gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Customer</p>
                  <p className="text-sm text-muted-foreground">{data.customerName}</p>
                </div>
              </div>
            )}

            {data.customerAddress && (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Address</p>
                  <p className="text-sm text-muted-foreground">{data.customerAddress}</p>
                  <a
                    href={`https://maps.apple.com/?q=${encodeURIComponent(data.customerAddress)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1 inline-block"
                  >
                    Open in Maps
                  </a>
                </div>
              </div>
            )}

            {(data.job.scheduledDate || data.job.scheduledTime) && (
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Schedule</p>
                  <p className="text-sm text-muted-foreground">
                    {[data.job.scheduledDate, data.job.scheduledTime].filter(Boolean).join(" at ")}
                  </p>
                </div>
              </div>
            )}

            {data.job.estimatedCost && data.allowPriceChange && (
              <div className="flex items-start gap-3">
                <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Estimated Cost</p>
                  <p className="text-sm text-muted-foreground">${parseFloat(data.job.estimatedCost).toFixed(2)}</p>
                </div>
              </div>
            )}

            {data.job.notes && (
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Notes</p>
                  <p className="text-sm text-muted-foreground">{data.job.notes}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.message && (
        <Card className="mb-4">
          <CardContent className="pt-5">
            <p className="text-sm font-medium mb-1">Message from sender</p>
            <p className="text-sm text-muted-foreground italic">"{data.message}"</p>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Referral Fee</span>
            <Badge variant="outline" className="text-sm">{feeDisplay} {data.referralType === "percent" ? "of job value" : "flat fee"}</Badge>
          </div>
          {data.job?.estimatedCost && parseFloat(data.job.estimatedCost) > 0 && (
            <div className="flex items-center justify-between pt-1 border-t">
              <span className="text-sm font-medium">Estimated Earnings</span>
              <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                ${data.referralType === "percent"
                  ? (parseFloat(data.job.estimatedCost) * (1 - parseFloat(data.referralValue) / 100)).toFixed(2)
                  : (parseFloat(data.job.estimatedCost) - parseFloat(data.referralValue)).toFixed(2)
                }
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => declineMutation.mutate()}
          disabled={declineMutation.isPending || acceptMutation.isPending}
        >
          {declineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Decline
        </Button>
        <Button
          className="flex-1 bg-green-600 hover:bg-green-700"
          onClick={() => acceptMutation.mutate()}
          disabled={acceptMutation.isPending || declineMutation.isPending}
        >
          {acceptMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Accept Job
        </Button>
      </div>
    </div>
  );
}
