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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  FileCheck, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Plus,
  FileText,
  ChevronDown,
  X,
  User,
  Mail,
  Eye,
  Send,
  Briefcase,
  Trash2,
  Copy,
  Link
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Document {
  id: number;
  name: string;
  fileUrl: string;
  category: string;
  jobId?: number;
}

interface Job {
  id: number;
  title: string;
  address?: string;
}

interface SignatureRequest {
  id: number;
  documentId: number;
  jobId?: number;
  customerName: string;
  customerEmail: string;
  message?: string;
  status: string;
  createdAt: string;
  sentAt?: string;
  viewedAt?: string;
  signedAt?: string;
  signUrl?: string;
  signingUrl?: string; // Only returned on creation
  signatureUrl?: string; // Base64 data URL of customer signature
  signedName?: string;
  deliveryStatus?: string; // sent, failed
  deliveryError?: string;
  document?: {
    id: number;
    name: string;
    fileUrl: string;
    category: string;
  };
  job?: {
    id: number;
    title: string;
    address?: string;
  };
}

interface UserInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

interface SignatureRequestsProps {
  prefilledDocumentId?: number;
  prefilledDocumentName?: string;
  onClose?: () => void;
  showCreateDialogOpen?: boolean;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-700 dark:text-gray-200';
    case 'sent': return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200';
    case 'viewed': return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900 dark:text-purple-200';
    case 'signed': return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200';
    case 'declined': return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200';
    case 'expired': return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900 dark:text-orange-200';
    case 'canceled': return 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-600 dark:text-gray-300';
    default: return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-700 dark:text-gray-200';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'signed': return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'declined': return <XCircle className="h-4 w-4 text-red-600" />;
    case 'viewed': return <Eye className="h-4 w-4 text-purple-600" />;
    case 'sent': return <Send className="h-4 w-4 text-blue-600" />;
    case 'draft': return <Clock className="h-4 w-4 text-gray-600" />;
    default: return <Clock className="h-4 w-4 text-gray-600" />;
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'draft': return 'Draft';
    case 'sent': return 'Sent';
    case 'viewed': return 'Viewed';
    case 'signed': return 'Signed';
    case 'declined': return 'Declined';
    case 'expired': return 'Expired';
    case 'canceled': return 'Canceled';
    default: return status;
  }
};

