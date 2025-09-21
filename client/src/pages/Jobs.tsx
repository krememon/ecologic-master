import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Building2, Calendar, DollarSign, MapPin, Trash2, Edit, Eye, Camera, Search } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertJobSchema, type InsertJob, type Job, type Client } from "@shared/schema";
import JobPhotoFeed from "@/components/JobPhotoFeed";
import AIScopeAnalyzer from "@/components/AIScopeAnalyzer";

interface JobWithClient extends Job {
  client?: Client | null;
}
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";

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
                <Input {...field} placeholder="Enter client name..." data-testid="input-client-name" />
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
                <LocationAutocomplete
                  value={field.value}
                  onChange={(value, addressComponents) => {
                    field.onChange(value);
                    // Auto-populate city and postal code if address components are provided
                    if (addressComponents) {
                      form.setValue("city", addressComponents.city);
                      form.setValue("postalCode", addressComponents.postalCode);
                      // Store hidden location data for backend
                      form.setValue("locationLat", addressComponents.lat);
                      form.setValue("locationLng", addressComponents.lng);
                      form.setValue("locationPlaceId", addressComponents.placeId);
                    }
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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [selectedJob, setSelectedJob] = useState<JobWithClient | null>(null);
  const [jobToDelete, setJobToDelete] = useState<{ id: number; title: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

  // Filter jobs based on search query
  const filteredJobs = jobs.filter(job => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.trim().toLowerCase();
    const matchesTitle = job.title.toLowerCase().includes(query);
    const matchesLocation = job.location ? job.location.toLowerCase().includes(query) : false;
    const matchesStatus = job.status.toLowerCase().includes(query);
    const matchesClient = job.client?.name ? job.client.name.toLowerCase().includes(query) : false;
    
    return matchesTitle || matchesLocation || matchesStatus || matchesClient;
  });

  const createJobMutation = useMutation({
    mutationFn: async (jobData: InsertJob) => {
      const res = await apiRequest("POST", "/api/jobs", jobData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
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
        <DialogContent className="sm:max-w-[350px] rounded-2xl" onInteractOutside={handleInteractOutside}>
          <DialogHeader>
            <DialogTitle>Create New Job</DialogTitle>
          </DialogHeader>
          <JobForm onSubmit={createJobMutation.mutate} isLoading={createJobMutation.isPending} />
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
        <DialogContent className="w-[98vw] max-w-4xl h-[95vh] overflow-y-auto overflow-x-hidden p-3 rounded-3xl border-0 shadow-2xl" onInteractOutside={handleInteractOutside}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {selectedJob?.title}
            </DialogTitle>
          </DialogHeader>
          {selectedJob && (
            <div className="space-y-6">
              {/* Job Information Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Job Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Status:</span>
                      <Badge variant={selectedJob.status === 'active' ? 'default' : 'secondary'}>
                        {selectedJob.status}
                      </Badge>
                    </div>
                    {selectedJob.client && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Client:</span>
                        <span className="text-sm truncate ml-2">{selectedJob.client.name}</span>
                      </div>
                    )}
                    {selectedJob.location && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Location:</span>
                          <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedJob.location)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:text-blue-800 underline truncate ml-2 flex items-center gap-1"
                            data-testid="link-job-location"
                          >
                            <MapPin className="h-3 w-3" />
                            {selectedJob.location}
                          </a>
                        </div>
                        {(selectedJob.city || selectedJob.postalCode) && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">City/ZIP:</span>
                            <span className="text-sm text-slate-600 dark:text-slate-300 ml-2" data-testid="text-job-city-zip-detail">
                              {[selectedJob.city, selectedJob.postalCode].filter(Boolean).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {selectedJob.estimatedCost && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Estimated Cost:</span>
                        <span className="text-sm">${Number(selectedJob.estimatedCost).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedJob.startDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Start Date:</span>
                        <span className="text-sm">{new Date(selectedJob.startDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    {selectedJob.endDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">End Date:</span>
                        <span className="text-sm">{new Date(selectedJob.endDate).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                  {selectedJob.description && (
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-sm font-medium">Description:</span>
                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        {selectedJob.description}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>



              {/* Photo Feed */}
              <JobPhotoFeed jobId={selectedJob.id} canUpload={true} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Active Jobs
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
          placeholder="Search jobs by name, location, status, or client..."
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
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  {job.title}
                </CardTitle>
                <Badge variant={job.status === 'active' ? 'default' : 'secondary'}>
                  {job.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {job.client && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Building2 className="h-4 w-4" />
                    {job.client.name}
                  </div>
                )}
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
    </div>
  );
}