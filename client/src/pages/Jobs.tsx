import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Building2, Calendar, DollarSign, MapPin, Trash2, Edit, Eye, Camera, Search, User, UserPlus, Loader2, X, Check } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertJobSchema, type InsertJob, type Job, type Client } from "@shared/schema";
import JobPhotoFeed from "@/components/JobPhotoFeed";
import { JobWizard } from "@/components/JobWizard";
import { useCan } from "@/hooks/useCan";

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
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [technicianSearch, setTechnicianSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  
  // Check if user is admin (Owner or Supervisor)
  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';

  // Reset description expansion when job changes
  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [selectedJob?.id]);

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

  // Fetch photos count for selected job
  const { data: jobPhotos = [] } = useQuery<JobPhoto[]>({
    queryKey: [`/api/jobs/${selectedJob?.id}/photos`],
    enabled: !!selectedJob?.id,
  });

  // Fetch current crew assignments for selected job
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

  // Bulk assign crew mutation
  const assignCrewMutation = useMutation({
    mutationFn: async ({ jobId, userIds }: { jobId: number; userIds: string[] }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/crew`, { userIds });
      return await res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', selectedJob?.id, 'crew'] });
      setIsAssignModalOpen(false);
      setTechnicianSearch("");
      setSelectedUserIds(new Set());
      toast({
        title: "Success",
        description: `Assigned ${result.added} crew member${result.added !== 1 ? 's' : ''}`,
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
        description: "Failed to assign crew members",
        variant: "destructive",
      });
    },
  });

  // Remove crew member mutation
  const removeCrewMutation = useMutation({
    mutationFn: async ({ jobId, userId }: { jobId: number; userId: string }) => {
      const res = await apiRequest("DELETE", `/api/jobs/${jobId}/crew/${userId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', selectedJob?.id, 'crew'] });
      toast({
        title: "Success",
        description: "Crew member removed",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove crew member",
        variant: "destructive",
      });
    },
  });

  // Validate file before upload
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

  // Handle photo upload
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Jobs Management</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage all your construction projects and track their progress</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="job-wizard w-[min(92vw,900px)] h-[min(92vh,680px)] p-0 rounded-2xl overflow-hidden shadow-xl" onInteractOutside={handleInteractOutside}>
          <JobWizard onComplete={createJobMutation.mutate} isLoading={createJobMutation.isPending} />
        </DialogContent>
      </Dialog>

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
          {selectedJob && (
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
                      
                      {/* Assigned Crew (Multi-member) */}
                      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2">
                        <dt className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">Assigned Crew:</dt>
                        <dd className="flex items-center gap-2">
                          {crewAssignments.length === 0 ? (
                            <span className="italic text-slate-500" data-testid="text-job-assigned">Unassigned</span>
                          ) : (
                            <div className="flex items-center gap-2" data-testid="text-job-assigned">
                              {/* Avatar bubbles - show up to 3 */}
                              <div className="flex -space-x-2">
                                {crewAssignments.slice(0, 3).map((assignment) => {
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
                                {crewAssignments.length > 3 && (
                                  <div className="h-7 w-7 rounded-full border-2 border-white dark:border-slate-800 bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-medium text-slate-700 dark:text-slate-200">
                                    +{crewAssignments.length - 3}
                                  </div>
                                )}
                              </div>
                              {/* Names subtitle for small crews */}
                              {crewAssignments.length <= 2 && (
                                <span className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[150px]">
                                  {crewAssignments.map(a => 
                                    `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() || a.user.email.split('@')[0]
                                  ).join(', ')}
                                </span>
                              )}
                            </div>
                          )}
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => setIsAssignModalOpen(true)}
                              data-testid="button-assign-crew"
                            >
                              <UserPlus className="h-3 w-3 mr-1" />
                              {crewAssignments.length > 0 ? 'Edit Crew' : 'Add Crew'}
                            </Button>
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
                        onClick={() => fileInputRef.current?.click()}
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
                            onClick={() => fileInputRef.current?.click()}
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
          </div>
          {/* Hidden file input for photo upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoUpload}
            className="hidden"
            aria-label="Upload photo"
          />
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Jobs
        </h3>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create New Job
        </Button>
      </div>

      {/* Search Bar */}
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
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                  <p className="text-xs text-slate-500">
                    Created {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'N/A'}
                  </p>
                  <div className="flex gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-green-500 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedJob(job);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingJob(job);
                      }}
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

      {/* Assign Crew Members Modal (Multi-select) */}
      <Dialog open={isAssignModalOpen} onOpenChange={(open) => {
        setIsAssignModalOpen(open);
        if (!open) {
          setTechnicianSearch("");
          setSelectedUserIds(new Set());
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Crew Members</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                    const isAlreadyAssigned = assignedUserIds.has(tech.id);
                    const isChecked = selectedUserIds.has(tech.id);
                    const techName = `${tech.firstName || ''} ${tech.lastName || ''}`.trim() || tech.email;
                    
                    const toggleSelection = () => {
                      if (isAlreadyAssigned) return;
                      const newSet = new Set(selectedUserIds);
                      if (isChecked) {
                        newSet.delete(tech.id);
                      } else {
                        newSet.add(tech.id);
                      }
                      setSelectedUserIds(newSet);
                    };
                    
                    return (
                      <button
                        key={tech.id}
                        onClick={toggleSelection}
                        disabled={isAlreadyAssigned || assignCrewMutation.isPending}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isAlreadyAssigned 
                            ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-slate-800/50' 
                            : isChecked 
                              ? 'bg-blue-50 dark:bg-blue-900/30' 
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                        data-testid={`button-select-crew-${tech.id}`}
                      >
                        {/* Checkbox */}
                        <div className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 ${
                          isAlreadyAssigned 
                            ? 'bg-green-100 border-green-400 dark:bg-green-900/30 dark:border-green-600'
                            : isChecked 
                              ? 'bg-blue-500 border-blue-500' 
                              : 'border-slate-300 dark:border-slate-600'
                        }`}>
                          {(isAlreadyAssigned || isChecked) && (
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
                        
                        {isAlreadyAssigned && (
                          <Badge variant="secondary" className="text-xs shrink-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Assigned</Badge>
                        )}
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
                disabled={assignCrewMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (selectedJob && selectedUserIds.size > 0) {
                    assignCrewMutation.mutate({
                      jobId: selectedJob.id,
                      userIds: Array.from(selectedUserIds),
                    });
                  }
                }}
                disabled={selectedUserIds.size === 0 || assignCrewMutation.isPending}
                data-testid="button-assign-crew"
              >
                {assignCrewMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Assigning...
                  </>
                ) : (
                  `Assign (${selectedUserIds.size})`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}