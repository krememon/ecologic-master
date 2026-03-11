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
  Clock, User, Phone, Mail, Tag, MessageSquare, List,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface LineItemData {
  name: string;
  description: string | null;
  quantity: string;
  unitPriceCents: number;
  unit: string;
  lineTotalCents: number;
}

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
  jobTotalCents: number | null;
  receiverShareCents: number | null;
  senderShareCents: number | null;
  lineItems: LineItemData[] | null;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
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

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider leading-none">{label}</p>
        <p className="text-[14px] text-slate-800 dark:text-slate-200 mt-1 leading-snug whitespace-pre-wrap">{value}</p>
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
  const jobAddress = data.job?.location || data.customerAddress || null;
  const dateStr = data.job?.startDate ? formatDate(data.job.startDate) : null;
  const startTimeStr = data.job?.scheduledTime ? formatTime(data.job.scheduledTime) : null;
  const endTimeStr = data.job?.scheduledEndTime ? formatTime(data.job.scheduledEndTime) : null;
  const hasPaymentBreakdown = data.jobTotalCents && data.jobTotalCents > 0;

  return (
    <div className="min-h-[60vh] px-4 py-6 max-w-lg mx-auto space-y-4">

      {/* Header */}
      <div className="text-center pb-1">
        <Badge variant="secondary" className="mb-3 text-xs px-3 py-1 font-medium">Job Offer</Badge>
        <h1 className="text-xl font-bold text-foreground">You've received a job offer</h1>
      </div>

      {/* 1. Company card */}
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
                  const fallback = (e.target as HTMLImageElement).nextElementSibling;
                  if (fallback) fallback.classList.remove("hidden");
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

      {/* 2. Job details card */}
      {data.job && (
        <Card>
          <CardContent className="p-4">
            <div className="pb-3 mb-1 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100 leading-tight">{data.job.title}</h3>
              {data.job.jobType && (
                <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-md px-2 py-0.5 uppercase tracking-wider">
                  <Tag className="w-3 h-3" />
                  {data.job.jobType}
                </span>
              )}
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {data.job.description && (
                <DetailRow icon={FileText} label="Description" value={data.job.description} />
              )}
              {data.customerName && (
                <DetailRow icon={User} label="Customer" value={data.customerName} />
              )}
              {jobAddress && (
                <DetailRow icon={MapPin} label="Service Address" value={jobAddress} />
              )}
              {dateStr && (
                <DetailRow icon={Calendar} label="Date" value={dateStr} />
              )}
              {startTimeStr && (
                <DetailRow
                  icon={Clock}
                  label={endTimeStr ? "Start Time" : "Time"}
                  value={startTimeStr}
                />
              )}
              {endTimeStr && (
                <DetailRow icon={Clock} label="End Time" value={endTimeStr} />
              )}
              {data.customerPhone && (
                <DetailRow icon={Phone} label="Contact Phone" value={data.customerPhone} />
              )}
              {data.customerEmail && (
                <DetailRow icon={Mail} label="Contact Email" value={data.customerEmail} />
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
                <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider leading-none">Message from sender</p>
                <p className="text-[14px] text-slate-700 dark:text-slate-300 mt-1.5 italic leading-snug">"{data.message}"</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. Line items card */}
      {data.lineItems && data.lineItems.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <List className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <h4 className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Line Items</h4>
            </div>
          </div>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {data.lineItems.map((item, idx) => {
                const qty = parseFloat(item.quantity);
                const qtyDisplay = qty === Math.floor(qty) ? String(Math.floor(qty)) : qty.toFixed(2);
                return (
                  <div key={idx} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-slate-800 dark:text-slate-200 leading-snug">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                        )}
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                          {qtyDisplay} {item.unit} × {formatCents(item.unitPriceCents)}
                        </p>
                      </div>
                      <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap flex-shrink-0 pt-0.5">
                        {formatCents(item.lineTotalCents)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {hasPaymentBreakdown && (
              <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Total</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{formatCents(data.jobTotalCents!)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4. Payment breakdown card */}
      <Card className="border-emerald-200/60 dark:border-emerald-800/30 overflow-hidden">
        <div className="bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 border-b border-emerald-100 dark:border-emerald-900/30">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">Payment Breakdown</h4>
          </div>
        </div>
        <CardContent className="p-4 space-y-0">
          {hasPaymentBreakdown ? (
            <div className="space-y-0 divide-y divide-slate-100 dark:divide-slate-800/60">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-slate-600 dark:text-slate-400">Job Price</span>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formatCents(data.jobTotalCents!)}</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-slate-600 dark:text-slate-400">Referral Rate</span>
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{feeDisplay}</span>
              </div>
              {data.receiverShareCents != null && (
                <div className="flex items-center justify-between py-3 -mx-4 px-4 bg-emerald-50 dark:bg-emerald-950/30">
                  <span className="text-[14px] font-semibold text-emerald-700 dark:text-emerald-400">Contractor Gets</span>
                  <span className="text-[16px] font-bold text-emerald-700 dark:text-emerald-300">{formatCents(data.receiverShareCents)}</span>
                </div>
              )}
              {data.senderShareCents != null && (
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-slate-500 dark:text-slate-500">Your Share</span>
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-500">{formatCents(data.senderShareCents)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-600 dark:text-slate-400">Referral Fee</span>
                <Badge className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 text-sm font-semibold px-3 py-1">
                  {feeDisplay} {data.referralType === "percent" ? "of job value" : "flat fee"}
                </Badge>
              </div>
              {data.job?.estimatedCost && data.allowPriceChange && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Estimated Cost</span>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">${parseFloat(data.job.estimatedCost).toFixed(2)}</span>
                </div>
              )}
              <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">Final payout will be calculated when the job is invoiced and paid.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Action buttons */}
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
