import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderOpen, FileText, Upload, Download, PenTool, X, Loader2, ExternalLink, File, Search, ChevronDown, Building2, Briefcase } from "lucide-react";
import ApprovalWorkflow from "@/components/ApprovalWorkflow";
import { queryClient } from "@/lib/queryClient";
import { DOCUMENT_CATEGORIES, WORKFLOW_CATEGORIES, DOCUMENT_STATUSES, type DocumentCategory, type DocumentStatus } from "@shared/schema";

interface JobInfo {
  id: number;
  title: string;
  clientName: string | null;
}

interface DocumentType {
  id: number;
  name: string;
  type: string | null;
  category: string;
  status: string;
  jobId: number | null;
  job: JobInfo | null;
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

type JobFilterMode = 
  | { mode: 'all' }
  | { mode: 'company' }
  | { mode: 'job'; jobId: number; label: string };

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
  const [jobFilter, setJobFilter] = useState<JobFilterMode>({ mode: 'all' });
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("Other");
  const [uploadJobId, setUploadJobId] = useState<string>('company-wide');
  const [uploadJobPickerOpen, setUploadJobPickerOpen] = useState(false);
  const [uploadJobSearchQuery, setUploadJobSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentType | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const { data: documents = [], isLoading: documentsLoading } = useQuery<DocumentType[]>({
    queryKey: ["/api/documents"],
    enabled: isAuthenticated,
  });

  const { data: jobs = [] } = useQuery<JobType[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/documents", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setUploadOpen(false);
      setUploadName("");
      setUploadCategory("Other");
      setUploadJobId("company-wide");
      setSelectedFile(null);
      toast({ title: "Document uploaded", description: "Your document has been uploaded successfully." });
    },
    onError: () => {
      toast({ title: "Upload failed", description: "Failed to upload document. Please try again.", variant: "destructive" });
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

  // Filter jobs for search
  const filteredJobs = useMemo(() => {
    const query = jobSearchQuery.trim().toLowerCase();
    if (!query) return jobs.slice(0, 100);
    return jobs.filter(job => {
      const searchFields = [
        job.title,
        job.clientName,
        job.location,
        job.city
      ].filter(Boolean).map(f => f!.toLowerCase());
      return searchFields.some(field => field.includes(query));
    }).slice(0, 100);
  }, [jobs, jobSearchQuery]);

  const uploadFilteredJobs = useMemo(() => {
    const query = uploadJobSearchQuery.trim().toLowerCase();
    if (!query) return jobs.slice(0, 100);
    return jobs.filter(job => {
      const searchFields = [
        job.title,
        job.clientName,
        job.location,
        job.city
      ].filter(Boolean).map(f => f!.toLowerCase());
      return searchFields.some(field => field.includes(query));
    }).slice(0, 100);
  }, [jobs, uploadJobSearchQuery]);

  const filteredDocuments = useMemo(() => {
    let result = documents;
    
    // Filter by job
    if (jobFilter.mode === 'company') {
      result = result.filter(doc => doc.jobId === null);
    } else if (jobFilter.mode === 'job') {
      result = result.filter(doc => doc.jobId === jobFilter.jobId);
    }
    
    // Filter by category
    if (activeCategory !== 'All') {
      result = result.filter(doc => doc.category === activeCategory);
    }
    
    return result;
  }, [documents, activeCategory, jobFilter]);

  const handleUpload = () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("name", uploadName || selectedFile.name);
    formData.append("category", uploadCategory);
    if (uploadJobId !== 'company-wide') {
      formData.append("jobId", uploadJobId);
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Documents & Approvals</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage project documents and e-signature approval workflows</p>
      </div>

      <Tabs defaultValue="documents" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="documents" className="flex items-center gap-2" data-testid="tab-documents">
            <FolderOpen className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="approvals" className="flex items-center gap-2" data-testid="tab-approvals">
            <PenTool className="h-4 w-4" />
            E-signature Approvals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-6">
          {/* Filter Row: Job Picker Button + Category Dropdown */}
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                className="flex-1 justify-between"
                onClick={() => setJobPickerOpen(true)}
                data-testid="button-job-picker"
              >
                <span className="truncate">
                  {jobFilter.mode === 'all' ? 'All jobs' : 
                   jobFilter.mode === 'company' ? 'Company-wide' : 
                   jobFilter.label}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
              </Button>
              <Select value={activeCategory} onValueChange={setActiveCategory}>
                <SelectTrigger className="flex-1" data-testid="filter-category-dropdown">
                  <SelectValue placeholder="All categories" />
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
            </div>

            {/* Selected Job Chip */}
            {jobFilter.mode === 'job' && (
              <div className="flex items-center gap-2">
                <Badge 
                  variant="secondary" 
                  className="flex items-center gap-1 px-3 py-1.5 text-sm"
                  data-testid="chip-selected-job"
                >
                  <Briefcase className="h-3 w-3" />
                  <span className="truncate max-w-[200px]">Job: {jobFilter.label}</span>
                  <button 
                    onClick={() => setJobFilter({ mode: 'all' })}
                    className="ml-1 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-full p-0.5"
                    data-testid="button-clear-job-filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              </div>
            )}
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-upload-document">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Upload Document</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="file">File</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        ref={fileInputRef}
                        id="file"
                        type="file"
                        onChange={handleFileSelect}
                        className="flex-1"
                        data-testid="input-file"
                      />
                    </div>
                    {selectedFile && (
                      <p className="text-sm text-muted-foreground">
                        Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Document Name</Label>
                    <Input
                      id="name"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.target.value)}
                      placeholder="Enter document name"
                      data-testid="input-document-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as DocumentCategory)}>
                      <SelectTrigger data-testid="select-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat} data-testid={`option-${cat.toLowerCase()}`}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="job">Attach to Job</Label>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between"
                      onClick={() => setUploadJobPickerOpen(true)}
                      data-testid="button-select-job"
                    >
                      <span className="truncate">
                        {uploadJobId === 'company-wide' 
                          ? 'Company-wide (No job)' 
                          : jobs.find(j => j.id.toString() === uploadJobId)?.title || 'Select job'}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                    </Button>
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => setUploadOpen(false)} data-testid="button-cancel">
                      Cancel
                    </Button>
                    <Button 
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
                  {activeCategory === 'All' ? 'No documents yet' : `No ${activeCategory} documents yet`}
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
                  {activeCategory === 'All' 
                    ? 'Upload contracts, plans, and other project documents.'
                    : `Upload ${activeCategory.toLowerCase()} to see them here.`}
                </p>
                <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-first">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Your First Document
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredDocuments.map((document) => (
                <Card 
                  key={document.id} 
                  className="w-full rounded-2xl border bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow cursor-pointer" 
                  data-testid={`document-card-${document.id}`}
                  onClick={() => {
                    setSelectedDoc(document);
                    setIsPreviewOpen(true);
                  }}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
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
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="approvals" className="mt-6">
          <ApprovalWorkflow />
        </TabsContent>
      </Tabs>

      {/* Job Picker Modal */}
      <Dialog open={jobPickerOpen} onOpenChange={(open) => {
        setJobPickerOpen(open);
        if (!open) setJobSearchQuery('');
      }}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select Job</DialogTitle>
          </DialogHeader>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search jobs..."
              value={jobSearchQuery}
              onChange={(e) => setJobSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-job-search"
            />
          </div>
          <div className="flex-1 overflow-auto space-y-1">
            {/* Quick Options */}
            <div className="pb-2 mb-2 border-b">
              <button
                onClick={() => {
                  setJobFilter({ mode: 'all' });
                  setJobPickerOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  jobFilter.mode === 'all' 
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                data-testid="option-all-jobs"
              >
                <FolderOpen className="h-4 w-4 text-slate-500" />
                <span>All jobs</span>
              </button>
              <button
                onClick={() => {
                  setJobFilter({ mode: 'company' });
                  setJobPickerOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  jobFilter.mode === 'company' 
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                data-testid="option-company-wide"
              >
                <Building2 className="h-4 w-4 text-slate-500" />
                <span>Company-wide</span>
              </button>
            </div>
            {/* Job List */}
            {filteredJobs.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No matching jobs
              </div>
            ) : (
              filteredJobs.map((job) => {
                const label = job.title + (job.clientName ? ` - ${job.clientName}` : '');
                const isSelected = jobFilter.mode === 'job' && jobFilter.jobId === job.id;
                return (
                  <button
                    key={job.id}
                    onClick={() => {
                      setJobFilter({ mode: 'job', jobId: job.id, label });
                      setJobPickerOpen(false);
                    }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      isSelected 
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                    data-testid={`option-job-${job.id}`}
                  >
                    <Briefcase className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{job.title}</div>
                      {(job.clientName || job.city) && (
                        <div className="text-xs text-slate-500 truncate">
                          {[job.clientName, job.city].filter(Boolean).join(' • ')}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Job Picker Modal */}
      <Dialog open={uploadJobPickerOpen} onOpenChange={(open) => {
        setUploadJobPickerOpen(open);
        if (!open) setUploadJobSearchQuery('');
      }}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Attach to Job</DialogTitle>
          </DialogHeader>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search jobs..."
              value={uploadJobSearchQuery}
              onChange={(e) => setUploadJobSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-upload-job-search"
            />
          </div>
          <div className="flex-1 overflow-auto space-y-1">
            {/* Quick Options */}
            <div className="pb-2 mb-2 border-b">
              <button
                onClick={() => {
                  setUploadJobId('company-wide');
                  setUploadJobPickerOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  uploadJobId === 'company-wide' 
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                data-testid="upload-option-company-wide"
              >
                <Building2 className="h-4 w-4 text-slate-500" />
                <span>Company-wide (No job)</span>
              </button>
            </div>
            {/* Job List */}
            {uploadFilteredJobs.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No matching jobs
              </div>
            ) : (
              uploadFilteredJobs.map((job) => {
                const isSelected = uploadJobId === job.id.toString();
                return (
                  <button
                    key={job.id}
                    onClick={() => {
                      setUploadJobId(job.id.toString());
                      setUploadJobPickerOpen(false);
                    }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      isSelected 
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                    data-testid={`upload-option-job-${job.id}`}
                  >
                    <Briefcase className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{job.title}</div>
                      {(job.clientName || job.city) && (
                        <div className="text-xs text-slate-500 truncate">
                          {[job.clientName, job.city].filter(Boolean).join(' • ')}
                        </div>
                      )}
                    </div>
                  </button>
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
          
          {/* Status section for workflow categories only */}
          {selectedDoc && isWorkflowCategory(selectedDoc.category) && (
            <div className="flex items-center gap-3 py-2 border-b">
              <span className="text-sm text-slate-600 dark:text-slate-400">Status:</span>
              <Select 
                value={selectedDoc.status} 
                onValueChange={(newStatus) => statusMutation.mutate({ id: selectedDoc.id, status: newStatus })}
                disabled={statusMutation.isPending}
              >
                <SelectTrigger className="w-[180px]" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status} data-testid={`status-option-${status.toLowerCase().replace(' ', '-')}`}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {statusMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            </div>
          )}

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
          <div className="flex justify-end gap-2 pt-4 border-t">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
