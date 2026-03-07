import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Building2, UserCheck, Mail, Phone, Globe, Calendar,
  Briefcase, DollarSign, Clock, CheckCircle, XCircle, Inbox, ArrowUpRight,
  Loader2,
} from "lucide-react";
import type { Subcontractor } from "@shared/schema";

interface ContractorDetailProps {
  contractorId: string;
}

const STATUS_CONFIG: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending: { color: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400", icon: Clock, label: "Pending" },
  accepted: { color: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400", icon: CheckCircle, label: "Accepted" },
  declined: { color: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400", icon: XCircle, label: "Declined" },
  completed: { color: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400", icon: CheckCircle, label: "Completed" },
};

function feeBadge(type: string, value: string) {
  const v = parseFloat(value || '0');
  if (type === 'percent') return `${v}%`;
  return `$${v.toFixed(2)}`;
}

export default function ContractorDetail({ contractorId }: ContractorDetailProps) {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data: contractor, isLoading, error } = useQuery<Subcontractor>({
    queryKey: [`/api/subcontractors/${contractorId}`],
    enabled: !!contractorId && isAuthenticated,
  });

  const { data: referralData } = useQuery<{ incoming: any[]; outgoing: any[] }>({
    queryKey: [`/api/subcontractors/${contractorId}/referrals`],
    enabled: !!contractorId && isAuthenticated,
  });

  const incoming = referralData?.incoming || [];
  const outgoing = referralData?.outgoing || [];

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !contractor) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Contractor not found</h2>
          <p className="text-slate-600 dark:text-slate-400 mt-2">The contractor you're looking for doesn't exist.</p>
          <Button onClick={() => navigate('/subcontractors')} className="mt-4">
            Back to Contractors
          </Button>
        </div>
      </div>
    );
  }

  const displayName = contractor.companyName || contractor.name || 'Unknown';
  const personalName = (contractor.companyName && contractor.name && contractor.name !== contractor.companyName)
    ? contractor.name : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/subcontractors')}
          className="h-10 w-10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {displayName}
          </h1>
          {personalName && (
            <p className="text-slate-600 dark:text-slate-400">{personalName}</p>
          )}
        </div>
      </div>

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
              <a href={`mailto:${contractor.email}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400">
                {contractor.email}
              </a>
            </div>
          )}
          {contractor.phone && (
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-slate-400" />
              <a href={`tel:${contractor.phone}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400">
                {contractor.phone}
              </a>
            </div>
          )}
          {contractor.companyWebsite && (
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-slate-400" />
              <a href={contractor.companyWebsite} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 dark:text-blue-400">
                {contractor.companyWebsite.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
          {contractor.createdAt && (
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-slate-400" />
              <span className="text-slate-500 dark:text-slate-400 text-sm">Added {new Date(contractor.createdAt).toLocaleDateString()}</span>
            </div>
          )}
          {!contractor.email && !contractor.phone && !contractor.companyWebsite && !personalName && (
            <p className="text-slate-500 italic">No contact information available</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ArrowUpRight className="h-5 w-5 text-blue-600" />
            Referral Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {incoming.length === 0 && outgoing.length === 0 ? (
            <div className="flex flex-col items-center py-8">
              <Inbox className="h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No referral activity with this contractor yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {outgoing.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sent</h4>
                  {outgoing.map((ref: any) => {
                    const sc = STATUS_CONFIG[ref.status] || STATUS_CONFIG.pending;
                    const StatusIcon = sc.icon;
                    return (
                      <div key={ref.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {ref.jobTitle || 'Untitled Job'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-[11px] font-bold px-2 py-0.5 rounded-full">
                            {feeBadge(ref.referralType, ref.referralValue)}
                          </span>
                          <span className={`${sc.color} text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {incoming.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Received</h4>
                  {incoming.map((ref: any) => {
                    const sc = STATUS_CONFIG[ref.status] || STATUS_CONFIG.pending;
                    const StatusIcon = sc.icon;
                    return (
                      <div key={ref.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {ref.jobTitle || 'Untitled Job'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-[11px] font-bold px-2 py-0.5 rounded-full">
                            {feeBadge(ref.referralType, ref.referralValue)}
                          </span>
                          <span className={`${sc.color} text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}