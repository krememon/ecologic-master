import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Building2, Calendar, DollarSign, MapPin, Trash2, Edit, Camera, Search, User, Users, Loader2, X, Check, ChevronDown, FolderOpen, FileText, CheckSquare, List, Upload, Paperclip, Wrench, CheckCircle2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isNativePlatform, getPlatform } from "@/lib/capacitor";
import { parseDateOnly } from "@/lib/dateUtils";
import { type Job, type Client, type Estimate, type Customer } from "@shared/schema";
import JobPhotoFeed from "@/components/JobPhotoFeed";
import { NewJobSheet } from "@/components/NewJobSheet";
import { useCan } from "@/hooks/useCan";
import { SelectCustomerModal } from "@/components/CustomerModals";
import { NewEstimateSheet } from "@/components/NewEstimateSheet";
import { ShareEstimateModal } from "@/components/ShareEstimateModal";
import { JobInvoiceModal } from "@/components/JobInvoiceModal";
import { Share2, Receipt } from "lucide-react";
import { formatEstimateRequestedSchedule } from "@/utils/scheduleDate";
import { formatCurrency } from "@/lib/utils";
import { useSignatureAfterPayment } from "@/hooks/useSignatureAfterPayment";
import { PendingSignatureBanner } from "@/components/PendingSignatureBanner";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";

