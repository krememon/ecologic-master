import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, User, Mail, Phone, MapPin, FileText, Calendar, Briefcase, Edit2, StickyNote, X, Bell, ArrowRightLeft, Building2, DollarSign, ChevronRight, MoreVertical, Trash2, Pencil } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Customer, Job, Estimate } from "@shared/schema";

interface ClientDetailProps {
  customerId: string;
}

interface SubcontractedJob {
  referralId: number;
  jobId: number | null;
  jobTitle: string;
  jobLocation: string | null;
  jobCreatedAt: string | null;
  referralStatus: string;
  referralType: string;
  rateLabel: string;
  inviteSentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  jobTotalAtAcceptanceCents: number | null;
  contractorPayoutAmountCents: number | null;
  companyShareAmountCents: number | null;
  receiverCompanyName: string | null;
  invoiceId: number | null;
  invoiceStatus: string | null;
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
    case 'paid':
      return 'default';
    case 'draft':
    case 'pending':
    case 'unpaid':
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

function deriveSubcontractPillStatus(referralStatus: string, invoiceStatus: string | null): string {
  if (referralStatus === 'declined') return 'declined';
  if (referralStatus === 'completed') {
    return invoiceStatus === 'paid' ? 'paid' : 'completed';
  }
  if (referralStatus === 'accepted') {
    return invoiceStatus === 'paid' ? 'paid' : 'unpaid';
  }
  // pending referral — not yet accepted
  return 'pending';
}

function getReferralStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    case 'accepted': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    case 'declined': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    case 'pending': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    default: return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400';
  }
}

function getReferralStatusLabel(status: string): string {
  switch (status) {
    case 'completed': return 'Completed';
    case 'accepted': return 'Accepted';
    case 'declined': return 'Declined';
    case 'pending': return 'Pending';
    default: return status;
  }
}

function getJobDisplayStatus(job: Job & { paymentStatus?: string }): string {
  if (job.paymentStatus === 'paid') return 'paid';
  return job.status || 'pending';
}