export default function SignatureRequests({ 
  prefilledDocumentId, 
  prefilledDocumentName,
  onClose,
  showCreateDialogOpen = false 
}: SignatureRequestsProps) {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(showCreateDialogOpen);
  const [selectedRequest, setSelectedRequest] = useState<SignatureRequest | null>(null);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(prefilledDocumentId || null);
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [message, setMessage] = useState("");

  // Fetch user info for RBAC
  const { data: userInfo } = useQuery<UserInfo>({
    queryKey: ["/api/auth/user"],
  });

  // Fetch signature requests
  const { data: requests = [], isLoading } = useQuery<SignatureRequest[]>({
    queryKey: ["/api/signature-requests"],
  });

  // Fetch documents for picker (only shows docs user can access via backend RBAC)
  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  // RBAC: Check if user can create signature requests (not Technician)
  const userRole = userInfo?.role?.toUpperCase() || 'TECHNICIAN';
  const canCreate = ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(userRole);

  // Create signature request mutation
  const createMutation = useMutation({
    mutationFn: async (data: { documentId: number; customerName: string; customerEmail: string; message?: string }) => {
      const res = await apiRequest("POST", "/api/signature-requests", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signature-requests"] });
      setShowCreateDialog(false);
      resetForm();
      toast({
        title: "Signature Request Created",
        description: "You can now send it to the customer",
      });
      if (onClose) onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/signature-requests/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signature-requests"] });
      setSelectedRequest(null);
      toast({
        title: "Deleted",
        description: "Signature request has been deleted",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Send mutation - transitions draft → sent, sends email via Resend
  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/signature-requests/${id}/send`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to send');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/signature-requests"] });
      // Update selectedRequest with new status and signUrl
      setSelectedRequest(prev => prev ? { 
        ...prev, 
        status: 'sent', 
        sentAt: data.sentAt,
        signUrl: data.signUrl,
        deliveryStatus: 'sent'
      } : null);
      toast({
        title: "Email sent successfully",
        description: `Signature request sent to ${selectedRequest?.customerEmail || 'customer'}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Email failed to send",
        description: error.message.includes('RESEND') || error.message.includes('EMAIL') 
          ? "Please check your email settings in Secrets (RESEND_API_KEY, EMAIL_FROM)."
          : error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedDocumentId(prefilledDocumentId || null);
    setCustomerName("");
    setCustomerEmail("");
    setMessage("");
  };

  const selectedDocument = documents.find(d => d.id === selectedDocumentId);

  // Filter documents by search query
  const filteredDocuments = documents.filter(doc => 
    doc.name.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
    doc.category.toLowerCase().includes(docSearchQuery.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedDocumentId) {
      toast({
        title: "Document Required",
        description: "Please select a document to request signature for",
        variant: "destructive",
      });
      return;
    }
    
    if (!customerName.trim()) {
      toast({
        title: "Customer Name Required",
        description: "Please enter the customer's name",
        variant: "destructive",
      });
      return;
    }
    
    if (!customerEmail.trim() || !customerEmail.includes('@')) {
      toast({
        title: "Valid Email Required",
        description: "Please enter a valid customer email",
        variant: "destructive",
      });
      return;
    }
    
    createMutation.mutate({
      documentId: selectedDocumentId,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      message: message.trim() || undefined,
    });
  };

  if (isLoading && !prefilledDocumentId) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-pulse text-slate-500">Loading signature requests...</div>
      </div>
    );
  }

  // Embedded mode: When called with a prefilled document, show only the create form
  if (prefilledDocumentId && prefilledDocumentName) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Document Info */}
        <div className="space-y-2">
          <Label>Document</Label>
          <div className="flex items-center gap-2 p-3 bg-slate-100 dark:bg-slate-800 rounded-md">
            <FileText className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium">{prefilledDocumentName}</span>
          </div>
        </div>

        {/* Customer Name */}
        <div className="space-y-2">
          <Label htmlFor="customerName">Customer Name *</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="customerName"
              className="pl-10"
              placeholder="John Smith"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              data-testid="input-customer-name"
            />
          </div>
        </div>

        {/* Customer Email */}
        <div className="space-y-2">
          <Label htmlFor="customerEmail">Customer Email *</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="customerEmail"
              className="pl-10"
              type="email"
              placeholder="john@example.com"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              data-testid="input-customer-email"
            />
          </div>
        </div>

        {/* Optional Message */}
        <div className="space-y-2">
          <Label htmlFor="message">Message (Optional)</Label>
          <Textarea
            id="message"
            placeholder="Include a personal message with the signature request..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            data-testid="input-message"
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-request">
            {createMutation.isPending ? "Creating..." : "Send for Signature"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Signature Requests</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Send documents for customer signature
          </p>
        </div>
        {/* Only show Create button if user has permission */}
        {canCreate && (
          <Dialog open={showCreateDialog} onOpenChange={(open) => {
            setShowCreateDialog(open);
            if (!open) {
              resetForm();
              if (onClose) onClose();
            }
          }}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700" data-testid="button-new-signature-request">
                <Plus className="h-4 w-4 mr-2" />
                New Signature Request
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New Signature Request</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Document Picker */}
                <div className="space-y-2">
                  <Label>Document *</Label>
                  {prefilledDocumentId && prefilledDocumentName ? (
                    <div className="flex items-center gap-2 p-3 bg-slate-100 dark:bg-slate-800 rounded-md">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <span className="text-sm">{prefilledDocumentName}</span>
                    </div>
                  ) : (
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
                            <span className="text-muted-foreground">Select a document</span>
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
                                      <span className="text-xs text-muted-foreground">{doc.category}</span>
                                    </div>
                                  </CommandItem>
                                ))}
                              </ScrollArea>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                  {selectedDocument && !prefilledDocumentId && (
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
                <div className="space-y-2">
                  <Label htmlFor="customerName">Customer Name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="customerName"
                      className="pl-10"
                      placeholder="John Smith"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      data-testid="input-customer-name"
                    />
                  </div>
                </div>

                {/* Customer Email */}
                <div className="space-y-2">
                  <Label htmlFor="customerEmail">Customer Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="customerEmail"
                      className="pl-10"
                      type="email"
                      placeholder="john@example.com"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      data-testid="input-customer-email"
                    />
                  </div>
                </div>

                {/* Optional Message */}
                <div className="space-y-2">
                  <Label htmlFor="message">Message (Optional)</Label>
                  <Textarea
                    id="message"
                    placeholder="Include a personal message with the signature request..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    data-testid="input-message"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => {
                    setShowCreateDialog(false);
                    resetForm();
                    if (onClose) onClose();
                  }}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-request">
                    {createMutation.isPending ? "Creating..." : "Create Request"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Requests List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {requests.map((request) => (
          <Card 
            key={request.id} 
            className="cursor-pointer hover:shadow-md transition-shadow border-slate-200 dark:border-slate-700" 
            onClick={() => setSelectedRequest(request)}
            data-testid={`signature-request-card-${request.id}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                  {request.document?.name || `Document #${request.documentId}`}
                </CardTitle>
                <Badge className={getStatusColor(request.status)}>
                  {getStatusLabel(request.status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <User className="h-3 w-3" />
                  <span>{request.customerName}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <Mail className="h-3 w-3" />
                  <span className="truncate">{request.customerEmail}</span>
                </div>
                {request.job && (
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Briefcase className="h-3 w-3" />
                    <span className="truncate">{request.job.title}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
                  <Clock className="h-3 w-3" />
                  <span>{format(new Date(request.createdAt), 'MMM d, yyyy')}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {requests.length === 0 && (
          <div className="col-span-2 text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
            <FileCheck className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-500 dark:text-slate-400 mb-4">No signature requests yet</p>
            {canCreate && (
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first">
                <Plus className="h-4 w-4 mr-2" />
                New Signature Request
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Request Detail Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                {getStatusIcon(selectedRequest?.status || '')}
                Signature Request
              </DialogTitle>
              <Badge className={getStatusColor(selectedRequest?.status || '')}>
                {getStatusLabel(selectedRequest?.status || '')}
              </Badge>
            </div>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              {/* Document Info */}
              <div>
                <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Document</Label>
                <div className="flex items-center gap-2 mt-1">
                  <FileText className="h-4 w-4 text-slate-500" />
                  <a 
                    href={selectedRequest.document?.fileUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {selectedRequest.document?.name}
                  </a>
                </div>
                {selectedRequest.document?.category && (
                  <Badge variant="outline" className="mt-1 text-xs">{selectedRequest.document.category}</Badge>
                )}
              </div>

              {/* Customer Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Customer</Label>
                  <p className="text-slate-900 dark:text-slate-100">{selectedRequest.customerName}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Email</Label>
                  <p className="text-slate-900 dark:text-slate-100">{selectedRequest.customerEmail}</p>
                </div>
              </div>

              {/* Job Info */}
              {selectedRequest.job && (
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Related Job</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Briefcase className="h-4 w-4 text-slate-500" />
                    <span className="text-slate-900 dark:text-slate-100">{selectedRequest.job.title}</span>
                  </div>
                </div>
              )}

              {/* Message */}
              {selectedRequest.message && (
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Message</Label>
                  <p className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap mt-1">{selectedRequest.message}</p>
                </div>
              )}

              {/* Created Date */}
              <div>
                <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Created</Label>
                <p className="text-slate-900 dark:text-slate-100">
                  {format(new Date(selectedRequest.createdAt), 'MMM d, yyyy HH:mm')}
                </p>
              </div>

              {/* Sent Date */}
              {selectedRequest.sentAt && (
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Sent</Label>
                  <p className="text-slate-900 dark:text-slate-100">
                    {format(new Date(selectedRequest.sentAt), 'MMM d, yyyy HH:mm')}
                  </p>
                </div>
              )}

              {/* Signed Date */}
              {selectedRequest.signedAt && (
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Signed</Label>
                  <p className="text-slate-900 dark:text-slate-100">
                    {format(new Date(selectedRequest.signedAt), 'MMM d, yyyy HH:mm')}
                    {selectedRequest.signedName && ` by ${selectedRequest.signedName}`}
                  </p>
                </div>
              )}

              {/* View Signature - Show for signed requests with signature data */}
              {selectedRequest.status === 'signed' && selectedRequest.signatureUrl && (
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400">Customer Signature</Label>
                  <div className="mt-2 border rounded-lg p-2 bg-white dark:bg-slate-800">
                    <img 
                      src={selectedRequest.signatureUrl} 
                      alt="Customer Signature"
                      className="max-w-full max-h-32 mx-auto"
                    />
                  </div>
                </div>
              )}

              {/* Signing Link - Show for sent/viewed/signed requests */}
              {selectedRequest.signUrl && ['sent', 'viewed', 'signed'].includes(selectedRequest.status) && (
                <div>
                  <Label className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1">
                    <Link className="h-3 w-3" />
                    Signing Link
                  </Label>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded text-sm font-mono truncate text-slate-600 dark:text-slate-300">
                      {selectedRequest.signUrl}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedRequest.signUrl || '');
                        toast({
                          title: "Link copied",
                          description: "Signing link copied to clipboard",
                        });
                      }}
                      data-testid="button-copy-sign-link"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Actions - Only show for draft requests with proper role */}
              {canCreate && selectedRequest.status === 'draft' && (
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this signature request?')) {
                        deleteMutation.mutate(selectedRequest.id);
                      }
                    }}
                    disabled={deleteMutation.isPending || sendMutation.isPending}
                    data-testid="button-delete-request"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                  </Button>
                  <Button 
                    onClick={() => sendMutation.mutate(selectedRequest.id)}
                    disabled={sendMutation.isPending || deleteMutation.isPending}
                    data-testid="button-send-request"
                  >
                    <Send className="h-4 w-4 mr-1" />
                    {sendMutation.isPending ? 'Sending...' : 'Send for Signature'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