interface JobWithClient extends Job {
  client?: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  primaryLineItem?: string | null;
  isPaid?: boolean;
  invoicePaymentStatus?: string | null;
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Jobs() {
  const isAndroid = isNativePlatform() && getPlatform() === 'android';
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { role } = useCan();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  
  const {
    isModalOpen: sigModalOpen,
    pendingPayment: sigPendingPayment,
    hasPendingSignature,
    onSignatureComplete: handleSigComplete,
    onModalDismiss: handleSigDismiss,
    openPendingModal: openSigModal,
  } = useSignatureAfterPayment();
  
  // Redirect technicians away from Jobs page - they use Home/Schedule instead
  useEffect(() => {
    if (role === 'TECHNICIAN') {
      setLocation('/');
    }
  }, [role, setLocation]);
  
  // Parse URL search params to get initial tab
  const getInitialTab = (): 'jobs' | 'estimates' => {
    const params = new URLSearchParams(searchString);
    const tabParam = params.get('tab');
    if (tabParam === 'estimates') return 'estimates';
    return 'jobs';
  };
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobWithClient | null>(null);
  const [jobToDelete, setJobToDelete] = useState<{ id: number; title: string } | null>(null);
  const [jobToArchive, setJobToArchive] = useState<{ id: number; title: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalFileInputRef = useRef<HTMLInputElement>(null);
  const [isPhotoUploadModalOpen, setIsPhotoUploadModalOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [photoVisibility, setPhotoVisibility] = useState<'customer_internal' | 'assigned_crew_only' | 'office_only' | 'owner_only'>('assigned_crew_only');
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [crewJobId, setCrewJobId] = useState<number | null>(null); // Separate state for crew editing
  const [technicianSearch, setTechnicianSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [originalAssignedIds, setOriginalAssignedIds] = useState<Set<string>>(new Set());
  const [jobModalTab, setJobModalTab] = useState<'documents' | 'approvals'>('documents');
  const [mainPageTab, setMainPageTab] = useState<'jobs' | 'estimates'>(getInitialTab());
  
  // Estimates tab filters
  const [estimatesCustomerFilter, setEstimatesCustomerFilter] = useState<'all' | number>('all');
  const [estimatesCustomerPickerOpen, setEstimatesCustomerPickerOpen] = useState(false);
  const [estimatesCustomerSearchQuery, setEstimatesCustomerSearchQuery] = useState('');
  
  // Bulk selection mode for estimates
  const [isEstimateSelectionMode, setIsEstimateSelectionMode] = useState(false);
  const [selectedEstimateIds, setSelectedEstimateIds] = useState<Set<number>>(new Set());
  const [estimateDeleteConfirmOpen, setEstimateDeleteConfirmOpen] = useState(false);
  
  // Customer selection for estimates
  const [selectCustomerModalOpen, setSelectCustomerModalOpen] = useState(false);
  const [selectedCustomerForEstimate, setSelectedCustomerForEstimate] = useState<Customer | null>(null);
  
  // New Estimate Sheet state
  const [isNewEstimateSheetOpen, setIsNewEstimateSheetOpen] = useState(false);
  const [shareEstimateData, setShareEstimateData] = useState<{
    id: number;
    estimateNumber: string;
    customerEmail?: string | null;
    customerFirstName?: string | null;
  } | null>(null);
  
  // Invoice modal state
  const [invoiceJobData, setInvoiceJobData] = useState<{ 
    id: number; 
    title: string; 
    customerEmail?: string | null; 
    customerFirstName?: string | null;
  } | null>(null);
  
  // Check if user is admin (Owner or Supervisor)
  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';
  
  // RBAC: Owner, Supervisor can share estimates
  const canShareEstimates = role === 'OWNER' || role === 'SUPERVISOR';
  
  // RBAC: Owner, Supervisor can generate invoices
  const canGenerateInvoices = role === 'OWNER' || role === 'SUPERVISOR';

  // Reset description expansion and tab when job changes
  useEffect(() => {
    setIsDescriptionExpanded(false);
    setJobModalTab('documents');
  }, [selectedJob?.id]);
  
  // Check if user can access estimates (Technician cannot)
  const canAccessEstimates = role !== 'TECHNICIAN';
  
  // Sync mainPageTab with URL search params when they change (e.g., browser back/forward)
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const tabParam = params.get('tab');
    if (tabParam === 'estimates' && canAccessEstimates) {
      setMainPageTab('estimates');
    } else if (tabParam === 'jobs' || !tabParam) {
      setMainPageTab('jobs');
    }
  }, [searchString, canAccessEstimates]);
  
  // Handle create=true and createEstimate=true URL params from global create menu
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get('create') === 'true') {
      setIsDialogOpen(true);
      // Clear the param from URL
      params.delete('create');
      const newSearch = params.toString();
      setLocation(newSearch ? `/jobs?${newSearch}` : '/jobs', { replace: true });
    }
    if (params.get('createEstimate') === 'true' && canAccessEstimates) {
      setIsNewEstimateSheetOpen(true);
      setMainPageTab('estimates');
      // Clear the param from URL
      params.delete('createEstimate');
      const newSearch = params.toString();
      setLocation(newSearch ? `/jobs?${newSearch}` : '/jobs?tab=estimates', { replace: true });
    }
  }, [searchString, canAccessEstimates, setLocation]);
  
  // Defensive: reset main page tab to 'jobs' if user cannot access estimates
  useEffect(() => {
    if (!canAccessEstimates && mainPageTab === 'estimates') {
      setMainPageTab('jobs');
    }
  }, [canAccessEstimates, mainPageTab]);

  // Utility function for Google Places dropdown detection using composedPath
  const isInPacContainer = (event: Event): boolean => {
    // works with shadow DOM / composedPath
    const path = (event as any).composedPath ? (event as any).composedPath() : ((event as any).path || []);
    return path.some((el: any) =>
      el && el.classList && (
        el.classList.contains('pac-container') ||
        el.classList.contains('gm-style-pac-container') ||
        el.classList.contains('autocomplete-container') ||
        el.classList.contains('pac-item')
      )
    );
  };


  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  // Prevent modal closing when clicking Google Places autocomplete
  const handleInteractOutside = (event: Event) => {
    // If click was inside Google Places dropdown, prevent modal from closing
    if (isInPacContainer(event)) {
      event.preventDefault();
    }
  };


  const { data: rawJobs = [], isLoading: jobsLoading } = useQuery<JobWithClient[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });
  
  // De-duplicate jobs as a safety measure (in case of query issues)
  const jobs = Array.from(new Map(rawJobs.map(j => [j.id, j])).values());

  // Fetch all estimates for the main page tab (only if user can access estimates)
  const { data: allEstimates = [], isLoading: estimatesLoading, error: estimatesError } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
    enabled: isAuthenticated && canAccessEstimates && mainPageTab === 'estimates',
  });

  // Fetch customers for filtering
  const { data: allCustomers = [] } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
    enabled: isAuthenticated && canAccessEstimates,
  });
  
  // Fetch company profile for invoice email
  const { data: companyProfile } = useQuery<{ name: string }>({
    queryKey: ['/api/company/profile'],
    enabled: isAuthenticated,
  });

  // Filter estimates based on customer and status filters
  const filteredEstimates = useMemo(() => {
    let result = allEstimates;
    
    // Filter by customer
    if (estimatesCustomerFilter !== 'all') {
      result = result.filter(est => est.customerId === estimatesCustomerFilter);
    }
    
    return result;
  }, [allEstimates, estimatesCustomerFilter]);

  // Filter customers for estimates customer picker (case-insensitive search by name or email)
  const estimatesFilteredCustomers = useMemo(() => {
    const query = estimatesCustomerSearchQuery.trim().toLowerCase();
    if (!query) return allCustomers.slice(0, 100);
    return allCustomers.filter(customer => {
      const firstName = (customer.firstName || '').toLowerCase();
      const lastName = (customer.lastName || '').toLowerCase();
      const fullName = `${firstName} ${lastName}`;
      const email = (customer.email || '').toLowerCase();
      return firstName.includes(query) || lastName.includes(query) || fullName.includes(query) || email.includes(query);
    }).slice(0, 100);
  }, [allCustomers, estimatesCustomerSearchQuery]);

  // Get selected customer label for filter dropdown
  const selectedCustomerForFilterLabel = useMemo(() => {
    if (estimatesCustomerFilter === 'all') return 'All customers';
    const customer = allCustomers.find(c => c.id === estimatesCustomerFilter);
    if (!customer) return 'Unknown customer';
    return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email || 'Unknown';
  }, [estimatesCustomerFilter, allCustomers]);

  // Fetch photos from legacy endpoint
  const { data: legacyJobPhotos = [] } = useQuery<JobPhoto[]>({
    queryKey: [`/api/jobs/${selectedJob?.id}/photos`],
    enabled: !!selectedJob?.id,
  });

  // Fetch documents for this job (to include uploaded photos via documents endpoint)
  interface JobDocument {
    id: number;
    jobId: number;
    name: string;
    fileUrl: string;
    category: string;
    visibility: string;
    createdAt: string;
    uploadedBy: string;
  }
  const { data: allDocuments = [] } = useQuery<JobDocument[]>({
    queryKey: ['/api/documents'],
    enabled: isAuthenticated,
  });

  // Combine legacy photos with document photos for display
  const jobDocumentPhotos = allDocuments
    .filter(doc => doc.jobId === selectedJob?.id && doc.category === 'Photos')
    .map(doc => ({
      id: doc.id + 100000, // Offset to avoid ID collision
      jobId: doc.jobId,
      uploadedBy: doc.uploadedBy,
      title: doc.name,
      description: null,
      photoUrl: doc.fileUrl,
      location: null,
      phase: null,
      weather: null,
      isPublic: doc.visibility === 'customer_internal',
      createdAt: doc.createdAt,
      isDocument: true, // Flag to distinguish source
    }));

  // Merge legacy photos and document photos (documents first, then legacy)
  const jobPhotos = [...jobDocumentPhotos, ...legacyJobPhotos];

  // Fetch current crew assignments for crew modal (uses crewJobId, not selectedJob)
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
  const { data: crewAssignments = [] } = useQuery<CrewAssignment[]>({
    queryKey: ['/api/jobs', crewJobId, 'crew'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${crewJobId}/crew`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch crew');
      return res.json();
    },
    enabled: !!crewJobId && isAdmin,
  });
  
  // Fetch crew for Job Insights modal display (read-only, available to all users)
  const { data: selectedJobCrew = [] } = useQuery<CrewAssignment[]>({
    queryKey: ['/api/jobs', selectedJob?.id, 'crew'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${selectedJob?.id}/crew`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch crew');
      return res.json();
    },
    enabled: !!selectedJob?.id,
  });

  // Fetch line items for selected job
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
    lineTotalCents: number;
    sortOrder: number;
  }
  const { data: selectedJobLineItems = [] } = useQuery<JobLineItem[]>({
    queryKey: ['/api/jobs', selectedJob?.id, 'line-items'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${selectedJob?.id}/line-items`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch line items');
      return res.json();
    },
    enabled: !!selectedJob?.id,
  });
  
  // Get set of already assigned user IDs
  const assignedUserIds = new Set(crewAssignments.map(a => a.userId));

  // Initialize crew modal state when it opens or when crewAssignments data changes
  useEffect(() => {
    if (!isAssignModalOpen) return;
    
    const assignedIds = crewAssignments.map(a => a.userId);
    setOriginalAssignedIds(new Set(assignedIds));
    setSelectedUserIds(new Set(assignedIds));
  }, [isAssignModalOpen, crewAssignments]);

  // Fetch company members for assignment (only fetch when modal is open)
  // The /api/org/users endpoint automatically filters by the current user's company
  interface OrgUser {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    role: string;
    status: string;
    profileImageUrl: string | null;
  }
  const { data: crewMembersData, isLoading: crewMembersLoading } = useQuery<{ users: OrgUser[] }>({
    queryKey: ["/api/org/users?status=ACTIVE"],
    enabled: isAssignModalOpen && isAdmin,
  });
  
  // Assignable roles: all field workers (exclude Owner from assignment list)
  // Roles are stored as UPPERCASE in database
  const ASSIGNABLE_ROLES = ['TECHNICIAN', 'SUPERVISOR', 'PROJECT_MANAGER', 'ADMIN_ASSISTANT'];
  const assignableMembers = (crewMembersData?.users || []).filter(
    member => ASSIGNABLE_ROLES.includes(member.role?.toUpperCase())
  );
  
  // Filter by search (name or email, case-insensitive)
  const filteredTechnicians = assignableMembers.filter(tech => {
    const searchTerm = technicianSearch.trim().toLowerCase();
    if (!searchTerm) return true;
    const name = `${tech.firstName || ''} ${tech.lastName || ''}`.toLowerCase();
    return name.includes(searchTerm) || tech.email.toLowerCase().includes(searchTerm);
  });

  const filteredJobs = jobs.filter(job => {
    if (job.status === 'archived') return false;
    
    // For TECHNICIAN role, only show jobs assigned to them (via crew assignments)
    if (role === 'TECHNICIAN') {
      const assignedIds = (job as any).assignedEmployeeIds || [];
      if (!assignedIds.includes(user?.id)) {
        return false;
      }
    }
    
    // Then apply search filter
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.trim().toLowerCase();
    const matchesTitle = job.title.toLowerCase().includes(query);
    const matchesLocation = job.location ? job.location.toLowerCase().includes(query) : false;
    const matchesStatus = job.status.toLowerCase().includes(query);
    const matchesClient = (job.clientName ? job.clientName.toLowerCase().includes(query) : false) || 
                         (job.client?.name ? job.client.name.toLowerCase().includes(query) : false);
    
    return matchesTitle || matchesLocation || matchesStatus || matchesClient;
  });

  const createJobMutation = useMutation({
    mutationFn: async (wizardData: {
      job: any;
      client: 
        | { mode: "existing"; id: number }
        | { mode: "new"; data: any };
      schedule: any;
    }) => {
      const res = await apiRequest("POST", "/api/jobs/finalize", wizardData);
      return await res.json();
    },
    onSuccess: (newJob) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      // Invalidate the customer's jobs list so it appears on their detail page
      if (newJob.customerId) {
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${newJob.customerId}/jobs`] });
      }
      // Invalidate all schedule queries (with any date range)
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      setIsDialogOpen(false);
      // Ensure no job detail/insights overlay opens - stay on jobs list
      setSelectedJob(null);
      // Navigate to jobs list (ensure we're on the correct route)
      setLocation("/jobs");
    },
    onError: (error: Error) => {
      // Try to parse error message for field-specific errors
      let errorMessage = error.message;
      let errorTitle = "Error";
      
      // Error format is "STATUS: {json}" from apiRequest
      const match = error.message.match(/^\d+:\s*({.*})/);
      if (match) {
        try {
          const errorData = JSON.parse(match[1]);
          if (errorData.code === 'INVALID_TIME_RANGE') {
            errorTitle = "Invalid Schedule";
            errorMessage = "End time must be after start time";
          } else if (errorData.code === 'INVALID_DATETIME') {
            errorTitle = "Invalid Date/Time";
            errorMessage = "Please enter valid start and end times";
          } else if (errorData.code === 'MISSING_DATETIME') {
            errorTitle = "Missing Date/Time";
            errorMessage = "Start and end date/time are required";
          } else if (errorData.code === 'MISSING_CLIENT' || errorData.code === 'CLIENT_NOT_FOUND') {
            errorTitle = "Client Required";
            errorMessage = "Please select a client";
          } else if (errorData.code === 'VALIDATION_ERROR') {
            errorTitle = "Validation Error";
            errorMessage = errorData.message || "Please check your inputs";
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch (e) {
          // If parsing fails, use original message
        }
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      console.debug('Deleting job', jobId);
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 204) {
        return { success: true, softDeleted: false };
      } else if (res.status === 200) {
        const data = await res.json();
        return { success: true, softDeleted: !!data.softDeleted };
      } else if (res.status === 409) {
        const data = await res.json();
        throw new Error(data.code === 'JOB_HAS_REFERENCES' ? 'HAS_REFERENCES' : data.message);
      } else if (res.status === 401) {
        throw new Error('Unauthorized');
      }
      throw new Error('Failed to delete job');
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      setJobToDelete(null);
    },
    onError: (error: Error) => {
      if (error.message === 'Unauthorized') {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      if (error.message === 'HAS_REFERENCES') {
        setJobToArchive(jobToDelete);
        setJobToDelete(null);
        return;
      }
      toast({
        title: "Unable to delete",
        description: error.message || "Failed to delete job",
      });
    },
  });

  const archiveJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await apiRequest("PATCH", `/api/jobs/${jobId}/archive`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      setJobToArchive(null);
      toast({ title: "Job archived successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to archive job",
        variant: "destructive",
      });
    },
  });

  const markCompletedMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await apiRequest("PATCH", `/api/jobs/${jobId}`, { status: "completed" });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      toast({ title: "Job marked as completed" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark job as completed",
        variant: "destructive",
      });
    },
  });

  // Photo upload mutation
  const uploadPhotoMutation = useMutation({
    mutationFn: async ({ jobId, formData }: { jobId: number; formData: FormData }) => {
      const res = await fetch(`/api/jobs/${jobId}/photos`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${selectedJob?.id}/photos`] });
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      // No success toast - visual feedback via thumbnail update and counter
    },
    onError: (error: Error) => {
      console.error('jobphoto:upload:error', { jobId: selectedJob?.id, error });
      setIsUploading(false);
      setUploadProgress(0);
      toast({
        title: "Error",
        description: "Upload failed — try again.",
        variant: "destructive",
      });
    },
  });

  // Document upload mutation (for uploads with visibility selection)
  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ formData }: { formData: FormData }) => {
      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${selectedJob?.id}/photos`] });
      setIsUploading(false);
      setUploadProgress(0);
      setIsPhotoUploadModalOpen(false);
      setPendingUploadFile(null);
      setPhotoVisibility('assigned_crew_only');
      if (modalFileInputRef.current) {
        modalFileInputRef.current.value = '';
      }
      toast({
        title: "Document uploaded",
        description: "Your file has been uploaded successfully.",
      });
    },
    onError: (error: Error) => {
      console.error('document:upload:error', { jobId: selectedJob?.id, error });
      setIsUploading(false);
      setUploadProgress(0);
      toast({
        title: "Upload failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update crew mutation (handles both add and remove)
  const updateCrewMutation = useMutation({
    mutationFn: async ({ jobId, toAdd, toRemove }: { jobId: number; toAdd: string[]; toRemove: string[] }) => {
      const results = { added: 0, removed: 0 };
      
      // Add new crew members
      if (toAdd.length > 0) {
        const addRes = await apiRequest("POST", `/api/jobs/${jobId}/crew`, { userIds: toAdd });
        const addData = await addRes.json();
        results.added = addData.added || 0;
      }
      
      // Remove crew members
      if (toRemove.length > 0) {
        const removeRes = await apiRequest("POST", `/api/jobs/${jobId}/crew/remove`, { userIds: toRemove });
        const removeData = await removeRes.json();
        results.removed = removeData.removed || 0;
      }
      
      return results;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', variables.jobId, 'crew'] });
      setIsAssignModalOpen(false);
      setCrewJobId(null);
      setTechnicianSearch("");
      setSelectedUserIds(new Set());
      setOriginalAssignedIds(new Set());
      
      // Build description message
      const parts = [];
      if (result.added > 0) parts.push(`${result.added} added`);
      if (result.removed > 0) parts.push(`${result.removed} removed`);
      
      toast({
        title: "Crew Updated",
        description: parts.length > 0 ? parts.join(', ') : "No changes made",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update crew",
        variant: "destructive",
      });
    },
  });

  // Bulk delete estimates mutation
  const bulkDeleteEstimatesMutation = useMutation({
    mutationFn: async (estimateIds: number[]) => {
      console.log("[EstimatesDelete] deleting ids:", estimateIds);
      const results = await Promise.all(
        estimateIds.map(async (id) => {
          try {
            const res = await fetch(`/api/estimates/${id}`, { 
              method: "DELETE", 
              credentials: "include" 
            });
            if (res.status === 204 || res.ok) {
              return { id, success: true, error: null };
            } else {
              const data = await res.json().catch(() => ({ message: "Delete failed" }));
              return { id, success: false, error: data.message || "Delete failed" };
            }
          } catch (err: any) {
            return { id, success: false, error: err.message || "Network error" };
          }
        })
      );
      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length;
      const failedResults = results.filter(r => !r.success);
      
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      setSelectedEstimateIds(new Set());
      setIsEstimateSelectionMode(false);
      setEstimateDeleteConfirmOpen(false);
      
      if (failedResults.length === 0) {
        // All deletes succeeded - no toast needed (per user request)
      } else if (successCount > 0) {
        toast({
          title: "Partially deleted",
          description: `Deleted ${successCount}, but ${failedResults.length} failed: ${failedResults[0].error}`,
          variant: "destructive",
        });
      } else {
        const firstError = failedResults[0]?.error || "Unknown error";
        toast({
          title: "Delete failed",
          description: firstError,
          variant: "destructive",
        });
      }
    },
    onError: () => {
      setEstimateDeleteConfirmOpen(false);
      toast({
        title: "Error",
        description: "Failed to delete estimates.",
        variant: "destructive",
      });
    },
  });

  // Toggle estimate selection
  const toggleEstimateSelection = (estimateId: number) => {
    setSelectedEstimateIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(estimateId)) {
        newSet.delete(estimateId);
      } else {
        newSet.add(estimateId);
      }
      return newSet;
    });
  };

  // Exit estimate selection mode
  const exitEstimateSelectionMode = () => {
    setIsEstimateSelectionMode(false);
    setSelectedEstimateIds(new Set());
  };

  // Validate file before upload (images only - for legacy photo endpoint)
  const validateFile = (file: File): string | null => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
    const maxSize = 15 * 1024 * 1024; // 15 MB

    if (!allowedTypes.includes(file.type)) {
      return 'Invalid file type. Please upload JPEG, PNG, HEIC, or WebP images.';
    }

    if (file.size > maxSize) {
      return 'File too large. Maximum size is 15 MB.';
    }

    return null;
  };

  // Validate file for document upload (accepts more file types)
  const validateDocumentFile = (file: File): string | null => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/gif',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv'
    ];
    const maxSize = 25 * 1024 * 1024; // 25 MB

    if (!allowedTypes.includes(file.type)) {
      return 'Invalid file type. Please upload images, PDFs, or common document files.';
    }

    if (file.size > maxSize) {
      return 'File too large. Maximum size is 25 MB.';
    }

    return null;
  };

  // Determine category based on file type
  const getCategoryFromMimeType = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return 'Photos';
    return 'Other';
  };

  // Handle file selection in modal
  const handleModalFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validationError = validateDocumentFile(file);
    if (validationError) {
      toast({
        title: "Error",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    setPendingUploadFile(file);
  };

  // Handle document upload from modal
  const handleDocumentUpload = () => {
    if (!pendingUploadFile || !selectedJob) return;

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', pendingUploadFile);
    formData.append('name', pendingUploadFile.name);
    formData.append('category', getCategoryFromMimeType(pendingUploadFile.type));
    formData.append('jobId', selectedJob.id.toString());
    formData.append('visibility', photoVisibility);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + 10;
      });
    }, 100);

    uploadDocumentMutation.mutate({ formData }, {
      onSettled: () => {
        clearInterval(progressInterval);
        setUploadProgress(100);
      }
    });
  };

  // Open upload modal
  const openPhotoUploadModal = () => {
    setPendingUploadFile(null);
    setPhotoVisibility('assigned_crew_only');
    setIsPhotoUploadModalOpen(true);
  };

  // Handle photo upload (legacy - direct upload without visibility)
  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedJob) return;

    const validationError = validateFile(file);
    if (validationError) {
      toast({
        title: "Error",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('photo', file);
    formData.append('location', '');

    // Simulate progress (since fetch doesn't provide upload progress easily)
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + 10;
      });
    }, 100);

    uploadPhotoMutation.mutate({ jobId: selectedJob.id, formData }, {
      onSettled: () => {
        clearInterval(progressInterval);
        setUploadProgress(100);
      }
    });
  };

  if (isLoading || !isAuthenticated || jobsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="w-full pb-24">
      {hasPendingSignature && (
        <PendingSignatureBanner onCapture={openSigModal} />
      )}
      {sigPendingPayment && (
        <SignatureCaptureModal
          open={sigModalOpen}
          onOpenChange={handleSigDismiss}
          paymentId={sigPendingPayment.paymentId}
          jobId={sigPendingPayment.jobId}
          invoiceId={sigPendingPayment.invoiceId}
          required
          onComplete={handleSigComplete}
        />
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Jobs & Estimates</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage projects and create estimates for your clients</p>
      </div>

      <NewJobSheet 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        onJobCreated={() => {
          // Job created - stay on jobs list, don't open any modal
          setSelectedJob(null);
        }}
      />


      {/* Job Detail Modal - Estimate-style layout */}
      <Dialog open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <DialogContent className="w-[98vw] max-w-4xl h-[95vh] overflow-y-auto overflow-x-hidden p-0 rounded-2xl border-0 shadow-2xl" onInteractOutside={handleInteractOutside}>
          {/* Clean Header - matches Estimate detail */}
          <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-4 md:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setSelectedJob(null)}
                  className="flex-shrink-0"
                >
                  <X className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold truncate" data-testid="job-header">
                    {selectedJob?.clientName || selectedJob?.client?.name 
                      ? `Job for ${selectedJob?.clientName || selectedJob?.client?.name}`
                      : selectedJob?.title}
                  </h1>
                  {selectedJob?.title && (selectedJob?.clientName || selectedJob?.client?.name) && (
                    <p className="text-sm text-muted-foreground truncate">{selectedJob.title}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedJob) {
                      const jobId = selectedJob.id;
                      setSelectedJob(null);
                      setTimeout(() => setLocation(`/jobs/${jobId}/edit`), 0);
                    }
                  }}
                  data-testid="button-edit-job"
                >
                  <Edit className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
                {selectedJob && selectedJob.status !== 'completed' && selectedJob.status !== 'cancelled' && selectedJob.status !== 'archived' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/30"
                    onClick={() => {
                      if (selectedJob) {
                        markCompletedMutation.mutate(selectedJob.id);
                      }
                    }}
                    disabled={markCompletedMutation.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    {markCompletedMutation.isPending ? 'Completing...' : 'Complete'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedJob) {
                      setJobToDelete({ id: selectedJob.id, title: selectedJob.title });
                      setSelectedJob(null);
                    }
                  }}
                  data-testid="button-delete-job"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {selectedJob && (
                  selectedJob.status === 'cancelled' ? (
                    <Badge className="text-sm bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      Cancelled
                    </Badge>
                  ) : selectedJob.status === 'completed' ? (
                    <Badge className="text-sm bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100">
                      Completed
                    </Badge>
                  ) : selectedJob.isPaid ? (
                    <Badge 
                      className="text-sm bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100"
                    >
                      Paid
                    </Badge>
                  ) : selectedJob.invoicePaymentStatus === 'partial' ? (
                    <Badge 
                      className="text-sm bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-100"
                    >
                      Partial
                    </Badge>
                  ) : (
                    <Badge 
                      variant={selectedJob.status === 'active' ? 'default' : 'secondary'}
                      className="text-sm capitalize"
                    >
                      {selectedJob.status}
                    </Badge>
                  )
                )}
              </div>
            </div>
            
            {/* Segmented Tab Switcher */}
            <div className="mt-4" data-testid="job-tab-switcher">
              <div className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 p-1">
                <button
                  onClick={() => setJobModalTab('documents')}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    jobModalTab === 'documents'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                  data-testid="tab-documents"
                >
                  Documents
                </button>
                <button
                  onClick={() => setJobModalTab('approvals')}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    jobModalTab === 'approvals'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                  data-testid="tab-approvals"
                >
                  E-signature Approvals
                </button>
              </div>
            </div>
          </div>

          {/* Tab Content - Card-based sections like Estimates */}
          {selectedJob && jobModalTab === 'documents' && (
            <div className="p-4 md:p-6 space-y-6" data-testid="job-sections-stack">
              {/* Customer Card */}
              <Card data-testid="job-customer-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Customer
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(selectedJob.clientName || selectedJob.client?.name) ? (
                    <div className="space-y-1">
                      <p className="font-medium" data-testid="text-job-client-detail">
                        {selectedJob.clientName || selectedJob.client?.name}
                      </p>
                      {selectedJob.client?.email && (
                        <p className="text-sm text-muted-foreground">{selectedJob.client.email}</p>
                      )}
                      {selectedJob.client?.phone && (
                        <p className="text-sm text-muted-foreground">{selectedJob.client.phone}</p>
                      )}
                      {selectedJob.location && (
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedJob.location)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          data-testid="link-job-location-detail"
                        >
                          {selectedJob.location}
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No customer assigned</p>
                  )}
                </CardContent>
              </Card>

              {/* Job Type Card */}
              {selectedJob.jobType && (
                <Card data-testid="job-type-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Job Type
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p data-testid="text-job-type-detail">{selectedJob.jobType}</p>
                  </CardContent>
                </Card>
              )}

              {/* Schedule Card */}
              {(selectedJob.startDate || selectedJob.endDate) && (
                <Card data-testid="job-schedule-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {selectedJob.startDate && (
                        <p>{format(parseDateOnly(selectedJob.startDate) ?? new Date(), 'EEEE, MMMM d, yyyy')}</p>
                      )}
                      {selectedJob.endDate && selectedJob.startDate !== selectedJob.endDate && (
                        <p className="text-sm text-muted-foreground">
                          to {format(parseDateOnly(selectedJob.endDate) ?? new Date(), 'MMMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Assigned Employees Card */}
              <Card data-testid="job-crew-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Assigned Employees
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedJobCrew.length > 0 ? (
                    <div className="flex items-center gap-3" data-testid="text-job-assigned">
                      <div className="flex -space-x-2 flex-shrink-0">
                        {selectedJobCrew.slice(0, 4).map((assignment) => {
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
                        {selectedJobCrew.length > 4 && (
                          <div className="h-8 w-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-medium">
                            +{selectedJobCrew.length - 4}
                          </div>
                        )}
                      </div>
                      <div className="text-sm">
                        {selectedJobCrew.map(a => 
                          `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() || a.user.email.split('@')[0]
                        ).slice(0, 3).join(', ')}
                        {selectedJobCrew.length > 3 && ` +${selectedJobCrew.length - 3} more`}
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No employees assigned</p>
                  )}
                </CardContent>
              </Card>

              {/* Line Items Card */}
              <Card data-testid="job-line-items-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <List className="h-5 w-5" />
                    Line Items
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedJobLineItems.length > 0 ? (
                    <div className="space-y-3">
                      {selectedJobLineItems.map((item) => (
                        <div key={item.id} className="flex justify-between items-start py-2 border-b last:border-0">
                          <div className="flex-1">
                            <p className="font-medium">{item.name}</p>
                            {item.description && (
                              <p className="text-sm text-muted-foreground">{item.description}</p>
                            )}
                            <p className="text-sm text-muted-foreground">
                              {item.quantity} × {formatCurrency(item.unitPriceCents)} / {item.unit}
                            </p>
                          </div>
                          <p className="font-medium">{formatCurrency(item.lineTotalCents)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-2">No line items</p>
                  )}
                  <Separator className="my-3" />
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span>{formatCurrency(selectedJobLineItems.reduce((sum, item) => sum + item.lineTotalCents, 0))}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Description Card */}
              {selectedJob.description && (
                <Card data-testid="job-description-card">
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
                      {selectedJob.description}
                    </p>
                    {selectedJob.description.length > 150 && (
                      <button 
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                        className="text-sm text-blue-600 hover:text-blue-800 mt-2"
                        data-testid="button-toggle-description"
                      >
                        {isDescriptionExpanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Attachments/Photos Card - Estimate style */}
              <Card data-testid="job-photos-card">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Paperclip className="h-5 w-5" />
                      Attachments
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openPhotoUploadModal}
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
                        <div key={photo.id} className="relative group cursor-pointer">
                          <img
                            src={photo.photoUrl}
                            alt={photo.title || "Job attachment"}
                            className="w-full h-24 object-cover rounded-lg border hover:opacity-90 transition-opacity"
                          />
                          <p className="text-xs truncate mt-1">{photo.title || 'Photo'}</p>
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
          {selectedJob && jobModalTab === 'approvals' && (
            <div className="p-4 md:p-6" data-testid="approvals-tab-content">
              <Card>
                <CardContent className="flex flex-col items-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">E-signature Approvals</p>
                  <p className="text-sm text-muted-foreground text-center">
                    Signature requests for this job will appear here.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Hidden file input for photo upload (legacy) */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoUpload}
            className="hidden"
            aria-label="Upload photo"
          />

          {/* Photo Upload Modal with Visibility Selection */}
          <Dialog open={isPhotoUploadModalOpen} onOpenChange={setIsPhotoUploadModalOpen}>
            <DialogContent className="sm:max-w-[425px] rounded-2xl">
              <DialogHeader>
                <DialogTitle>Upload Photo or Document</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* File Picker */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Select File
                  </label>
                  <div className="flex flex-col gap-2">
                    <input
                      ref={modalFileInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                      onChange={handleModalFileSelect}
                      className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900 dark:file:text-blue-300"
                      data-testid="input-file-upload"
                    />
                    {pendingUploadFile && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Selected: {pendingUploadFile.name} ({(pendingUploadFile.size / 1024 / 1024).toFixed(2)} MB)
                      </p>
                    )}
                  </div>
                </div>

                {/* Visibility Dropdown */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Who can see this?
                  </label>
                  <Select value={photoVisibility} onValueChange={(value: any) => setPhotoVisibility(value)}>
                    <SelectTrigger className="w-full" data-testid="select-visibility">
                      <SelectValue placeholder="Select visibility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer_internal">Everyone</SelectItem>
                      <SelectItem value="assigned_crew_only">Assigned Crew Only</SelectItem>
                      <SelectItem value="office_only">Office Only</SelectItem>
                      <SelectItem value="owner_only">Owner Only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {photoVisibility === 'customer_internal' && 'Visible to customers and all team members'}
                    {photoVisibility === 'assigned_crew_only' && 'Only visible to crew assigned to this job'}
                    {photoVisibility === 'office_only' && 'Only visible to office staff'}
                    {photoVisibility === 'owner_only' && 'Only visible to the company owner'}
                  </p>
                </div>

                {/* Upload Progress */}
                {isUploading && uploadProgress > 0 && (
                  <div className="w-full">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
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

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-2">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setIsPhotoUploadModalOpen(false);
                      setPendingUploadFile(null);
                    }}
                    disabled={isUploading}
                    data-testid="button-cancel-upload"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleDocumentUpload}
                    disabled={!pendingUploadFile || isUploading}
                    data-testid="button-confirm-upload"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Camera className="h-4 w-4 mr-2" />
                        Upload
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>

      {/* Main Page Tabs: Jobs | Estimates (styled like Documents page) */}
      <Tabs value={mainPageTab} onValueChange={(value) => setMainPageTab(value as 'jobs' | 'estimates')} className="w-full">
        <TabsList className={canAccessEstimates ? "grid w-full grid-cols-2" : "grid w-full grid-cols-1"}>
          <TabsTrigger value="jobs" className="flex items-center gap-2" data-testid="tab-main-jobs">
            <Building2 className="h-4 w-4" />
            Jobs
          </TabsTrigger>
          {canAccessEstimates && (
            <TabsTrigger value="estimates" className="flex items-center gap-2" data-testid="tab-main-estimates">
              <DollarSign className="h-4 w-4" />
              Estimates
            </TabsTrigger>
          )}
        </TabsList>

        {/* ESTIMATES TAB CONTENT - RBAC guarded */}
        {canAccessEstimates && (
        <TabsContent value="estimates" className="mt-6">
          <div className="w-full flex justify-center">
          <div className="w-full max-w-[640px] px-4">
          {/* Filter Row: Customer Picker + Status Dropdown + Select Button */}
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex items-center gap-2 w-full">
              <Button 
                variant="outline" 
                className="flex-[2] min-w-0 justify-between"
                onClick={() => setEstimatesCustomerPickerOpen(true)}
                disabled={isEstimateSelectionMode}
                data-testid="button-estimates-customer-picker"
              >
                <span className="truncate">{selectedCustomerForFilterLabel}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (isEstimateSelectionMode) {
                    exitEstimateSelectionMode();
                  } else {
                    setIsEstimateSelectionMode(true);
                  }
                }}
                className="shrink-0 px-3"
                data-testid="button-estimates-select-mode"
              >
                {isEstimateSelectionMode ? (
                  "Cancel"
                ) : (
                  <>
                    <CheckSquare className="h-4 w-4 mr-1.5" />
                    Select
                  </>
                )}
              </Button>
            </div>

            {/* Selected Customer Chip */}
            {estimatesCustomerFilter !== 'all' && (
              <div className="flex items-center gap-2">
                <Badge 
                  variant="secondary" 
                  className="flex items-center gap-1 px-3 py-1.5 text-sm"
                  data-testid="chip-selected-estimate-customer"
                >
                  <User className="h-3 w-3" />
                  <span className="truncate max-w-[200px]">{selectedCustomerForFilterLabel}</span>
                  <button 
                    onClick={() => setEstimatesCustomerFilter('all')}
                    className="ml-1 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-full p-0.5"
                    data-testid="button-clear-estimate-customer-filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              </div>
            )}
            
            {/* Create Estimate Button (prominent like Documents upload button) */}
            {canAccessEstimates && (
              <Button 
                className="w-full"
                onClick={() => setIsNewEstimateSheetOpen(true)}
                data-testid="button-create-estimate"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Estimate
              </Button>
            )}
          </div>

          {/* Estimates List */}
          {estimatesLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : estimatesError ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-red-600">Failed to load estimates</p>
              </CardContent>
            </Card>
          ) : filteredEstimates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <DollarSign className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  {allEstimates.length === 0 ? 'No estimates yet' : 'No estimates match filters'}
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-center">
                  {allEstimates.length === 0 
                    ? 'Click "Create Estimate" to get started.' 
                    : 'Try adjusting your filters.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
            <div className={`w-full space-y-3 ${isEstimateSelectionMode && selectedEstimateIds.size > 0 ? 'pb-20' : ''}`}>
              {filteredEstimates.map((estimate) => {
                const job = jobs.find(j => j.id === estimate.jobId);
                const isSelected = selectedEstimateIds.has(estimate.id);
                return (
                  <Card 
                    key={estimate.id} 
                    className={`w-full hover:shadow-md transition-all cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-950 ring-2 ring-blue-400' : ''}`}
                    onClick={() => {
                      if (isEstimateSelectionMode) {
                        toggleEstimateSelection(estimate.id);
                      } else {
                        console.log("Estimate card clicked", estimate.id);
                        setLocation(`/estimates/${estimate.id}`);
                      }
                    }}
                    data-testid={`card-estimate-${estimate.id}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          {isEstimateSelectionMode && (
                            <div 
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                                isSelected 
                                  ? 'bg-blue-600 border-blue-600' 
                                  : 'border-slate-300 dark:border-slate-600'
                              }`}
                            >
                              {isSelected && <Check className="h-3 w-3 text-white" />}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <DollarSign className="h-5 w-5 text-green-600 flex-shrink-0" />
                              <span className="truncate">{estimate.title || estimate.estimateNumber}</span>
                            </CardTitle>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                              {estimate.estimateNumber}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!isEstimateSelectionMode && canShareEstimates && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShareEstimateData({
                                  id: estimate.id,
                                  estimateNumber: estimate.estimateNumber,
                                  customerEmail: estimate.customerEmail,
                                  customerFirstName: estimate.customerName?.split(' ')[0] || null,
                                });
                              }}
                              title="Share Estimate"
                            >
                              <Share2 className="h-4 w-4 text-slate-500 hover:text-slate-700" />
                            </Button>
                          )}
                          <Badge 
                            variant={estimate.status === 'draft' ? 'secondary' : estimate.status === 'sent' ? 'default' : 'outline'}
                            className="capitalize"
                          >
                            {estimate.status}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-1.5">
                      {job && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{job.title}</span>
                        </div>
                      )}
                      {estimate.customerName && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <User className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{estimate.customerName}</span>
                        </div>
                      )}
                      {/* Schedule Box - Always visible (display-only) - uses scheduledDate + scheduledTime */}
                      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-medium">Schedule</span>
                        </div>
                        <div className="mt-1 text-sm">
                          {(() => {
                            const scheduledDate = (estimate as any).scheduledDate;
                            const scheduledTime = (estimate as any).scheduledTime;
                            const scheduledEndTime = (estimate as any).scheduledEndTime;
                            
                            if (!scheduledDate) {
                              return <span className="text-slate-400 dark:text-slate-500">Not scheduled</span>;
                            }
                            
                            const formatTimeDisplay = (time: string | null) => {
                              if (!time) return null;
                              try {
                                const [hours, minutes] = time.split(':').map(Number);
                                const period = hours >= 12 ? 'PM' : 'AM';
                                const displayHours = hours % 12 || 12;
                                return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
                              } catch {
                                return time;
                              }
                            };
                            
                            const startDisplay = formatTimeDisplay(scheduledTime);
                            const endDisplay = formatTimeDisplay(scheduledEndTime);
                            
                            const timeStr = startDisplay && endDisplay 
                              ? `${startDisplay} – ${endDisplay}`
                              : startDisplay || 'Scheduled';
                            
                            return (
                              <span className="text-slate-900 dark:text-slate-100">
                                {timeStr}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-100 dark:border-slate-800">
                        <span className="text-sm text-slate-500">Total</span>
                        <span className="font-semibold text-green-600">
                          {formatCurrency(estimate.totalCents || 0)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 pt-1">
                        {(() => {
                          const scheduledDateVal = (estimate as any).scheduledDate;
                          
                          const getYmd = (value: any): string | null => {
                            if (!value) return null;
                            if (value instanceof Date) {
                              if (isNaN(value.getTime())) return null;
                              const y = value.getFullYear();
                              const m = String(value.getMonth() + 1).padStart(2, '0');
                              const d = String(value.getDate()).padStart(2, '0');
                              return `${y}-${m}-${d}`;
                            }
                            if (typeof value === 'string' && value.length >= 10) {
                              return value.slice(0, 10);
                            }
                            return null;
                          };
                          
                          const formatYmd = (ymd: string): string => {
                            try {
                              const [y, m, d] = ymd.split('-').map(Number);
                              const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                              return `${months[m - 1]} ${d}, ${y}`;
                            } catch {
                              return ymd;
                            }
                          };
                          
                          const scheduledYmd = getYmd(scheduledDateVal);
                          if (scheduledYmd) {
                            return formatYmd(scheduledYmd);
                          }
                          
                          const safeToDate = (value: any): Date | null => {
                            if (!value) return null;
                            if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
                            const d = new Date(value);
                            return isNaN(d.getTime()) ? null : d;
                          };
                          const created = safeToDate(estimate.createdAt);
                          const updated = safeToDate(estimate.updatedAt);
                          const displayDate = created || updated;
                          if (!displayDate) return '—';
                          try {
                            return format(displayDate, 'MMM d, yyyy');
                          } catch {
                            return '—';
                          }
                        })()}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            
            {/* Sticky Action Bar when items are selected */}
            {isEstimateSelectionMode && selectedEstimateIds.size > 0 && (
              <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 shadow-lg px-4 py-3 flex items-center justify-between z-50">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {selectedEstimateIds.size} selected
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setEstimateDeleteConfirmOpen(true)}
                  disabled={selectedEstimateIds.size === 0}
                  data-testid="button-bulk-delete-estimates"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            )}
            </>
          )}
          </div>
          </div>
        </TabsContent>
        )}

        {/* JOBS TAB CONTENT */}
        <TabsContent value="jobs" className="mt-6">
          {/* Create Job + Search */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-jobs"
              />
            </div>
            <Button className="sm:w-auto" onClick={() => setIsDialogOpen(true)} data-testid="button-create-job">
              <Plus className="w-4 h-4 mr-2" />
              Create New Job
            </Button>
          </div>

          {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No jobs yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start by creating your first construction project.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Job
            </Button>
          </CardContent>
        </Card>
      ) : filteredJobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No jobs found</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Try adjusting your search criteria or create a new job.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredJobs.map((job: JobWithClient) => (
            <Card 
              key={job.id} 
              className="hover:shadow-md transition-shadow cursor-pointer relative"
              onClick={(e) => {
                // let anchors / autocomplete interactions proceed
                if (e.target && (e.target as Element).closest && (e.target as Element).closest('a')) {
                  return;
                }
                if (isInPacContainer(e.nativeEvent)) {
                  return;
                }
                setLocation(`/jobs/${job.id}?from=jobs`);
              }}
            >
              {/* Status Badge - Top Right */}
              {(() => {
                const pillBase = "absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full border min-w-max";
                if (job.status === 'cancelled') {
                  return (
                    <span className={`${pillBase} bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700`}>
                      <X className="h-3 w-3" />
                      Cancelled
                    </span>
                  );
                }
                if (job.status === 'completed') {
                  return (
                    <span className={`${pillBase} bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800`}>
                      <CheckCircle2 className="h-3 w-3" />
                      Completed
                    </span>
                  );
                }
                if (job.isPaid) {
                  return (
                    <span className={`${pillBase} bg-green-50 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800`}>
                      <CheckCircle2 className="h-3 w-3" />
                      Paid
                    </span>
                  );
                }
                if (job.invoicePaymentStatus === 'partial') {
                  return (
                    <span className={`${pillBase} bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800`}>
                      <DollarSign className="h-3 w-3" />
                      Partial
                    </span>
                  );
                }
                return (
                  <span className={`${pillBase} bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700`}>
                    Pending
                  </span>
                );
              })()}
              <CardHeader className={isAndroid ? "pb-2" : "pb-3"}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-20 min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-5 w-5 flex-shrink-0 text-slate-600 dark:text-slate-400" />
                      <span className="truncate">{job.clientName || job.client?.name || 'Unassigned Job'}</span>
                    </CardTitle>
                    <div className="flex items-center gap-1 mt-1 text-sm text-slate-600 dark:text-slate-400">
                      <Wrench className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate" data-testid="text-job-primary-line-item">
                        {job.primaryLineItem || 'No line items yet'}
                      </span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className={isAndroid ? "pt-0 space-y-2" : "pt-0 space-y-3"}>
                {(job.location || job.startDate) && (
                  <div className={isAndroid ? "flex flex-col gap-1.5 text-sm text-slate-500 dark:text-slate-400" : "flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400"}>
                    {job.location && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 min-w-0 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate" data-testid="text-job-location">{job.location}</span>
                      </a>
                    )}
                    {job.startDate && (
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                          {(() => {
                            try {
                              const rawDate = job.startDate as any;
                              let formattedDate = '';
                              if (rawDate instanceof Date) {
                                formattedDate = format(rawDate, 'MMM d, yyyy');
                              } else if (typeof rawDate === 'string' && rawDate) {
                                const dateStr = rawDate.split('T')[0];
                                formattedDate = format(new Date(dateStr + 'T12:00:00'), 'MMM d, yyyy');
                              } else {
                                formattedDate = format(new Date(rawDate), 'MMM d, yyyy');
                              }
                              const timeStr = (job as any).scheduledTime;
                              const formattedTime = timeStr ? format(new Date(`2000-01-01T${timeStr}`), 'h:mm a') : null;
                              return formattedTime ? `${formattedDate} • ${formattedTime}` : formattedDate;
                            } catch {
                              return 'Scheduled';
                            }
                          })()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {job.estimatedCost && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <DollarSign className="h-4 w-4" />
                    ${Number(job.estimatedCost).toLocaleString()}
                  </div>
                )}
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center gap-2">
                  <p className="text-xs text-slate-500 truncate min-w-0">
                    Created {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'N/A'}
                  </p>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocation(`/jobs/${job.id}/edit`);
                      }}
                      data-testid={`button-edit-job-${job.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                      onClick={(e) => {
                        e.stopPropagation();
                        setJobToDelete({ id: job.id, title: job.title });
                      }}
                      data-testid={`button-delete-job-${job.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </TabsContent>
      </Tabs>

      {/* Estimates Customer Picker Dialog (for filtering) */}
      <Dialog open={estimatesCustomerPickerOpen} onOpenChange={(open) => {
        setEstimatesCustomerPickerOpen(open);
        if (!open) setEstimatesCustomerSearchQuery('');
      }}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Filter by Customer
            </DialogTitle>
            <button
              onClick={() => { setEstimatesCustomerPickerOpen(false); setEstimatesCustomerSearchQuery(''); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-3 bg-white dark:bg-slate-900">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name or email..."
                value={estimatesCustomerSearchQuery}
                onChange={(e) => setEstimatesCustomerSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-0"
                data-testid="input-search-estimates-filter-customers"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          <ScrollArea className="max-h-80">
            <div className="bg-white dark:bg-slate-900 py-1">
              <button
                className={`w-full flex items-center gap-3 px-4 min-h-[60px] text-left transition-colors ${
                  estimatesCustomerFilter === 'all'
                    ? 'bg-blue-50 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                }`}
                onClick={() => {
                  setEstimatesCustomerFilter('all');
                  setEstimatesCustomerPickerOpen(false);
                  setEstimatesCustomerSearchQuery('');
                }}
                data-testid="button-filter-all-customers"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center">
                  <Users className="h-5 w-5 text-slate-500 dark:text-slate-300" />
                </div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">All Customers</span>
                {estimatesCustomerFilter === 'all' && (
                  <Check className="h-5 w-5 text-blue-600 dark:text-blue-400 ml-auto" />
                )}
              </button>

              <div className="h-px bg-slate-100 dark:bg-slate-800 ml-[68px] mr-4" />

              {estimatesFilteredCustomers.map((customer, index) => {
                const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
                const initials = (customer.firstName?.charAt(0)?.toUpperCase() || '') + (customer.lastName?.charAt(0)?.toUpperCase() || '') || '?';
                const isSelected = estimatesCustomerFilter === customer.id;
                return (
                  <div key={customer.id}>
                    <button
                      className={`w-full flex items-center gap-3 px-4 min-h-[60px] text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                      }`}
                      onClick={() => {
                        setEstimatesCustomerFilter(customer.id);
                        setEstimatesCustomerPickerOpen(false);
                        setEstimatesCustomerSearchQuery('');
                      }}
                      data-testid={`button-filter-customer-${customer.id}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{fullName || 'Unnamed'}</p>
                        {customer.email && (
                          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{customer.email}</p>
                        )}
                      </div>
                      {isSelected && (
                        <Check className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      )}
                    </button>
                    {index < estimatesFilteredCustomers.length - 1 && (
                      <div className="h-px bg-slate-100 dark:bg-slate-800 ml-[68px] mr-4" />
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* New Estimate Sheet (Full creation flow) */}
      <NewEstimateSheet
        open={isNewEstimateSheetOpen}
        onOpenChange={setIsNewEstimateSheetOpen}
        onEstimateCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
        }}
      />

      {/* Share Estimate Modal */}
      {shareEstimateData && (
        <ShareEstimateModal
          open={!!shareEstimateData}
          onOpenChange={(open) => !open && setShareEstimateData(null)}
          estimateId={shareEstimateData.id}
          estimateNumber={shareEstimateData.estimateNumber}
          customerEmail={shareEstimateData.customerEmail}
          customerFirstName={shareEstimateData.customerFirstName}
        />
      )}

      {/* Select Customer Modal (legacy - kept for other flows) */}
      <SelectCustomerModal
        open={selectCustomerModalOpen}
        onOpenChange={(open) => {
          setSelectCustomerModalOpen(open);
          if (!open) {
            setSelectedCustomerForEstimate(null);
          }
        }}
        onSelectCustomer={(customer) => {
          setSelectedCustomerForEstimate(customer);
          setSelectCustomerModalOpen(false);
        }}
        canCreateCustomer={canAccessEstimates}
      />

      {/* Bulk Delete Estimates Confirmation Dialog */}
      <AlertDialog open={estimateDeleteConfirmOpen} onOpenChange={setEstimateDeleteConfirmOpen}>
        <AlertDialogContent className="sm:max-w-[400px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete estimates?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected {selectedEstimateIds.size} estimate{selectedEstimateIds.size !== 1 ? 's' : ''} and all associated documents. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setEstimateDeleteConfirmOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                bulkDeleteEstimatesMutation.mutate(Array.from(selectedEstimateIds));
              }}
              disabled={bulkDeleteEstimatesMutation.isPending}
            >
              {bulkDeleteEstimatesMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Modal - Single Source of Truth */}
      <AlertDialog open={!!jobToDelete} onOpenChange={(open) => !open && setJobToDelete(null)}>
        <AlertDialogContent className="sm:max-w-[350px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{jobToDelete?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (jobToDelete) {
                  console.debug('Modal delete confirmation - Job ID:', jobToDelete.id, 'Job Title:', jobToDelete.title);
                  deleteJobMutation.mutate(jobToDelete.id);
                }
              }}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteJobMutation.isPending}
            >
              {deleteJobMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive Confirmation Modal - For jobs with time logs */}
      <AlertDialog open={!!jobToArchive} onOpenChange={(open) => !open && setJobToArchive(null)}>
        <AlertDialogContent className="sm:max-w-[380px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Job Instead?</AlertDialogTitle>
            <AlertDialogDescription>
              "{jobToArchive?.title}" has time logs or related records and cannot be deleted. Would you like to archive it instead? Archived jobs are hidden from your main list but preserved for records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (jobToArchive) {
                  archiveJobMutation.mutate(jobToArchive.id);
                }
              }}
              className="bg-amber-600 hover:bg-amber-700"
              disabled={archiveJobMutation.isPending}
            >
              {archiveJobMutation.isPending ? "Archiving..." : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Crew Members Modal (Multi-select with add/remove) */}
      <Dialog open={isAssignModalOpen} onOpenChange={(open) => {
        setIsAssignModalOpen(open);
        if (!open) {
          // Clear state when closing
          setCrewJobId(null);
          setTechnicianSearch("");
          setSelectedUserIds(new Set());
          setOriginalAssignedIds(new Set());
        }
        // Note: initialization happens in useEffect when modal opens
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{crewAssignments.length > 0 ? 'Edit Crew' : 'Assign Crew Members'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Helper text */}
            <p className="text-sm text-slate-500">Check users to assign, uncheck to remove from this job.</p>
            
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name or email..."
                value={technicianSearch}
                onChange={(e) => setTechnicianSearch(e.target.value)}
                className="pl-9"
                data-testid="input-crew-search"
              />
            </div>
            
            {/* Crew Member List */}
            <div className="max-h-[300px] overflow-y-auto border rounded-lg divide-y">
              {crewMembersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : filteredTechnicians.length === 0 ? (
                <div className="py-8 text-center text-slate-500">
                  {technicianSearch ? 'No crew members match your search' : 'No assignable crew members found. Add employees to your company first.'}
                </div>
              ) : (
                <>
                  {filteredTechnicians.map((tech) => {
                    const isChecked = selectedUserIds.has(tech.id);
                    const techName = `${tech.firstName || ''} ${tech.lastName || ''}`.trim() || tech.email;
                    
                    const toggleSelection = () => {
                      setSelectedUserIds(prev => {
                        const next = new Set(prev);
                        if (next.has(tech.id)) {
                          next.delete(tech.id);
                        } else {
                          next.add(tech.id);
                        }
                        return next;
                      });
                    };
                    
                    return (
                      <button
                        key={tech.id}
                        onClick={toggleSelection}
                        disabled={updateCrewMutation.isPending}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isChecked 
                            ? 'bg-blue-50 dark:bg-blue-900/30' 
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                        data-testid={`button-select-crew-${tech.id}`}
                      >
                        {/* Checkbox */}
                        <div className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 ${
                          isChecked 
                            ? 'bg-blue-600 border-blue-600' 
                            : 'border-slate-300 dark:border-slate-600'
                        }`}>
                          {isChecked && (
                            <Check className="h-3 w-3 text-white" />
                          )}
                        </div>
                        
                        {/* Avatar */}
                        {tech.profileImageUrl ? (
                          <img 
                            src={tech.profileImageUrl} 
                            alt={techName}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                            <User className="h-4 w-4 text-slate-500" />
                          </div>
                        )}
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">{techName}</span>
                            <Badge variant="outline" className="text-xs shrink-0">{tech.role}</Badge>
                          </div>
                          <div className="text-xs text-slate-500 truncate">{tech.email}</div>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setIsAssignModalOpen(false);
                  setSelectedUserIds(new Set());
                  setTechnicianSearch("");
                }}
                disabled={updateCrewMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (crewJobId) {
                    // Compute diffs using the frozen snapshot (originalAssignedIds)
                    const toAdd = Array.from(selectedUserIds).filter(id => !originalAssignedIds.has(id));
                    const toRemove = Array.from(originalAssignedIds).filter(id => !selectedUserIds.has(id));
                    
                    if (toAdd.length > 0 || toRemove.length > 0) {
                      updateCrewMutation.mutate({
                        jobId: crewJobId,
                        toAdd,
                        toRemove,
                      });
                    } else {
                      // No changes, just close
                      setIsAssignModalOpen(false);
                    }
                  }
                }}
                disabled={updateCrewMutation.isPending}
                data-testid="button-save-crew"
              >
                {updateCrewMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  `Update Crew (${selectedUserIds.size})`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Modal */}
      <JobInvoiceModal
        open={!!invoiceJobData}
        onOpenChange={(open) => !open && setInvoiceJobData(null)}
        jobId={invoiceJobData?.id ?? 0}
        jobTitle={invoiceJobData?.title ?? ""}
        customerEmail={invoiceJobData?.customerEmail}
        customerFirstName={invoiceJobData?.customerFirstName}
        companyName={companyProfile?.name}
      />
    </div>
  );
}