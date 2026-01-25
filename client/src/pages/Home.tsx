import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { useCan } from "@/hooks/useCan";
import { 
  Briefcase, 
  Users, 
  FileText, 
  DollarSign, 
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronRight,
  Loader2,
  Circle
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
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';
  const isOwner = role === 'OWNER';
  const canSeeLeads = role !== 'TECHNICIAN';
  const canSeeEstimates = role !== 'TECHNICIAN';
  const isTechnician = role === 'TECHNICIAN';
  const userId = user?.id;

  const today = startOfDay(new Date());
  
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

  const newLeads = leads.filter(lead => lead.status === 'new');
  
  const unsentEstimates = estimates.filter(estimate => 
    estimate.status === 'draft'
  );

  const unpaidInvoices = invoices.filter(invoice => 
    invoice.status !== 'paid' && invoice.status !== 'cancelled'
  );

  const overdueInvoices = unpaidInvoices.filter(inv => {
    if (!inv.dueDate) return false;
    const dueDate = parseISO(inv.dueDate as unknown as string);
    return dueDate < today;
  });

  const sevenDaysAgo = subDays(today, 7);

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

      const leadsWon7d = leadsCreated7d.filter(lead => lead.status === 'won').length;
      const totalLeads7d = leadsCreated7d.length;
      const winRate7d = totalLeads7d > 0 ? Math.round((leadsWon7d / totalLeads7d) * 100) : null;

      return {
        revenue7d,
        invoicesPaid7d,
        winRate7d,
        hasData: true,
      };
    } catch {
      return null;
    }
  })();

  const needsAttentionItems: Array<{
    id: string;
    type: 'lead' | 'estimate' | 'job' | 'invoice';
    title: string;
    subtitle: string;
    urgency: 'high' | 'medium' | 'low';
    route: string;
  }> = [];

  if (canSeeLeads) {
    newLeads.slice(0, 3).forEach(lead => {
      const customerName = lead.customer 
        ? `${lead.customer.firstName || ''} ${lead.customer.lastName || ''}`.trim() 
        : 'New Lead';
      needsAttentionItems.push({
        id: `lead-${lead.id}`,
        type: 'lead',
        title: customerName || 'New Lead',
        subtitle: 'Not contacted yet',
        urgency: 'high',
        route: `/leads/${lead.id}`,
      });
    });
  }

  if (canSeeEstimates) {
    unsentEstimates.slice(0, 3).forEach(estimate => {
      needsAttentionItems.push({
        id: `estimate-${estimate.id}`,
        type: 'estimate',
        title: estimate.estimateNumber || `Estimate #${estimate.id}`,
        subtitle: 'Not sent to customer',
        urgency: 'medium',
        route: `/estimates/${estimate.id}`,
      });
    });
  }

  if (isAdmin) {
    overdueInvoices.slice(0, 3).forEach(invoice => {
      needsAttentionItems.push({
        id: `invoice-${invoice.id}`,
        type: 'invoice',
        title: invoice.invoiceNumber || `Invoice #${invoice.id}`,
        subtitle: 'Overdue',
        urgency: 'high',
        route: `/invoicing/${invoice.id}`,
      });
    });
  }

  const upcomingJobs = myJobs
    .filter(job => {
      const date = getJobDate(job);
      if (!date) return false;
      return date >= today && job.status !== 'completed' && job.status !== 'cancelled';
    })
    .sort((a, b) => {
      const dateA = getJobDate(a);
      const dateB = getJobDate(b);
      if (!dateA || !dateB) return 0;
      return dateA.getTime() - dateB.getTime();
    })
    .slice(0, 5);

  const dataLoading = jobsLoading || (canSeeLeads && leadsLoading) || (canSeeEstimates && estimatesLoading) || (isAdmin && invoicesLoading);

  const briefItems: Array<{ text: string; count: number; route: string }> = [];
  
  if (jobsToday.length > 0) {
    briefItems.push({
      text: jobsToday.length === 1 ? '1 job scheduled today' : `${jobsToday.length} jobs scheduled today`,
      count: jobsToday.length,
      route: '/jobs',
    });
  }

  if (canSeeLeads && newLeads.length > 0) {
    briefItems.push({
      text: newLeads.length === 1 ? '1 new lead awaiting contact' : `${newLeads.length} new leads awaiting contact`,
      count: newLeads.length,
      route: '/leads',
    });
  }

  if (canSeeEstimates && unsentEstimates.length > 0) {
    briefItems.push({
      text: unsentEstimates.length === 1 ? '1 estimate ready to send' : `${unsentEstimates.length} estimates ready to send`,
      count: unsentEstimates.length,
      route: '/jobs?tab=estimates',
    });
  }

  if (isAdmin && unpaidInvoices.length > 0) {
    briefItems.push({
      text: unpaidInvoices.length === 1 ? '1 unpaid invoice' : `${unpaidInvoices.length} unpaid invoices`,
      count: unpaidInvoices.length,
      route: '/invoicing',
    });
  }

  const greeting = getGreeting();
  const firstName = user?.firstName || 'there';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-24">
      <div className="px-4 pt-6 pb-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Home</h1>
      </div>

      {hasDataError && (
        <div className="px-4 mb-4">
          <Card className="bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <span className="text-red-700 dark:text-red-300 text-sm">
                Some data couldn't be loaded. Pull down to refresh.
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {dataLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="px-4 mb-6">
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
              <CardContent className="p-5">
                <p className="text-lg text-slate-700 dark:text-slate-300 mb-1">
                  {greeting}, {firstName}
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                  Here's what's happening today
                </p>
                
                {briefItems.length === 0 ? (
                  <div className="flex items-center gap-3 py-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <span className="text-slate-600 dark:text-slate-400 text-sm">
                      Your day looks clear. Enjoy!
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {briefItems.map((item, index) => (
                      <BriefItem 
                        key={index}
                        text={item.text}
                        onClick={() => navigate(item.route)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {needsAttentionItems.length > 0 && (
            <div className="px-4 mb-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-3">
                Needs Attention
              </h2>
              <div className="space-y-2">
                {needsAttentionItems.map(item => (
                  <AttentionCard
                    key={item.id}
                    type={item.type}
                    title={item.title}
                    subtitle={item.subtitle}
                    urgency={item.urgency}
                    onClick={() => navigate(item.route)}
                  />
                ))}
              </div>
            </div>
          )}

          {isOwner && (
            <div className="px-4 mb-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-3">
                This Week Pulse
              </h2>
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="p-4">
                  {pulseLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  ) : pulseError ? (
                    <div className="flex items-center justify-center gap-2 py-3 text-slate-500 dark:text-slate-400">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">Couldn't load pulse data</span>
                    </div>
                  ) : pulseMetrics ? (
                    <div className="grid grid-cols-3 gap-4">
                      <PulseMetric
                        label="Revenue"
                        value={pulseMetrics.revenue7d > 0 ? `$${(pulseMetrics.revenue7d / 100).toLocaleString()}` : '$0'}
                        onClick={() => navigate('/invoicing')}
                      />
                      <PulseMetric
                        label="Invoices Paid"
                        value={pulseMetrics.invoicesPaid7d.toString()}
                        onClick={() => navigate('/invoicing')}
                      />
                      <PulseMetric
                        label="Win Rate"
                        value={pulseMetrics.winRate7d !== null ? `${pulseMetrics.winRate7d}%` : '—'}
                        onClick={() => navigate('/leads')}
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          <div className="px-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-3">
              {isTechnician ? 'My Schedule' : 'Today & Upcoming'}
            </h2>
            
            {upcomingJobs.length === 0 ? (
              <Card className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="p-4 flex items-center gap-3">
                  <Clock className="h-5 w-5 text-slate-400" />
                  <span className="text-slate-500 dark:text-slate-400 text-sm">
                    No upcoming jobs scheduled
                  </span>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {upcomingJobs.map(job => {
                  const jobDate = getJobDate(job);
                  let dateLabel = '';
                  if (jobDate) {
                    if (isToday(jobDate)) {
                      dateLabel = 'Today';
                    } else if (isTomorrow(jobDate)) {
                      dateLabel = 'Tomorrow';
                    } else {
                      dateLabel = format(jobDate, 'EEE, MMM d');
                    }
                  }
                  return (
                    <ScheduleCard
                      key={job.id}
                      title={job.title || `Job #${job.id}`}
                      subtitle={dateLabel}
                      status={job.status}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    />
                  );
                })}
              </div>
            )}
          </div>
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

function BriefItem({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors -mx-2 px-2"
    >
      <Circle className="h-2 w-2 text-blue-500 fill-blue-500 flex-shrink-0" />
      <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">
        {text}
      </span>
      <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
    </button>
  );
}

function PulseMetric({ 
  label, 
  value, 
  onClick 
}: { 
  label: string; 
  value: string; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-center p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
    >
      <p className="text-xl font-bold text-slate-900 dark:text-white">
        {value}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
        {label}
      </p>
    </button>
  );
}

function AttentionCard({ 
  type, 
  title, 
  subtitle, 
  urgency, 
  onClick 
}: { 
  type: 'lead' | 'estimate' | 'job' | 'invoice';
  title: string; 
  subtitle: string; 
  urgency: 'high' | 'medium' | 'low';
  onClick: () => void;
}) {
  const iconMap = {
    lead: Users,
    estimate: FileText,
    job: Briefcase,
    invoice: DollarSign,
  };
  const Icon = iconMap[type];
  
  const urgencyColors = {
    high: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400',
    medium: 'bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400',
    low: 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400',
  };

  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-slate-900"
      onClick={onClick}
    >
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${urgencyColors[urgency]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {subtitle}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
      </CardContent>
    </Card>
  );
}

function ScheduleCard({ 
  title, 
  subtitle, 
  status,
  onClick 
}: { 
  title: string; 
  subtitle: string; 
  status: string;
  onClick: () => void;
}) {
  const statusColors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    scheduled: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
    in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  };

  const displayStatus = status.replace(/_/g, ' ');
  const colorClass = statusColors[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-slate-900"
      onClick={onClick}
    >
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        </div>
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${colorClass}`}>
          {displayStatus}
        </span>
        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
      </CardContent>
    </Card>
  );
}
