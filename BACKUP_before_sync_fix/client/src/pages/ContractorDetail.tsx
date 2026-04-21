import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { formatDollarAmount } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Building2, UserCheck, Mail, Phone, Globe, Calendar,
  Briefcase, DollarSign, Clock, CheckCircle, XCircle, Inbox,
  ArrowUpRight, Loader2, MapPin, User, SendHorizonal, Download,
} from "lucide-react";
import type { Subcontractor } from "@shared/schema";

interface ContractorDetailProps {
  contractorId: string;
}

interface ReferralActivityItem {
  id: number;
  jobId: number;
  status: string;
  referralType: string;
  referralValue: string;
  message: string | null;
  createdAt: string;
  acceptedAt: string | null;
  inviteSentTo: string | null;
  jobTotalAtAcceptanceCents: number | null;
  contractorPayoutAmountCents: number | null;
  companyShareAmountCents: number | null;
  jobTitle: string | null;
  jobStatus: string | null;
  jobLocation: string | null;
  jobStartDate: string | null;
  jobScheduledTime: string | null;
  jobEstimatedCost: string | null;
  customerName: string | null;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string; icon: typeof Clock }> = {
  pending:   { bg: "bg-amber-50 dark:bg-amber-950/40",  text: "text-amber-700 dark:text-amber-400",  label: "Pending",   icon: Clock },
  accepted:  { bg: "bg-green-50 dark:bg-green-950/40",  text: "text-green-700 dark:text-green-400",  label: "Accepted",  icon: CheckCircle },
  declined:  { bg: "bg-red-50 dark:bg-red-950/40",      text: "text-red-700 dark:text-red-400",      label: "Declined",  icon: XCircle },
  completed: { bg: "bg-blue-50 dark:bg-blue-950/40",    text: "text-blue-700 dark:text-blue-400",    label: "Completed", icon: CheckCircle },
};

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${display}:${m} ${ampm}`;
  } catch {
    return timeStr;
  }
}

function feeBadge(type: string, value: string) {
  const v = parseFloat(value || "0");
  return type === "percent" ? `${v}%` : formatDollarAmount(v);
}

function ReferralCard({ item, direction }: { item: ReferralActivityItem; direction: "sent" | "received" }) {
  const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
  const StatusIcon = sc.icon;
  const payout = direction === "received"
    ? item.contractorPayoutAmountCents
    : item.companyShareAmountCents;
  const payoutLabel = direction === "received" ? "You received" : "Your share";

  return (
    <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      {/* Top row: job title + status */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 truncate">
              {item.jobTitle || "Untitled Job"}
            </p>
          </div>
          {item.customerName && (
            <div className="flex items-center gap-1.5 mt-1">
              <User className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.customerName}</p>
            </div>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 shrink-0 mt-0.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${sc.bg} ${sc.text}`}>
          <StatusIcon className="w-3 h-3" />
          {sc.label}
        </span>
      </div>

      {/* Meta row */}
      <div className="px-4 pb-3 space-y-1.5">
        {item.jobLocation && (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.jobLocation}</p>
          </div>
        )}
        {item.jobStartDate && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatDate(item.jobStartDate)}
              {item.jobScheduledTime ? ` at ${formatTime(item.jobScheduledTime)}` : ""}
            </p>
          </div>
        )}
        {item.createdAt && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Sent {formatDate(item.createdAt)}
            </p>
          </div>
        )}
      </div>

      {/* Bottom row: referral fee + payout */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
        <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 rounded-full">
          {feeBadge(item.referralType, item.referralValue)} referral
        </span>
        {payout != null && payout > 0 ? (
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {payoutLabel}: {formatCents(payout)}
          </span>
        ) : item.jobTotalAtAcceptanceCents && item.jobTotalAtAcceptanceCents > 0 ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Job: {formatCents(item.jobTotalAtAcceptanceCents)}
          </span>
        ) : item.jobEstimatedCost && parseFloat(item.jobEstimatedCost) > 0 ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Est. ${parseFloat(item.jobEstimatedCost).toFixed(0)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: "sent" | "received" }) {
  return (
    <div className="flex flex-col items-center py-10">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
        {tab === "sent"
          ? <SendHorizonal className="w-5 h-5 text-slate-400 dark:text-slate-500" />
          : <Download className="w-5 h-5 text-slate-400 dark:text-slate-500" />
        }
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
        {tab === "sent" ? "No jobs sent to this contractor yet." : "No jobs received from this contractor yet."}
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
        {tab === "sent" ? "Sent job offers will appear here." : "Job offers from this contractor will appear here."}
      </p>
    </div>
  );
}

