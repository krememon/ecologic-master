import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { useCan } from "@/hooks/useCan";
import { 
  Briefcase, 
  FileText, 
  DollarSign, 
  AlertCircle,
  ChevronRight,
  Loader2,
  Calendar,
  Users,
  ClipboardList
} from "lucide-react";
import { format, isToday, isTomorrow, parseISO, startOfDay, subDays, isAfter } from "date-fns";
import type { Job, Lead, Estimate, Invoice, Customer } from "@shared/schema";

interface JobWithClient extends Job {
  client?: { id: number; name: string } | null;
  customer?: Customer | null;
}

interface LeadWithCustomer extends Lead {
  customer?: Customer | null;
}

interface InvoiceWithDetails extends Invoice {
  customer?: Customer | null;
}

export default function Home() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { role } = useCan();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: jobs = [], isLoading: jobsLoading, isError: jobsError } = useQuery<JobWithClient[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  const { data: leads = [], isLoading: leadsLoading, isError: leadsError } = useQuery<LeadWithCustomer[]>({
    queryKey: ["/api/leads"],
    enabled: isAuthenticated && role !== 'TECHNICIAN',
  });

  const { data: estimates = [], isLoading: estimatesLoading, isError: estimatesError } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
    enabled: isAuthenticated && role !== 'TECHNICIAN',
  });

  const { data: invoices = [], isLoading: invoicesLoading, isError: invoicesError } = useQuery<InvoiceWithDetails[]>({
    queryKey: ["/api/invoices"],
    enabled: isAuthenticated && (role === 'OWNER' || role === 'SUPERVISOR'),
  });

  const hasDataError = jobsError || (role !== 'TECHNICIAN' && leadsError) || (role !== 'TECHNICIAN' && estimatesError) || ((role === 'OWNER' || role === 'SUPERVISOR') && invoicesError);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';
  const isOwner = role === 'OWNER';
  const canSeeLeads = role !== 'TECHNICIAN';
  const canSeeEstimates = role !== 'TECHNICIAN';
  const isTechnician = role === 'TECHNICIAN';
  const isEstimator = role === 'ESTIMATOR';
  const userId = user?.id;

  const today = startOfDay(new Date());
  const sevenDaysAgo = subDays(today, 7);
  
  const getJobDate = (job: JobWithClient): Date | null => {
    if (job.startDate) {
      return parseISO(job.startDate as unknown as string);
    }
    return null;
  };

  const isAssignedToMe = (job: JobWithClient): boolean => {
    if (!userId) return false;
    return job.assignedTo === userId;
  };

  const myJobs = isTechnician 
    ? jobs.filter(job => isAssignedToMe(job))
    : jobs;

  const jobsToday = myJobs.filter(job => {
    const date = getJobDate(job);
    return date && isToday(date) && job.status !== 'completed' && job.status !== 'cancelled';
  });

  const openJobs = myJobs.filter(job => 
    job.status !== 'completed' && job.status !== 'cancelled'
  );

  const leadsInFlow = leads.filter(lead => 
    lead.status !== 'won' && lead.status !== 'lost'
  );

  const draftEstimates = estimates.filter(estimate => 
    estimate.status === 'draft'
  );

  const openEstimates = estimates.filter(estimate => 
    estimate.status === 'draft' || estimate.status === 'sent'
  );

  const outstandingInvoices = invoices.filter(invoice => 
    invoice.status !== 'paid' && invoice.status !== 'cancelled'
  );

  const pulseLoading = isOwner && (invoicesLoading || leadsLoading);
  const pulseError = isOwner && (invoicesError || leadsError);

  const pulseMetrics = (() => {
    if (!isOwner) return null;
    if (pulseLoading || pulseError) return null;

    try {
      const paidInvoices7d = invoices.filter(inv => {
        if (inv.status !== 'paid' || !inv.paidAt) return false;
        const paidDate = parseISO(inv.paidAt as unknown as string);
        return isAfter(paidDate, sevenDaysAgo);
      });

      const revenue7d = paidInvoices7d.reduce((sum, inv) => {
        const amount = inv.totalCents || 0;
        return sum + amount;
      }, 0);

      const invoicesPaid7d = paidInvoices7d.length;

      const leadsCreated7d = leads.filter(lead => {
        if (!lead.createdAt) return false;
        const createdDate = parseISO(lead.createdAt as unknown as string);
        return isAfter(createdDate, sevenDaysAgo);
      });

      const leadsWon7dCount = leadsCreated7d.filter(lead => lead.status === 'won').length;
      const leadsCreated7dCount = leadsCreated7d.length;
      const winRate7d = leadsCreated7dCount > 0 ? Math.round((leadsWon7dCount / leadsCreated7dCount) * 100) : null;

      return {
        revenue7d,
        invoicesPaid7d,
        leadsCreated7d: leadsCreated7dCount,
        leadsWon7d: leadsWon7dCount,
        winRate7d,
        hasData: true,
      };
    } catch {
      return null;
    }
  })();

  const todayJobs = myJobs
    .filter(job => {
      const date = getJobDate(job);
      return date && isToday(date) && job.status !== 'completed' && job.status !== 'cancelled';
    })
    .sort((a, b) => {
      const dateA = getJobDate(a);
      const dateB = getJobDate(b);
      if (!dateA || !dateB) return 0;
      return dateA.getTime() - dateB.getTime();
    });

  const upcomingJobs = myJobs
    .filter(job => {
      const date = getJobDate(job);
      if (!date) return false;
      return date > today && job.status !== 'completed' && job.status !== 'cancelled';
    })
    .sort((a, b) => {
      const dateA = getJobDate(a);
      const dateB = getJobDate(b);
      if (!dateA || !dateB) return 0;
      return dateA.getTime() - dateB.getTime();
    })
    .slice(0, 5);

  const dataLoading = jobsLoading || (canSeeLeads && leadsLoading) || (canSeeEstimates && estimatesLoading) || (isAdmin && invoicesLoading);

  const statusStripItems: Array<{ icon: React.ElementType; value: number; label: string; route: string }> = [];
  
  if (!isEstimator) {
    statusStripItems.push({ icon: Calendar, value: jobsToday.length, label: 'Jobs Today', route: '/jobs' });
    statusStripItems.push({ icon: Briefcase, value: openJobs.length, label: 'Open Jobs', route: '/jobs' });
  }
  
  if (canSeeLeads) {
    statusStripItems.push({ icon: Users, value: leadsInFlow.length, label: 'Leads In Flow', route: '/leads' });
  }
  
  if (canSeeEstimates) {
    statusStripItems.push({ icon: ClipboardList, value: draftEstimates.length, label: 'Draft Estimates', route: '/jobs?tab=estimates' });
  }

  const greeting = getGreeting();
  const firstName = user?.firstName || 'there';
  const dateDisplay = format(new Date(), 'EEEE · MMM d');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-24">
      <div className="px-4 pt-6 pb-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">{dateDisplay}</p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
          {greeting}, {firstName}
        </h1>
      </div>

      {hasDataError && (
        <div className="px-4 mb-4">
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50">
            <CardContent className="p-3 flex items-center gap-3">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-amber-700 dark:text-amber-300 text-sm">
                Some data couldn't be loaded
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {dataLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="mb-6 overflow-x-auto scrollbar-hide">
            <div className="flex gap-3 px-4 pb-1">
              {statusStripItems.map((item, index) => (
                <StatusPill
                  key={index}
                  icon={item.icon}
                  value={item.value}
                  label={item.label}
                  onClick={() => navigate(item.route)}
                />
              ))}
            </div>
          </div>

          <div className="px-4 mb-6">
            <h2 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
              Today
            </h2>
            {todayJobs.length === 0 ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="py-8 text-center">
                  <Calendar className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    No jobs scheduled today
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {todayJobs.map(job => (
                  <JobCard
                    key={job.id}
                    title={job.title || `Job #${job.id}`}
                    status={job.status}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="px-4 mb-6">
            <h2 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
              Business Snapshot
            </h2>
            <div className="space-y-2">
              <SnapshotRow
                icon={Briefcase}
                label="Open Jobs"
                value={openJobs.length}
                onClick={() => navigate('/jobs')}
              />
              {canSeeEstimates && (
                <SnapshotRow
                  icon={FileText}
                  label="Open Estimates"
                  value={openEstimates.length}
                  onClick={() => navigate('/jobs?tab=estimates')}
                />
              )}
              {isAdmin && (
                <SnapshotRow
                  icon={DollarSign}
                  label="Outstanding Invoices"
                  value={outstandingInvoices.length}
                  onClick={() => navigate('/invoicing')}
                />
              )}
            </div>
          </div>

          {isOwner && (
            <div className="px-4 mb-6">
              <Card 
                className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate('/leads')}
              >
                <CardContent className="p-5">
                  {pulseLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  ) : pulseError ? (
                    <div className="flex items-center justify-center py-4 text-slate-400">
                      <span className="text-sm">Data unavailable</span>
                    </div>
                  ) : pulseMetrics ? (
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
                          Leads · This Week
                        </p>
                        <div className="flex gap-8">
                          <div>
                            <p className="text-3xl font-bold text-slate-900 dark:text-white">
                              {pulseMetrics.leadsCreated7d}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Created</p>
                          </div>
                          <div>
                            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                              {pulseMetrics.leadsWon7d}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Won</p>
                          </div>
                        </div>
                      </div>
                      <WinRateRing percentage={pulseMetrics.winRate7d} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          {upcomingJobs.length > 0 && (
            <div className="px-4 mb-6">
              <h2 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                Upcoming
              </h2>
              <div className="space-y-2">
                {upcomingJobs.map(job => {
                  const jobDate = getJobDate(job);
                  let dateLabel = '';
                  if (jobDate) {
                    if (isTomorrow(jobDate)) {
                      dateLabel = 'Tomorrow';
                    } else {
                      dateLabel = format(jobDate, 'EEE, MMM d');
                    }
                  }
                  return (
                    <JobCard
                      key={job.id}
                      title={job.title || `Job #${job.id}`}
                      subtitle={dateLabel}
                      status={job.status}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function StatusPill({ 
  icon: Icon, 
  value, 
  label, 
  onClick 
}: { 
  icon: React.ElementType; 
  value: number; 
  label: string; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors whitespace-nowrap shadow-sm"
    >
      <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      <span className="text-lg font-semibold text-slate-900 dark:text-white">{value}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
    </button>
  );
}

function SnapshotRow({ 
  icon: Icon, 
  label, 
  value, 
  onClick 
}: { 
  icon: React.ElementType; 
  label: string; 
  value: number; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
        </div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-slate-900 dark:text-white">{value}</span>
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </div>
    </button>
  );
}

function WinRateRing({ percentage }: { percentage: number | null }) {
  if (percentage === null) {
    return (
      <div className="w-16 h-16 flex items-center justify-center">
        <span className="text-sm text-slate-400">—</span>
      </div>
    );
  }

  const radius = 28;
  const strokeWidth = 4;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-16 h-16">
      <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 64 64">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-100 dark:text-slate-800"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="text-emerald-500 dark:text-emerald-400"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {percentage}%
        </span>
      </div>
    </div>
  );
}

function JobCard({ 
  title, 
  subtitle,
  status,
  onClick 
}: { 
  title: string; 
  subtitle?: string;
  status: string;
  onClick: () => void;
}) {
  const statusStyles: Record<string, { bg: string; text: string }> = {
    new: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-700 dark:text-blue-300' },
    scheduled: { bg: 'bg-indigo-100 dark:bg-indigo-900/50', text: 'text-indigo-700 dark:text-indigo-300' },
    in_progress: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-700 dark:text-amber-300' },
    pending: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400' },
    active: { bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-700 dark:text-emerald-300' },
  };

  const style = statusStyles[status] || statusStyles.pending;
  const displayStatus = status.replace(/_/g, ' ');

  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
      onClick={onClick}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {title}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        <span className={`px-2.5 py-1 text-xs font-medium rounded-full capitalize ${style.bg} ${style.text}`}>
          {displayStatus}
        </span>
        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
      </CardContent>
    </Card>
  );
}
