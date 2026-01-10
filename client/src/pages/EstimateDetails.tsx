import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, User, FileText, Calendar, List, DollarSign, Paperclip, Upload, Trash2, CheckCircle, Pen, X, Users } from "lucide-react";
import type { EstimateWithItems, EstimateAttachment } from "@shared/schema";

interface EstimateDetailsProps {
  estimateId: string;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 'approved': return 'default';
    case 'draft': return 'secondary';
    case 'sent': return 'outline';
    case 'accepted': return 'default';
    case 'rejected': return 'destructive';
    default: return 'secondary';
  }
}

export default function EstimateDetails({ estimateId }: EstimateDetailsProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<EstimateAttachment | null>(null);

  const { data: estimate, isLoading, error } = useQuery<EstimateWithItems>({
    queryKey: [`/api/estimates/${estimateId}`],
    enabled: !!estimateId,
  });

  const { data: orgUsersData } = useQuery<{ users: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }> }>({
    queryKey: ['/api/org/users'],
  });
  
  const orgUsers = orgUsersData?.users || [];
  
  const assignedEmployees = estimate?.assignedEmployeeIds && Array.isArray(estimate.assignedEmployeeIds)
    ? orgUsers.filter(user => (estimate.assignedEmployeeIds as string[]).includes(user.id))
    : [];
  
  const formatEmployeeNames = (employees: typeof assignedEmployees): string => {
    if (employees.length === 0) return '';
    const names = employees.map(e => `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
  };

  const uploadAttachmentMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/estimates/${estimateId}/attachments`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Upload failed');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${estimateId}`] });
      toast({ title: "Attachment uploaded" });
    },
    onError: () => {
      toast({ title: "Upload failed", variant: "destructive" });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (attachmentId: number) => {
      await apiRequest('DELETE', `/api/estimates/${estimateId}/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${estimateId}`] });
      toast({ title: "Attachment deleted" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      const res = await apiRequest('PATCH', `/api/estimates/${estimateId}/approve`, {
        signatureDataUrl,
        approvedTotalCents: estimate?.totalCents,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${estimateId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      setIsSignatureModalOpen(false);
      toast({ title: "Estimate approved!" });
    },
    onError: () => {
      toast({ title: "Approval failed", variant: "destructive" });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadAttachmentMutation.mutate(file);
    }
    e.target.value = '';
  };

  const handleApproveClick = () => {
    setIsApproveDialogOpen(true);
  };

  const handleConfirmApprove = () => {
    setIsApproveDialogOpen(false);
    setIsSignatureModalOpen(true);
    setHasSignature(false);
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;
    const dataUrl = canvas.toDataURL('image/png');
    approveMutation.mutate(dataUrl);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Estimate not found</h2>
          <Button onClick={() => navigate('/jobs')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  const canApprove = estimate.status === 'draft';

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/jobs')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{estimate.title || estimate.estimateNumber}</h1>
            <p className="text-sm text-muted-foreground">{estimate.estimateNumber}</p>
          </div>
        </div>
        <Badge variant={getStatusBadgeVariant(estimate.status)} className="text-sm capitalize">
          {estimate.status}
        </Badge>
      </div>

      {canApprove && (
        <Button 
          onClick={handleApproveClick} 
          className="w-full mb-6 bg-green-600 hover:bg-green-700 text-white py-6 text-lg font-semibold"
          disabled={approveMutation.isPending}
        >
          <CheckCircle className="h-5 w-5 mr-2" />
          Approve Estimate • {formatCurrency(estimate.totalCents)}
        </Button>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            {estimate.customerName ? (
              <div className="space-y-1">
                <p className="font-medium">{estimate.customerName}</p>
                {estimate.customerEmail && <p className="text-sm text-muted-foreground">{estimate.customerEmail}</p>}
                {estimate.customerPhone && <p className="text-sm text-muted-foreground">{estimate.customerPhone}</p>}
                {estimate.customerAddress && <p className="text-sm text-muted-foreground">{estimate.customerAddress}</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">No customer assigned</p>
            )}
          </CardContent>
        </Card>

        {estimate.jobType && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Job Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>{estimate.jobType}</p>
            </CardContent>
          </Card>
        )}

        {(estimate.scheduledDate || estimate.scheduledTime) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {estimate.scheduledDate && (
                  <p>{new Date(estimate.scheduledDate).toLocaleDateString()}</p>
                )}
                {estimate.scheduledTime && (
                  <p className="text-sm text-muted-foreground">{estimate.scheduledTime}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Assigned Employees
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assignedEmployees.length > 0 ? (
              <ul className="space-y-1">
                {assignedEmployees.map((emp) => (
                  <li key={emp.id} className="text-sm">
                    {`${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No employees assigned</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              Line Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            {estimate.items && estimate.items.length > 0 ? (
              <div className="space-y-3">
                {estimate.items.map((item) => (
                  <div key={item.id} className="flex justify-between items-start py-2 border-b last:border-0">
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      {item.description && (
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {item.quantity} × {formatCurrency(item.unitPriceCents)} / {item.unit}
                      </p>
                    </div>
                    <p className="font-medium">{formatCurrency(item.lineTotalCents)}</p>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between pt-2">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(estimate.subtotalCents)}</span>
                </div>
                {estimate.taxCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{formatCurrency(estimate.taxCents)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>{formatCurrency(estimate.totalCents)}</span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No line items</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Paperclip className="h-5 w-5" />
                Attachments
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadAttachmentMutation.isPending}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleFileUpload}
            />
            {estimate.attachments && estimate.attachments.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {estimate.attachments.map((attachment: EstimateAttachment) => (
                  <div 
                    key={attachment.id} 
                    className="relative group cursor-pointer"
                    onClick={() => {
                      if (attachment.fileType.startsWith('image/')) {
                        setPreviewAttachment(attachment);
                      } else {
                        window.open(attachment.fileUrl, '_blank');
                      }
                    }}
                  >
                    {attachment.fileType.startsWith('image/') ? (
                      <img
                        src={attachment.fileUrl}
                        alt={attachment.fileName}
                        className="w-full h-24 object-cover rounded-lg border hover:opacity-90 transition-opacity"
                      />
                    ) : (
                      <div className="w-full h-24 bg-slate-100 dark:bg-slate-800 rounded-lg border flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <p className="text-xs truncate mt-1">{attachment.fileName}</p>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAttachmentMutation.mutate(attachment.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">No attachments</p>
            )}
          </CardContent>
        </Card>

        {estimate.status === 'approved' && estimate.signatureDataUrl && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Pen className="h-5 w-5" />
                Signature
              </CardTitle>
            </CardHeader>
            <CardContent>
              <img
                src={estimate.signatureDataUrl}
                alt="Approval signature"
                className="max-w-xs border rounded bg-white"
              />
              {estimate.approvedAt && (
                <p className="text-sm text-muted-foreground mt-2">
                  Approved on {new Date(estimate.approvedAt).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Estimate</DialogTitle>
            <DialogDescription>
              You are about to approve this estimate.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-center text-2xl font-bold">
              {formatCurrency(estimate.totalCents)}
            </p>
            <p className="text-center text-muted-foreground mt-2">
              Once approved, this estimate cannot be edited.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsApproveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmApprove} className="bg-green-600 hover:bg-green-700">
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSignatureModalOpen} onOpenChange={setIsSignatureModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sign to Approve</DialogTitle>
            <DialogDescription>
              Draw your signature below to confirm approval.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="border rounded-lg bg-white p-2">
              <canvas
                ref={canvasRef}
                width={350}
                height={150}
                className="w-full touch-none cursor-crosshair"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Draw your signature above
            </p>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={clearSignature}>
              Clear
            </Button>
            <Button variant="outline" onClick={() => setIsSignatureModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveSignature}
              disabled={!hasSignature || approveMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {approveMutation.isPending ? "Saving..." : "Save Signature"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewAttachment} onOpenChange={(open) => !open && setPreviewAttachment(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="flex items-center justify-between">
              <span className="truncate pr-8">{previewAttachment?.fileName}</span>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3 h-8 w-8"
                onClick={() => setPreviewAttachment(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 flex items-center justify-center">
            {previewAttachment && (
              <img
                src={previewAttachment.fileUrl}
                alt={previewAttachment.fileName}
                className="max-h-[70vh] max-w-full object-contain rounded"
              />
            )}
          </div>
          <DialogFooter className="p-4 pt-0">
            <Button
              variant="outline"
              onClick={() => window.open(previewAttachment?.fileUrl, '_blank')}
            >
              Open in New Tab
            </Button>
            <Button onClick={() => setPreviewAttachment(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
