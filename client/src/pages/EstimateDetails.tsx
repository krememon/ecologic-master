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
import { ArrowLeft, User, FileText, Calendar, List, DollarSign, Paperclip, Upload, Trash2, CheckCircle, Pen, X, Users, Share2, MapPin, Edit, StickyNote } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { EstimateWithItems, EstimateAttachment } from "@shared/schema";
import { ShareEstimateModal } from "@/components/ShareEstimateModal";
import { TimeWheelPicker } from "@/components/TimeWheelPicker";
import { useCan } from "@/hooks/useCan";
import { formatEstimateRequestedSchedule } from "@/utils/scheduleDate";

interface EstimateDetailsProps {
  estimateId: string;
}

function getReturnUrl(): string {
  if (typeof window === 'undefined') return '/jobs?tab=estimates';
  const params = new URLSearchParams(window.location.search);
  if (params.get('from') === 'schedule') {
    const view = params.get('view') || 'day';
    const date = params.get('date') || '';
    return `/schedule?view=${view}&date=${date}`;
  }
  return '/jobs?tab=estimates';
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
  const { role } = useCan();
  
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<EstimateAttachment | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  
  // Scheduling modal state (after estimate approval)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<number | null>(null);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [scheduledEndTime, setScheduledEndTime] = useState('');
  
  // Estimate schedule editing state (for draft estimates)
  const [isEstimateScheduleModalOpen, setIsEstimateScheduleModalOpen] = useState(false);
  const [estimateScheduleDate, setEstimateScheduleDate] = useState('');
  const [estimateScheduleTime, setEstimateScheduleTime] = useState('');
  const [estimateScheduleEndTime, setEstimateScheduleEndTime] = useState('');
  
  // Notes editing state
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [editedNotes, setEditedNotes] = useState('');
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);
  
  // RBAC: Owner, Supervisor, Estimator can share estimates
  const canShareEstimates = role === 'OWNER' || role === 'SUPERVISOR' || role === 'ESTIMATOR';
  
  // RBAC: Owner, Supervisor, Dispatcher, Estimator can edit estimates
  const canEditEstimate = role === 'OWNER' || role === 'SUPERVISOR' || role === 'DISPATCHER' || role === 'ESTIMATOR';

  const { data: estimate, isLoading, error } = useQuery<EstimateWithItems>({
    queryKey: [`/api/estimates/${estimateId}`],
    enabled: !!estimateId,
  });

  const { data: orgUsersData } = useQuery<{ users: Array<{ id: string; firstName: string | null; lastName: string | null; email: string; profileImageUrl?: string | null }> }>({
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

  const updateNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const response = await apiRequest('PATCH', `/api/estimates/${estimateId}/notes`, { notes });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update notes');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${estimateId}`] });
      setIsNotesModalOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to update notes", variant: "destructive" });
    },
  });

  const openNotesModal = () => {
    setEditedNotes(estimate?.notes || '');
    setIsNotesModalOpen(true);
  };

  const saveNotes = () => {
    updateNotesMutation.mutate(editedNotes);
  };

  const approveMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      const res = await apiRequest('PATCH', `/api/estimates/${estimateId}/approve`, {
        signatureDataUrl,
        approvedTotalCents: estimate?.totalCents,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${estimateId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      setIsSignatureModalOpen(false);
      
      // If a job was created, open the scheduling modal
      if (data.jobId) {
        setCreatedJobId(data.jobId);
        setScheduledDate('');
        setScheduledTime('');
        setScheduledEndTime('');
        setIsScheduleModalOpen(true);
      } else {
        navigate('/jobs', { replace: true });
      }
    },
    onError: () => {
      toast({ title: "Approval failed", variant: "destructive" });
    },
  });
  
  // Schedule job mutation
  const scheduleMutation = useMutation({
    mutationFn: async ({ jobId, date, time, endTime }: { jobId: number; date: string; time: string; endTime: string }) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await apiRequest('PATCH', `/api/jobs/${jobId}/schedule`, {
        scheduledDate: date || null,
        scheduledTime: time || null,
        scheduledEndTime: endTime || null,
        timezone,
      });
      return res.json();
    },
    onSuccess: (data) => {
      console.log('[ScheduleSaved]', { startDate: data.startDate, scheduledTime: data.scheduledTime });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      setIsScheduleModalOpen(false);
      toast({ title: "Scheduled" });
    },
    onError: () => {
      toast({ title: "Failed to schedule job", variant: "destructive" });
    },
  });
  
  const handleScheduleJob = () => {
    if (createdJobId) {
      scheduleMutation.mutate({ jobId: createdJobId, date: scheduledDate, time: scheduledTime, endTime: scheduledEndTime });
    }
  };
  
  const handleSkipSchedule = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
    queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
    setIsScheduleModalOpen(false);
    navigate('/jobs', { replace: true });
  };
  
  // Estimate schedule mutation (for draft estimates) - sends scheduledDate and scheduledTime directly
  const estimateScheduleMutation = useMutation({
    mutationFn: async ({ date, time, endTime }: { date: string; time: string; endTime: string }) => {
      // Send date (YYYY-MM-DD) and time (HH:mm) as separate strings to avoid timezone issues
      const res = await apiRequest('PATCH', `/api/estimates/${estimateId}/schedule`, {
        scheduledDate: date || null,
        scheduledTime: time || '09:00',
        scheduledEndTime: endTime || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${estimateId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      setIsEstimateScheduleModalOpen(false);
      toast({ title: "Schedule saved" });
    },
    onError: () => {
      toast({ title: "Failed to save schedule", variant: "destructive" });
    },
  });
  
  const openEstimateScheduleModal = () => {
    // Pre-populate with existing schedule from scheduledDate and scheduledTime
    const rawDate = (estimate as any)?.scheduledDate;
    const rawTime = (estimate as any)?.scheduledTime;
    const rawEndTime = (estimate as any)?.scheduledEndTime;
    if (rawDate) {
      // Extract YYYY-MM-DD from scheduledDate (handles both ISO string and Date)
      const dateStr = typeof rawDate === 'string' 
        ? rawDate.split('T')[0] 
        : new Date(rawDate).toISOString().split('T')[0];
      setEstimateScheduleDate(dateStr);
      setEstimateScheduleTime(rawTime || '09:00');
      setEstimateScheduleEndTime(rawEndTime || '');
    } else {
      setEstimateScheduleDate('');
      setEstimateScheduleTime('');
      setEstimateScheduleEndTime('');
    }
    setIsEstimateScheduleModalOpen(true);
  };
  
  const handleSaveEstimateSchedule = () => {
    estimateScheduleMutation.mutate({ date: estimateScheduleDate, time: estimateScheduleTime, endTime: estimateScheduleEndTime });
  };

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
          <Button onClick={() => navigate(getReturnUrl())}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  const canApprove = estimate.status === 'draft';

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5 pb-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => navigate(getReturnUrl())}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors -ml-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {estimate.customerName || 'Unnamed Customer'}
          </h1>
        </div>
        <div className="flex items-center justify-between pl-9">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Estimate • {estimate.estimateNumber}
          </p>
          <div className="flex items-center gap-2">
            {canShareEstimates && (
              <Button variant="outline" size="sm" onClick={() => setIsShareModalOpen(true)} className="h-8 px-3 rounded-lg text-xs">
                <Share2 className="h-3.5 w-3.5 mr-1.5" />
                Share
              </Button>
            )}
            <span className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-full text-xs font-medium capitalize ${
              estimate.status === 'approved' 
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400' 
                : estimate.status === 'draft'
                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                : 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400'
            }`}>
              {estimate.status === 'approved' && <CheckCircle className="h-3 w-3" />}
              {estimate.status}
            </span>
          </div>
        </div>
      </div>

      {canApprove && (
        <Button 
          onClick={handleApproveClick} 
          className="w-full mb-6 py-6 text-lg font-semibold rounded-xl"
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
              <div className="space-y-4">
                <div>
                  <p className="font-medium">{estimate.customerName}</p>
                </div>
                {(() => {
                  const jobAddress = [
                    (estimate as any).jobAddressLine1,
                    (estimate as any).jobCity,
                    (estimate as any).jobState,
                    (estimate as any).jobZip
                  ].filter(Boolean).join(', ');
                  if (jobAddress) {
                    return (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Address</p>
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(jobAddress)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {jobAddress}
                        </a>
                      </div>
                    );
                  }
                  return null;
                })()}
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule
              </div>
              {estimate.status === 'draft' && (
                <Button variant="outline" size="sm" onClick={openEstimateScheduleModal}>
                  {(estimate as any).scheduledDate ? 'Edit' : 'Set Schedule'}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const rawDate = (estimate as any)?.scheduledDate;
              const rawTime = (estimate as any)?.scheduledTime;
              const rawEndTime = (estimate as any)?.scheduledEndTime;
              if (!rawDate) {
                return <p className="text-muted-foreground">Not scheduled</p>;
              }
              const dateStr = typeof rawDate === 'string' ? rawDate.split('T')[0] : new Date(rawDate).toISOString().split('T')[0];
              const [year, month, day] = dateStr.split('-').map(Number);
              const dateFormatted = new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
              const formatTime = (t: string) => {
                const [h, m] = t.split(':').map(Number);
                const period = h >= 12 ? 'PM' : 'AM';
                const displayH = h % 12 || 12;
                return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
              };
              let timeFormatted = '';
              if (rawTime && rawEndTime) {
                timeFormatted = `${formatTime(rawTime)} – ${formatTime(rawEndTime)}`;
              } else if (rawTime) {
                timeFormatted = formatTime(rawTime);
              }
              return (
                <div className="space-y-1">
                  <p className="font-medium">{dateFormatted}</p>
                  {timeFormatted && <p className="text-muted-foreground">{timeFormatted}</p>}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Assigned Employees
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assignedEmployees.length > 0 ? (
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2 flex-shrink-0">
                  {assignedEmployees.slice(0, 4).map((emp) => {
                    const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email;
                    const initials = (emp.firstName?.[0] || '') + (emp.lastName?.[0] || '') || emp.email[0].toUpperCase();
                    return emp.profileImageUrl ? (
                      <img
                        key={emp.id}
                        src={emp.profileImageUrl}
                        alt={name}
                        title={name}
                        className="h-8 w-8 rounded-full border-2 border-white dark:border-slate-800 object-cover"
                      />
                    ) : (
                      <div
                        key={emp.id}
                        title={name}
                        className="h-8 w-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        {initials}
                      </div>
                    );
                  })}
                  {assignedEmployees.length > 4 && (
                    <div className="h-8 w-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-medium">
                      +{assignedEmployees.length - 4}
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  {assignedEmployees.map(e => 
                    `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email.split('@')[0]
                  ).slice(0, 3).join(', ')}
                  {assignedEmployees.length > 3 && ` +${assignedEmployees.length - 3} more`}
                </div>
              </div>
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
            {estimate.items && estimate.items.length > 0 ? (() => {
              // Compute tax from line items if server taxCents is 0 but items have tax
              let computedTaxCents = 0;
              let computedSubtotalCents = 0;
              for (const item of estimate.items) {
                const lineSubtotal = item.lineTotalCents || 0;
                computedSubtotalCents += lineSubtotal;
                // Use stored taxCents if available, otherwise calculate from rate
                if (item.taxCents && item.taxCents > 0) {
                  computedTaxCents += item.taxCents;
                } else if (item.taxable && item.taxRatePercentSnapshot) {
                  const rate = parseFloat(item.taxRatePercentSnapshot) || 0;
                  computedTaxCents += Math.round(lineSubtotal * rate / 100);
                }
              }
              // Use server values if available, otherwise use computed
              const displaySubtotal = estimate.subtotalCents || computedSubtotalCents;
              const displayTax = estimate.taxCents > 0 ? estimate.taxCents : computedTaxCents;
              const displayTotal = estimate.totalCents || (displaySubtotal + displayTax);

              // Debug log (remove after verified)
              console.log("ESTIMATE TOTALS DEBUG", {
                estimateId: estimate.id,
                serverSubtotal: estimate.subtotalCents,
                serverTax: estimate.taxCents,
                serverTotal: estimate.totalCents,
                computedSubtotal: computedSubtotalCents,
                computedTax: computedTaxCents,
                displaySubtotal,
                displayTax,
                displayTotal,
              });

              return (
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
                    <span>{formatCurrency(displaySubtotal)}</span>
                  </div>
                  {displayTax > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(displayTax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span>{formatCurrency(displayTotal)}</span>
                  </div>
                </div>
              );
            })() : (
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

        {/* Notes Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StickyNote className="h-5 w-5" />
                Notes
              </div>
              {canEditEstimate && estimate.notes && (
                <Button variant="ghost" size="sm" onClick={openNotesModal}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {estimate.notes ? (
              <div>
                <p 
                  className={`text-sm leading-relaxed whitespace-pre-wrap ${
                    !isNotesExpanded ? 'line-clamp-5' : ''
                  }`}
                >
                  {estimate.notes}
                </p>
                {estimate.notes.length > 200 && (
                  <button 
                    onClick={() => setIsNotesExpanded(!isNotesExpanded)}
                    className="text-sm text-blue-600 hover:text-blue-800 mt-2"
                  >
                    {isNotesExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground mb-1">No notes yet</p>
                <p className="text-sm text-muted-foreground mb-3">Add notes for this estimate.</p>
                {canEditEstimate && (
                  <Button variant="outline" size="sm" onClick={openNotesModal}>
                    Add Notes
                  </Button>
                )}
              </div>
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
              <div className="w-full h-32 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center p-3">
                <img
                  src={estimate.signatureDataUrl}
                  alt="Approval signature"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              {estimate.approvedAt && (
                <p className="text-sm text-muted-foreground mt-3">
                  Approved on {new Date(estimate.approvedAt).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Approve Estimate
            </DialogTitle>
            <button 
              onClick={() => setIsApproveDialogOpen(false)} 
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
              You are about to approve this estimate.
            </p>
            <p className="text-center text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatCurrency(estimate.totalCents)}
            </p>
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Once approved, this estimate cannot be edited.
            </p>
            <div className="pt-2 space-y-2">
              <Button onClick={handleConfirmApprove} className="w-full h-11 rounded-xl font-medium">
                Approve
              </Button>
              <Button variant="outline" onClick={() => setIsApproveDialogOpen(false)} className="w-full h-11 rounded-xl font-medium">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSignatureModalOpen} onOpenChange={setIsSignatureModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Sign to Approve
            </DialogTitle>
            <button 
              onClick={() => setIsSignatureModalOpen(false)} 
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
              Draw your signature below to confirm approval.
            </p>
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <canvas
                ref={canvasRef}
                width={350}
                height={150}
                className="w-full touch-none cursor-crosshair bg-white dark:bg-slate-900 rounded-lg"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={clearSignature}
                className="text-xs text-red-500 hover:text-red-600 font-medium"
              >
                Clear
              </button>
              <p className="text-xs text-slate-400">
                Draw your signature above
              </p>
            </div>
            <div className="pt-1 space-y-2">
              <Button
                onClick={saveSignature}
                disabled={!hasSignature || approveMutation.isPending}
                className="w-full h-11 rounded-xl font-medium"
              >
                {approveMutation.isPending ? "Saving..." : "Save Signature"}
              </Button>
              <Button variant="outline" onClick={() => setIsSignatureModalOpen(false)} className="w-full h-11 rounded-xl font-medium">
                Cancel
              </Button>
            </div>
          </div>
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

      {/* Schedule Job Modal - appears after estimate approval */}
      <Dialog open={isScheduleModalOpen} onOpenChange={(open) => !open && handleSkipSchedule()}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="min-w-[44px] flex items-center">
              <Calendar className="h-4 w-4 text-slate-400" />
            </div>
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Schedule Job
            </DialogTitle>
            <button 
              onClick={handleSkipSchedule} 
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="bg-white dark:bg-slate-900 p-4 space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              When would you like to schedule the job?
            </p>
            
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-900 dark:text-slate-100">Date</label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full h-10 px-3 border rounded-xl bg-slate-100 dark:bg-slate-800 border-0 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-900 dark:text-slate-100">Start Time</label>
              <TimeWheelPicker
                value={scheduledTime}
                onChange={setScheduledTime}
                label="Select Start Time"
                className="h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-900 dark:text-slate-100">End Time</label>
              <TimeWheelPicker
                value={scheduledEndTime}
                onChange={setScheduledEndTime}
                label="Select End Time"
                className="h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="pt-2 space-y-2">
              <Button 
                onClick={handleScheduleJob}
                disabled={scheduleMutation.isPending}
                className="w-full h-11 rounded-xl font-medium"
              >
                {scheduleMutation.isPending ? "Scheduling..." : "Schedule"}
              </Button>
              <Button 
                variant="outline" 
                onClick={handleSkipSchedule}
                className="w-full h-11 rounded-xl font-medium"
              >
                Skip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Estimate Schedule Modal - for draft estimates */}
      <Dialog open={isEstimateScheduleModalOpen} onOpenChange={setIsEstimateScheduleModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-green-600" />
              Schedule Estimate
            </DialogTitle>
            <DialogDescription>
              Set when this estimate should be scheduled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={estimateScheduleDate}
                onChange={(e) => setEstimateScheduleDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Start Time</label>
              <TimeWheelPicker
                value={estimateScheduleTime}
                onChange={setEstimateScheduleTime}
                label="Select Start Time"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">End Time</label>
              <TimeWheelPicker
                value={estimateScheduleEndTime}
                onChange={setEstimateScheduleEndTime}
                label="Select End Time"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsEstimateScheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEstimateSchedule}
              disabled={estimateScheduleMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {estimateScheduleMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Modal */}
      <Dialog open={isNotesModalOpen} onOpenChange={setIsNotesModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Estimate Notes</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Add notes about this estimate..."
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              rows={6}
              className="resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsNotesModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveNotes}
              disabled={updateNotesMutation.isPending}
            >
              {updateNotesMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Share Estimate Modal */}
      {estimate && (
        <ShareEstimateModal
          open={isShareModalOpen}
          onOpenChange={setIsShareModalOpen}
          estimateId={estimate.id}
          estimateNumber={estimate.estimateNumber}
          customerEmail={estimate.customerEmail}
          customerFirstName={estimate.customerName?.split(' ')[0] || null}
        />
      )}
    </div>
  );
}
