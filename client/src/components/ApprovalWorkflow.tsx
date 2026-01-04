import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  FileCheck, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Plus,
  Briefcase,
  FileText,
  PenTool,
  Copy,
  ExternalLink,
  ChevronDown,
  Search,
  X,
  User,
  Mail
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Job {
  id: number;
  title: string;
  address?: string;
  clientName?: string;
}

interface Document {
  id: number;
  name: string;
  fileUrl: string;
  category: string;
  jobId?: number;
}

interface RelatedJob {
  id: number;
  title: string;
  address?: string;
}

interface RelatedDocument {
  id: number;
  name: string;
  fileUrl: string;
  category: string;
}

interface ApprovalWorkflow {
  id: number;
  title: string;
  description: string;
  type: string;
  status: string;
  relatedJobId?: number;
  relatedDocumentId?: number;
  relatedJob?: RelatedJob;
  relatedDocument?: RelatedDocument;
  customerName?: string;
  customerEmail?: string;
  expiresAt?: string;
  createdAt: string;
  signatures?: ApprovalSignature[];
  history?: ApprovalHistory[];
}

interface ApprovalSignature {
  id: number;
  signerName: string;
  signerEmail: string;
  signerType: string;
  status: string;
  signedAt?: string;
  comments?: string;
  accessToken: string;
}

interface ApprovalHistory {
  id: number;
  action: string;
  description: string;
  performedByEmail?: string;
  timestamp: string;
}

interface UserInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

const createWorkflowSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  type: z.string().min(1, "Type is required"),
  relatedJobId: z.number().optional().nullable(),
  relatedDocumentId: z.number().optional().nullable(),
  customerName: z.string().optional(),
  customerEmail: z.string().email("Valid email required").optional().or(z.literal("")),
});

const addSignatureSchema = z.object({
  signerName: z.string().min(1, "Signer name is required"),
  signerEmail: z.string().email("Valid email is required"),
  signerType: z.string().min(1, "Signer type is required"),
});

const getStatusColor = (status: string) => {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-700 dark:text-gray-200';
    case 'sent': return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200';
    case 'approved': return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200';
    case 'declined': return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-700 dark:text-gray-200';
  }
};

const getSignatureStatusIcon = (status: string) => {
  switch (status) {
    case 'signed': return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'declined': return <XCircle className="h-4 w-4 text-red-600" />;
    case 'pending': return <Clock className="h-4 w-4 text-yellow-600" />;
    default: return <Clock className="h-4 w-4 text-gray-600" />;
  }
};

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'estimate': return 'Estimate';
    case 'change_order': return 'Change Order';
    case 'authorization': return 'Authorization';
    case 'other': return 'Other';
    default: return type;
  }
};