export default function ContractorDetail({ contractorId }: ContractorDetailProps) {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [activityTab, setActivityTab] = useState<"sent" | "received">("sent");

  const { data: contractor, isLoading, error } = useQuery<Subcontractor>({
    queryKey: [`/api/subcontractors/${contractorId}`],
    enabled: !!contractorId && isAuthenticated,
  });

  const { data: referralData, isLoading: referralsLoading } = useQuery<{ sent: ReferralActivityItem[]; received: ReferralActivityItem[] }>({
    queryKey: [`/api/subcontractors/${contractorId}/referrals`],
    enabled: !!contractorId && isAuthenticated,
  });

  const sent = referralData?.sent || [];
  const received = referralData?.received || [];
  const activeList = activityTab === "sent" ? sent : received;

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !contractor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Contractor not found</h2>
          <p className="text-slate-600 dark:text-slate-400 mt-2">The contractor you're looking for doesn't exist.</p>
          <Button onClick={() => navigate("/subcontractors")} className="mt-4">
            Back to Contractors
          </Button>
        </div>
      </div>
    );
  }

  const displayName = contractor.companyName || contractor.name || "Unknown";
  const personalName =
    contractor.companyName && contractor.name && contractor.name !== contractor.companyName
      ? contractor.name
      : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/subcontractors")} className="h-10 w-10">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{displayName}</h1>
          {personalName && <p className="text-slate-600 dark:text-slate-400">{personalName}</p>}
        </div>
      </div>

      {/* Contractor info card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-blue-600" />
            Contractor Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {personalName && (
            <div className="flex items-center gap-3">
              <UserCheck className="h-4 w-4 text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300">{personalName}</span>
            </div>
          )}
          {contractor.email && (
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-slate-400" />
              <a href={`mailto:${contractor.email.trim()}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                {contractor.email.trim()}
              </a>
            </div>
          )}
          {contractor.phone && (
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-slate-400" />
              <a href={`tel:${contractor.phone.replace(/[\s()-]/g, "")}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                {contractor.phone}
              </a>
            </div>
          )}
          {contractor.companyWebsite && (
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-slate-400" />
              <a
                href={contractor.companyWebsite.match(/^https?:\/\//) ? contractor.companyWebsite : `https://${contractor.companyWebsite}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {contractor.companyWebsite.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
          {contractor.createdAt && (
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-slate-400" />
              <span className="text-slate-500 dark:text-slate-400 text-sm">
                Added {new Date(contractor.createdAt).toLocaleDateString()}
              </span>
            </div>
          )}
          {!contractor.email && !contractor.phone && !contractor.companyWebsite && !personalName && (
            <p className="text-slate-500 italic">No contact information available</p>
          )}
        </CardContent>
      </Card>

      {/* Referral Activity card with tabs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg mb-3">
            <ArrowUpRight className="h-5 w-5 text-blue-600" />
            Referral Activity
          </CardTitle>

          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
            <button
              onClick={() => setActivityTab("sent")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activityTab === "sent"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              Sent {sent.length > 0 ? `(${sent.length})` : ""}
            </button>
            <button
              onClick={() => setActivityTab("received")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activityTab === "received"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              Received {received.length > 0 ? `(${received.length})` : ""}
            </button>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {referralsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300 dark:text-slate-600" />
            </div>
          ) : activeList.length === 0 ? (
            <EmptyState tab={activityTab} />
          ) : (
            <div className="space-y-3">
              {activeList.map((item) => (
                <ReferralCard key={item.id} item={item} direction={activityTab} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
