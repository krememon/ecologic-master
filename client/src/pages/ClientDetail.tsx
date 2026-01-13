import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, User, Mail, Phone, MapPin, FileText, Calendar, Briefcase, DollarSign } from "lucide-react";
import { format } from "date-fns";
import type { Customer, Job, Estimate } from "@shared/schema";

interface ClientDetailProps {
  customerId: string;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status?.toLowerCase()) {
    case 'approved':
    case 'completed':
    case 'active':
      return 'default';
    case 'draft':
    case 'pending':
      return 'secondary';
    case 'sent':
      return 'outline';
    case 'rejected':
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export default function ClientDetail({ customerId }: ClientDetailProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { role } = useCan();
  
  const [activeTab, setActiveTab] = useState<'jobs' | 'estimates'>('jobs');

  const { data: customer, isLoading, error } = useQuery<Customer>({
    queryKey: [`/api/customers/${customerId}`],
    enabled: !!customerId && isAuthenticated,
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: [`/api/customers/${customerId}/jobs`],
    enabled: !!customerId && isAuthenticated,
  });

  const { data: estimates = [] } = useQuery<Estimate[]>({
    queryKey: [`/api/customers/${customerId}/estimates`],
    enabled: !!customerId && isAuthenticated,
  });

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Client not found</h2>
          <p className="text-slate-600 dark:text-slate-400 mt-2">The client you're looking for doesn't exist.</p>
          <Button onClick={() => navigate('/clients')} className="mt-4">
            Back to Clients
          </Button>
        </div>
      </div>
    );
  }

  const formatCustomerName = () => {
    return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed Client';
  };

  const getJobPrimaryText = (job: Job) => {
    return job.title || job.jobType || 'Untitled Job';
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/clients')}
          className="h-10 w-10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {formatCustomerName()}
          </h1>
          {customer.companyName && (
            <p className="text-slate-600 dark:text-slate-400">{customer.companyName}</p>
          )}
        </div>
      </div>

      {/* Client Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-blue-600" />
            Client Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {customer.email && (
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-slate-400" />
              <a 
                href={`mailto:${customer.email}`}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
              >
                {customer.email}
              </a>
            </div>
          )}
          {customer.phone && (
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-slate-400" />
              <a 
                href={`tel:${customer.phone}`}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
              >
                {customer.phone}
              </a>
            </div>
          )}
          {customer.address && (
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300">{customer.address}</span>
            </div>
          )}
          {customer.jobTitle && (
            <div className="flex items-center gap-3">
              <Briefcase className="h-4 w-4 text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300">{customer.jobTitle}</span>
            </div>
          )}
          {!customer.email && !customer.phone && !customer.address && (
            <p className="text-slate-500 italic">No contact information available</p>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('jobs')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'jobs'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          Jobs ({jobs.length})
        </button>
        <button
          onClick={() => setActiveTab('estimates')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'estimates'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          Estimates ({estimates.length})
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'jobs' && (
        <div className="space-y-3">
          {jobs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Briefcase className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No jobs yet</h3>
                <p className="text-slate-600 dark:text-slate-400 text-center">
                  This client doesn't have any jobs associated with them.
                </p>
              </CardContent>
            </Card>
          ) : (
            jobs.map((job) => (
              <Card
                key={job.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/jobs/${job.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {getJobPrimaryText(job)}
                      </h4>
                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {job.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {job.location}
                          </span>
                        )}
                        {job.createdAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(job.createdAt), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant={getStatusBadgeVariant(job.status)}>
                      {job.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === 'estimates' && (
        <div className="space-y-3">
          {estimates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No estimates yet</h3>
                <p className="text-slate-600 dark:text-slate-400 text-center">
                  This client doesn't have any estimates associated with them.
                </p>
              </CardContent>
            </Card>
          ) : (
            estimates.map((estimate: any) => (
              <Card
                key={estimate.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/estimates/${estimate.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-slate-900 dark:text-slate-100">
                        Estimate #{estimate.estimateNumber || estimate.id}
                      </h4>
                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {estimate.createdAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(estimate.createdAt), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {estimate.totalCents && estimate.totalCents > 0 && (
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {formatCurrency(estimate.totalCents)}
                        </span>
                      )}
                      <Badge variant={getStatusBadgeVariant(estimate.status || 'draft')}>
                        {estimate.status || 'draft'}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