export default function ApprovalWorkflow() {
  const { toast } = useToast();
  const [selectedWorkflow, setSelectedWorkflow] = useState<ApprovalWorkflow | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddSignatureDialog, setShowAddSignatureDialog] = useState(false);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [docSearchQuery, setDocSearchQuery] = useState("");

  // Fetch user info for RBAC
  const { data: userInfo } = useQuery<UserInfo>({
    queryKey: ["/api/auth/user"],
  });

  // Fetch approval workflows
  const { data: workflows = [], isLoading } = useQuery<ApprovalWorkflow[]>({
    queryKey: ["/api/approvals"],
  });

  // Fetch jobs for picker
  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
  });

  // Fetch documents for picker
  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  // Fetch detailed workflow
  const { data: workflowDetails } = useQuery<ApprovalWorkflow>({
    queryKey: ["/api/approvals", selectedWorkflow?.id],
    enabled: !!selectedWorkflow?.id,
  });

  // RBAC: Check if user can create approvals (not Technician)
  const userRole = userInfo?.role?.toUpperCase() || 'TECHNICIAN';
  const canCreateApproval = ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(userRole);

  // Create workflow mutation
  const createWorkflowMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createWorkflowSchema>) => {
      const res = await apiRequest("POST", "/api/approvals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      setShowCreateDialog(false);
      setSelectedJobId(null);
      setSelectedDocumentId(null);
      createForm.reset();
      toast({
        title: "Approval Created",
        description: "New approval workflow created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add signature mutation
  const addSignatureMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addSignatureSchema>) => {
      const res = await apiRequest("POST", `/api/approvals/${selectedWorkflow?.id}/signatures`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals", selectedWorkflow?.id] });
      setShowAddSignatureDialog(false);
      signatureForm.reset();
      toast({
        title: "Signature Request Added",
        description: "Signature request has been added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Signature",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createForm = useForm<z.infer<typeof createWorkflowSchema>>({
    resolver: zodResolver(createWorkflowSchema),
    defaultValues: {
      title: "",
      description: "",
      type: "",
      relatedJobId: null,
      relatedDocumentId: null,
      customerName: "",
      customerEmail: "",
    },
  });

  const signatureForm = useForm<z.infer<typeof addSignatureSchema>>({
    resolver: zodResolver(addSignatureSchema),
    defaultValues: {
      signerName: "",
      signerEmail: "",
      signerType: "",
    },
  });

  // Filter jobs by search query
  const filteredJobs = jobs.filter(job => 
    job.title.toLowerCase().includes(jobSearchQuery.toLowerCase()) ||
    (job.address && job.address.toLowerCase().includes(jobSearchQuery.toLowerCase()))
  );

  // Filter documents - if a job is selected, show its docs first, otherwise show all
  const filteredDocuments = documents
    .filter(doc => 
      doc.name.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
      doc.category.toLowerCase().includes(docSearchQuery.toLowerCase())
    )
    .sort((a, b) => {
      // Sort documents from selected job to top
      if (selectedJobId) {
        if (a.jobId === selectedJobId && b.jobId !== selectedJobId) return -1;
        if (b.jobId === selectedJobId && a.jobId !== selectedJobId) return 1;
      }
      return 0;
    });

  const selectedJob = jobs.find(j => j.id === selectedJobId);
  const selectedDocument = documents.find(d => d.id === selectedDocumentId);

  const copySignatureLink = (signature: ApprovalSignature) => {
    const link = `${window.location.origin}/api/sign/${signature.accessToken}`;
    navigator.clipboard.writeText(link);
    toast({
      title: "Link Copied",
      description: "Signature link copied to clipboard",
    });
  };

  const openSignatureLink = (signature: ApprovalSignature) => {
    const link = `${window.location.origin}/api/sign/${signature.accessToken}`;
    window.open(link, '_blank');
  };

  const handleCreateSubmit = (data: z.infer<typeof createWorkflowSchema>) => {
    createWorkflowMutation.mutate({
      ...data,
      relatedJobId: selectedJobId,
      relatedDocumentId: selectedDocumentId,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-pulse text-slate-500">Loading approval workflows...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">E-signature Approvals</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Manage approval workflows for estimates, change orders, and authorizations
          </p>
        </div>
        {/* Only show Create button if user has permission */}
        {canCreateApproval && (
          <Dialog open={showCreateDialog} onOpenChange={(open) => {
            setShowCreateDialog(open);
            if (!open) {
              setSelectedJobId(null);
              setSelectedDocumentId(null);
              createForm.reset();
            }
          }}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700" data-testid="button-create-approval">
                <Plus className="h-4 w-4 mr-2" />
                Create Approval
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Approval Workflow</DialogTitle>
              </DialogHeader>
              <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(handleCreateSubmit)} className="space-y-4">
                  {/* Title */}
                  <FormField
                    control={createForm.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title *</FormLabel>
                        <FormControl>
                          <Input placeholder="Kitchen Renovation Estimate" {...field} data-testid="input-approval-title" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Type */}
                  <FormField
                    control={createForm.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-approval-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="estimate">Estimate</SelectItem>
                            <SelectItem value="change_order">Change Order</SelectItem>
                            <SelectItem value="authorization">Authorization</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Description */}
                  <FormField
                    control={createForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Details about what needs approval..." {...field} data-testid="input-approval-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Related Job Picker */}
                  <div className="space-y-2">
                    <Label>Related Job</Label>
                    <Popover open={jobPickerOpen} onOpenChange={setJobPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between"
                          data-testid="button-select-job"
                        >
                          {selectedJob ? (
                            <span className="truncate">{selectedJob.title}</span>
                          ) : (
                            <span className="text-muted-foreground">Select a job (optional)</span>
                          )}
                          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <Command>
                          <CommandInput 
                            placeholder="Search jobs..." 
                            value={jobSearchQuery}
                            onValueChange={setJobSearchQuery}
                          />
                          <CommandList>
                            <CommandEmpty>No jobs found.</CommandEmpty>
                            <CommandGroup>
                              <ScrollArea className="h-[200px]">
                                {filteredJobs.map((job) => (
                                  <CommandItem
                                    key={job.id}
                                    value={job.title}
                                    onSelect={() => {
                                      setSelectedJobId(job.id);
                                      setJobPickerOpen(false);
                                      setJobSearchQuery("");
                                    }}
                                    data-testid={`job-option-${job.id}`}
                                  >
                                    <Briefcase className="mr-2 h-4 w-4" />
                                    <div className="flex flex-col">
                                      <span>{job.title}</span>
                                      {job.address && (
                                        <span className="text-xs text-muted-foreground truncate max-w-[300px]">{job.address}</span>
                                      )}
                                    </div>
                                  </CommandItem>
                                ))}
                              </ScrollArea>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedJob && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3" />
                          {selectedJob.title}
                          <button 
                            type="button"
                            onClick={() => setSelectedJobId(null)}
                            className="ml-1 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Related Document Picker */}
                  <div className="space-y-2">
                    <Label>Related Document</Label>
                    <Popover open={documentPickerOpen} onOpenChange={setDocumentPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between"
                          data-testid="button-select-document"
                        >
                          {selectedDocument ? (
                            <span className="truncate">{selectedDocument.name}</span>
                          ) : (
                            <span className="text-muted-foreground">Select a document (optional)</span>
                          )}
                          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <Command>
                          <CommandInput 
                            placeholder="Search documents..." 
                            value={docSearchQuery}
                            onValueChange={setDocSearchQuery}
                          />
                          <CommandList>
                            <CommandEmpty>No documents found.</CommandEmpty>
                            <CommandGroup>
                              <ScrollArea className="h-[200px]">
                                {filteredDocuments.map((doc) => (
                                  <CommandItem
                                    key={doc.id}
                                    value={doc.name}
                                    onSelect={() => {
                                      setSelectedDocumentId(doc.id);
                                      setDocumentPickerOpen(false);
                                      setDocSearchQuery("");
                                    }}
                                    data-testid={`doc-option-${doc.id}`}
                                  >
                                    <FileText className="mr-2 h-4 w-4" />
                                    <div className="flex flex-col">
                                      <span>{doc.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {doc.category}
                                        {selectedJobId && doc.jobId === selectedJobId && (
                                          <span className="ml-2 text-blue-600">(This job)</span>
                                        )}
                                      </span>
                                    </div>
                                  </CommandItem>
                                ))}
                              </ScrollArea>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedDocument && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {selectedDocument.name}
                          <button 
                            type="button"
                            onClick={() => setSelectedDocumentId(null)}
                            className="ml-1 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Customer Name */}
                  <FormField
                    control={createForm.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Name</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input className="pl-10" placeholder="John Smith" {...field} data-testid="input-customer-name" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Customer Email */}
                  <FormField
                    control={createForm.control}
                    name="customerEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Email</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input className="pl-10" type="email" placeholder="john@example.com" {...field} data-testid="input-customer-email" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createWorkflowMutation.isPending} data-testid="button-submit-approval">
                      {createWorkflowMutation.isPending ? "Creating..." : "Create Approval"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Workflows List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {workflows.map((workflow) => (
          <Card 
            key={workflow.id} 
            className="cursor-pointer hover:shadow-md transition-shadow border-slate-200 dark:border-slate-700" 
            onClick={() => setSelectedWorkflow(workflow)}
            data-testid={`approval-card-${workflow.id}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-slate-900 dark:text-slate-100">{workflow.title}</CardTitle>
                <Badge className={getStatusColor(workflow.status)}>
                  {workflow.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <Badge variant="outline" className="text-xs">
                  {getTypeLabel(workflow.type)}
                </Badge>
                <span>•</span>
                <span>{format(new Date(workflow.createdAt), 'MMM d, yyyy')}</span>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {workflow.description && (
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-3 line-clamp-2">
                  {workflow.description}
                </p>
              )}
              
              {/* Show related job */}
              {workflow.relatedJob && (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-2">
                  <Briefcase className="h-3 w-3" />
                  <span className="truncate">{workflow.relatedJob.title}</span>
                </div>
              )}
              
              {/* Show related document */}
              {workflow.relatedDocument && (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-2">
                  <FileText className="h-3 w-3" />
                  <span className="truncate">{workflow.relatedDocument.name}</span>
                </div>
              )}
              
              {/* Signature summary */}
              {workflow.signatures && workflow.signatures.length > 0 && (
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span>{workflow.signatures.filter(s => s.status === 'signed').length} Signed</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-yellow-600" />
                    <span>{workflow.signatures.filter(s => s.status === 'pending').length} Pending</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {workflows.length === 0 && (
          <div className="col-span-2 text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
            <FileCheck className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-500 dark:text-slate-400 mb-4">No approval workflows yet</p>
            {canCreateApproval && (
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first">
                <Plus className="h-4 w-4 mr-2" />
                Create First Approval
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Workflow Detail Dialog */}
      <Dialog open={!!selectedWorkflow} onOpenChange={() => setSelectedWorkflow(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <FileCheck className="h-5 w-5" />
                {selectedWorkflow?.title}
              </DialogTitle>
              <Badge className={getStatusColor(selectedWorkflow?.status || '')}>
                {selectedWorkflow?.status}
              </Badge>
            </div>
          </DialogHeader>

          {workflowDetails && (
            <Tabs defaultValue="signatures" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="signatures">Signatures</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              {/* Signatures Tab */}
              <TabsContent value="signatures" className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Signature Requests</h3>
                  {canCreateApproval && (
                    <Dialog open={showAddSignatureDialog} onOpenChange={setShowAddSignatureDialog}>
                      <DialogTrigger asChild>
                        <Button size="sm" data-testid="button-add-signer">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Signer
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>Add Signature Request</DialogTitle>
                        </DialogHeader>
                        <Form {...signatureForm}>
                          <form onSubmit={signatureForm.handleSubmit((data) => addSignatureMutation.mutate(data))} className="space-y-4">
                            <FormField
                              control={signatureForm.control}
                              name="signerName"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Signer Name</FormLabel>
                                  <FormControl>
                                    <Input placeholder="John Smith" {...field} data-testid="input-signer-name" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={signatureForm.control}
                              name="signerEmail"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Email Address</FormLabel>
                                  <FormControl>
                                    <Input type="email" placeholder="john@example.com" {...field} data-testid="input-signer-email" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={signatureForm.control}
                              name="signerType"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Signer Type</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                      <SelectTrigger data-testid="select-signer-type">
                                        <SelectValue placeholder="Select signer type" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="client">Client</SelectItem>
                                      <SelectItem value="subcontractor">Contractor</SelectItem>
                                      <SelectItem value="company_rep">Company Representative</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="flex justify-end gap-2 pt-4">
                              <Button type="button" variant="outline" onClick={() => setShowAddSignatureDialog(false)}>
                                Cancel
                              </Button>
                              <Button type="submit" disabled={addSignatureMutation.isPending} data-testid="button-submit-signer">
                                {addSignatureMutation.isPending ? "Adding..." : "Add Signer"}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>

                <div className="space-y-3">
                  {workflowDetails.signatures?.map((signature) => (
                    <Card key={signature.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getSignatureStatusIcon(signature.status)}
                            <div>
                              <p className="font-medium text-slate-900 dark:text-slate-100">{signature.signerName}</p>
                              <p className="text-sm text-slate-600 dark:text-slate-400">{signature.signerEmail}</p>
                              <Badge variant="outline" className="text-xs mt-1">
                                {signature.signerType.replace('_', ' ')}
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {signature.status === 'pending' && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => copySignatureLink(signature)}>
                                  <Copy className="h-3 w-3 mr-1" />
                                  Copy Link
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openSignatureLink(signature)}>
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  Open
                                </Button>
                              </>
                            )}
                            {signature.signedAt && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {format(new Date(signature.signedAt), 'MMM d, yyyy HH:mm')}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {signature.comments && (
                          <div className="mt-3 p-2 bg-slate-50 dark:bg-slate-800 rounded text-sm">
                            <strong>Comments:</strong> {signature.comments}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}

                  {(!workflowDetails.signatures || workflowDetails.signatures.length === 0) && (
                    <div className="text-center py-8">
                      <PenTool className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-slate-500 dark:text-slate-400 mb-4">No signature requests yet</p>
                      {canCreateApproval && (
                        <Button onClick={() => setShowAddSignatureDialog(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add First Signer
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Details Tab */}
              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Type</Label>
                    <p className="text-slate-900 dark:text-slate-100">{getTypeLabel(workflowDetails.type)}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Status</Label>
                    <div className="mt-1">
                      <Badge className={getStatusColor(workflowDetails.status)}>
                        {workflowDetails.status}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Created</Label>
                    <p className="text-slate-900 dark:text-slate-100">{format(new Date(workflowDetails.createdAt), 'MMM d, yyyy HH:mm')}</p>
                  </div>
                  {workflowDetails.customerName && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Customer</Label>
                      <p className="text-slate-900 dark:text-slate-100">{workflowDetails.customerName}</p>
                      {workflowDetails.customerEmail && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">{workflowDetails.customerEmail}</p>
                      )}
                    </div>
                  )}
                </div>

                {workflowDetails.relatedJob && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Related Job</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Briefcase className="h-4 w-4 text-slate-500" />
                      <span className="text-slate-900 dark:text-slate-100">{workflowDetails.relatedJob.title}</span>
                    </div>
                    {workflowDetails.relatedJob.address && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 ml-6">{workflowDetails.relatedJob.address}</p>
                    )}
                  </div>
                )}

                {workflowDetails.relatedDocument && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Related Document</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <a 
                        href={workflowDetails.relatedDocument.fileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {workflowDetails.relatedDocument.name}
                      </a>
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 ml-6">{workflowDetails.relatedDocument.category}</p>
                  </div>
                )}

                {workflowDetails.description && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Description</Label>
                    <p className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap">{workflowDetails.description}</p>
                  </div>
                )}
              </TabsContent>

              {/* History Tab */}
              <TabsContent value="history" className="space-y-4">
                {workflowDetails.history && workflowDetails.history.length > 0 ? (
                  <div className="space-y-3">
                    {workflowDetails.history.map((entry) => (
                      <div key={entry.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="flex-shrink-0 mt-1">
                          <div className="h-2 w-2 rounded-full bg-blue-500" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-slate-900 dark:text-slate-100">{entry.description}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {format(new Date(entry.timestamp), 'MMM d, yyyy HH:mm')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-slate-500 dark:text-slate-400">No history entries yet</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
