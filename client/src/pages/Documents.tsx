import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderOpen, FileText, Upload, Download, PenTool, X, Loader2, ExternalLink, File, Search, ChevronDown, Building2, CheckSquare, Square, Check } from "lucide-react";
import ApprovalWorkflow from "@/components/ApprovalWorkflow";
import { queryClient } from "@/lib/queryClient";
import { DOCUMENT_CATEGORIES, WORKFLOW_CATEGORIES, DOCUMENT_STATUSES, type DocumentCategory, type DocumentStatus } from "@shared/schema";
import { isAdmin, canDelete, canChangeStatus, getUploadableCategories, requireJobForUpload, isWorkflowCategory as checkWorkflowCategory, getAllowedStatusTransitions, DOCUMENT_VISIBILITIES, type DocumentStatus as PermDocStatus, type DocumentVisibility } from "@shared/documentPermissions";
import { Trash2, Camera } from "lucide-react";

interface JobInfo {
  id: number;
  title: string;
  clientName: string | null;
}

interface CustomerInfo {
  id: number;
  firstName: string;
  lastName: string;
}

interface DocumentType {
  id: number;
  name: string;
  type: string | null;
  category: string;
  status: string;
  visibility: DocumentVisibility;
  jobId: number | null;
  customerId: number | null;
  job: JobInfo | null;
  customer: CustomerInfo | null;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
}

interface JobType {
  id: number;
  title: string;
  clientName: string | null;
  location?: string | null;
  city?: string | null;
  status?: string;
}

type CustomerFilterMode = 
  | { mode: 'all' }
  | { mode: 'has_customer' }
  | { mode: 'company' }
  | { mode: 'customer'; customerId: number; label: string };

function isWorkflowCategory(category: string): boolean {
  return (WORKFLOW_CATEGORIES as readonly string[]).includes(category);
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 'Approved': return 'default';
    case 'Rejected': return 'destructive';
    case 'Pending Approval': return 'secondary';
    default: return 'outline';
  }
}

function getVisibilityLabel(visibility: DocumentVisibility): string {
  switch (visibility) {
    case 'customer_internal': return 'Everyone';
    case 'assigned_crew_only': return 'Crew Only';
    case 'office_only': return 'Office Only';
    case 'internal': return 'Internal';
    case 'owner_only': return 'Owner Only';
    default: return 'Internal';
  }
}

function getVisibilityVariant(visibility: DocumentVisibility): "default" | "secondary" | "destructive" | "outline" {
  switch (visibility) {
    case 'customer_internal': return 'default';
    case 'owner_only': return 'destructive';
    case 'assigned_crew_only': return 'secondary';
    default: return 'outline';
  }
}


function getFileType(fileName: string, mimeType?: string | null): 'image' | 'pdf' | 'other' {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return 'image';
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  return 'other';
}

