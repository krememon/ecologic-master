import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertClientSchema, type Client, type Job, type Customer } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";
import { z } from "zod";
import { Plus, UserCheck, Mail, Phone, MapPin, Building, Edit2, Trash2, MoreVertical, Briefcase, ChevronDown, ChevronRight, User, Search, X, Check, CheckSquare, Send } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useLocation } from "wouter";
import LocationInput from "@/components/LocationInput";
import { useCompanyCustomers } from "@/hooks/useCompanyCustomers";
import CampaignModal from "@/components/CampaignModal";

type ClientFormData = z.infer<typeof insertClientSchema>;

// Component to display job history for a client
function ClientJobsHistory({ clientId }: { clientId: number }) {
  const { data: clientJobs = [], isLoading } = useQuery<Job[]>({
    queryKey: [`/api/clients/${clientId}/jobs`],
    enabled: !!clientId,
  });

  if (isLoading) {
    return (
      <div className="mt-3 animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
      </div>
    );
  }

  if (clientJobs.length === 0) {
    return (
      <div className="mt-3 py-2">
        <p className="text-xs text-slate-500 italic">No jobs yet</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {clientJobs.slice(0, 3).map((job: any) => (
        <div key={job.id} className="flex items-center justify-between py-1">
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
              {job.title}
            </p>
            <p className="text-xs text-slate-500">
              {job.status} • {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'N/A'}
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${
            job.status === 'active' 
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : job.status === 'completed'
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
              : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
          }`}>
            {job.status}
          </span>
        </div>
      ))}
      {clientJobs.length > 3 && (
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
          +{clientJobs.length - 3} more job{clientJobs.length - 3 !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

export default function Clients() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [expandedClientJobs, setExpandedClientJobs] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<number>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [campaignAudienceMode, setCampaignAudienceMode] = useState<"selected" | "all">("selected");

  const canSendCampaigns = user?.role === 'OWNER' || user?.role === 'SUPERVISOR';

  const handleLaunchCampaign = () => {
    if (isSelectMode && selectedCustomerIds.size > 0) {
      setCampaignAudienceMode("selected");
    } else {
      setCampaignAudienceMode("all");
    }
    setCampaignModalOpen(true);
  };

  const handleCampaignSendSuccess = () => {
    if (isSelectMode) {
      exitSelectMode();
    }
  };

  // Redirect to home if not authenticated
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

  // Unified data source - customers only (clients migrated to customers table)
  const { customers, isLoading: customersLoading, error: customersError } = useCompanyCustomers();
  
  // Debug logging
  console.log("[ClientsPage] customers fetch result:", { 
    customersLoading, 
    customersError: customersError?.message,
    customersLength: customers.length,
    customers 
  });

  // Function to toggle job history expansion
  const toggleClientJobs = (clientId: number) => {
    const newExpanded = new Set(expandedClientJobs);
    if (newExpanded.has(clientId)) {
      newExpanded.delete(clientId);
    } else {
      newExpanded.add(clientId);
    }
    setExpandedClientJobs(newExpanded);
  };

  const form = useForm<ClientFormData>({
    resolver: zodResolver(insertClientSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
    },
  });

  const editForm = useForm<ClientFormData>({
    resolver: zodResolver(insertClientSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
    },
  });

  const createClientMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      const res = await apiRequest("POST", "/api/clients", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      form.reset();
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ClientFormData }) => {
      const res = await apiRequest("PATCH", `/api/clients/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      editForm.reset();
      setIsEditDialogOpen(false);
      setEditingClient(null);
      toast({
        title: "Success",
        description: "Client updated successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/clients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditClient = (client: Client) => {
    setEditingClient(client);
    editForm.reset({
      name: client.name,
      email: client.email || "",
      phone: client.phone || "",
      address: client.address || "",
      notes: client.notes || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleClientCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (isSubmitting) {
      return;
    }

    const formData = form.getValues();
    
    // Validate required fields - name is required
    if (!formData.name || formData.name.trim() === '') {
      toast({
        title: "Validation Error",
        description: "Name is required",
        variant: "destructive",
      });
      return;
    }

    // Validate email format if provided
    if (formData.email && formData.email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        toast({
          title: "Validation Error",
          description: "Please enter a valid email address",
          variant: "destructive",
        });
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // Split name into firstName/lastName for customers table
      const nameParts = formData.name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      const payload = {
        firstName,
        lastName,
        email: formData.email || "",
        phone: formData.phone || "",
        address: formData.address || "",
      };
      
      const res = await apiRequest("POST", "/api/customers", payload);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errorData.message || `Server error: ${res.status}`);
      }
      
      await res.json();
      
      // Invalidate customers cache to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      form.reset();
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Couldn't add client. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to format customer name (defined before useMemo)
  const formatCustomerName = (customer: Customer) => {
    return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed';
  };

  // Filter customers based on search query - MUST be before early return (Rules of Hooks)
  const filteredCustomers = useMemo(() => {
    if (!customers || customers.length === 0) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return customers;
    
    return customers.filter((customer) => {
      const fullName = formatCustomerName(customer).toLowerCase();
      const email = (customer.email || '').toLowerCase();
      const phone = (customer.phone || '').toLowerCase();
      const address = (customer.address || '').toLowerCase();
      const companyName = (customer.companyName || '').toLowerCase();
      
      return fullName.includes(query) || 
             email.includes(query) || 
             phone.includes(query) || 
             address.includes(query) ||
             companyName.includes(query);
    });
  }, [customers, searchQuery]);

  // Bulk delete mutation - MUST be before early return (Rules of Hooks)
  const bulkDeleteMutation = useMutation({
    mutationFn: async (customerIds: number[]) => {
      const res = await apiRequest("DELETE", "/api/customers/bulk", { customerIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Deleted",
        description: `Deleted ${selectedCustomerIds.size} client${selectedCustomerIds.size > 1 ? 's' : ''}`,
      });
      setIsSelectMode(false);
      setSelectedCustomerIds(new Set());
      setDeleteConfirmOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete clients",
        variant: "destructive",
      });
    },
  });

  // Loading state - AFTER all hooks
  if (isLoading || !isAuthenticated || customersLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Toggle customer selection
  const toggleCustomerSelection = (customerId: number) => {
    const newSelected = new Set(selectedCustomerIds);
    if (newSelected.has(customerId)) {
      newSelected.delete(customerId);
    } else {
      newSelected.add(customerId);
    }
    setSelectedCustomerIds(newSelected);
  };

  // Exit select mode
  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedCustomerIds(new Set());
  };

  const handleBulkDelete = () => {
    const idsToDelete = Array.from(selectedCustomerIds);
    bulkDeleteMutation.mutate(idsToDelete);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Clients</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage your clients and their information</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <div className="flex flex-col h-full max-h-[85vh]">
            {/* Fixed Header */}
            <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative flex-shrink-0">
              <button 
                type="button"
                onClick={() => setIsDialogOpen(false)} 
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              </button>
              <div className="text-center">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add Client</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Add a new client to your system</p>
              </div>
            </div>

            {/* Body and Footer combined in form */}
            <Form {...form}>
              <form 
                id="client-create-form"
                onSubmit={handleClientCreateSubmit}
                noValidate
                className="flex flex-col flex-1 overflow-hidden"
              >
                <div className="px-5 md:px-6 py-4 flex-1 overflow-auto">
                  <div className="space-y-3 md:space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium mb-1">Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Name" {...field} className="h-9 text-sm" data-testid="input-client-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem className="min-w-0">
                            <FormLabel className="text-xs font-medium mb-1">Email</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="Email" {...field} value={field.value || ""} className="h-9 text-sm" data-testid="input-client-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem className="min-w-0">
                            <FormLabel className="text-xs font-medium mb-1">Phone</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="Phone" 
                                {...field} 
                                value={field.value || ""} 
                                onChange={(e) => field.onChange(formatPhoneInput(e.target.value))}
                                inputMode="numeric"
                                autoComplete="tel"
                                className="h-9 text-sm" 
                                data-testid="input-client-phone" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium mb-1">Address</FormLabel>
                          <FormControl>
                            <LocationInput
                              value={field.value || ""}
                              onChange={(value) => {
                                field.onChange(value);
                              }}
                              onAddressSelected={(addr) => {
                                form.setValue("address", addr.formatted_address || addr.street);
                              }}
                              placeholder="Address"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium mb-1">Notes</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Notes" {...field} value={field.value || ""} className="text-sm min-h-[100px] resize-none" data-testid="input-client-notes" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Fixed Footer */}
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="flex-1 h-11" data-testid="button-cancel-client">
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      form="client-create-form"
                      disabled={isSubmitting}
                      className="flex-1 h-11"
                      data-testid="button-submit-client"
                    >
                      {isSubmitting ? "Adding..." : "Add Client"}
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Client Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <div className="flex flex-col h-full max-h-[85vh]">
            {/* Fixed Header */}
            <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative flex-shrink-0">
              <button 
                type="button"
                onClick={() => setIsEditDialogOpen(false)} 
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              </button>
              <div className="text-center">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit Client</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Update client information</p>
              </div>
            </div>

            {/* Body and Footer combined in form */}
            <Form {...editForm}>
              <form 
                onSubmit={editForm.handleSubmit((data) => editingClient && updateClientMutation.mutate({ id: editingClient.id, data }))} 
                className="flex flex-col flex-1 overflow-hidden"
              >
                <div className="px-5 md:px-6 py-4 flex-1 overflow-auto">
                  <div className="space-y-3 md:space-y-4">
                    <FormField
                      control={editForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium mb-1">Client Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Name" {...field} className="h-9 text-sm" data-testid="input-edit-client-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                      <FormField
                        control={editForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem className="min-w-0">
                            <FormLabel className="text-xs font-medium mb-1">Email</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="Email" {...field} value={field.value || ""} className="h-9 text-sm" data-testid="input-edit-client-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={editForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem className="min-w-0">
                            <FormLabel className="text-xs font-medium mb-1">Phone</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="Phone" 
                                {...field} 
                                value={field.value || ""} 
                                onChange={(e) => field.onChange(formatPhoneInput(e.target.value))}
                                inputMode="numeric"
                                autoComplete="tel"
                                className="h-9 text-sm" 
                                data-testid="input-edit-client-phone" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <FormField
                      control={editForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium mb-1">Address</FormLabel>
                          <FormControl>
                            <LocationInput
                              value={field.value || ""}
                              onChange={(value) => {
                                field.onChange(value);
                              }}
                              onAddressSelected={(addr) => {
                                editForm.setValue("address", addr.formatted_address || addr.street);
                              }}
                              placeholder="Address"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={editForm.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium mb-1">Notes</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Notes" {...field} value={field.value || ""} className="text-sm min-h-[100px] resize-none" data-testid="input-edit-client-notes" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Fixed Footer */}
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)} className="flex-1 h-11" data-testid="button-cancel-edit-client">
                      Cancel
                    </Button>
                    <Button type="submit" disabled={updateClientMutation.isPending} className="flex-1 h-11" data-testid="button-submit-edit-client">
                      {updateClientMutation.isPending ? "Updating..." : "Update Client"}
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Header Toolbar - Matches Documents page pattern */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Row 1: Filter Controls */}
        <div className="flex items-center gap-2">
          {/* All Clients pill */}
          <Button 
            variant="outline" 
            className="flex-1 justify-between"
          >
            <span className="truncate">All Clients ({customers.length})</span>
          </Button>
          
          {/* Campaign button */}
          {canSendCampaigns && (
            <Button 
              variant="outline" 
              className="flex-1 justify-between"
              onClick={handleLaunchCampaign}
            >
              <span className="truncate">Campaign</span>
              <Send className="h-4 w-4 shrink-0 opacity-50 ml-2" />
            </Button>
          )}
          
          {/* Select toggle button */}
          {customers.length > 0 && (
            <Button 
              variant={isSelectMode ? "secondary" : "outline"}
              size="icon"
              onClick={() => {
                if (isSelectMode) {
                  exitSelectMode();
                } else {
                  setIsSelectMode(true);
                }
              }}
              title={isSelectMode ? 'Exit selection' : 'Select clients'}
            >
              {isSelectMode ? <X className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
            </Button>
          )}
        </div>
        
        {/* Select mode info row */}
        {isSelectMode && customers.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {selectedCustomerIds.size} selected
            </span>
            <Button 
              variant="ghost"
              size="sm"
              onClick={() => {
                const allSelected = customers.every(c => selectedCustomerIds.has(c.id));
                if (allSelected) {
                  setSelectedCustomerIds(new Set());
                } else {
                  setSelectedCustomerIds(new Set(customers.map(c => c.id)));
                }
              }}
            >
              {customers.every(c => selectedCustomerIds.has(c.id)) ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
        )}

        {/* Row 2: Primary Action - Full width Add New Client */}
        <Button 
          onClick={() => setIsDialogOpen(true)}
          className="w-full"
          data-testid="button-add-client"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add New Client
        </Button>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10 h-10 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 rounded-lg"
            data-testid="input-search-clients"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500 transition-colors"
            >
              <X className="h-3 w-3 text-slate-600 dark:text-slate-300" />
            </button>
          )}
        </div>
      </div>

      {/* Bulk Action Bar */}
      {isSelectMode && (
        <div className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {selectedCustomerIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            {canSendCampaigns && (
              <Button
                variant="outline"
                size="sm"
                disabled={selectedCustomerIds.size === 0}
                onClick={() => setCampaignModalOpen(true)}
              >
                <Send className="h-4 w-4 mr-1.5" />
                Send Email/Text
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedCustomerIds.size === 0}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCustomerIds.size} client{selectedCustomerIds.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected clients will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Campaign Modal */}
      <CampaignModal
        open={campaignModalOpen}
        onOpenChange={setCampaignModalOpen}
        selectedCustomerIds={Array.from(selectedCustomerIds)}
        audienceMode={campaignAudienceMode}
        onSendSuccess={handleCampaignSendSuccess}
      />

      {/* Clients List (from unified customers table) */}
      {customers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <UserCheck className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No clients yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start building your client base by adding your first client.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Client
            </Button>
          </CardContent>
        </Card>
      ) : filteredCustomers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No clients found</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              No clients match your search "{searchQuery}"
            </p>
            <Button variant="outline" onClick={() => setSearchQuery("")}>
              Clear Search
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCustomers.map((customer) => (
            <Card 
              key={`customer-${customer.id}`} 
              className={`hover:shadow-md transition-shadow border-l-4 cursor-pointer ${
                isSelectMode && selectedCustomerIds.has(customer.id) 
                  ? 'border-l-blue-600 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-600' 
                  : 'border-l-blue-600'
              }`}
              onClick={() => {
                if (isSelectMode) {
                  toggleCustomerSelection(customer.id);
                } else {
                  navigate(`/clients/${customer.id}`);
                }
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {isSelectMode && (
                      <div 
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedCustomerIds.has(customer.id)
                            ? 'bg-blue-600 border-blue-600'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {selectedCustomerIds.has(customer.id) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                    )}
                    {!isSelectMode && <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                    {formatCustomerName(customer)}
                  </CardTitle>
                  {customer.companyName && (
                    <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
                      {customer.companyName}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {customer.email && (
                  isSelectMode ? (
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Mail className="h-4 w-4" />
                      {customer.email}
                    </div>
                  ) : (
                    <a 
                      href={`mailto:${customer.email}`}
                      className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                    >
                      <Mail className="h-4 w-4" />
                      {customer.email}
                    </a>
                  )
                )}
                {customer.phone && (
                  isSelectMode ? (
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Phone className="h-4 w-4" />
                      {customer.phone}
                    </div>
                  ) : (
                    <a 
                      href={`tel:${customer.phone}`}
                      className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                    >
                      <Phone className="h-4 w-4" />
                      {customer.phone}
                    </a>
                  )
                )}
                {customer.address && (
                  isSelectMode ? (
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 text-left">
                      <MapPin className="h-4 w-4" />
                      {customer.address}
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        const address = encodeURIComponent(customer.address || '');
                        if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
                          window.open(`maps://maps.apple.com/?q=${address}`, '_self');
                        } else if (navigator.userAgent.includes('Android')) {
                          window.open(`geo:0,0?q=${address}`, '_self');
                        } else {
                          window.open(`https://maps.google.com/?q=${address}`, '_blank');
                        }
                      }}
                      className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer text-left"
                    >
                      <MapPin className="h-4 w-4" />
                      {customer.address}
                    </button>
                  )
                )}
                {customer.jobTitle && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    {customer.jobTitle}
                  </p>
                )}
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    Customer • Added {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}