import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { insertClientSchema, type Client, type Job } from "@shared/schema";
import { z } from "zod";
import { Plus, UserCheck, Mail, Phone, MapPin, Building, Edit2, Trash2, MoreVertical, Briefcase, ChevronDown, ChevronRight } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useTranslation } from "react-i18next";
import LocationInput from "@/components/LocationInput";

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
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [expandedClientJobs, setExpandedClientJobs] = useState<Set<number>>(new Set());

  // Redirect to home if not authenticated
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

  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isAuthenticated,
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
      toast({
        title: "Success",
        description: "Client created successfully",
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
          window.location.href = "/api/login";
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
          window.location.href = "/api/login";
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
      toast({
        title: "Success",
        description: "Client deleted successfully",
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
          window.location.href = "/api/login";
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

  if (isLoading || !isAuthenticated || clientsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('clients.title')}</h1>
        <p className="text-slate-600 dark:text-slate-400">{t('clients.subtitle')}</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('clients.addClient')}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => createClientMutation.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('clients.fields.name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('clients.fields.name')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('clients.fields.email')}</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder={t('clients.fields.email')} {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('clients.fields.phone')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('clients.fields.phone')} {...field} value={field.value || ""} />
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
                    <FormLabel>{t('clients.fields.address')}</FormLabel>
                    <FormControl>
                      <LocationInput
                        value={field.value || ""}
                        onChange={(value) => {
                          field.onChange(value);
                        }}
                        onAddressSelected={(addr) => {
                          form.setValue("address", addr.formatted_address || addr.street);
                        }}
                        placeholder={t('clients.fields.address')}
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
                    <FormLabel>{t('clients.fields.notes')}</FormLabel>
                    <FormControl>
                      <Textarea placeholder={t('clients.fields.notes')} {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex justify-end space-x-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={createClientMutation.isPending}>
                  {createClientMutation.isPending ? t('common.loading') : t('clients.addClient')}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Client Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((data) => editingClient && updateClientMutation.mutate({ id: editingClient.id, data }))} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter client name or company" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="client@example.com" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={editForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} />
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
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <LocationInput
                        value={field.value || ""}
                        onChange={(value) => {
                          field.onChange(value);
                        }}
                        onAddressSelected={(addr) => {
                          editForm.setValue("address", addr.formatted_address || addr.street);
                        }}
                        placeholder="Enter client address"
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
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Any additional notes about this client" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex justify-end space-x-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateClientMutation.isPending}>
                  {updateClientMutation.isPending ? "Updating..." : "Update Client"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Client Count and Add Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Clients ({clients.length})
        </h3>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add New Client
        </Button>
      </div>

      {/* Clients List */}
      {clients.length === 0 ? (
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
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {clients.map((client: any) => (
            <Card key={client.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Building className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    {client.name}
                  </CardTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEditClient(client)}>
                        <Edit2 className="h-4 w-4 mr-2" />
                        Edit Client
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Client
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Client</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete {client.name}? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteClientMutation.mutate(client.id)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {client.email && (
                  <a 
                    href={`mailto:${client.email}`}
                    className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    <Mail className="h-4 w-4" />
                    {client.email}
                  </a>
                )}
                {client.phone && (
                  <a 
                    href={`tel:${client.phone}`}
                    className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    <Phone className="h-4 w-4" />
                    {client.phone}
                  </a>
                )}
                {client.address && (
                  <button
                    onClick={() => {
                      const address = encodeURIComponent(client.address);
                      // Try to open with device's default maps app
                      if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
                        // iOS - opens in Apple Maps by default, or user's preferred maps app
                        window.open(`maps://maps.apple.com/?q=${address}`, '_self');
                      } else if (navigator.userAgent.includes('Android')) {
                        // Android - opens in default maps app (Google Maps, Waze, etc.)
                        window.open(`geo:0,0?q=${address}`, '_self');
                      } else {
                        // Desktop/other - fallback to Google Maps
                        window.open(`https://maps.google.com/?q=${address}`, '_blank');
                      }
                    }}
                    className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer text-left"
                  >
                    <MapPin className="h-4 w-4" />
                    {client.address}
                  </button>
                )}
                {client.notes && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    {client.notes}
                  </p>
                )}
                
                {/* Jobs History Section */}
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <button
                    onClick={() => toggleClientJobs(client.id)}
                    className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 w-full text-left"
                  >
                    {expandedClientJobs.has(client.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Briefcase className="h-4 w-4" />
                    <span className="font-medium">Jobs History</span>
                  </button>
                  
                  {expandedClientJobs.has(client.id) && (
                    <ClientJobsHistory clientId={client.id} />
                  )}
                </div>
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    Added {new Date(client.createdAt).toLocaleDateString()}
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