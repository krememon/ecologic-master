import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Building2, MapPin, Calendar, DollarSign, FileText,
  CheckCircle2, XCircle, AlertTriangle, ArrowRight, LogIn,
  Clock, User, Phone, Mail, Briefcase, MessageSquare, Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface JobOfferData {
  referralId: number;
  jobId: number;
  status: string;
  referralType: string;
  referralValue: string;
  message: string | null;
  allowPriceChange: boolean;
  senderCompanyName: string | null;
  senderCompanyCity: string | null;
  senderCompanyState: string | null;
  senderCompanyLogo: string | null;
  tokenValid: boolean;
  job: {
    id: number;
    title: string;
    status: string;
    description: string | null;
    startDate: string | null;
    scheduledTime: string | null;
    scheduledEndTime: string | null;
    estimatedCost: string | null;
    location: string | null;
    jobType: string | null;
    priority: string | null;
    notes: string | null;
  } | null;
  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${m} ${ampm}`;
  } catch {
    return timeStr;
  }
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-slate-800 dark:text-slate-200 mt-0.5 whitespace-pre-wrap">{value}</p>
      </div>
    </div>
  );
}

export default function JobOffer() {
  const [, params] = useRoute("/job-offer/:jobId/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const jobId = params?.jobId || "";
  const token = params?.token || "";
  const [actionTaken, setActionTaken] = useState<"accepted" | "declined" | null>(null);
  const [acceptedJobId, setAcceptedJobId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<JobOfferData>({
    queryKey: ["/api/job-offer", jobId, token],
    queryFn: async () => {
      const res = await fetch(`/api/job-offer/${jobId}/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw { status: res.status, ...body };
      }
      return res.json();
    },
    enabled: !!jobId && !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/job-offer/${jobId}/accept`, { token });
      return res.json();
    },
    onSuccess: (result) => {
      setActionTaken("accepted");
      setAcceptedJobId(result.job?.id || parseInt(jobId) || null);
      queryClient.invalidateQueries({ queryKey: ["/api/job-offer", jobId, token] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/incoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job offer accepted", description: "The job has been transferred to your company." });
    },
    onError: (err: any) => {
      if (err.message?.includes("401") || err.message?.includes("Unauthorized")) {
        toast({ title: "Login required", description: "Please log in to accept this job offer.", variant: "destructive" });
      } else {
        toast({ title: "Failed to accept", description: err.message || "Something went wrong.", variant: "destructive" });
      }
    },
  });

  const declineMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/job-offer/${jobId}/decline`, { token });
      return res.json();
    },
    onSuccess: () => {
      setActionTaken("declined");
      queryClient.invalidateQueries({ queryKey: ["/api/job-offer", jobId, token] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/incoming"] });
      toast({ title: "Job offer declined" });
    },
    onError: (err: any) => {
      if (err.message?.includes("401") || err.message?.includes("Unauthorized")) {
        toast({ title: "Login required", description: "Please log in to decline this job offer.", variant: "destructive" });
      } else {
        toast({ title: "Failed to decline", description: err.message || "Something went wrong.", variant: "destructive" });
      }
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
    if (err.status === 410) {
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
              <h2 className="text-lg font-semibold mb-2">Invalid Token</h2>
              <p className="text-muted-foreground text-sm">This job offer link is not valid. Please check the link or contact the sender.</p>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (err.error?.includes?.("already")) {
      return (
        <div className="flex items-center justify-center min-h-[60vh] px-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Already Responded</h2>
              <p className="text-muted-foreground text-sm">This job offer has already been responded to.</p>
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
            <p className="text-muted-foreground text-sm">{err.error || "Failed to load this job offer. Please try again."}</p>
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

  const scheduleStr = (() => {
    const parts: string[] = [];
    if (data.job?.startDate) parts.push(formatDate(data.job.startDate));
    if (data.job?.scheduledTime) {
      let timeStr = formatTime(data.job.scheduledTime);
      if (data.job.scheduledEndTime) timeStr += ` – ${formatTime(data.job.scheduledEndTime)}`;
      parts.push(timeStr);
    }
    return parts.join(" · ");
  })();

  const jobAddress = data.job?.location || data.customerAddress || null;

  return (
    <div className="min-h-[60vh] px-4 py-6 max-w-lg mx-auto space-y-4">

      {/* Header badge */}
      <div className="text-center pb-1">
        <Badge variant="secondary" className="mb-3 text-xs px-3 py-1 font-medium">Job Offer</Badge>
        <h1 className="text-xl font-bold text-foreground">You've received a job offer</h1>
      </div>

      {/* Company card */}
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center gap-3.5">
            {data.senderCompanyLogo ? (
              <img
                src={data.senderCompanyLogo}
                alt={data.senderCompanyName || "Company"}
                className="w-12 h-12 rounded-xl object-cover bg-slate-100 dark:bg-slate-800 flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                }}
              />
            ) : null}
            <div
              className={`w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 ${data.senderCompanyLogo ? "hidden" : ""}`}
            >
              <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                {data.senderCompanyName || "Unknown Company"}
              </p>
              {senderLocation && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {senderLocation}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Job details card */}
      {data.job && (
        <Card>
          <CardContent className="p-4 space-y-0">
            {/* Job title header */}
            <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{data.job.title}</h3>
              {data.job.jobType && (
                <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-md px-2 py-0.5">
                  <Tag className="w-3 h-3" />
                  {data.job.jobType}
                </span>
              )}
            </div>

            {/* Detail rows */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.job.description && (
                <DetailRow icon={FileText} label="Description" value={data.job.description} />
              )}
              {data.customerName && (
                <DetailRow icon={User} label="Customer" value={data.customerName} />
              )}
              {jobAddress && (
                <DetailRow icon={MapPin} label="Address" value={jobAddress} />
              )}
              {scheduleStr && (
                <DetailRow icon={Calendar} label="Schedule" value={scheduleStr} />
              )}
              {data.customerPhone && (
                <DetailRow icon={Phone} label="Contact Phone" value={data.customerPhone} />
              )}
              {data.customerEmail && (
                <DetailRow icon={Mail} label="Contact Email" value={data.customerEmail} />
              )}
              {data.job.estimatedCost && data.allowPriceChange && (
                <DetailRow icon={DollarSign} label="Estimated Cost" value={`$${parseFloat(data.job.estimatedCost).toFixed(2)}`} />
              )}
              {data.job.notes && (
                <DetailRow icon={FileText} label="Notes" value={data.job.notes} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Message from sender */}
      {data.message && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Message from sender</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 mt-1 italic">"{data.message}"</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Referral fee */}
      <Card className="border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Referral Fee</span>
            </div>
            <Badge className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100 text-sm font-semibold px-3 py-1">
              {feeDisplay} {data.referralType === "percent" ? "of job value" : "flat fee"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="pt-2 pb-4">
        {!isAuthenticated ? (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground">Log in to accept or decline this job offer</p>
            <Button
              className="w-full h-12 rounded-xl text-[15px] font-medium"
              onClick={() => setLocation(`/login?redirect=/job-offer/${jobId}/${token}`)}
            >
              <LogIn className="h-4 w-4 mr-2" />
              Log In to Respond
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-12 rounded-xl text-[15px] font-medium border-slate-200 dark:border-slate-700"
              onClick={() => declineMutation.mutate()}
              disabled={declineMutation.isPending || acceptMutation.isPending}
            >
              {declineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Decline
            </Button>
            <Button
              className="h-12 rounded-xl text-[15px] font-medium bg-green-600 hover:bg-green-700"
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending || declineMutation.isPending}
            >
              {acceptMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Accept Job
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
