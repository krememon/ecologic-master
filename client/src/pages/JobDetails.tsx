import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, User, FileText, Calendar, List, Paperclip, Upload, Trash2, Edit, Users, X, CreditCard, Loader2, CheckCircle2, MoreVertical, Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { Job, Client } from "@shared/schema";
import { JobInvoiceModal } from "@/components/JobInvoiceModal";

interface JobDetailsProps {
  jobId: string;
}

function getReturnUrl(): string {
  if (typeof window === 'undefined') return '/jobs';
  const params = new URLSearchParams(window.location.search);
  if (params.get('from') === 'schedule') {
    const view = params.get('view') || 'day';
    const date = params.get('date') || '';
    return `/schedule?view=${view}&date=${date}`;
  }
  return '/jobs';
}

interface JobWithClient extends Job {
  client?: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

interface CrewAssignment {
  id: number;
  jobId: number;
  userId: string;
  companyId: number;
  assignedAt: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    profileImageUrl: string | null;
  };
}

interface JobLineItem {
  id: number;
  jobId: number;
  name: string;
  description: string | null;
  taskCode: string | null;
  quantity: string;
  unitPriceCents: number;
  unit: string;
  taxable: boolean;
  taxId: number | null;
  taxRatePercentSnapshot: string | null;
  taxNameSnapshot: string | null;
  lineTotalCents: number;
  taxCents: number;
  subtotalCents: number; // Backend computed: same as lineTotalCents
  totalCents: number; // Backend computed: lineTotalCents + taxCents
  sortOrder: number;
}

interface JobPhoto {
  id: number;
  jobId: number;
  uploadedBy: string;
  title: string | null;
  description: string | null;
  photoUrl: string;
  location: string | null;
  phase: string | null;
  weather: string | null;
  isPublic: boolean;
  createdAt: string;
}

interface JobDocument {
  id: number;
  jobId: number;
  name: string;
  fileUrl: string;
  type: string | null;
  visibility: string;
  createdAt: string;
}

interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  profileImageUrl?: string | null;
}

