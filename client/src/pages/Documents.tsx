import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Folder,
  FolderOpen,
  FileText,
  FileImage,
  File,
  Upload,
  Download,
  PenTool,
  Trash2,
  ChevronRight,
  Home,
  Plus,
  MoreHorizontal,
  Search,
  Loader2,
  FileBadge,
  FolderPlus,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ApprovalWorkflow from "@/components/ApprovalWorkflow";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type DocumentVisibility } from "@shared/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FolderItem {
  id: number;
  name: string;
  parentFolderId: number | null;
  companyId: number;
  createdAt: string;
}

interface DocumentItem {
  id: number;
  name: string;
  type: string | null;
  category: string;
  status: string;
  visibility: DocumentVisibility;
  jobId: number | null;
  customerId: number | null;
  folderId: number | null;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
}

interface BreadcrumbEntry {
  id: number | null;
  name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFileIcon(type: string | null, name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const mime = (type || "").toLowerCase();
  if (mime.startsWith("image/") || ["jpg","jpeg","png","webp","gif","heic"].includes(ext)) {
    return <FileImage className="w-7 h-7 text-sky-500 flex-shrink-0" />;
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return <FileText className="w-7 h-7 text-red-500 flex-shrink-0" />;
  }
  if (["doc","docx"].includes(ext)) {
    return <FileText className="w-7 h-7 text-blue-600 flex-shrink-0" />;
  }
  if (["xls","xlsx","csv"].includes(ext)) {
    return <FileBadge className="w-7 h-7 text-green-600 flex-shrink-0" />;
  }
  return <File className="w-7 h-7 text-slate-400 flex-shrink-0" />;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function isImageFile(type: string | null, name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return (type || "").startsWith("image/") || ["jpg","jpeg","png","webp","gif"].includes(ext);
}

function isPdfFile(type: string | null, name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return type === "application/pdf" || ext === "pdf";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Documents() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Navigation state ──
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([{ id: null, name: "Documents" }]);
  const currentFolder = breadcrumb[breadcrumb.length - 1];
  const currentFolderId = currentFolder.id;

  // ── Search ──
  const [search, setSearch] = useState("");

  // ── Modals ──
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameFolder, setRenameFolder] = useState<FolderItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureDoc, setSignatureDoc] = useState<DocumentItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "folder" | "document"; id: number; name: string } | null>(null);

  // ── Data fetching ──
  const contentsKey = ["/api/folders/contents", currentFolderId ?? "null"];
  const { data, isLoading } = useQuery<{ folders: FolderItem[]; documents: DocumentItem[] }>({
    queryKey: contentsKey,
    queryFn: async () => {
      const res = await fetch(`/api/folders/contents?folderId=${currentFolderId ?? "null"}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const folders = data?.folders ?? [];
  const docs = data?.documents ?? [];

  // ── Filtered by search ──
  const filteredFolders = search.trim()
    ? folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : folders;
  const filteredDocs = search.trim()
    ? docs.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
    : docs;

  // ── Navigation ──
  function navigateTo(entry: BreadcrumbEntry) {
    const idx = breadcrumb.findIndex(b => b.id === entry.id);
    if (idx >= 0) {
      setBreadcrumb(breadcrumb.slice(0, idx + 1));
    } else {
      setBreadcrumb([...breadcrumb, entry]);
    }
    setSearch("");
  }

  function openFolder(folder: FolderItem) {
    navigateTo({ id: folder.id, name: folder.name });
  }

  // ── Create Folder ──
  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("POST", "/api/folders", {
        name,
        parentFolderId: currentFolderId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentsKey });
      setCreateFolderOpen(false);
      setNewFolderName("");
      toast({ title: "Folder created" });
    },
    onError: () => toast({ title: "Failed to create folder", variant: "destructive" }),
  });

  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    createFolderMutation.mutate(newFolderName.trim());
  }

  // ── Rename Folder ──
  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return apiRequest("PATCH", `/api/folders/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentsKey });
      setRenameFolder(null);
      setRenameName("");
      toast({ title: "Folder renamed" });
    },
    onError: () => toast({ title: "Failed to rename folder", variant: "destructive" }),
  });

  function handleRenameFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!renameFolder || !renameName.trim()) return;
    renameFolderMutation.mutate({ id: renameFolder.id, name: renameName.trim() });
  }

  // ── Delete Folder ──
  const deleteFolderMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/folders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentsKey });
      setDeleteConfirm(null);
      toast({ title: "Folder deleted" });
    },
    onError: () => toast({ title: "Failed to delete folder", variant: "destructive" }),
  });

  // ── Upload Document ──
  const uploadMutation = useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name || file.name);
      formData.append("category", "Other");
      formData.append("visibility", "customer_internal");
      if (currentFolderId !== null) {
        formData.append("folderId", String(currentFolderId));
      }
      const res = await fetch("/api/documents", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentsKey });
      setUploadOpen(false);
      setUploadName("");
      setSelectedFile(null);
      toast({ title: "Document uploaded" });
    },
    onError: (err: any) =>
      toast({ title: err.message || "Upload failed", variant: "destructive" }),
  });

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;
    uploadMutation.mutate({ file: selectedFile, name: uploadName });
  }

  // ── Delete Document ──
  const deleteDocMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentsKey });
      setDeleteConfirm(null);
      toast({ title: "Document deleted" });
    },
    onError: () => toast({ title: "Failed to delete document", variant: "destructive" }),
  });

  function handleDeleteConfirm() {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "folder") {
      deleteFolderMutation.mutate(deleteConfirm.id);
    } else {
      deleteDocMutation.mutate(deleteConfirm.id);
    }
  }

  // ── View / Download ──
  function handleView(doc: DocumentItem) {
    window.open(doc.fileUrl, "_blank");
  }

  function handleDownload(doc: DocumentItem) {
    const a = document.createElement("a");
    a.href = doc.fileUrl;
    a.download = doc.name;
    a.click();
  }

  // ── Guard ──
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isEmpty = filteredFolders.length === 0 && filteredDocs.length === 0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Top Bar ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 border-b border-border bg-background sticky top-0 z-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-wrap text-sm mb-3 min-h-[24px]">
          {breadcrumb.map((entry, idx) => {
            const isLast = idx === breadcrumb.length - 1;
            return (
              <span key={idx} className="flex items-center gap-1">
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                {isLast ? (
                  <span className="font-semibold text-foreground truncate max-w-[160px]">{entry.name}</span>
                ) : (
                  <button
                    onClick={() => navigateTo(entry)}
                    className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    {idx === 0 && <Home className="w-3.5 h-3.5 flex-shrink-0" />}
                    <span className="truncate max-w-[120px]">{entry.name}</span>
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {/* Search + Actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search files and folders…"
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0 gap-1.5 h-9"
            onClick={() => { setNewFolderName(""); setCreateFolderOpen(true); }}
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">New Folder</span>
          </Button>
          <Button
            size="sm"
            className="flex-shrink-0 gap-1.5 h-9"
            onClick={() => { setUploadName(""); setSelectedFile(null); setUploadOpen(true); }}
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload</span>
          </Button>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <EmptyState
            inFolder={breadcrumb.length > 1}
            onNewFolder={() => { setNewFolderName(""); setCreateFolderOpen(true); }}
            onUpload={() => { setUploadName(""); setSelectedFile(null); setUploadOpen(true); }}
          />
        ) : (
          <div className="space-y-6">
            {/* Folders */}
            {filteredFolders.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Folders
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {filteredFolders.map(folder => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      onOpen={() => openFolder(folder)}
                      onRename={() => { setRenameFolder(folder); setRenameName(folder.name); }}
                      onDelete={() => setDeleteConfirm({ type: "folder", id: folder.id, name: folder.name })}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Files */}
            {filteredDocs.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Files
                </h2>
                <div className="space-y-1">
                  {filteredDocs.map(doc => (
                    <FileRow
                      key={doc.id}
                      doc={doc}
                      onView={() => handleView(doc)}
                      onDownload={() => handleDownload(doc)}
                      onSign={() => { setSignatureDoc(doc); setSignatureModalOpen(true); }}
                      onDelete={() => setDeleteConfirm({ type: "document", id: doc.id, name: doc.name })}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* ── Create Folder Modal ──────────────────────────────────────── */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="rounded-2xl max-w-sm mx-auto" hideCloseButton>
          <DialogHeader>
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => setCreateFolderOpen(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <DialogTitle className="text-base font-semibold">New Folder</DialogTitle>
              <button
                type="submit"
                form="create-folder-form"
                className="text-sm font-semibold text-primary disabled:opacity-40"
                disabled={!newFolderName.trim() || createFolderMutation.isPending}
              >
                {createFolderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </button>
            </div>
          </DialogHeader>
          <form id="create-folder-form" onSubmit={handleCreateFolder} className="space-y-4 pt-2">
            <div>
              <Label htmlFor="folder-name" className="text-sm font-medium">Folder Name</Label>
              <Input
                id="folder-name"
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="e.g. Contracts, Permits, Photos…"
                className="mt-1"
              />
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Rename Folder Modal ──────────────────────────────────────── */}
      <Dialog open={!!renameFolder} onOpenChange={open => !open && setRenameFolder(null)}>
        <DialogContent className="rounded-2xl max-w-sm mx-auto" hideCloseButton>
          <DialogHeader>
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => setRenameFolder(null)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <DialogTitle className="text-base font-semibold">Rename Folder</DialogTitle>
              <button
                type="submit"
                form="rename-folder-form"
                className="text-sm font-semibold text-primary disabled:opacity-40"
                disabled={!renameName.trim() || renameFolderMutation.isPending}
              >
                {renameFolderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </button>
            </div>
          </DialogHeader>
          <form id="rename-folder-form" onSubmit={handleRenameFolder} className="space-y-4 pt-2">
            <div>
              <Label htmlFor="rename-name" className="text-sm font-medium">Folder Name</Label>
              <Input
                id="rename-name"
                autoFocus
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                placeholder="Folder name"
                className="mt-1"
              />
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Upload Modal ─────────────────────────────────────────────── */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="rounded-2xl max-w-sm mx-auto" hideCloseButton>
          <DialogHeader>
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => setUploadOpen(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <DialogTitle className="text-base font-semibold">Upload Document</DialogTitle>
              <button
                type="submit"
                form="upload-form"
                className="text-sm font-semibold text-primary disabled:opacity-40"
                disabled={!selectedFile || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upload"}
              </button>
            </div>
          </DialogHeader>
          <form id="upload-form" onSubmit={handleUpload} className="space-y-4 pt-2">
            {/* File Picker */}
            <div>
              <Label className="text-sm font-medium">File</Label>
              <div
                className="mt-1 border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setSelectedFile(f);
                    if (f && !uploadName) setUploadName(f.name.replace(/\.[^/.]+$/, ""));
                  }}
                />
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    {getFileIcon(selectedFile.type, selectedFile.name)}
                    <span className="text-sm font-medium truncate max-w-[200px]">{selectedFile.name}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="w-8 h-8" />
                    <span className="text-sm">Tap to choose a file</span>
                  </div>
                )}
              </div>
            </div>
            {/* Name */}
            <div>
              <Label htmlFor="upload-name" className="text-sm font-medium">Document Name</Label>
              <Input
                id="upload-name"
                value={uploadName}
                onChange={e => setUploadName(e.target.value)}
                placeholder="Name (optional)"
                className="mt-1"
              />
            </div>
            {/* Location indicator */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              <Folder className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Uploading to: <strong>{currentFolder.name}</strong></span>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Modal ─────────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => !open && setDeleteConfirm(null)}>
        <DialogContent className="rounded-2xl max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              Delete {deleteConfirm?.type === "folder" ? "Folder" : "Document"}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteConfirm?.type === "folder"
              ? `"${deleteConfirm.name}" and everything inside it — all sub-folders and all files — will be permanently deleted. This cannot be undone.`
              : `"${deleteConfirm?.name}" will be permanently deleted and cannot be undone.`}
          </p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteConfirm}
              disabled={deleteFolderMutation.isPending || deleteDocMutation.isPending}
            >
              {(deleteFolderMutation.isPending || deleteDocMutation.isPending)
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Signature Modal ──────────────────────────────────────────── */}
      <Dialog open={signatureModalOpen} onOpenChange={setSignatureModalOpen}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>Send for Signature</DialogTitle>
          </DialogHeader>
          {signatureDoc && (
            <ApprovalWorkflow
              documentId={signatureDoc.id}
              documentName={signatureDoc.name}
              onClose={() => setSignatureModalOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Folder Card ─────────────────────────────────────────────────────────────

function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: FolderItem;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative bg-card border border-border rounded-2xl p-4 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all active:scale-[0.98]">
      {/* Main tap area */}
      <div
        className="flex flex-col items-center gap-2 text-center"
        onClick={onOpen}
      >
        <Folder className="w-10 h-10 text-amber-400 group-hover:text-amber-500 transition-colors" />
        <span className="text-sm font-medium leading-tight line-clamp-2 break-words w-full">
          {folder.name}
        </span>
      </div>

      {/* Context menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
            onClick={e => e.stopPropagation()}
          >
            <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onOpen}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRename}>
            <FileBadge className="w-4 h-4 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── File Row ─────────────────────────────────────────────────────────────────

function FileRow({
  doc,
  onView,
  onDownload,
  onSign,
  onDelete,
}: {
  doc: DocumentItem;
  onView: () => void;
  onDownload: () => void;
  onSign: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer active:bg-muted/40"
      onClick={onView}
    >
      {/* Icon */}
      {getFileIcon(doc.type, doc.name)}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{doc.name}</p>
        <p className="text-xs text-muted-foreground">
          {doc.fileSize ? formatFileSize(doc.fileSize) : ""}
          {doc.fileSize && doc.createdAt ? " · " : ""}
          {doc.createdAt ? formatDate(doc.createdAt) : ""}
        </p>
      </div>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-all flex-shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onView(); }}>
            <FileText className="w-4 h-4 mr-2" />
            View
          </DropdownMenuItem>
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onDownload(); }}>
            <Download className="w-4 h-4 mr-2" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onSign(); }}>
            <PenTool className="w-4 h-4 mr-2" />
            Send for Signature
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={e => { e.stopPropagation(); onDelete(); }}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({
  inFolder,
  onNewFolder,
  onUpload,
}: {
  inFolder: boolean;
  onNewFolder: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center mb-5">
        <FolderOpen className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">
        {inFolder ? "This folder is empty" : "No files or folders yet"}
      </h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        {inFolder
          ? "Add files or create a sub-folder to organize your documents."
          : "Create folders to organize your documents, or upload your first file."}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" size="sm" className="gap-2" onClick={onNewFolder}>
          <FolderPlus className="w-4 h-4" />
          New Folder
        </Button>
        <Button size="sm" className="gap-2" onClick={onUpload}>
          <Upload className="w-4 h-4" />
          Upload
        </Button>
      </div>
    </div>
  );
}
