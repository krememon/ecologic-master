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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ArrowLeft, User, FileText, Calendar, List, Paperclip, Upload, Trash2, Edit, Users, X, CreditCard, Loader2, CheckCircle2, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { Job, Client } from "@shared/schema";
import { JobInvoiceModal } from "@/components/JobInvoiceModal";

interface JobDetailsProps {
  jobId: string;
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

export default function JobDetails({ jobId }: JobDetailsProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { role } = useCan();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [activeTab, setActiveTab] = useState<'documents' | 'approvals'>('documents');
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string; id?: number } | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] = useState<{ id: number; title: string } | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  
  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';
  const canCreatePaymentLink = role === 'OWNER' || role === 'SUPERVISOR' || role === 'DISPATCHER' || role === 'ESTIMATOR';

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

  const invoice = invoiceData?.invoice;
  const invoiceId = invoice?.id;
  const invoiceStatus = invoice?.status;
  const isPaid = invoiceStatus?.toLowerCase() === 'paid';
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

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
          <Button onClick={() => navigate('/jobs')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Jobs
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/jobs')} className="shrink-0">
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
          
          {/* Overflow Menu for Edit/Delete */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-2">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate(`/jobs/${jobId}/edit`)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Job
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="text-red-600 focus:text-red-600"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Job
                </DropdownMenuItem>
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

          {/* Schedule Card */}
          {(job.scheduledAt || job.startDate || job.endDate) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {job.scheduledAt ? (
                    <p>{format(new Date(job.scheduledAt), 'EEEE, MMMM d, yyyy • h:mm a')}</p>
                  ) : job.startDate ? (
                    <p>{format(new Date(job.startDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}</p>
                  ) : null}
                  {job.endDate && job.startDate !== job.endDate && (
                    <p className="text-sm text-muted-foreground">
                      to {format(new Date(job.endDate + 'T12:00:00'), 'MMMM d, yyyy')}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Assigned Employees Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Assigned Employees
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
                <p className="text-muted-foreground">No employees assigned</p>
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
                  {lineItems.map((item) => (
                    <div key={item.id} className="flex justify-between items-start py-2 border-b last:border-0">
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} × ${(item.unitPriceCents / 100).toFixed(2)} / {item.unit}
                        </p>
                        {item.taxable && item.taxCents > 0 && (
                          <p className="text-xs text-muted-foreground">
                            + Tax ({item.taxNameSnapshot || 'Tax'}): ${(item.taxCents / 100).toFixed(2)}
                          </p>
                        )}
                      </div>
                      <p className="font-medium">${(item.totalCents / 100).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-2">No line items</p>
              )}
              <Separator className="my-3" />
              {(() => {
                const subtotal = lineItems.reduce((sum, item) => sum + (item.subtotalCents || item.lineTotalCents), 0);
                const totalTax = lineItems.reduce((sum, item) => sum + (item.taxCents || 0), 0);
                const grandTotal = lineItems.reduce((sum, item) => sum + (item.totalCents || item.lineTotalCents), 0);
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
          {job.description && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p 
                  className={`text-sm leading-relaxed ${
                    !isDescriptionExpanded ? 'line-clamp-3' : ''
                  }`}
                >
                  {job.description}
                </p>
                {job.description.length > 150 && (
                  <button 
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                    className="text-sm text-blue-600 hover:text-blue-800 mt-2"
                  >
                    {isDescriptionExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </CardContent>
            </Card>
          )}

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
    </div>
  );
}