export default function JobDetails({ jobId }: JobDetailsProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { role } = useCan();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [activeTab, setActiveTab] = useState<'documents' | 'approvals'>('documents');
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string; id?: number } | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] = useState<{ id: number; title: string } | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);
  const [employeesModalOpen, setEmployeesModalOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [isSavingCrew, setIsSavingCrew] = useState(false);
  
  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';
  const canEditJob = role === 'OWNER' || role === 'SUPERVISOR' || role === 'DISPATCHER' || role === 'ESTIMATOR';
  const canCreatePaymentLink = role === 'OWNER' || role === 'SUPERVISOR' || role === 'DISPATCHER' || role === 'ESTIMATOR';
  const canCancelJob = role === 'OWNER' || role === 'SUPERVISOR' || role === 'DISPATCHER';

  const { data: job, isLoading, error } = useQuery<JobWithClient>({
    queryKey: [`/api/jobs/${jobId}`],
    enabled: !!jobId && isAuthenticated,
  });

  const { data: crewAssignments = [] } = useQuery<CrewAssignment[]>({
    queryKey: ['/api/jobs', jobId, 'crew'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/crew`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch crew');
      return res.json();
    },
    enabled: !!jobId && isAuthenticated,
  });

  const { data: lineItems = [] } = useQuery<JobLineItem[]>({
    queryKey: ['/api/jobs', jobId, 'line-items'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/line-items`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch line items');
      return res.json();
    },
    enabled: !!jobId && isAuthenticated,
  });

  const { data: legacyPhotos = [] } = useQuery<JobPhoto[]>({
    queryKey: [`/api/jobs/${jobId}/photos`],
    enabled: !!jobId && isAuthenticated,
  });

  const { data: jobDocuments = [] } = useQuery<JobDocument[]>({
    queryKey: [`/api/jobs/${jobId}/documents`],
    enabled: !!jobId && isAuthenticated,
  });

  // Fetch invoice for this job (if exists)
  interface InvoiceData {
    invoice: {
      id: number;
      invoiceNumber: string;
      amount: string;
      status: string;
      jobId: number;
      companyId: number;
    } | null;
  }
  const { data: invoiceData, refetch: refetchInvoice } = useQuery<InvoiceData>({
    queryKey: ['/api/jobs', jobId, 'invoice'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/invoice`, { credentials: 'include' });
      if (!res.ok) return { invoice: null };
      return res.json();
    },
    enabled: !!jobId && isAuthenticated,
  });

  interface LaborData {
    totalMinutes: number;
    laborByUser: { userId: string; minutes: number }[];
  }
  const { data: laborData, isError: laborError } = useQuery<LaborData>({
    queryKey: ['/api/jobs', jobId, 'labor'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/labor`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch labor');
      return res.json();
    },
    enabled: !!jobId && isAuthenticated,
  });

  const invoice = invoiceData?.invoice;
  const invoiceId = invoice?.id;
  const invoiceStatus = invoice?.status;
  const isPaid = invoiceStatus?.toLowerCase() === 'paid';
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  // Fetch company employees for assignment
  const { data: employeesData, isLoading: employeesLoading } = useQuery<{ users: Employee[]; total: number }>({
    queryKey: ['/api/org/users'],
    enabled: isAuthenticated,
  });
  const allEmployees = employeesData?.users || [];
  
  // Filter employees by search
  const filteredEmployees = allEmployees.filter((emp) => {
    const searchLower = employeeSearch.toLowerCase();
    const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
    return fullName.includes(searchLower) || emp.email.toLowerCase().includes(searchLower);
  });
  
  // Toggle employee selection
  const toggleEmployee = (id: string) => {
    setSelectedEmployees(prev => 
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  };
  
  // Open employee picker modal
  const openEmployeePicker = () => {
    // Initialize with currently assigned employees
    setSelectedEmployees(crewAssignments.map(a => a.userId));
    setEmployeeSearch("");
    setEmployeesModalOpen(true);
  };
  
  // Save crew assignments
  const saveCrewAssignments = async () => {
    setIsSavingCrew(true);
    try {
      // Send the complete list of selected employees (empty array clears assignments)
      console.log("ASSIGN TECHS submit", { jobId, userIds: selectedEmployees });
      
      await apiRequest("POST", `/api/jobs/${jobId}/crew`, { userIds: selectedEmployees });
      
      // Refresh crew list
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'crew'] });
      setEmployeesModalOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update crew assignments",
        variant: "destructive",
      });
    } finally {
      setIsSavingCrew(false);
    }
  };

  // Helper to ensure invoice exists (creates if needed, returns invoice)
  const ensureInvoice = async (): Promise<{ id: number; invoiceNumber: string } | null> => {
    // If invoice already exists, return it
    if (invoice) {
      return { id: invoice.id, invoiceNumber: invoice.invoiceNumber };
    }
    
    // Create new invoice
    try {
      const response = await apiRequest("POST", `/api/jobs/${jobId}/invoice`);
      const data = await response.json();
      
      if (data.invoice) {
        // Update cache
        await refetchInvoice();
        return { id: data.invoice.id, invoiceNumber: data.invoice.invoiceNumber };
      }
      return null;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
      return null;
    }
  };

  // Separate loading state for Invoice button
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  // Handle Invoice button click - creates if needed, then opens modal
  const handleInvoiceClick = async () => {
    setInvoiceLoading(true);
    try {
      const inv = await ensureInvoice();
      if (inv) {
        setInvoiceModalOpen(true);
      }
    } finally {
      setInvoiceLoading(false);
    }
  };

  // Handle Pay button click - auto-creates invoice if needed, then navigates to Payment Review
  const handlePayInvoice = async () => {
    if (isPaid) return; // Already paid, do nothing
    
    setPaymentLoading(true);
    try {
      // Ensure invoice exists first
      const inv = await ensureInvoice();
      if (!inv) {
        setPaymentLoading(false);
        return; // Error already shown by ensureInvoice
      }
      
      // Navigate to Payment Review page instead of direct Stripe checkout
      navigate(`/jobs/${jobId}/pay/${inv.id}`);
    } catch (error: any) {
      setPaymentLoading(false);
      toast({
        title: "Error",
        description: error.message || "Failed to prepare payment",
        variant: "destructive",
      });
    }
  };

  const jobDocumentPhotos = jobDocuments
    .filter(doc => doc.type?.startsWith('image/'))
    .map(doc => ({
      id: doc.id,
      jobId: doc.jobId,
      uploadedBy: '',
      title: doc.name,
      description: null,
      photoUrl: doc.fileUrl,
      location: null,
      phase: null,
      weather: null,
      isPublic: doc.visibility === 'customer_internal',
      createdAt: doc.createdAt,
      isDocument: true,
    }));

  const jobPhotos = [...jobDocumentPhotos, ...legacyPhotos];

  const deleteJobMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('DELETE', `/api/jobs/${jobId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job deleted successfully" });
      navigate('/jobs');
    },
    onError: () => {
      toast({ title: "Failed to delete job", variant: "destructive" });
    },
  });

  const cancelJobMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('PATCH', `/api/jobs/${jobId}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setIsCancelDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to cancel job", variant: "destructive" });
    },
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: async ({ formData }: { formData: FormData }) => {
      const res = await fetch(`/api/jobs/${jobId}/documents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/documents`] });
      toast({ title: "Photo uploaded successfully" });
      setIsUploading(false);
      setUploadProgress(0);
    },
    onError: () => {
      toast({ title: "Failed to upload photo", variant: "destructive" });
      setIsUploading(false);
      setUploadProgress(0);
    },
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    setUploadProgress(30);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('jobId', jobId);
    formData.append('visibility', 'assigned_crew_only');
    
    setUploadProgress(60);
    uploadPhotoMutation.mutate({ formData });
  };

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (documentId: number) => {
      await apiRequest('DELETE', `/api/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/documents`] });
      toast({ title: "Attachment deleted" });
      setAttachmentToDelete(null);
      if (previewImage?.id === attachmentToDelete?.id) {
        setPreviewImage(null);
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to delete attachment", variant: "destructive" });
      setAttachmentToDelete(null);
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const response = await apiRequest('PATCH', `/api/jobs/${jobId}`, { notes });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to update notes');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}`] });
      setIsNotesModalOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to update notes", variant: "destructive" });
    },
  });

  const openNotesModal = () => {
    setEditedNotes(job?.notes || "");
    setIsNotesModalOpen(true);
  };

  const saveNotes = () => {
    updateNotesMutation.mutate(editedNotes);
  };

  if (authLoading || isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Job not found</h2>
          <Button onClick={() => navigate(getReturnUrl())}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  const customerName = job.clientName || job.client?.name;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header - Two Row Mobile Layout */}
      <div className="mb-4 space-y-3">
        {/* Row 1: Back arrow + Title */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(getReturnUrl())} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl md:text-2xl font-bold truncate">
            {customerName || 'Untitled Job'}
          </h1>
        </div>
        
        {/* Row 2: Action Bar */}
        <div className="flex items-center gap-2 flex-wrap pl-1">
          {/* Invoice Button */}
          {canCreatePaymentLink && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleInvoiceClick}
              disabled={invoiceLoading}
              className="h-8 px-3 text-sm"
            >
              {invoiceLoading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-1.5" />
              )}
              Invoice
            </Button>
          )}
          
          {/* Pay Button / Paid Badge */}
          {canCreatePaymentLink && (
            isPaid ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 flex items-center gap-1 px-2.5 py-1 h-8 text-sm font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Paid
              </Badge>
            ) : (
              <Button
                size="sm"
                onClick={handlePayInvoice}
                disabled={paymentLoading}
                className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-sm"
              >
                {paymentLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Processing
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4 mr-1.5" />
                    Pay
                  </>
                )}
              </Button>
            )
          )}
          
          {/* Overflow Menu for Edit/Cancel/Delete */}
          {(canEditJob || canCancelJob || isAdmin) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-2">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEditJob && (
                  <DropdownMenuItem onClick={() => navigate(`/jobs/${jobId}/edit`)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Job
                  </DropdownMenuItem>
                )}
                {canCancelJob && job?.status !== 'cancelled' && (
                  <DropdownMenuItem 
                    onClick={() => setIsCancelDialogOpen(true)}
                    className="text-amber-600 focus:text-amber-600"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel Job
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem 
                    onClick={() => setIsDeleteDialogOpen(true)}
                    className="text-red-600 focus:text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Job
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="mb-6" data-testid="job-tab-switcher">
        <div className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 p-1">
          <button
            onClick={() => setActiveTab('documents')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              activeTab === 'documents'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Documents
          </button>
          <button
            onClick={() => setActiveTab('approvals')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              activeTab === 'approvals'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            E-signature Approvals
          </button>
        </div>
      </div>

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <div className="space-y-6">
          {/* Customer Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent>
              {customerName ? (
                <div className="space-y-4">
                  <div>
                    <p className="font-medium">{customerName}</p>
                    {job.client?.email && (
                      <p className="text-sm text-muted-foreground">{job.client.email}</p>
                    )}
                    {job.client?.phone && (
                      <p className="text-sm text-muted-foreground">{job.client.phone}</p>
                    )}
                  </div>
                  {job.location && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Address</p>
                      <a 
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {job.location}
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">No customer assigned</p>
              )}
            </CardContent>
          </Card>

          {/* Job Type Card */}
          {job.jobType && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Job Type
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p>{job.jobType}</p>
              </CardContent>
            </Card>
          )}

          {/* Schedule Card - Always visible */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.startDate ? (
                <div className="space-y-1">
                  <p className="font-medium">
                    {(() => {
                      try {
                        const rawDate = job.startDate as any;
                        if (rawDate instanceof Date) {
                          return format(rawDate, 'EEEE, MMMM d, yyyy');
                        } else if (typeof rawDate === 'string' && rawDate) {
                          const dateStr = rawDate.split('T')[0];
                          return format(new Date(dateStr + 'T12:00:00'), 'EEEE, MMMM d, yyyy');
                        }
                        return format(new Date(rawDate), 'EEEE, MMMM d, yyyy');
                      } catch {
                        return 'Scheduled';
                      }
                    })()}
                  </p>
                  {job.scheduledTime && (
                    <p className="text-muted-foreground">
                      {(() => {
                        const startTime = job.scheduledTime;
                        const endTime = (job as any).scheduledEndTime;
                        const formatTime = (t: string) => {
                          const [h, m] = t.split(':').map(Number);
                          const period = h >= 12 ? 'PM' : 'AM';
                          const displayH = h % 12 || 12;
                          return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
                        };
                        if (startTime && endTime) {
                          return `${formatTime(startTime)} – ${formatTime(endTime)}`;
                        }
                        return formatTime(startTime);
                      })()}
                    </p>
                  )}
                  {job.endDate && job.startDate !== job.endDate && (
                    <p className="text-sm text-muted-foreground">
                      to {(() => {
                        try {
                          const rawDate = job.endDate as any;
                          if (rawDate instanceof Date) {
                            return format(rawDate, 'MMMM d, yyyy');
                          } else if (typeof rawDate === 'string' && rawDate) {
                            const dateStr = rawDate.split('T')[0];
                            return format(new Date(dateStr + 'T12:00:00'), 'MMMM d, yyyy');
                          }
                          return format(new Date(rawDate), 'MMMM d, yyyy');
                        } catch {
                          return '';
                        }
                      })()}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">Not scheduled</p>
              )}
            </CardContent>
          </Card>

          {/* Labor Time Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Labor Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              {laborError ? (
                <p className="text-sm text-muted-foreground">Labor time unavailable</p>
              ) : laborData ? (
                <p className="text-lg font-semibold">
                  {laborData.totalMinutes > 0 
                    ? `${Math.floor(laborData.totalMinutes / 60)}h ${laborData.totalMinutes % 60}m`
                    : '—'}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
            </CardContent>
          </Card>

          {/* Assigned Employees Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Assigned Employees
                </div>
                {canEditJob && crewAssignments.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={openEmployeePicker}>
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {crewAssignments.length > 0 ? (
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2 flex-shrink-0">
                    {crewAssignments.slice(0, 4).map((assignment) => {
                      const name = `${assignment.user.firstName || ''} ${assignment.user.lastName || ''}`.trim() || assignment.user.email;
                      const initials = (assignment.user.firstName?.[0] || '') + (assignment.user.lastName?.[0] || '') || assignment.user.email[0].toUpperCase();
                      return assignment.user.profileImageUrl ? (
                        <img
                          key={assignment.userId}
                          src={assignment.user.profileImageUrl}
                          alt={name}
                          title={name}
                          className="h-8 w-8 rounded-full border-2 border-white dark:border-slate-800 object-cover"
                        />
                      ) : (
                        <div
                          key={assignment.userId}
                          title={name}
                          className="h-8 w-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-300"
                        >
                          {initials}
                        </div>
                      );
                    })}
                    {crewAssignments.length > 4 && (
                      <div className="h-8 w-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-medium">
                        +{crewAssignments.length - 4}
                      </div>
                    )}
                  </div>
                  <div className="text-sm">
                    {crewAssignments.map(a => 
                      `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() || a.user.email.split('@')[0]
                    ).slice(0, 3).join(', ')}
                    {crewAssignments.length > 3 && ` +${crewAssignments.length - 3} more`}
                  </div>
                </div>
              ) : (
                canEditJob ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openEmployeePicker}
                    className="gap-2"
                  >
                    <UserPlus className="h-4 w-4" />
                    Select Employee
                  </Button>
                ) : (
                  <p className="text-muted-foreground">No employees assigned</p>
                )
              )}
            </CardContent>
          </Card>

          {/* Line Items Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5" />
                Line Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lineItems.length > 0 ? (
                <div className="space-y-3">
                  {lineItems.map((item) => {
                    // Compute line total: prefer lineTotalCents, fallback to unitPriceCents × quantity
                    const quantity = parseFloat(item.quantity) || 1;
                    const computedLineTotal = item.lineTotalCents || Math.round(item.unitPriceCents * quantity);
                    
                    // Compute tax for this line item
                    let itemTaxCents = item.taxCents || 0;
                    if (item.taxable && item.taxRatePercentSnapshot && !itemTaxCents) {
                      const rate = parseFloat(item.taxRatePercentSnapshot) || 0;
                      itemTaxCents = Math.round(computedLineTotal * (rate / 100));
                    }
                    
                    // Total with tax for display
                    const displayTotal = item.totalCents || (computedLineTotal + itemTaxCents);
                    
                    return (
                      <div key={item.id} className="flex justify-between items-start py-2 border-b last:border-0">
                        <div className="flex-1">
                          <p className="font-medium">{item.name}</p>
                          {item.description && (
                            <p className="text-sm text-muted-foreground">{item.description}</p>
                          )}
                          <p className="text-sm text-muted-foreground">
                            {item.quantity} × ${(item.unitPriceCents / 100).toFixed(2)} / {item.unit}
                          </p>
                          {item.taxable && itemTaxCents > 0 && (
                            <p className="text-xs text-muted-foreground">
                              + Tax ({item.taxNameSnapshot || 'Tax'}): ${(itemTaxCents / 100).toFixed(2)}
                            </p>
                          )}
                        </div>
                        <p className="font-medium">${(displayTotal / 100).toFixed(2)}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-2">No line items</p>
              )}
              <Separator className="my-3" />
              {(() => {
                // Compute subtotal from line items (before tax)
                const subtotal = lineItems.reduce((sum, item) => {
                  const qty = parseFloat(item.quantity) || 1;
                  const lineSubtotal = item.subtotalCents || item.lineTotalCents || Math.round(qty * (item.unitPriceCents || 0));
                  return sum + lineSubtotal;
                }, 0);
                
                // Compute total tax from line items
                const totalTax = lineItems.reduce((sum, item) => {
                  const qty = parseFloat(item.quantity) || 1;
                  const lineSubtotal = item.lineTotalCents || Math.round(qty * (item.unitPriceCents || 0));
                  let itemTax = item.taxCents || 0;
                  // If taxable with rate but no taxCents, compute it
                  if (item.taxable && item.taxRatePercentSnapshot && !itemTax) {
                    const rate = parseFloat(item.taxRatePercentSnapshot) || 0;
                    itemTax = Math.round(lineSubtotal * (rate / 100));
                  }
                  return sum + itemTax;
                }, 0);
                
                const grandTotal = subtotal + totalTax;
                return (
                  <div className="space-y-1">
                    {totalTax > 0 && (
                      <>
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>Subtotal</span>
                          <span>${(subtotal / 100).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>Tax</span>
                          <span>${(totalTax / 100).toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between font-bold text-lg">
                      <span>Total</span>
                      <span>${(grandTotal / 100).toFixed(2)}</span>
                    </div>
                  </div>
                );
              })()}
              
            </CardContent>
          </Card>

          {/* Notes Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Notes
                </div>
                {canEditJob && job.notes && (
                  <Button variant="ghost" size="sm" onClick={openNotesModal}>
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.notes ? (
                <div>
                  <p 
                    className={`text-sm leading-relaxed whitespace-pre-wrap ${
                      !isNotesExpanded ? 'line-clamp-5' : ''
                    }`}
                  >
                    {job.notes}
                  </p>
                  {job.notes.length > 200 && (
                    <button 
                      onClick={() => setIsNotesExpanded(!isNotesExpanded)}
                      className="text-sm text-blue-600 hover:text-blue-800 mt-2"
                    >
                      {isNotesExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-muted-foreground mb-1">No notes yet</p>
                  <p className="text-sm text-muted-foreground mb-3">Add notes for this job.</p>
                  {canEditJob && (
                    <Button variant="outline" size="sm" onClick={openNotesModal}>
                      Add Notes
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Attachments Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-5 w-5" />
                  Attachments
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {isUploading ? 'Uploading...' : 'Upload'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isUploading && uploadProgress > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
              {jobPhotos.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {jobPhotos.map((photo) => (
                    <div 
                      key={photo.id} 
                      className="relative group cursor-pointer"
                    >
                      <div 
                        onClick={() => setPreviewImage({ url: photo.photoUrl, title: photo.title || 'Photo', id: photo.id })}
                      >
                        <img
                          src={photo.photoUrl}
                          alt={photo.title || "Job attachment"}
                          className="w-full h-24 object-cover rounded-lg border hover:opacity-90 transition-opacity"
                        />
                        <p className="text-xs truncate mt-1">{photo.title || 'Photo'}</p>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachmentToDelete({ id: photo.id, title: photo.title || 'Photo' });
                          }}
                          className="absolute top-1 right-1 p-1 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 md:opacity-0 md:group-hover:opacity-100"
                          title="Delete attachment"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">No attachments</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* E-signature Approvals Tab */}
      {activeTab === 'approvals' && (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">E-signature Approvals</p>
            <p className="text-sm text-muted-foreground text-center">
              Signature requests for this job will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoUpload}
        className="hidden"
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this job? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteJobMutation.mutate()}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Job Confirmation Dialog */}
      <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this job? Assigned crew members will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelJobMutation.mutate()}
              className="bg-amber-600 hover:bg-amber-700"
              disabled={cancelJobMutation.isPending}
            >
              {cancelJobMutation.isPending ? "Cancelling..." : "Cancel Job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Image Preview Modal */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-white dark:bg-slate-900 border rounded-xl shadow-xl">
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-3 right-3 z-50 p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          {previewImage && (
            <div className="flex flex-col items-center justify-center p-6">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-2 w-full flex items-center justify-center">
                <img
                  src={previewImage.url}
                  alt={previewImage.title}
                  className="max-w-full max-h-[70vh] object-contain rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '';
                    (e.target as HTMLImageElement).alt = 'Failed to load preview';
                  }}
                />
              </div>
              {previewImage.title && (
                <p className="text-slate-600 dark:text-slate-400 text-sm mt-4 text-center">{previewImage.title}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Attachment Confirmation Dialog */}
      <AlertDialog open={!!attachmentToDelete} onOpenChange={(open) => !open && setAttachmentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Attachment</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this attachment? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => attachmentToDelete && deleteAttachmentMutation.mutate(attachmentToDelete.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invoice Modal */}
      <JobInvoiceModal
        open={invoiceModalOpen}
        onOpenChange={setInvoiceModalOpen}
        jobId={parseInt(jobId)}
        jobTitle={job?.title || customerName || 'Job'}
        customerEmail={job?.client?.email}
        customerFirstName={job?.clientName?.split(' ')[0]}
      />

      {/* Notes Modal */}
      <Dialog open={isNotesModalOpen} onOpenChange={setIsNotesModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Job Notes</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Add notes about this job..."
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              rows={6}
              className="resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsNotesModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveNotes}
              disabled={updateNotesMutation.isPending}
            >
              {updateNotesMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Employee Picker Modal */}
      <Dialog open={employeesModalOpen} onOpenChange={setEmployeesModalOpen}>
        <DialogContent 
          className="w-[95vw] max-w-md p-0 gap-0" 
          hideCloseButton
          onInteractOutside={(e) => e.preventDefault()}
          preventAutoFocus
        >
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <button 
              onClick={() => setEmployeesModalOpen(false)} 
              className="text-sm text-blue-500 font-medium"
              disabled={isSavingCrew}
            >
              Cancel
            </button>
            <DialogTitle className="text-base font-semibold">ASSIGN TECHNICIANS</DialogTitle>
            <button 
              onClick={saveCrewAssignments} 
              className="text-sm text-blue-500 font-medium"
              disabled={isSavingCrew}
            >
              {isSavingCrew ? 'Saving...' : 'Done'}
            </button>
          </div>

          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <ScrollArea className="max-h-64">
            <div className="py-2">
              {employeesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Users className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                  <p className="font-medium">No team members found</p>
                </div>
              ) : (
                filteredEmployees.map((employee) => (
                  <button
                    key={employee.id}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                      selectedEmployees.includes(employee.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    onClick={() => toggleEmployee(employee.id)}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                      <User className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {`${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Unnamed'}
                      </p>
                      <p className="text-xs text-slate-500 capitalize">{employee.role?.toLowerCase()}</p>
                    </div>
                    {selectedEmployees.includes(employee.id) && (
                      <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
