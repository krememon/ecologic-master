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
import { Plus, Building2, Calendar, DollarSign, MapPin, Trash2, Edit, Eye, Camera, Search, User, Users, Loader2, X, Check, ChevronDown, FolderOpen, FileText, CheckSquare } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertJobSchema, type InsertJob, type Job, type Client, type Estimate, type Customer } from "@shared/schema";
import JobPhotoFeed from "@/components/JobPhotoFeed";
import { NewJobSheet } from "@/components/NewJobSheet";
import { useCan } from "@/hooks/useCan";
import { SelectCustomerModal } from "@/components/CustomerModals";
import { NewEstimateSheet } from "@/components/NewEstimateSheet";
import { ShareEstimateModal } from "@/components/ShareEstimateModal";
import { Share2 } from "lucide-react";

interface JobWithClient extends Job {
  client?: Client | null;
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LocationInput from "@/components/LocationInput";
import { ClientSuggestions } from "@/components/ClientSuggestions";

function JobForm({ 
  onSubmit, 
  isLoading, 
  initialData, 
  isEdit = false 
}: { 
  onSubmit: (data: InsertJob) => void; 
  isLoading: boolean; 
  initialData?: any;
  isEdit?: boolean;
}) {
  const form = useForm<InsertJob>({
    resolver: zodResolver(insertJobSchema),
    defaultValues: {
      title: initialData?.title || "",
      clientName: initialData?.clientName || "",
      description: initialData?.description || "",
      location: initialData?.location || "",
      city: initialData?.city || "",
      postalCode: initialData?.postalCode || "",
      locationLat: initialData?.locationLat || undefined,
      locationLng: initialData?.locationLng || undefined,
      locationPlaceId: initialData?.locationPlaceId || "",
      status: initialData?.status || "pending",
      priority: initialData?.priority || "medium",
    },
  });

  const handleSubmit = (data: InsertJob) => {
    onSubmit(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Title</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-job-title" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="clientName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client Name *</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input {...field} placeholder="Enter client name..." data-testid="input-client-name" />
                  <ClientSuggestions
                    searchTerm={field.value}
                    onSelect={(client) => {
                      field.onChange(client.name);
                    }}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} data-testid="input-job-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location *</FormLabel>
              <FormControl>
                <LocationInput
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                  }}
                  onAddressSelected={(addr) => {
                    form.setValue("city", addr.city);
                    form.setValue("postalCode", addr.postalCode);
                    form.setValue("locationPlaceId", addr.place_id);
                    form.setValue("location", addr.formatted_address || addr.street);
                  }}
                  placeholder="Start typing an address..."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="City name..." data-testid="input-job-city" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ZIP / Postal Code</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="ZIP code..." data-testid="input-job-postal-code" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
        <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-job-submit">
          {isLoading ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Job" : "Create Job")}
        </Button>
      </form>
    </Form>
  );
}

