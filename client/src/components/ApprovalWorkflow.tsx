import { useState, useRef } from "react";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { 
  FileCheck, 
  Send, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Eye, 
  Plus,
  Mail,
  User,
  Building,
  FileText,
  Calendar,
  History,
  PenTool,
  AlertTriangle,
  Copy,
  ExternalLink
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";

interface ApprovalWorkflow {
  id: number;
  title: string;
  description: string;
  type: string;
  status: string;
  documentUrl?: string;
  documentType?: string;
  relatedJobId?: number;
  relatedClientId?: number;
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

const createWorkflowSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  type: z.string().min(1, "Type is required"),
  documentUrl: z.string().url().optional().or(z.literal("")),
  relatedJobId: z.number().optional(),
  relatedClientId: z.number().optional(),
  expiresAt: z.string().optional(),
});

const addSignatureSchema = z.object({
  signerName: z.string().min(1, "Signer name is required"),
  signerEmail: z.string().email("Valid email is required"),
  signerType: z.string().min(1, "Signer type is required"),
});

const getStatusColor = (status: string) => {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-800 border-gray-200';
    case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'approved': return 'bg-green-100 text-green-800 border-green-200';
    case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
    case 'expired': return 'bg-gray-100 text-gray-600 border-gray-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
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

export default function ApprovalWorkflow() {
  const { toast } = useToast();
  const [selectedWorkflow, setSelectedWorkflow] = useState<ApprovalWorkflow | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddSignatureDialog, setShowAddSignatureDialog] = useState(false);

  // Fetch approval workflows
  const { data: workflows = [], isLoading } = useQuery<ApprovalWorkflow[]>({
    queryKey: ["/api/approvals"],
  });

  // Fetch detailed workflow
  const { data: workflowDetails } = useQuery<ApprovalWorkflow>({
    queryKey: ["/api/approvals", selectedWorkflow?.id],
    enabled: !!selectedWorkflow?.id,
  });

  // Create workflow mutation
  const createWorkflowMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createWorkflowSchema>) => {
      const res = await apiRequest("POST", "/api/approvals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      setShowCreateDialog(false);
      toast({
        title: "Approval Workflow Created",
        description: "New approval workflow created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Workflow",
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
      toast({
        title: "Signature Request Sent",
        description: "Signature request has been sent successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Send Signature Request",
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
      documentUrl: "",
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
          <h2 className="text-2xl font-bold">E-signature Approvals</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Manage approval workflows for quotes, designs, and scope changes
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
              <Plus className="h-4 w-4 mr-2" />
              Create Approval
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Approval Workflow</DialogTitle>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit((data) => createWorkflowMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={createForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Kitchen Renovation Quote" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select approval type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="quote">Quote</SelectItem>
                          <SelectItem value="design">Design</SelectItem>
                          <SelectItem value="scope_change">Scope Change</SelectItem>
                          <SelectItem value="contract">Contract</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Detailed description of what needs approval..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createForm.control}
                  name="documentUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Document URL (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createWorkflowMutation.isPending}>
                    {createWorkflowMutation.isPending ? "Creating..." : "Create Workflow"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Workflows List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {workflows.map((workflow) => (
          <Card key={workflow.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedWorkflow(workflow)}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{workflow.title}</CardTitle>
                <Badge className={getStatusColor(workflow.status)}>
                  {workflow.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <FileCheck className="h-4 w-4" />
                <span className="capitalize">{workflow.type.replace('_', ' ')}</span>
                <span>•</span>
                <span>{format(new Date(workflow.createdAt), 'MMM d, yyyy')}</span>
              </div>
            </CardHeader>
            <CardContent>
              {workflow.description && (
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-3 line-clamp-2">
                  {workflow.description}
                </p>
              )}
              
              {workflow.signatures && (
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span>{workflow.signatures.filter(s => s.status === 'signed').length} Signed</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-yellow-600" />
                    <span>{workflow.signatures.filter(s => s.status === 'pending').length} Pending</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span>{workflow.signatures.filter(s => s.status === 'declined').length} Declined</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {workflows.length === 0 && (
          <div className="col-span-2 text-center py-8">
            <FileCheck className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-500 mb-4">No approval workflows yet</p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Approval
            </Button>
          </div>
        )}
      </div>

      {/* Workflow Detail Dialog */}
      <Dialog open={!!selectedWorkflow} onOpenChange={() => setSelectedWorkflow(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
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
                  <h3 className="text-lg font-semibold">Signature Requests</h3>
                  <Dialog open={showAddSignatureDialog} onOpenChange={setShowAddSignatureDialog}>
                    <DialogTrigger asChild>
                      <Button size="sm">
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
                                  <Input placeholder="John Smith" {...field} />
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
                                  <Input type="email" placeholder="john@example.com" {...field} />
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
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
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
                            <Button type="submit" disabled={addSignatureMutation.isPending}>
                              {addSignatureMutation.isPending ? "Sending..." : "Send Request"}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="space-y-3">
                  {workflowDetails.signatures?.map((signature) => (
                    <Card key={signature.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getSignatureStatusIcon(signature.status)}
                            <div>
                              <p className="font-medium">{signature.signerName}</p>
                              <p className="text-sm text-slate-600">{signature.signerEmail}</p>
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
                              <div className="text-xs text-slate-500">
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
                      <p className="text-slate-500 mb-4">No signature requests yet</p>
                      <Button onClick={() => setShowAddSignatureDialog(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add First Signer
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Details Tab */}
              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Type</Label>
                    <p className="capitalize">{workflowDetails.type.replace('_', ' ')}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Status</Label>
                    <Badge className={getStatusColor(workflowDetails.status)}>
                      {workflowDetails.status}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Created</Label>
                    <p>{format(new Date(workflowDetails.createdAt), 'MMM d, yyyy HH:mm')}</p>
                  </div>
                  {workflowDetails.expiresAt && (
                    <div>
                      <Label className="text-sm font-medium">Expires</Label>
                      <p>{format(new Date(workflowDetails.expiresAt), 'MMM d, yyyy HH:mm')}</p>
                    </div>
                  )}
                </div>

                {workflowDetails.description && (
                  <div>
                    <Label className="text-sm font-medium">Description</Label>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                      {workflowDetails.description}
                    </p>
                  </div>
                )}

                {workflowDetails.documentUrl && (
                  <div>
                    <Label className="text-sm font-medium">Document</Label>
                    <div className="mt-1">
                      <Button variant="outline" size="sm" onClick={() => window.open(workflowDetails.documentUrl, '_blank')}>
                        <FileText className="h-4 w-4 mr-2" />
                        View Document
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* History Tab */}
              <TabsContent value="history" className="space-y-4">
                <h3 className="text-lg font-semibold">Approval History</h3>
                <div className="space-y-3">
                  {workflowDetails.history?.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <History className="h-4 w-4 text-slate-500 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{entry.description}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                          {entry.performedByEmail && (
                            <>
                              <span>{entry.performedByEmail}</span>
                              <span>•</span>
                            </>
                          )}
                          <span>{format(new Date(entry.timestamp), 'MMM d, yyyy HH:mm')}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {(!workflowDetails.history || workflowDetails.history.length === 0) && (
                    <div className="text-center py-8">
                      <History className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-slate-500">No history available</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}