export default function Documents() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [customerFilter, setCustomerFilter] = useState<CustomerFilterMode>({ mode: 'all' });
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerSearchQuery, setCustomerPickerSearchQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("Other");
  const [uploadCustomerId, setUploadCustomerId] = useState<string>('company-wide');
  const [uploadCustomerPickerOpen, setUploadCustomerPickerOpen] = useState(false);
  const [uploadCustomerSearchQuery, setUploadCustomerSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentType | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [visibilityModalOpen, setVisibilityModalOpen] = useState(false);
  const [visibilityEditDoc, setVisibilityEditDoc] = useState<DocumentType | null>(null);
  const [selectedVisibility, setSelectedVisibility] = useState<DocumentVisibility>('internal');
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureDoc, setSignatureDoc] = useState<DocumentType | null>(null);
  
  // Bulk select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);

  const { data: documents = [], isLoading: documentsLoading } = useQuery<DocumentType[]>({
    queryKey: ["/api/documents"],
    enabled: isAuthenticated,
  });

  const { data: jobs = [] } = useQuery<JobType[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  interface CustomerType {
    id: number;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    companyName?: string | null;
  }

  const { data: customersList = [] } = useQuery<CustomerType[]>({
    queryKey: ["/api/customers"],
    enabled: isAuthenticated,
  });

  // Get user role from membership
  const { data: membership } = useQuery<{ role: string }>({
    queryKey: ["/api/user/membership"],
    enabled: isAuthenticated,
  });
  
  // Get user's assigned job IDs (for non-admins)
  const { data: assignedJobIds = [] } = useQuery<number[]>({
    queryKey: ["/api/user/assigned-jobs"],
    enabled: isAuthenticated,
  });
  
  const userRole = membership?.role || '';
  const userIsAdmin = isAdmin(userRole);
  const uploadableCategories = getUploadableCategories(userRole);
  
  // For non-admins, filter jobs to only show assigned jobs
  const availableJobs = useMemo(() => {
    if (userIsAdmin) return jobs;
    const assignedSet = new Set(assignedJobIds);
    return jobs.filter(job => assignedSet.has(job.id));
  }, [jobs, assignedJobIds, userIsAdmin]);

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/documents", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Upload failed");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setUploadOpen(false);
      setUploadName("");
      setUploadCategory(userIsAdmin ? "Other" : "Photos");
      setUploadCustomerId("company-wide");
      setSelectedFile(null);
      toast({ title: "Document uploaded", description: "Your document has been uploaded successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message || "You don't have permission to do that.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Delete failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setIsPreviewOpen(false);
      setSelectedDoc(null);
      toast({ title: "Document deleted", description: "The document has been deleted." });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message || "You don't have permission to do that.", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const response = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Update failed");
      return response.json();
    },
    onSuccess: (updatedDoc) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setSelectedDoc(updatedDoc);
      toast({ title: "Status updated", description: `Document status changed to ${updatedDoc.status}.` });
    },
    onError: () => {
      toast({ title: "Update failed", description: "Failed to update document status.", variant: "destructive" });
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: async ({ id, visibility }: { id: number; visibility: DocumentVisibility }) => {
      const response = await fetch(`/api/documents/${id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ visibility }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Update failed");
      }
      return response.json();
    },
    onSuccess: (updatedDoc) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      if (selectedDoc && selectedDoc.id === updatedDoc.id) {
        setSelectedDoc({ ...selectedDoc, visibility: updatedDoc.visibility });
      }
      setVisibilityModalOpen(false);
      setVisibilityEditDoc(null);
      toast({ title: "Visibility updated", description: `Document visibility changed to ${getVisibilityLabel(updatedDoc.visibility)}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message || "Failed to update visibility.", variant: "destructive" });
    },
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (documentIds: number[]) => {
      console.log('[DELETE] Bulk delete called with IDs:', documentIds);
      const response = await fetch("/api/documents/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ documentIds }),
      });
      console.log('[DELETE] Bulk delete response status:', response.status);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.log('[DELETE] Bulk delete error response:', data);
        throw new Error(data.message || "Bulk delete failed");
      }
      const result = await response.json();
      console.log('[DELETE] Bulk delete success:', result);
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setSelectedIds(new Set());
      setSelectMode(false);
      toast({ title: "Documents deleted", description: data.message || "Selected documents have been deleted." });
    },
    onError: (error: Error) => {
      console.error('[DELETE] Bulk delete mutation error:', error);
      toast({ title: "Delete failed", description: error.message || "You don't have permission to delete these documents.", variant: "destructive" });
    },
  });

  // Toggle document selection
  const toggleSelection = (id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Select all visible documents (union with existing selection)
  const selectAll = () => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      filteredDocuments.forEach(d => newSet.add(d.id));
      return newSet;
    });
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  // Download selected documents sequentially
  const downloadSelected = async () => {
    const selectedDocs = documents.filter(d => selectedIds.has(d.id));
    if (selectedDocs.length === 0) return;
    
    setIsDownloading(true);
    try {
      for (const doc of selectedDocs) {
        // Create a temporary anchor element for each download
        const link = document.createElement('a');
        link.href = doc.fileUrl;
        link.download = doc.name;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Small delay between downloads to prevent browser blocking
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      toast({ title: "Downloads started", description: `${selectedDocs.length} file(s) are being downloaded.` });
    } catch (error) {
      toast({ title: "Download failed", description: "Some files may not have been downloaded.", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  // Handle bulk delete
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    bulkDeleteMutation.mutate(ids);
  };

  // Check if user can edit visibility (Owner or Supervisor)
  const canEditVisibility = userRole.toUpperCase() === 'OWNER' || userRole.toUpperCase() === 'SUPERVISOR';
  
  // Get available visibility options based on role
  const getVisibilityOptions = (): { value: DocumentVisibility; label: string; description: string }[] => {
    const options = [
      { value: 'customer_internal' as DocumentVisibility, label: 'Everyone', description: 'All team members can see this' },
      { value: 'assigned_crew_only' as DocumentVisibility, label: 'Crew Only', description: 'Only assigned crew members' },
      { value: 'office_only' as DocumentVisibility, label: 'Office Only', description: 'Office staff only' },
      { value: 'internal' as DocumentVisibility, label: 'Internal', description: 'Internal team members' },
    ];
    // Only Owner can set owner_only
    if (userRole.toUpperCase() === 'OWNER') {
      options.push({ value: 'owner_only' as DocumentVisibility, label: 'Owner Only', description: 'Only visible to owners' });
    }
    return options;
  };

  const openVisibilityModal = (doc: DocumentType) => {
    setVisibilityEditDoc(doc);
    setSelectedVisibility(doc.visibility);
    setVisibilityModalOpen(true);
  };

  // Filter customers for the customer picker
  const filteredPickerCustomers = useMemo(() => {
    const query = customerPickerSearchQuery.trim().toLowerCase();
    if (!query) return customersList.slice(0, 100);
    return customersList.filter(c => {
      const searchFields = [
        `${c.firstName} ${c.lastName}`,
        c.email,
        c.phone,
        c.companyName,
      ].filter(Boolean).map(f => f!.toLowerCase());
      return searchFields.some(field => field.includes(query));
    }).slice(0, 100);
  }, [customersList, customerPickerSearchQuery]);

  const uploadFilteredCustomers = useMemo(() => {
    const query = uploadCustomerSearchQuery.trim().toLowerCase();
    if (!query) return customersList.slice(0, 100);
    return customersList.filter(c => {
      const searchFields = [
        `${c.firstName} ${c.lastName}`,
        c.email,
        c.phone,
        c.companyName,
      ].filter(Boolean).map(f => f!.toLowerCase());
      return searchFields.some(field => field.includes(query));
    }).slice(0, 100);
  }, [customersList, uploadCustomerSearchQuery]);

  const filteredDocuments = useMemo(() => {
    // Exclude invoice documents — they live in the Invoices section, not here
    let result = documents.filter(doc => doc.category !== 'Invoices' && doc.type !== 'invoice');
    
    // Filter by customer
    if (customerFilter.mode === 'has_customer') {
      result = result.filter(doc => doc.customerId !== null);
    } else if (customerFilter.mode === 'company') {
      result = result.filter(doc => doc.customerId === null);
    } else if (customerFilter.mode === 'customer') {
      result = result.filter(doc => doc.customerId === customerFilter.customerId);
    }
    
    // Filter by category
    if (activeCategory !== 'All') {
      result = result.filter(doc => doc.category === activeCategory);
    }
    
    return result;
  }, [documents, activeCategory, customerFilter]);

  // Auto-deselect items that are no longer visible due to filter changes
  const visibleIds = useMemo(() => new Set(filteredDocuments.map(d => d.id)), [filteredDocuments]);
  
  // Track how many selected items are currently visible
  const visibleSelectedCount = useMemo(() => {
    let count = 0;
    selectedIds.forEach(id => {
      if (visibleIds.has(id)) count++;
    });
    return count;
  }, [selectedIds, visibleIds]);

  // Check if all visible documents are selected
  const allVisibleSelected = filteredDocuments.length > 0 && visibleSelectedCount === filteredDocuments.length;

  const handleUpload = () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("name", uploadName || selectedFile.name);
    formData.append("category", uploadCategory);
    formData.append("visibility", "customer_internal");
    if (uploadCustomerId !== 'company-wide') {
      formData.append("customerId", uploadCustomerId);
    }
    uploadMutation.mutate(formData);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!uploadName) {
        setUploadName(file.name);
      }
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="w-full pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Documents</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage project documents</p>
      </div>

      <div className="w-full">
          {/* Filter Row: Job Picker + Category Dropdown + Select Toggle */}
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                className="flex-1 justify-between"
                onClick={() => setCustomerPickerOpen(true)}
                data-testid="button-customer-picker"
              >
                <span className="truncate">
                  {customerFilter.mode === 'all' 
                    ? 'All Documents' 
                    : customerFilter.mode === 'has_customer'
                      ? 'All Customers'
                      : customerFilter.mode === 'company' 
                        ? 'No customer' 
                        : customerFilter.label}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
              </Button>
              <Select value={activeCategory} onValueChange={setActiveCategory}>
                <SelectTrigger className="flex-1 min-w-0" data-testid="filter-category-dropdown">
                  <span className="min-w-0 flex-1 truncate text-left">
                    {activeCategory === 'All' ? 'All categories' : activeCategory}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" data-testid="filter-all">All categories</SelectItem>
                  {DOCUMENT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} data-testid={`filter-${cat.toLowerCase()}`}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Select toggle button - only show when documents exist */}
              {filteredDocuments.length > 0 && (
                <Button 
                  variant={selectMode ? "secondary" : "outline"}
                  size="icon"
                  onClick={() => {
                    if (selectMode) {
                      clearSelection();
                    } else {
                      setSelectMode(true);
                    }
                  }}
                  data-testid="button-select-mode"
                  title={selectMode ? 'Exit selection' : 'Select documents'}
                >
                  <CheckSquare className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* Selected Customer Chip - show when a specific customer is selected */}
            {customerFilter.mode === 'customer' && (
              <div className="flex items-center gap-2">
                <Badge 
                  variant="secondary" 
                  className="flex items-center gap-1 px-3 py-1.5 text-sm"
                  data-testid="chip-selected-customer"
                >
                  <FolderOpen className="h-3 w-3" />
                  <span className="truncate max-w-[200px]">{customerFilter.label}</span>
                  <button 
                    onClick={() => setCustomerFilter({ mode: 'all' })}
                    className="ml-1 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-full p-0.5"
                    data-testid="button-clear-customer-filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              </div>
            )}
            
            {/* Select All row - only shown in select mode */}
            {selectMode && filteredDocuments.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {selectedIds.size} selected
                </span>
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (allVisibleSelected) {
                      setSelectedIds(prev => {
                        const newSet = new Set(prev);
                        filteredDocuments.forEach(d => newSet.delete(d.id));
                        return newSet;
                      });
                    } else {
                      selectAll();
                    }
                  }}
                  data-testid="button-select-all"
                >
                  {allVisibleSelected ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
            )}
            
            <Dialog open={uploadOpen} onOpenChange={(open) => {
              setUploadOpen(open);
              if (open && !userIsAdmin) {
                setUploadCategory("Photos");
              }
            }}>
              <DialogTrigger asChild>
                <Button data-testid="button-upload-document">
                  {userIsAdmin ? (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Document
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4 mr-2" />
                      Upload Photo
                    </>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
                  <button 
                    onClick={() => setUploadOpen(false)}
                    className="absolute right-4 top-1/2 -translate-y-1/2"
                  >
                    <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                  </button>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {userIsAdmin ? 'Upload Document' : 'Upload Photo'}
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="file" className="text-sm font-medium text-slate-700 dark:text-slate-300">File</Label>
                    <Input
                      ref={fileInputRef}
                      id="file"
                      type="file"
                      accept={userIsAdmin ? undefined : "image/*"}
                      onChange={handleFileSelect}
                      className="h-10"
                      data-testid="input-file"
                    />
                    {selectedFile && (
                      <p className="text-xs text-slate-500">
                        Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {userIsAdmin ? 'Document Name' : 'Photo Name'}
                    </Label>
                    <Input
                      id="name"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.target.value)}
                      placeholder="Name"
                      className="h-10"
                      data-testid="input-document-name"
                    />
                  </div>
                  {userIsAdmin ? (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor="category" className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</Label>
                        <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as DocumentCategory)}>
                          <SelectTrigger className="h-10" data-testid="select-category">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {uploadableCategories.map((cat) => (
                              <SelectItem key={cat} value={cat} data-testid={`option-${cat.toLowerCase()}`}>
                                {cat}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</Label>
                      <div className="flex items-center gap-2 px-3 h-10 bg-slate-100 dark:bg-slate-800 rounded-md text-sm">
                        <Camera className="h-4 w-4" />
                        <span>Photos</span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="client" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Attach to Client
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10 justify-between"
                      onClick={() => setUploadCustomerPickerOpen(true)}
                      data-testid="button-select-client"
                    >
                      <span className="truncate">
                        {uploadCustomerId === 'company-wide' 
                          ? 'Company-wide (No client)'
                          : (() => {
                              const c = customersList.find(c => c.id.toString() === uploadCustomerId);
                              return c ? `${c.firstName} ${c.lastName}` : 'Select client';
                            })()}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                    </Button>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 mt-4">
                    <Button variant="outline" className="h-10" onClick={() => setUploadOpen(false)} data-testid="button-cancel">
                      Cancel
                    </Button>
                    <Button 
                      className="h-10"
                      onClick={handleUpload} 
                      disabled={!selectedFile || uploadMutation.isPending}
                      data-testid="button-submit-upload"
                    >
                      {uploadMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {documentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse text-slate-500">Loading documents...</div>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <Card className="w-full rounded-2xl border bg-white dark:bg-slate-900 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FolderOpen className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  {activeCategory === 'All' ? 'No documents available' : `No ${activeCategory} documents available`}
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-center mb-4 max-w-md">
                  {userRole.toUpperCase() === 'TECHNICIAN' ? (
                    <>You can only see documents for jobs you're assigned to. If you expect to see documents here, check with your supervisor about your job assignments.</>
                  ) : activeCategory === 'All' 
                    ? 'Upload contracts, plans, and other project documents.'
                    : `Upload ${activeCategory.toLowerCase()} to see them here.`}
                </p>
                {uploadableCategories.length > 0 && (
                  <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-first">
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Your First Document
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredDocuments.map((document) => {
                const isSelected = selectedIds.has(document.id);
                return (
                <Card 
                  key={document.id} 
                  className={`w-full rounded-2xl border shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                    isSelected 
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' 
                      : 'bg-white dark:bg-slate-900'
                  }`}
                  data-testid={`document-card-${document.id}`}
                  onClick={() => {
                    if (selectMode) {
                      toggleSelection(document.id);
                    } else {
                      setSelectedDoc(document);
                      setIsPreviewOpen(true);
                    }
                  }}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Checkbox in select mode */}
                        {selectMode && (
                          <div 
                            className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              isSelected 
                                ? 'bg-blue-600 border-blue-600' 
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelection(document.id);
                            }}
                            data-testid={`checkbox-${document.id}`}
                          >
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                        )}
                        <FileText className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{document.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {isWorkflowCategory(document.category) && (
                          <Badge variant={getStatusVariant(document.status)} className="text-xs" data-testid={`status-pill-${document.id}`}>
                            {document.status}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {document.category}
                        </Badge>
                        {document.visibility && (
                          <Badge 
                            variant={getVisibilityVariant(document.visibility)} 
                            className={`text-xs ${canEditVisibility ? 'cursor-pointer hover:opacity-80' : ''}`}
                            data-testid={`visibility-pill-${document.id}`}
                            onClick={(e) => {
                              if (canEditVisibility) {
                                e.stopPropagation();
                                openVisibilityModal(document);
                              }
                            }}
                          >
                            {getVisibilityLabel(document.visibility)}
                          </Badge>
                        )}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {document.job && (
                        <div className="text-sm text-blue-600 dark:text-blue-400" data-testid={`job-label-${document.id}`}>
                          Job: {document.job.title}{document.job.clientName ? ` - ${document.job.clientName}` : ''}
                        </div>
                      )}
                      {document.customer && (
                        <div className="text-sm text-emerald-600 dark:text-emerald-400" data-testid={`client-label-${document.id}`}>
                          Client: {document.customer.firstName} {document.customer.lastName}
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                        <span>Size: {((document.fileSize || 0) / 1024).toFixed(1)} KB</span>
                        <span>{new Date(document.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="flex-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(document.fileUrl, '_blank');
                          }}
                          data-testid={`button-download-${document.id}`}
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              })}
            </div>
          )}
          
          {/* Sticky Bottom Action Bar for Bulk Selection */}
          {selectMode && selectedIds.size > 0 && (
            <div className="fixed bottom-20 left-0 right-0 z-50 w-full px-4">
              <div className="w-full max-w-2xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center justify-between gap-2">
                  {/* Left: Cancel */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSelection}
                    className="shrink-0"
                    data-testid="button-cancel-selection"
                  >
                    Cancel
                  </Button>
                  
                  {/* Center: Download */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadSelected}
                    disabled={isDownloading}
                    className="shrink-0"
                    data-testid="button-bulk-download"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-1" />
                        <span className="hidden xs:inline">Download</span>
                        <span className="xs:ml-1">({selectedIds.size})</span>
                      </>
                    )}
                  </Button>
                  
                  {/* Right: Delete (danger) */}
                  {canDelete(userRole) && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkDelete}
                      disabled={bulkDeleteMutation.isPending}
                      className="shrink-0"
                      data-testid="button-bulk-delete"
                    >
                      {bulkDeleteMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-1" />
                          <span className="hidden xs:inline">Delete</span>
                          <span className="xs:ml-1">({selectedIds.size})</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
      </div>

      {/* Customer Picker Modal */}
      <Dialog open={customerPickerOpen} onOpenChange={(open) => {
        setCustomerPickerOpen(open);
        if (!open) setCustomerPickerSearchQuery('');
      }}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden max-h-[80vh] flex flex-col" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Select Customer
            </DialogTitle>
            <button
              onClick={() => setCustomerPickerOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search customers..."
                value={customerPickerSearchQuery}
                onChange={(e) => setCustomerPickerSearchQuery(e.target.value)}
                className="pl-10 h-10 rounded-xl"
                data-testid="input-customer-picker-search"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto py-1 bg-white dark:bg-slate-900">
            {/* All Documents option */}
            <button
              onClick={() => {
                setCustomerFilter({ mode: 'all' });
                setCustomerPickerOpen(false);
                setCustomerPickerSearchQuery('');
              }}
              className={`w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors ${
                customerFilter.mode === 'all'
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
              }`}
              data-testid="option-all-documents"
            >
              <div className="flex items-center gap-3">
                <FolderOpen className="h-4 w-4 text-slate-500" />
                <span className="font-medium text-slate-900 dark:text-slate-100">All Documents</span>
              </div>
              {customerFilter.mode === 'all' && (
                <Check className="h-5 w-5 text-blue-600" />
              )}
            </button>
            {/* All Customers option */}
            <button
              onClick={() => {
                setCustomerFilter({ mode: 'has_customer' });
                setCustomerPickerOpen(false);
                setCustomerPickerSearchQuery('');
              }}
              className={`w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors ${
                customerFilter.mode === 'has_customer'
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
              }`}
              data-testid="option-all-customers"
            >
              <div className="flex items-center gap-3">
                <FolderOpen className="h-4 w-4 text-slate-500" />
                <span className="font-medium text-slate-900 dark:text-slate-100">All Customers</span>
              </div>
              {customerFilter.mode === 'has_customer' && (
                <Check className="h-5 w-5 text-blue-600" />
              )}
            </button>
            {/* No customer / company-wide option */}
            <button
              onClick={() => {
                setCustomerFilter({ mode: 'company' });
                setCustomerPickerOpen(false);
                setCustomerPickerSearchQuery('');
              }}
              className={`w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors ${
                customerFilter.mode === 'company'
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
              }`}
              data-testid="option-no-customer"
            >
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-slate-500" />
                <span className="font-medium text-slate-900 dark:text-slate-100">No customer</span>
              </div>
              {customerFilter.mode === 'company' && (
                <Check className="h-5 w-5 text-blue-600" />
              )}
            </button>
            <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4 my-1" />
            {/* Customer list */}
            {filteredPickerCustomers.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                No matching customers
              </div>
            ) : (
              filteredPickerCustomers.map((customer, index) => {
                const label = `${customer.firstName} ${customer.lastName}`;
                const isSelected = customerFilter.mode === 'customer' && customerFilter.customerId === customer.id;
                const secondary = customer.companyName || customer.email || customer.phone;
                return (
                  <div key={customer.id}>
                    <button
                      onClick={() => {
                        setCustomerFilter({ mode: 'customer', customerId: customer.id, label });
                        setCustomerPickerOpen(false);
                        setCustomerPickerSearchQuery('');
                      }}
                      className={`w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                      }`}
                      data-testid={`option-customer-${customer.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{label}</div>
                        {secondary && (
                          <div className="text-xs text-slate-500 truncate mt-0.5">{secondary}</div>
                        )}
                      </div>
                      {isSelected && (
                        <Check className="h-5 w-5 text-blue-600 shrink-0 ml-3" />
                      )}
                    </button>
                    {index < filteredPickerCustomers.length - 1 && (
                      <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Client Picker Modal */}
      <Dialog open={uploadCustomerPickerOpen} onOpenChange={(open) => {
        setUploadCustomerPickerOpen(open);
        if (!open) setUploadCustomerSearchQuery('');
      }}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden max-h-[80vh] flex flex-col" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Attach to Client
            </DialogTitle>
            <button
              onClick={() => setUploadCustomerPickerOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search clients..."
                value={uploadCustomerSearchQuery}
                onChange={(e) => setUploadCustomerSearchQuery(e.target.value)}
                className="pl-10 h-10 rounded-xl"
                data-testid="input-upload-client-search"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto py-1 bg-white dark:bg-slate-900">
            <div>
              <button
                onClick={() => {
                  setUploadCustomerId('company-wide');
                  setUploadCustomerPickerOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors ${
                  uploadCustomerId === 'company-wide'
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                }`}
                data-testid="upload-option-company-wide"
              >
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-slate-500" />
                  <span className="font-medium text-slate-900 dark:text-slate-100">Company-wide (No client)</span>
                </div>
                {uploadCustomerId === 'company-wide' && (
                  <Check className="h-5 w-5 text-blue-600" />
                )}
              </button>
              <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
            </div>
            {uploadFilteredCustomers.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No matching clients
              </div>
            ) : (
              uploadFilteredCustomers.map((customer, index) => {
                const isSelected = uploadCustomerId === customer.id.toString();
                return (
                  <div key={customer.id}>
                    <button
                      onClick={() => {
                        setUploadCustomerId(customer.id.toString());
                        setUploadCustomerPickerOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                      }`}
                      data-testid={`upload-option-client-${customer.id}`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{customer.firstName} {customer.lastName}</div>
                        {(customer.email || customer.companyName) && (
                          <div className="text-xs text-slate-500 truncate">
                            {[customer.companyName, customer.email].filter(Boolean).join(' • ')}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <Check className="h-5 w-5 text-blue-600 shrink-0" />
                      )}
                    </button>
                    {index < uploadFilteredCustomers.length - 1 && (
                      <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Document Preview Modal */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <FileText className="h-5 w-5 flex-shrink-0" />
              <span className="truncate">{selectedDoc?.name}</span>
            </DialogTitle>
          </DialogHeader>
          
          {/* Status section for workflow categories - role-based */}
          {selectedDoc && isWorkflowCategory(selectedDoc.category) && canChangeStatus(userRole, selectedDoc.category) && (() => {
            const allowedStatuses = getAllowedStatusTransitions(userRole, selectedDoc.category, selectedDoc.status as PermDocStatus);
            return (
              <div className="flex items-center gap-3 py-2 border-b">
                <span className="text-sm text-slate-600 dark:text-slate-400">Status:</span>
                <Badge variant={getStatusVariant(selectedDoc.status)} className="mr-2">
                  {selectedDoc.status}
                </Badge>
                {allowedStatuses.length > 0 && (
                  <>
                    <span className="text-sm text-slate-400">→</span>
                    <Select 
                      value="" 
                      onValueChange={(newStatus) => statusMutation.mutate({ id: selectedDoc.id, status: newStatus })}
                      disabled={statusMutation.isPending}
                    >
                      <SelectTrigger className="w-[180px]" data-testid="select-status">
                        <SelectValue placeholder="Change to..." />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedStatuses.map((status) => (
                          <SelectItem key={status} value={status} data-testid={`status-option-${status.toLowerCase().replace(' ', '-')}`}>
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {statusMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  </>
                )}
              </div>
            );
          })()}

          <div className="flex-1 overflow-auto py-4">
            {selectedDoc && (() => {
              const fileType = getFileType(selectedDoc.name, selectedDoc.type);
              if (fileType === 'image') {
                return (
                  <img 
                    src={selectedDoc.fileUrl} 
                    alt={selectedDoc.name}
                    className="w-full rounded-xl object-contain max-h-[60vh]"
                    data-testid="preview-image"
                  />
                );
              }
              if (fileType === 'pdf') {
                return (
                  <div className="space-y-4">
                    <iframe 
                      src={selectedDoc.fileUrl}
                      className="w-full h-[60vh] rounded-xl border"
                      title={selectedDoc.name}
                      data-testid="preview-pdf"
                    />
                    <div className="text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(selectedDoc.fileUrl, '_blank')}
                        data-testid="button-open-pdf-tab"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open in New Tab
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <File className="h-16 w-16 text-slate-400 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    No preview available
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    This file type cannot be previewed in the browser.
                  </p>
                </div>
              );
            })()}
          </div>
          <div className="flex justify-between gap-2 pt-4 border-t">
            <div>
              {canDelete(userRole) && selectedDoc && (
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate(selectedDoc.id)}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-document"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {/* Send for Signature - RBAC: Only shown to Owner, Supervisor, Dispatcher, Estimator */}
              {['OWNER', 'SUPERVISOR'].includes(userRole.toUpperCase()) && selectedDoc && (
                <Button
                  variant="outline"
                  className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-900/30"
                  onClick={() => {
                    setSignatureDoc(selectedDoc);
                    setSignatureModalOpen(true);
                    setIsPreviewOpen(false);
                  }}
                  data-testid="button-send-for-signature"
                >
                  <PenTool className="w-4 h-4 mr-2" />
                  Send for Signature
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setIsPreviewOpen(false)}
                data-testid="button-close-preview"
              >
                Close
              </Button>
              <Button
                onClick={() => selectedDoc && window.open(selectedDoc.fileUrl, '_blank')}
                data-testid="button-preview-download"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Visibility Edit Modal */}
      <Dialog open={visibilityModalOpen} onOpenChange={(open) => {
        setVisibilityModalOpen(open);
        if (!open) {
          setVisibilityEditDoc(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Document Visibility</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Choose who can see this document
            </p>
            <div className="space-y-2">
              {getVisibilityOptions().map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSelectedVisibility(option.value)}
                  className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left transition-colors border ${
                    selectedVisibility === option.value
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                  data-testid={`visibility-option-${option.value}`}
                >
                  <div className="flex-1">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {option.label}
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      {option.description}
                    </div>
                  </div>
                  {selectedVisibility === option.value && (
                    <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setVisibilityModalOpen(false)}
              data-testid="button-cancel-visibility"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (visibilityEditDoc) {
                  visibilityMutation.mutate({ id: visibilityEditDoc.id, visibility: selectedVisibility });
                }
              }}
              disabled={visibilityMutation.isPending || (visibilityEditDoc?.visibility === selectedVisibility)}
              data-testid="button-save-visibility"
            >
              {visibilityMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send for Signature Modal */}
      <Dialog open={signatureModalOpen} onOpenChange={(open) => {
        setSignatureModalOpen(open);
        if (!open) {
          setSignatureDoc(null);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send for Signature</DialogTitle>
          </DialogHeader>
          {signatureDoc && (
            <ApprovalWorkflow 
              prefilledDocumentId={signatureDoc.id}
              prefilledDocumentName={signatureDoc.name}
              showCreateDialogOpen={false}
              onClose={() => {
                setSignatureModalOpen(false);
                setSignatureDoc(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