export default function Jobs() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { role } = useCan();
  const [, setLocation] = useLocation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [selectedJob, setSelectedJob] = useState<JobWithClient | null>(null);
  const [jobToDelete, setJobToDelete] = useState<{ id: number; title: string } | null>(null);
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
  const [mainPageTab, setMainPageTab] = useState<'jobs' | 'estimates'>('jobs');
  
  // Estimates tab filters
  const [estimatesCustomerFilter, setEstimatesCustomerFilter] = useState<'all' | number>('all');
  const [estimatesStatusFilter, setEstimatesStatusFilter] = useState<'all' | string>('all');
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
  
  // Check if user is admin (Owner or Supervisor)
  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';
  
  // RBAC: Owner, Supervisor, Estimator can share estimates
  const canShareEstimates = role === 'OWNER' || role === 'SUPERVISOR' || role === 'ESTIMATOR';

  // Reset description expansion and tab when job changes
  useEffect(() => {
    setIsDescriptionExpanded(false);
    setJobModalTab('documents');
  }, [selectedJob?.id]);
  
  // Check if user can access estimates (Technician cannot)
  const canAccessEstimates = role !== 'TECHNICIAN';
  
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
        window.location.href = "/api/login";
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


  const { data: jobs = [], isLoading: jobsLoading } = useQuery<JobWithClient[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

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

  // Filter estimates based on customer and status filters
  const filteredEstimates = useMemo(() => {
    let result = allEstimates;
    
    // Filter by customer
    if (estimatesCustomerFilter !== 'all') {
      result = result.filter(est => est.customerId === estimatesCustomerFilter);
    }
    
    // Filter by status
    if (estimatesStatusFilter !== 'all') {
      result = result.filter(est => est.status === estimatesStatusFilter);
    }
    
    return result;
  }, [allEstimates, estimatesCustomerFilter, estimatesStatusFilter]);

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
  
  // Fetch crew for Job Insights modal display (read-only)
  const { data: selectedJobCrew = [] } = useQuery<CrewAssignment[]>({
    queryKey: ['/api/jobs', selectedJob?.id, 'crew'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${selectedJob?.id}/crew`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch crew');
      return res.json();
    },
    enabled: !!selectedJob?.id && isAdmin,
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
  const ASSIGNABLE_ROLES = ['TECHNICIAN', 'SUPERVISOR', 'PROJECT_MANAGER', 'ADMIN_ASSISTANT', 'DISPATCHER', 'ESTIMATOR'];
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

  // Filter jobs based on role and search query
  const filteredJobs = jobs.filter(job => {
    // For TECHNICIAN role, only show jobs assigned to them
    if (role === 'TECHNICIAN' && job.assignedTo !== user?.id) {
      return false;
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
      // Invalidate all schedule queries (with any date range)
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      setIsDialogOpen(false);
      // Navigate to job detail page (no success toast)
      setSelectedJob(newJob);
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
      const res = await apiRequest("DELETE", `/api/jobs/${jobId}`);
      // Handle both 200 and 204 responses
      if (res.status === 204) {
        return; // No content to return
      } else if (res.status === 200) {
        return await res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      // Invalidate all schedule queries (with any date range) to remove ghost events
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      setJobToDelete(null); // Reset modal state
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to delete job",
        variant: "destructive",
      });
    },
  });

  const updateJobMutation = useMutation({
    mutationFn: async ({ jobId, jobData }: { jobId: number; jobData: Partial<InsertJob> }) => {
      const res = await apiRequest("PATCH", `/api/jobs/${jobId}`, jobData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setEditingJob(null);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to update job",
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
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
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
      
      if (successCount > 0 && failedResults.length === 0) {
        toast({
          title: "Estimates deleted",
          description: `Successfully deleted ${successCount} estimate${successCount !== 1 ? 's' : ''}.`,
        });
      } else if (successCount > 0 && failedResults.length > 0) {
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Jobs & Estimates</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage projects and create estimates for your clients</p>
      </div>

      <NewJobSheet 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        onJobCreated={(newJob) => {
          setSelectedJob(newJob);
        }}
      />

      {/* Edit Job Dialog */}
      <Dialog open={!!editingJob} onOpenChange={(open) => !open && setEditingJob(null)}>
        <DialogContent className="sm:max-w-[350px] rounded-2xl" onInteractOutside={handleInteractOutside}>
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
          </DialogHeader>
          <JobForm 
            onSubmit={(data) => updateJobMutation.mutate({ jobId: editingJob.id, jobData: data })} 
            isLoading={updateJobMutation.isPending}
            initialData={editingJob}
            isEdit={true}
          />
        </DialogContent>
      </Dialog>

      {/* Job Detail Modal with Photo Feed */}
      <Dialog open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <DialogContent className="w-[98vw] max-w-4xl h-[95vh] overflow-y-auto overflow-x-hidden px-5 pb-3 sm:px-6 sm:pb-4 rounded-3xl border-0 shadow-2xl" onInteractOutside={handleInteractOutside}>
          <div className="pt-6 sm:pt-8">
          <DialogHeader className="space-y-0">
            {/* Header Container with flex-wrap */}
            <div data-testid="job-header" className="flex flex-wrap items-start gap-x-2 gap-y-1 mb-2 sm:mb-2">
              {/* Title + Status Badge Group */}
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <DialogTitle className="text-xl font-semibold leading-tight truncate [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                  {selectedJob?.title}
                </DialogTitle>
                {selectedJob && (
                  <Badge 
                    variant={selectedJob.status === 'active' ? 'default' : 'secondary'}
                    className="text-sm px-2.5 py-0.5 flex-shrink-0"
                  >
                    {selectedJob.status}
                  </Badge>
                )}
              </div>
              
              {/* Action Buttons - compact */}
              <div className="ml-auto flex items-center gap-1.5 shrink-0 pr-1 sm:pr-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedJob) {
                      setEditingJob(selectedJob);
                      setSelectedJob(null);
                    }
                  }}
                  className="h-6 w-6 p-0.5"
                  aria-label="Edit job"
                  data-testid="button-edit-job"
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedJob) {
                      setJobToDelete({ id: selectedJob.id, title: selectedJob.title });
                      setSelectedJob(null);
                    }
                  }}
                  className="h-6 w-6 p-0.5"
                  aria-label="Delete job"
                  data-testid="button-delete-job"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          
          </DialogHeader>
          
          {/* Segmented Tab Switcher */}
          {selectedJob && (
            <div className="mt-4 mb-4" data-testid="job-tab-switcher">
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
          )}

          {/* Tab Content */}
          {selectedJob && jobModalTab === 'documents' && (
            <div data-testid="job-sections-stack" className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
              {/* Left Column - Job Information (60%) */}
              <div className="col-span-1 lg:col-span-3">
                <Card data-testid="job-info-card" className="mb-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Job Information</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {/* Definition list with label:value rows */}
                    <dl className="divide-y divide-slate-200 dark:divide-slate-700">
                      {/* Client */}
                      {(selectedJob.clientName || selectedJob.client?.name) && (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                          <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Client:</dt>
                          <dd className="text-slate-900 dark:text-slate-100 truncate" title={selectedJob.clientName || selectedJob.client?.name || ''} data-testid="text-job-client-detail">
                            {selectedJob.clientName || selectedJob.client?.name}
                          </dd>
                        </div>
                      )}
                      
                      {/* Assigned Crew (Read-only display) */}
                      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                        <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Assigned Crew:</dt>
                        <dd className="flex items-center gap-2" data-testid="text-job-assigned">
                          {selectedJobCrew.length === 0 ? (
                            <span className="italic text-slate-500">Unassigned</span>
                          ) : (
                            <>
                              {/* Avatar bubbles - show up to 3 */}
                              <div className="flex -space-x-2 flex-shrink-0">
                                {selectedJobCrew.slice(0, 3).map((assignment) => {
                                  const name = `${assignment.user.firstName || ''} ${assignment.user.lastName || ''}`.trim() || assignment.user.email;
                                  const initials = (assignment.user.firstName?.[0] || '') + (assignment.user.lastName?.[0] || '') || assignment.user.email[0].toUpperCase();
                                  return assignment.user.profileImageUrl ? (
                                    <img
                                      key={assignment.userId}
                                      src={assignment.user.profileImageUrl}
                                      alt={name}
                                      title={name}
                                      className="h-7 w-7 rounded-full border-2 border-white dark:border-slate-800 object-cover"
                                    />
                                  ) : (
                                    <div
                                      key={assignment.userId}
                                      title={name}
                                      className="h-7 w-7 rounded-full border-2 border-white dark:border-slate-800 bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-300"
                                    >
                                      {initials}
                                    </div>
                                  );
                                })}
                                {selectedJobCrew.length > 3 && (
                                  <div className="h-7 w-7 rounded-full border-2 border-white dark:border-slate-800 bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-medium text-slate-700 dark:text-slate-200">
                                    +{selectedJobCrew.length - 3}
                                  </div>
                                )}
                              </div>
                              {/* Names for small crews */}
                              {selectedJobCrew.length <= 2 && (
                                <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-300">
                                  {selectedJobCrew.map(a => 
                                    `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() || a.user.email.split('@')[0]
                                  ).join(', ')}
                                </span>
                              )}
                            </>
                          )}
                        </dd>
                      </div>
                      
                      {/* Address */}
                      {selectedJob.location && (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                          <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Address:</dt>
                          <dd className="truncate">
                            <a 
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedJob.location)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                              title={`View ${selectedJob.location} on map`}
                              data-testid="link-job-location-detail"
                            >
                              {selectedJob.location}
                            </a>
                          </dd>
                        </div>
                      )}
                      
                      {/* Priority */}
                      {selectedJob.priority && (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                          <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Priority:</dt>
                          <dd className="text-slate-900 dark:text-slate-100 capitalize truncate" title={selectedJob.priority}>
                            {selectedJob.priority}
                          </dd>
                        </div>
                      )}
                      
                      {/* Created */}
                      {selectedJob.createdAt && (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                          <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Created:</dt>
                          <dd className="text-slate-900 dark:text-slate-100 truncate" title={format(new Date(selectedJob.createdAt), 'PPpp')}>
                            {format(new Date(selectedJob.createdAt), 'MMM d, yyyy')}
                          </dd>
                        </div>
                      )}
                      
                      {/* Estimated Cost */}
                      {selectedJob.estimatedCost && (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                          <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Estimated Cost:</dt>
                          <dd className="text-slate-900 dark:text-slate-100 truncate" title={`$${Number(selectedJob.estimatedCost).toLocaleString()}`}>
                            ${Number(selectedJob.estimatedCost).toLocaleString()}
                          </dd>
                        </div>
                      )}
                      
                      {/* Start Date */}
                      {selectedJob.startDate && (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                          <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Start Date:</dt>
                          <dd className="text-slate-900 dark:text-slate-100 truncate" title={new Date(selectedJob.startDate).toLocaleDateString()}>
                            {new Date(selectedJob.startDate).toLocaleDateString()}
                          </dd>
                        </div>
                      )}
                      
                      {/* End Date */}
                      {selectedJob.endDate && (
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                          <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">End Date:</dt>
                          <dd className="text-slate-900 dark:text-slate-100 truncate" title={new Date(selectedJob.endDate).toLocaleDateString()}>
                            {new Date(selectedJob.endDate).toLocaleDateString()}
                          </dd>
                        </div>
                      )}
                    </dl>
                    
                    {/* Description Section */}
                    {selectedJob.description && (
                      <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Description</h4>
                        <div>
                          <p 
                            className={`text-sm text-slate-600 dark:text-slate-400 leading-relaxed ${
                              !isDescriptionExpanded 
                                ? 'line-clamp-3 overflow-hidden' 
                                : ''
                            }`}
                            style={!isDescriptionExpanded ? {
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden'
                            } : undefined}
                          >
                            {selectedJob.description}
                          </p>
                          {selectedJob.description.length > 100 && (
                            <button 
                              onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                              className="text-sm text-blue-600 hover:text-blue-800 mt-2 underline"
                              data-testid="button-toggle-description"
                            >
                              {isDescriptionExpanded ? 'Show less' : 'Read more'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right Column - Photos (40%) */}
              <div className="col-span-1 lg:col-span-2">
                {jobPhotos.length === 0 ? (
                  <Card data-testid="job-photos-card" className="mt-0">
                    <CardContent className="flex flex-col items-center py-4 sm:py-5 text-center">
                      <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                        <Camera className="h-5 w-5 text-slate-400" />
                      </div>
                      <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-1">No Photos Yet</h4>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Document job progress with photos</p>
                      {isUploading && uploadProgress > 0 && (
                        <div className="w-full mb-3">
                          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                            <span>Uploading photo...</span>
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
                      <Button 
                        size="sm" 
                        data-testid="button-upload-photo"
                        onClick={openPhotoUploadModal}
                        disabled={isUploading}
                      >
                        <Camera className="h-4 w-4 mr-2" />
                        {isUploading ? 'Uploading...' : 'Upload First Photo'}
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card data-testid="job-photos-card" className="mt-0">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Camera className="h-5 w-5" />
                          Job Site Photos
                        </CardTitle>
                        <Badge variant="secondary" className="text-sm px-2 py-1">
                          {jobPhotos.length}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-4">
                        {/* Photo Grid */}
                        <div className="grid grid-cols-3 gap-3">
                          {jobPhotos.slice(0, 6).map((photo) => (
                            <div key={photo.id} className="relative group">
                              <img
                                src={photo.photoUrl}
                                alt={photo.title || "Job site photo"}
                                className="w-full h-20 object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => {
                                  // TODO: Open full JobPhotoFeed modal
                                }}
                              />
                              {photo.location && (
                                <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                                  {photo.location}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex items-center justify-between pt-2">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            data-testid="button-upload-photo"
                            onClick={openPhotoUploadModal}
                            disabled={isUploading}
                          >
                            <Camera className="h-4 w-4 mr-2" />
                            {isUploading ? 'Uploading...' : 'Upload Photo'}
                          </Button>
                          {jobPhotos.length > 6 && (
                            <button 
                              className="text-sm text-blue-600 hover:text-blue-800 underline"
                              data-testid="button-view-all-photos"
                            >
                              View all {jobPhotos.length} photos
                            </button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
          
          {/* E-signature Approvals Tab */}
          {selectedJob && jobModalTab === 'approvals' && (
            <div className="py-4" data-testid="approvals-tab-content">
              <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                <p className="text-lg font-medium mb-2">E-signature Approvals</p>
                <p className="text-sm">Signature requests for this job will appear here.</p>
              </div>
            </div>
          )}
          </div>
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
          {/* Filter Row: Customer Picker + Status Dropdown + Select Button */}
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                className="flex-1 justify-between"
                onClick={() => setEstimatesCustomerPickerOpen(true)}
                disabled={isEstimateSelectionMode}
                data-testid="button-estimates-customer-picker"
              >
                <span className="truncate">{selectedCustomerForFilterLabel}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
              </Button>
              <Select 
                value={estimatesStatusFilter === 'all' ? 'all' : estimatesStatusFilter} 
                onValueChange={(v) => setEstimatesStatusFilter(v)}
                disabled={isEstimateSelectionMode}
              >
                <SelectTrigger className="flex-1 min-w-0" data-testid="filter-estimates-status">
                  <span className="min-w-0 flex-1 truncate text-left">
                    {estimatesStatusFilter === 'all' ? 'All statuses' : estimatesStatusFilter.charAt(0).toUpperCase() + estimatesStatusFilter.slice(1)}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                </SelectContent>
              </Select>
              {/* Select / Cancel button */}
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
                className="shrink-0"
                data-testid="button-estimates-select-mode"
              >
                {isEstimateSelectionMode ? (
                  "Cancel"
                ) : (
                  <>
                    <CheckSquare className="h-4 w-4 mr-1" />
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
            <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 ${isEstimateSelectionMode && selectedEstimateIds.size > 0 ? 'pb-20' : ''}`}>
              {filteredEstimates.map((estimate) => {
                const job = jobs.find(j => j.id === estimate.jobId);
                const isSelected = selectedEstimateIds.has(estimate.id);
                return (
                  <Card 
                    key={estimate.id} 
                    className={`hover:shadow-md transition-all cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-950 ring-2 ring-blue-400' : ''}`}
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
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          {/* Checkbox in selection mode */}
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
                            <CardTitle className="flex items-center gap-2 text-base truncate">
                              <DollarSign className="h-5 w-5 text-green-600 flex-shrink-0" />
                              {estimate.title || estimate.estimateNumber}
                            </CardTitle>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 truncate">
                              {estimate.estimateNumber}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          {!isEstimateSelectionMode && canShareEstimates && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
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
                    <CardContent className="pt-0 space-y-2">
                      {job && (
                        <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
                          <Building2 className="h-3 w-3" />
                          <span className="truncate">{job.title}</span>
                        </div>
                      )}
                      {estimate.customerName && (
                        <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
                          <User className="h-3 w-3" />
                          <span className="truncate">{estimate.customerName}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                        <span className="text-sm text-slate-500">Total</span>
                        <span className="font-semibold text-green-600">
                          ${((estimate.totalCents || 0) / 100).toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {estimate.updatedAt ? format(new Date(estimate.updatedAt), 'MMM d, yyyy') : ''}
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
        </TabsContent>
        )}

        {/* JOBS TAB CONTENT */}
        <TabsContent value="jobs" className="mt-6">
          {/* Create Job + Search */}
          <div className="flex flex-col gap-3 mb-6">
            <Button className="w-full" onClick={() => setIsDialogOpen(true)} data-testid="button-create-job">
              <Plus className="w-4 h-4 mr-2" />
              Create New Job
            </Button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-jobs"
              />
            </div>
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredJobs.map((job: JobWithClient) => (
            <Card 
              key={job.id} 
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={(e) => {
                // let anchors / autocomplete interactions proceed
                if (e.target && (e.target as Element).closest && (e.target as Element).closest('a')) {
                  return;
                }
                if (isInPacContainer(e.nativeEvent)) {
                  return;
                }
                // existing behavior (open detail / close)
                setSelectedJob(job);
              }}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                      {job.title}
                    </CardTitle>
                    {(job.clientName || job.client?.name) ? (
                      <div className="flex items-center gap-1 mt-1 text-sm text-slate-600 dark:text-slate-400">
                        <User className="h-3 w-3" />
                        {job.client?.id ? (
                          <button
                            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation('/clients');
                            }}
                            data-testid="button-job-client-name"
                          >
                            {job.clientName || job.client?.name}
                          </button>
                        ) : (
                          <span data-testid="text-job-client-name">{job.clientName}</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 mt-1 text-sm text-slate-400">
                        <User className="h-3 w-3" />
                        <span>—</span>
                      </div>
                    )}
                  </div>
                  <Badge variant={job.status === 'active' ? 'default' : 'secondary'} className="ml-2">
                    {job.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {job.location && (
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MapPin className="h-4 w-4" />
                    <div className="flex flex-col">
                      <span className="truncate" data-testid="text-job-location">{job.location}</span>
                      {(job.city || job.postalCode) && (
                        <span className="text-xs text-slate-500" data-testid="text-job-city-zip">
                          {[job.city, job.postalCode].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  </a>
                )}
                {job.estimatedCost && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <DollarSign className="h-4 w-4" />
                    ${Number(job.estimatedCost).toLocaleString()}
                  </div>
                )}
                {job.startDate && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Calendar className="h-4 w-4" />
                    {new Date(job.startDate).toLocaleDateString()}
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
                      className="h-8 w-8 p-0 text-green-500 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedJob(job);
                      }}
                      data-testid={`button-view-job-${job.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 w-8 p-0 text-purple-500 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCrewJobId(job.id);
                          setIsAssignModalOpen(true);
                        }}
                        data-testid={`button-crew-job-${job.id}`}
                      >
                        <Users className="h-4 w-4" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingJob(job);
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
      <Dialog open={estimatesCustomerPickerOpen} onOpenChange={setEstimatesCustomerPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Filter by Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search customers..."
                value={estimatesCustomerSearchQuery}
                onChange={(e) => setEstimatesCustomerSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-estimates-filter-customers"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                onClick={() => {
                  setEstimatesCustomerFilter('all');
                  setEstimatesCustomerPickerOpen(false);
                  setEstimatesCustomerSearchQuery('');
                }}
                data-testid="button-filter-all-customers"
              >
                <User className="h-4 w-4 text-slate-500" />
                <span className="font-medium">All customers</span>
              </button>
              {estimatesFilteredCustomers.map((customer) => {
                const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
                return (
                  <button
                    key={customer.id}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                    onClick={() => {
                      setEstimatesCustomerFilter(customer.id);
                      setEstimatesCustomerPickerOpen(false);
                      setEstimatesCustomerSearchQuery('');
                    }}
                    data-testid={`button-filter-customer-${customer.id}`}
                  >
                    <User className="h-4 w-4 text-slate-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{fullName || 'No name'}</p>
                      {customer.email && (
                        <p className="text-sm text-slate-500 truncate">{customer.email}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
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
                            ? 'bg-blue-500 border-blue-500' 
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
    </div>
  );
}