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
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronRight,
  Loader2
} from "lucide-react";
import { format, isToday, isTomorrow, isThisWeek, parseISO, startOfDay } from "date-fns";
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

  const openJobs = myJobs.filter(job => 
    job.status !== 'completed' && job.status !== 'cancelled'
  );

  const newLeads = leads.filter(lead => lead.status === 'new');
  
  const unsentEstimates = estimates.filter(estimate => 
    estimate.status === 'draft'
  );

  const unpaidInvoices = invoices.filter(invoice => 
    invoice.status !== 'paid' && invoice.status !== 'cancelled'
  );

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

  jobsToday.slice(0, 3).forEach(job => {
    needsAttentionItems.push({
      id: `job-${job.id}`,
      type: 'job',
      title: job.title || `Job #${job.id}`,
      subtitle: isTechnician ? 'Your job today' : 'Scheduled for today',
      urgency: 'medium',
      route: `/jobs/${job.id}`,
    });
  });

  if (isAdmin) {
    unpaidInvoices
      .filter(inv => {
        if (!inv.dueDate) return false;
        const dueDate = parseISO(inv.dueDate as unknown as string);
        return dueDate < today;
      })
      .slice(0, 3)
      .forEach(invoice => {
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

  const leadsNeedingFollowUp = leads
    .filter(lead => lead.status === 'contacted' || lead.status === 'new')
    .slice(0, 5);

  const dataLoading = jobsLoading || (canSeeLeads && leadsLoading) || (canSeeEstimates && estimatesLoading) || (isAdmin && invoicesLoading);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-24">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Home</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Welcome back, {user?.firstName || 'there'}
        </p>
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
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="px-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <KPICard
                icon={Calendar}
                label="Jobs Today"
                value={jobsToday.length}
                onClick={() => navigate('/jobs')}
              />
              <KPICard
                icon={Briefcase}
                label="Open Jobs"
                value={openJobs.length}
                onClick={() => navigate('/jobs')}
              />
              {canSeeLeads && (
                <KPICard
                  icon={Users}
                  label="New Leads"
                  value={newLeads.length}
                  onClick={() => navigate('/leads')}
                />
              )}
              {canSeeEstimates && (
                <KPICard
                  icon={FileText}
                  label="Unsent Estimates"
                  value={unsentEstimates.length}
                  onClick={() => navigate('/jobs?tab=estimates')}
                />
              )}
              {isAdmin && (
                <KPICard
                  icon={DollarSign}
                  label="Unpaid Invoices"
                  value={unpaidInvoices.length}
                  onClick={() => navigate('/invoicing')}
                  className="col-span-2 sm:col-span-1"
                />
              )}
            </div>
          </div>

          <div className="px-4 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
              Needs Attention
            </h2>
            {needsAttentionItems.length === 0 ? (
              <Card className="bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800">
                <CardContent className="p-4 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-300 text-sm font-medium">
                    All caught up! Nothing needs your attention right now.
                  </span>
                </CardContent>
              </Card>
            ) : (
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
            )}
          </div>

          <div className="px-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
              {isTechnician ? 'My Schedule' : (role === 'ESTIMATOR' ? 'Leads to Follow Up' : 'Today & Upcoming')}
            </h2>
            
            {role === 'ESTIMATOR' ? (
              leadsNeedingFollowUp.length === 0 ? (
                <EmptyStateCard message="No leads need follow-up right now" />
              ) : (
                <div className="space-y-2">
                  {leadsNeedingFollowUp.map(lead => {
                    const customerName = lead.customer 
                      ? `${lead.customer.firstName || ''} ${lead.customer.lastName || ''}`.trim() 
                      : 'Lead';
                    return (
                      <ScheduleCard
                        key={lead.id}
                        title={customerName || 'Lead'}
                        subtitle={lead.description || 'No description'}
                        status={lead.status}
                        onClick={() => navigate(`/leads/${lead.id}`)}
                      />
                    );
                  })}
                </div>
              )
            ) : (
              upcomingJobs.length === 0 ? (
                <EmptyStateCard message="No upcoming jobs scheduled" />
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
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KPICard({ 
  icon: Icon, 
  label, 
  value, 
  onClick,
  className = ""
}: { 
  icon: React.ElementType; 
  label: string; 
  value: number; 
  onClick: () => void;
  className?: string;
}) {
  return (
    <Card 
      className={`cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-slate-900 ${className}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
            <Icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
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
    contacted: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    scheduled: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
    in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
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

function EmptyStateCard({ message }: { message: string }) {
  return (
    <Card className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardContent className="p-4 flex items-center gap-3">
        <Clock className="h-5 w-5 text-slate-400" />
        <span className="text-slate-500 dark:text-slate-400 text-sm">
          {message}
        </span>
      </CardContent>
    </Card>
  );
}