export default function ClientDetail({ customerId }: ClientDetailProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { role } = useCan();
  
  const [activeTab, setActiveTab] = useState<'jobs' | 'subcontracted' | 'estimates' | 'notes'>('jobs');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCompanyName, setEditCompanyName] = useState('');

  const canEditCustomers = ['OWNER', 'SUPERVISOR'].includes(role || '');

  const { data: customer, isLoading, error } = useQuery<Customer>({
    queryKey: [`/api/customers/${customerId}`],
    enabled: !!customerId && isAuthenticated,
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: [`/api/customers/${customerId}/jobs`],
    enabled: !!customerId && isAuthenticated,
  });

  const { data: subcontractedJobs = [] } = useQuery<SubcontractedJob[]>({
    queryKey: [`/api/customers/${customerId}/subcontracted-jobs`],
    enabled: !!customerId && isAuthenticated,
  });

  const { data: estimates = [] } = useQuery<Estimate[]>({
    queryKey: [`/api/customers/${customerId}/estimates`],
    enabled: !!customerId && isAuthenticated,
  });

  const updateNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const res = await apiRequest('PATCH', `/api/customers/${customerId}`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: "Notes saved" });
      setIsEditingNotes(false);
    },
    onError: () => {
      toast({ title: "Failed to save notes", variant: "destructive" });
    },
  });

  const updateOptInMutation = useMutation({
    mutationFn: async (data: { emailOptIn?: boolean; smsOptIn?: boolean }) => {
      const res = await apiRequest('PATCH', `/api/customers/${customerId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: "Preferences updated" });
    },
    onError: () => {
      toast({ title: "Failed to update preferences", variant: "destructive" });
    },
  });

  const deleteCustomerMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('DELETE', `/api/clients/${customerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      toast({ title: "Customer deleted" });
      navigate('/clients');
    },
    onError: () => {
      toast({ title: "Failed to delete customer", variant: "destructive" });
    },
  });

  const updateCustomerMutation = useMutation({
    mutationFn: async (data: { firstName?: string; lastName?: string; email?: string; phone?: string; address?: string; companyName?: string }) => {
      const res = await apiRequest('PATCH', `/api/customers/${customerId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      toast({ title: "Customer updated" });
      setShowEditSheet(false);
    },
    onError: () => {
      toast({ title: "Failed to update customer", variant: "destructive" });
    },
  });

  const handleOpenEditSheet = () => {
    setEditFirstName(customer?.firstName || '');
    setEditLastName(customer?.lastName || '');
    setEditEmail(customer?.email || '');
    setEditPhone(customer?.phone || '');
    setEditAddress(customer?.address || '');
    setEditCompanyName(customer?.companyName || '');
    setShowEditSheet(true);
  };

  const handleSaveEdit = () => {
    updateCustomerMutation.mutate({
      firstName: editFirstName.trim(),
      lastName: editLastName.trim(),
      email: editEmail.trim() || undefined,
      phone: editPhone.trim() || undefined,
      address: editAddress.trim() || undefined,
      companyName: editCompanyName.trim() || undefined,
    });
  };

  const handleEditNotes = () => {
    setEditedNotes(customer?.notes || '');
    setIsEditingNotes(true);
  };

  const handleCancelEdit = () => {
    setIsEditingNotes(false);
    setEditedNotes('');
  };

  const handleSaveNotes = () => {
    updateNotesMutation.mutate(editedNotes);
  };

  const handleSubcontractedCardClick = (job: SubcontractedJob) => {
    if (job.invoiceId) {
      navigate(`/invoicing/${job.invoiceId}`);
    } else if (job.jobId) {
      navigate(`/jobs/${job.jobId}?from=client&clientId=${customerId}`);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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

  const tabs: { key: typeof activeTab; label: string; count?: number }[] = [
    { key: 'jobs', label: 'Jobs', count: jobs.length },
    { key: 'subcontracted', label: 'Subcontracted', count: subcontractedJobs.length },
    { key: 'estimates', label: 'Estimates', count: estimates.length },
    { key: 'notes', label: 'Notes' },
  ];

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
        {canEditCustomers && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleOpenEditSheet} className="gap-2">
                <Pencil className="h-4 w-4" />
                Edit Customer
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowDeleteConfirm(true)}
                className="gap-2 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
                Delete Customer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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

      {/* Communication Preferences Card */}
      {canEditCustomers && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="h-5 w-5 text-blue-600" />
              Communication Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="emailOptIn" className="text-sm font-medium">Email Campaigns</Label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Allow sending promotional emails to this client
                </p>
              </div>
              <Switch
                id="emailOptIn"
                checked={customer.emailOptIn ?? true}
                onCheckedChange={(checked) => updateOptInMutation.mutate({ emailOptIn: checked })}
                disabled={updateOptInMutation.isPending || !customer.email}
              />
            </div>
            {customer.emailUnsubscribedAt && (
              <p className="text-xs text-amber-600 dark:text-amber-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                Email unsubscribed.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.key
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}
          </button>
        ))}
      </div>

      {/* Jobs Tab */}
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
                onClick={() => navigate(`/jobs/${job.id}?from=client&clientId=${customerId}`)}
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
                    <Badge variant={getStatusBadgeVariant(getJobDisplayStatus(job as any))}>
                      {getJobDisplayStatus(job as any)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Subcontracted Tab */}
      {activeTab === 'subcontracted' && (
        <div className="space-y-3">
          {subcontractedJobs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ArrowRightLeft className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No subcontracted jobs</h3>
                <p className="text-slate-600 dark:text-slate-400 text-center">
                  No subcontracted jobs for this client yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            subcontractedJobs.map((job) => (
              <Card
                key={job.referralId}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleSubcontractedCardClick(job)}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Job title + referral status */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h4 className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {job.jobTitle}
                        </h4>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${getReferralStatusColor(job.referralStatus)}`}>
                          {getReferralStatusLabel(job.referralStatus)}
                        </span>
                      </div>

                      {/* Receiver company */}
                      {job.receiverCompanyName && (
                        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                          <Building2 className="h-3 w-3 flex-shrink-0" />
                          <span>Subcontracted to <span className="font-medium text-slate-700 dark:text-slate-300">{job.receiverCompanyName}</span></span>
                        </div>
                      )}

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        {job.jobLocation && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {job.jobLocation}
                          </span>
                        )}
                        {job.jobCreatedAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(job.jobCreatedAt), 'MMM d, yyyy')}
                          </span>
                        )}
                        {job.rateLabel && (
                          <span className="flex items-center gap-1">
                            <ArrowRightLeft className="h-3 w-3" />
                            {job.rateLabel} referral
                          </span>
                        )}
                      </div>

                      {/* Financial snapshot */}
                      {(job.jobTotalAtAcceptanceCents || job.companyShareAmountCents) && (
                        <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          {job.jobTotalAtAcceptanceCents && (
                            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                              <DollarSign className="h-3 w-3" />
                              <span>Job: <span className="font-medium text-slate-700 dark:text-slate-300">{formatCurrency(job.jobTotalAtAcceptanceCents)}</span></span>
                            </div>
                          )}
                          {job.companyShareAmountCents !== null && job.companyShareAmountCents !== undefined && (
                            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                              <DollarSign className="h-3 w-3" />
                              <span>Your share: <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(job.companyShareAmountCents)}</span></span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {(() => {
                        const pillStatus = deriveSubcontractPillStatus(job.referralStatus, job.invoiceStatus);
                        return (
                          <Badge variant={getStatusBadgeVariant(pillStatus)} className="text-[10px]">
                            {pillStatus}
                          </Badge>
                        );
                      })()}
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Estimates Tab */}
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

      {/* Notes Tab */}
      {activeTab === 'notes' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <StickyNote className="h-5 w-5 text-blue-600" />
                Notes
              </CardTitle>
              {canEditCustomers && !isEditingNotes && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditNotes}
                  className="gap-2"
                >
                  <Edit2 className="h-4 w-4" />
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditingNotes ? (
              <div className="space-y-4">
                <Textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  placeholder="Add notes about this client..."
                  className="min-h-[200px] resize-y"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={handleCancelEdit}
                    disabled={updateNotesMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveNotes}
                    disabled={updateNotesMutation.isPending}
                  >
                    {updateNotesMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            ) : customer.notes ? (
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {customer.notes}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8">
                <StickyNote className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No notes yet</h3>
                <p className="text-slate-600 dark:text-slate-400 text-center">
                  Add notes for this client.
                </p>
                {canEditCustomers && (
                  <Button
                    variant="outline"
                    onClick={handleEditNotes}
                    className="mt-4 gap-2"
                  >
                    <Edit2 className="h-4 w-4" />
                    Add Notes
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {formatCustomerName()} and cannot be undone. Associated jobs, estimates, and invoices will remain but will no longer be linked to this customer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCustomerMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCustomerMutation.mutate()}
              disabled={deleteCustomerMutation.isPending}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteCustomerMutation.isPending ? "Deleting..." : "Delete Customer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Customer dialog — matches Add Client modal aesthetic */}
      <Dialog open={showEditSheet} onOpenChange={setShowEditSheet}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <DialogTitle className="sr-only">Edit Customer</DialogTitle>
          <div className="flex flex-col h-full max-h-[85vh]">
            {/* Fixed header */}
            <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowEditSheet(false)}
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              </button>
              <div className="text-center">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit Customer</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Update customer information</p>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="px-5 md:px-6 py-4 flex-1 overflow-auto">
              <div className="space-y-3 md:space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  <div>
                    <Label htmlFor="edit-first-name" className="text-xs font-medium mb-1 block">First Name</Label>
                    <Input
                      id="edit-first-name"
                      value={editFirstName}
                      onChange={(e) => setEditFirstName(e.target.value)}
                      placeholder="First name"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-last-name" className="text-xs font-medium mb-1 block">Last Name</Label>
                    <Input
                      id="edit-last-name"
                      value={editLastName}
                      onChange={(e) => setEditLastName(e.target.value)}
                      placeholder="Last name"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="edit-company" className="text-xs font-medium mb-1 block">Company Name</Label>
                  <Input
                    id="edit-company"
                    value={editCompanyName}
                    onChange={(e) => setEditCompanyName(e.target.value)}
                    placeholder="Company name"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  <div>
                    <Label htmlFor="edit-email" className="text-xs font-medium mb-1 block">Email</Label>
                    <Input
                      id="edit-email"
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Email address"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-phone" className="text-xs font-medium mb-1 block">Phone</Label>
                    <Input
                      id="edit-phone"
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="Phone number"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="edit-address" className="text-xs font-medium mb-1 block">Address</Label>
                  <Input
                    id="edit-address"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    placeholder="Address"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Fixed footer */}
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditSheet(false)}
                  disabled={updateCustomerMutation.isPending}
                  className="flex-1 h-11"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={updateCustomerMutation.isPending}
                  className="flex-1 h-11"
                >
                  {updateCustomerMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
