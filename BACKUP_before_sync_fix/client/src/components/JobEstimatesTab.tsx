import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  User, List, Calendar, Users, SlidersHorizontal, Tag, ChevronRight, 
  Plus, Trash2, Loader2, Search, X, Building2, FileText, MoreVertical, Eye, Edit, Copy, ArrowLeft, Check, DollarSign
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PriceBookPickerModal } from "./PriceBookPickerModal";
import { TimeWheelPicker } from "./TimeWheelPicker";
import { SelectCustomerModal } from "./CustomerModals";
import type { Customer, Estimate } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";
import { formatEstimateRequestedSchedule } from "@/utils/scheduleDate";
import { formatScheduleDisplay } from "@/utils/formatScheduleTimeRange";

interface LineItem {
  name: string;
  description: string;
  taskCode: string;
  quantity: string;
  unitPriceCents: number;
  priceDisplay: string;
  unit: string;
  taxable: boolean;
  saveToPriceBook: boolean;
}

interface EstimateItemPayload {
  name: string;
  description: string | null;
  taskCode: string | null;
  quantity: string;
  unitPriceCents: number;
  unit: string;
  taxable: boolean;
  sortOrder: number;
}

interface ScheduleData {
  date: string;
  time: string;
}

interface EstimateFieldsData {
  showSubtotal: boolean;
  showTax: boolean;
  taxRate: string;
  validDays: string;
}

const JOB_TYPES = [
  "Diagnostic",
  "Maintenance",
  "Install",
  "Repair",
  "Emergency Service",
  "Service Call",
  "Replacement",
  "Inspection",
  "Cleaning",
  "Commissioning",
  "Warranty Work",
  "Recall",
] as const;

interface JobEstimatesTabProps {
  jobId: number;
  canCreate: boolean;
  selectedCustomer?: Customer | null;
  onCustomerUsed?: () => void;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'draft': return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
    case 'sent': return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'accepted': return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 'rejected': return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    default: return 'bg-slate-100 text-slate-700';
  }
}

export default function JobEstimatesTab({ jobId, canCreate, selectedCustomer: externalSelectedCustomer, onCustomerUsed }: JobEstimatesTabProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const canEditEstimate = canCreate;

  // Modal state for new estimate form
  const [isNewEstimateOpen, setIsNewEstimateOpen] = useState(false);
  const [estimateToDelete, setEstimateToDelete] = useState<Estimate | null>(null);

  // Form state for creating estimates
  const [notes, setNotes] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }
  ]);
  const [schedule, setSchedule] = useState<ScheduleData>({ date: "", time: "" });
  const [assignedEmployees, setAssignedEmployees] = useState<string[]>([]);
  const [estimateFields, setEstimateFields] = useState<EstimateFieldsData>({
    showSubtotal: true,
    showTax: true,
    taxRate: "0",
    validDays: "30"
  });
  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

  // Modal states
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [lineItemsModalOpen, setLineItemsModalOpen] = useState(false);
  const [priceBookPickerOpen, setPriceBookPickerOpen] = useState(false);
  const lineItemsScrollRef = useRef<HTMLDivElement>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [employeesModalOpen, setEmployeesModalOpen] = useState(false);
  const [jobTypeModalOpen, setJobTypeModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [jobType, setJobType] = useState<string | null>(null);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");

  // New customer form
  const [newCustomer, setNewCustomer] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    companyName: "",
    companyNumber: "",
    jobTitle: "",
    showCompany: false
  });

  // Fetch existing estimates for this job
  const { data: estimates = [], isLoading: estimatesLoading } = useQuery<Estimate[]>({
    queryKey: ['/api/jobs', jobId, 'estimates'],
  });

  // Fetch customers from API
  const { data: apiCustomers = [] } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
  });

  useEffect(() => {
    if (apiCustomers.length > 0) {
      setCustomers(apiCustomers);
    }
  }, [apiCustomers]);

  // Handle external customer selection (from Jobs.tsx flow)
  useEffect(() => {
    if (externalSelectedCustomer) {
      setSelectedCustomer(externalSelectedCustomer);
      setIsNewEstimateOpen(true);
      onCustomerUsed?.();
    }
  }, [externalSelectedCustomer, onCustomerUsed]);

  useEffect(() => {
    if (lineItemsModalOpen) {
      requestAnimationFrame(() => {
        lineItemsScrollRef.current?.scrollTo({ top: lineItemsScrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [lineItems.length]);

  // Reset form to defaults
  const resetForm = () => {
    setNotes("");
    setSelectedCustomer(null);
    setLineItems([{ name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }]);
    setSchedule({ date: "", time: "" });
    setAssignedEmployees([]);
    setEstimateFields({ showSubtotal: true, showTax: true, taxRate: "0", validDays: "30" });
    setTags([]);
    setJobType(null);
  };

  // Calculate tax based on settings
  const calculateTaxCents = (): number => {
    const rate = parseFloat(estimateFields.taxRate) || 0;
    const subtotal = lineItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      return sum + Math.round(qty * item.unitPriceCents);
    }, 0);
    return Math.round(subtotal * (rate / 100));
  };

  // Create estimate mutation
  const createEstimateMutation = useMutation({
    mutationFn: async (data: { title: string; customerId?: number; customerName?: string; customerEmail?: string; customerPhone?: string; customerAddress?: string; notes?: string; taxCents: number; assignedEmployeeIds?: string[]; jobType?: string; requestedStartAt?: string | null; items: EstimateItemPayload[] }) => {
      return await apiRequest("POST", `/api/jobs/${jobId}/estimates`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'estimates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      queryClient.invalidateQueries({ predicate: (q) =>
        Array.isArray(q.queryKey) && typeof q.queryKey[0] === 'string' && q.queryKey[0].includes('/api/customers/') && q.queryKey[0].includes('/estimates')
      });
      setIsNewEstimateOpen(false);
      resetForm();
      toast({
        title: "Estimate Created",
        description: "The estimate has been saved as a draft.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create estimate",
        variant: "destructive",
      });
    },
  });

  const deleteEstimateMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      return await apiRequest("DELETE", `/api/estimates/${estimateId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'estimates'] });
      setEstimateToDelete(null);
      toast({
        title: "Estimate Deleted",
        description: "The estimate has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete estimate",
        variant: "destructive",
      });
    },
  });

  const duplicateEstimateMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      return await apiRequest("POST", `/api/estimates/${estimateId}/duplicate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'estimates'] });
      toast({
        title: "Estimate Duplicated",
        description: "A copy of the estimate has been created.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate estimate",
        variant: "destructive",
      });
    },
  });

  // Submit estimate
  const handleSubmitEstimate = async () => {
    const validItems = lineItems.filter(item => item.name.trim());
    if (validItems.length === 0) {
      toast({
        title: "Error",
        description: "At least one line item with a name is required",
        variant: "destructive",
      });
      return;
    }

    // Save items to price book if requested (using idempotent endpoint)
    const itemsToSave = validItems.filter(item => item.saveToPriceBook);
    for (const item of itemsToSave) {
      try {
        await apiRequest('POST', '/api/service-catalog/save-from-line-item', {
          name: item.name.trim(),
          description: item.description || null,
          defaultPriceCents: item.unitPriceCents,
          unit: item.unit,
          taskCode: item.taskCode || null,
          taxable: item.taxable,
        });
      } catch {
        // Silently ignore price book errors to not block estimate creation
      }
    }
    if (itemsToSave.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
    }

    // Auto-generate title from customer name
    const autoTitle = selectedCustomer 
      ? `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''} – Estimate`.trim()
      : "Estimate";

    // Combine date + time into single ISO string for requestedStartAt
    // We create a Date object from local date/time components, then convert to ISO
    let requestedStartAt: string | null = null;
    if (schedule.date) {
      const timeStr = schedule.time || '09:00';
      const [year, month, day] = schedule.date.split('-').map(Number);
      const [hours, minutes] = timeStr.split(':').map(Number);
      // Create date in LOCAL timezone
      const localDate = new Date(year, month - 1, day, hours, minutes, 0);
      // Convert to ISO string (UTC) - this preserves the correct moment in time
      requestedStartAt = localDate.toISOString();
    }
    
    createEstimateMutation.mutate({
      title: autoTitle,
      customerId: selectedCustomer?.id || undefined,
      customerName: selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}` : undefined,
      customerEmail: selectedCustomer?.email || undefined,
      customerPhone: selectedCustomer?.phone || undefined,
      customerAddress: selectedCustomer?.address || undefined,
      notes: notes.trim() || undefined,
      taxCents: calculateTaxCents(),
      assignedEmployeeIds: assignedEmployees,
      jobType: jobType || undefined,
      requestedStartAt,
      items: validItems.map((item, index) => ({
        name: item.name.trim(),
        description: item.description?.trim() || null,
        taskCode: item.taskCode?.trim() || null,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        unit: item.unit,
        taxable: item.taxable,
        sortOrder: index,
      })),
    });
  };

  // Fetch company employees for assignment
  const { data: employeesData } = useQuery<{ users: { id: string; firstName: string | null; lastName: string | null; email: string | null; role: string; profileImageUrl?: string | null }[]; total: number }>({
    queryKey: ['/api/org/users'],
  });
  const companyEmployees = employeesData?.users || [];

  // Customer create mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (data: typeof newCustomer) => {
      const response = await apiRequest("POST", "/api/customers", {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || undefined,
        phone: data.phone || undefined,
        address: data.address || undefined,
        companyName: data.showCompany ? data.companyName || undefined : undefined,
        companyNumber: data.showCompany ? data.companyNumber || undefined : undefined,
        jobTitle: data.showCompany ? data.jobTitle || undefined : undefined,
      });
      return response.json();
    },
    onSuccess: (data: Customer) => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      setCustomers(prev => [...prev, data]);
      setSelectedCustomer(data);
      setAddCustomerModalOpen(false);
      setCustomerModalOpen(false);
      resetNewCustomerForm();
      toast({
        title: "Customer Added",
        description: `${data.firstName} ${data.lastName} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create customer",
        variant: "destructive",
      });
    },
  });

  const resetNewCustomerForm = () => {
    setNewCustomer({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      companyName: "",
      companyNumber: "",
      jobTitle: "",
      showCompany: false
    });
  };

  // Filter customers by search
  const filteredCustomers = customers.filter(c => {
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    return fullName.includes(customerSearch.toLowerCase());
  });

  // Line item helpers
  const addLineItem = () => {
    setLineItems(prev => [...prev, { name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }]);
  };

  const addLineItemFromPriceBook = (item: LineItem) => {
    // Filter out empty placeholder items and add the new item
    const existingItems = lineItems.filter(i => i.name.trim());
    setLineItems([...existingItems, item]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number | boolean) => {
    const updated = [...lineItems];
    if (field === 'unitPriceCents') {
      updated[index][field] = typeof value === 'number' ? value : Math.round(parseFloat(String(value)) * 100) || 0;
    } else if (field === 'taxable' || field === 'saveToPriceBook') {
      updated[index][field] = value as boolean;
    } else {
      updated[index][field] = value as string;
    }
    setLineItems(updated);
  };

  const handlePriceChange = (index: number, value: string) => {
    // Allow only digits and single decimal point
    const cleanValue = value.replace(/[^0-9.]/g, '');
    const parts = cleanValue.split('.');
    const sanitized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleanValue;
    
    const updated = [...lineItems];
    updated[index].priceDisplay = sanitized;
    updated[index].unitPriceCents = Math.round((parseFloat(sanitized) || 0) * 100);
    setLineItems(updated);
  };

  const handlePriceBlur = (index: number) => {
    const updated = [...lineItems];
    const dollars = updated[index].unitPriceCents / 100;
    updated[index].priceDisplay = dollars.toFixed(2);
    setLineItems(updated);
  };

  const handlePriceFocus = (index: number) => {
    const updated = [...lineItems];
    const dollars = updated[index].unitPriceCents / 100;
    updated[index].priceDisplay = dollars === 0 ? "" : String(dollars);
    setLineItems(updated);
  };

  const calculateLineTotal = (item: LineItem): number => {
    const qty = parseFloat(item.quantity) || 0;
    return Math.round(qty * item.unitPriceCents);
  };

  const calculateSubtotal = (): number => {
    return lineItems.reduce((sum, item) => sum + calculateLineTotal(item), 0);
  };

  // Tag helpers
  const addTag = () => {
    if (newTagInput.trim() && !tags.includes(newTagInput.trim())) {
      setTags([...tags, newTagInput.trim()]);
      setNewTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // Toggle employee selection
  const toggleEmployee = (employeeId: string) => {
    if (assignedEmployees.includes(employeeId)) {
      setAssignedEmployees(assignedEmployees.filter(id => id !== employeeId));
    } else {
      setAssignedEmployees([...assignedEmployees, employeeId]);
    }
  };

  // Section Header Component
  const SectionHeader = ({ title }: { title: string }) => (
    <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2">
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {title}
      </span>
    </div>
  );

  // Information Row Component
  const InfoRow = ({ 
    icon: Icon, 
    label, 
    value, 
    onClick,
    testId
  }: { 
    icon: typeof User; 
    label: string; 
    value?: string;
    onClick: () => void;
    testId: string;
  }) => (
    <button
      onClick={canEditEstimate ? onClick : undefined}
      disabled={!canEditEstimate}
      className="w-full flex items-center justify-between px-4 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-slate-400" />
        <span className="text-sm text-slate-700 dark:text-slate-300">
          {value || label}
        </span>
      </div>
      {canEditEstimate && (
        <ChevronRight className="h-5 w-5 text-slate-300 dark:text-slate-600" />
      )}
    </button>
  );

  // Customer initials helper
  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  // Show loading state
  if (estimatesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Estimates</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => setIsNewEstimateOpen(true)}
            data-testid="button-create-estimate"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Create Estimate
          </Button>
        )}
      </div>

      {/* Estimates List */}
      {estimates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <FileText className="h-7 w-7 text-slate-400" />
            </div>
            <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-1">No estimates yet</h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Create an estimate for this job</p>
            {canCreate && (
              <Button
                size="sm"
                onClick={() => setIsNewEstimateOpen(true)}
                data-testid="button-create-estimate-empty"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Create Estimate
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
          <div className="space-y-3">
            {estimates.map((estimate) => (
              <Card 
                key={estimate.id} 
                className="hover:shadow-sm transition-shadow cursor-pointer" 
                data-testid={`card-estimate-${estimate.id}`}
                onClick={() => navigate(`/estimates/${estimate.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-mono text-slate-500 dark:text-slate-400">
                          {estimate.estimateNumber}
                        </span>
                        <Badge className={`text-xs ${getStatusColor(estimate.status)}`}>
                          {estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1)}
                        </Badge>
                      </div>
                      <h4 className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {estimate.title}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {(() => {
                          const safeToDate = (value: any): Date | null => {
                            if (!value) return null;
                            if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
                            const d = new Date(value);
                            return isNaN(d.getTime()) ? null : d;
                          };
                          const scheduled = safeToDate((estimate as any).scheduledDate);
                          const created = safeToDate(estimate.createdAt);
                          const updated = safeToDate(estimate.updatedAt);
                          const displayDate = scheduled || created || updated;
                          if (!displayDate) return '—';
                          try {
                            return format(displayDate, 'MMM d, yyyy');
                          } catch {
                            return '—';
                          }
                        })()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(estimate.totalCents)}
                      </p>
                      {canCreate && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0" 
                              data-testid={`button-estimate-actions-${estimate.id}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              onClick={() => navigate(`/estimates/${estimate.id}`)}
                              data-testid={`action-view-estimate-${estimate.id}`}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View
                            </DropdownMenuItem>
                            {estimate.status === 'draft' && (
                              <DropdownMenuItem 
                                onClick={() => {
                                  toast({
                                    title: "Edit Estimate",
                                    description: `Editing ${estimate.estimateNumber} - Edit functionality coming soon`,
                                  });
                                }}
                                data-testid={`action-edit-estimate-${estimate.id}`}
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem 
                              onClick={() => duplicateEstimateMutation.mutate(estimate.id)}
                              disabled={duplicateEstimateMutation.isPending}
                              data-testid={`action-duplicate-estimate-${estimate.id}`}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            {estimate.status === 'draft' && (
                              <DropdownMenuItem 
                                onClick={() => setEstimateToDelete(estimate)}
                                className="text-red-600 dark:text-red-400"
                                data-testid={`action-delete-estimate-${estimate.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  
                  {/* Schedule Box - Always visible (display-only) - reads ONLY from requestedStartAt */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Calendar className="h-4 w-4" />
                      <span className="font-medium">Schedule</span>
                    </div>
                    <div className="mt-1.5 text-sm">
                      {(() => {
                        const scheduleInfo = formatEstimateRequestedSchedule({ id: estimate.id, requestedStartAt: (estimate as any).requestedStartAt });
                        if (!scheduleInfo) {
                          return <span className="text-slate-400 dark:text-slate-500">Not scheduled</span>;
                        }
                        return (
                          <span className="text-slate-900 dark:text-slate-100">
                            {scheduleInfo.full}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!estimateToDelete} onOpenChange={(open) => !open && setEstimateToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Estimate</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {estimateToDelete?.estimateNumber}? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => estimateToDelete && deleteEstimateMutation.mutate(estimateToDelete.id)}
                className="bg-red-600 hover:bg-red-700"
              >
                {deleteEstimateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Delete'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      {/* NEW ESTIMATE Modal - Full Screen Sheet */}
      <Dialog open={isNewEstimateOpen} onOpenChange={(open) => { if (!open) { setIsNewEstimateOpen(false); resetForm(); } }}>
        <DialogContent className="w-full max-w-lg h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
          {/* Header with Cancel, Title, Save */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <button 
              onClick={() => { setIsNewEstimateOpen(false); resetForm(); }}
              className="text-sm text-blue-600 font-medium"
              data-testid="button-cancel-create"
            >
              Cancel
            </button>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">New Estimate</h3>
            <Button
              size="sm"
              onClick={handleSubmitEstimate}
              disabled={createEstimateMutation.isPending}
              data-testid="button-save-estimate"
            >
              {createEstimateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Save'
              )}
            </Button>
          </div>

          {/* Scrollable Form Content */}
          <div className="flex-1 overflow-y-auto">
            {/* CUSTOMER INFO Section */}
            <SectionHeader title="Customer Info" />
            <InfoRow
              icon={User}
              label="Add customer"
              value={selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}` : undefined}
              onClick={() => setCustomerModalOpen(true)}
              testId="row-add-customer"
            />

            {/* ESTIMATE Section */}
            <SectionHeader title="Estimate" />
            <InfoRow
              icon={List}
              label="Add line items"
              value={lineItems.filter(i => i.name.trim()).length > 0 ? `${lineItems.filter(i => i.name.trim()).length} items` : undefined}
              onClick={() => {
                const hasItems = lineItems.filter(i => i.name.trim()).length > 0;
                if (hasItems) {
                  setLineItemsModalOpen(true);
                } else {
                  setPriceBookPickerOpen(true);
                }
              }}
              testId="row-add-line-items"
            />

            {/* SCHEDULE Section */}
            <SectionHeader title="Schedule" />
            <InfoRow
              icon={Calendar}
              label="Add schedule"
              value={schedule.date ? formatScheduleDisplay(schedule.date, schedule.time) : undefined}
              onClick={() => setScheduleModalOpen(true)}
              testId="row-add-schedule"
            />

            {/* DISPATCH TO Section */}
            <SectionHeader title="Dispatch To" />
            <InfoRow
              icon={Users}
              label="My employees"
              value={assignedEmployees.length > 0 ? `${assignedEmployees.length} selected` : undefined}
              onClick={() => setEmployeesModalOpen(true)}
              testId="row-my-employees"
            />

            {/* JOB TYPE Section */}
            <SectionHeader title="Job Type" />
            <InfoRow
              icon={SlidersHorizontal}
              label="Choose job type"
              value={jobType || undefined}
              onClick={() => setJobTypeModalOpen(true)}
              testId="row-job-type"
            />

            {/* JOB TAGS Section */}
            <SectionHeader title="Job Tags" />
            <InfoRow
              icon={Tag}
              label="Add job tags"
              value={tags.length > 0 ? `${tags.length} tags` : undefined}
              onClick={() => setTagsModalOpen(true)}
              testId="row-add-job-tags"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* SELECT CUSTOMER Modal */}
      <SelectCustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        onSelectCustomer={(customer) => {
          setSelectedCustomer(customer);
          setCustomerModalOpen(false);
        }}
        canCreateCustomer={canEditEstimate}
      />

      {/* LINE ITEMS Modal */}
      <Dialog open={lineItemsModalOpen} onOpenChange={setLineItemsModalOpen}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Line Items</DialogTitle>
          </DialogHeader>

          <div ref={lineItemsScrollRef} className="flex-1 overflow-y-auto space-y-4 py-2">
            {lineItems.map((item, index) => (
              <div key={index} className="p-3 border rounded-lg space-y-3 bg-slate-50 dark:bg-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    Item {index + 1}
                  </span>
                  {lineItems.length > 1 && (
                    <button
                      onClick={() => removeLineItem(index)}
                      className="text-red-500 hover:text-red-700"
                      data-testid={`button-remove-line-item-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Input
                  placeholder="Name *"
                  value={item.name}
                  onChange={(e) => updateLineItem(index, 'name', e.target.value)}
                  data-testid={`input-line-item-name-${index}`}
                />
                <Textarea
                  placeholder="Description (optional)"
                  value={item.description}
                  onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                  rows={2}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Task Code</Label>
                    <Input
                      placeholder="e.g., SVC-001"
                      value={item.taskCode}
                      onChange={(e) => updateLineItem(index, 'taskCode', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Select
                      value={item.unit}
                      onValueChange={(value) => updateLineItem(index, 'unit', value)}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="each">Each</SelectItem>
                        <SelectItem value="hour">Hour</SelectItem>
                        <SelectItem value="ft">Foot</SelectItem>
                        <SelectItem value="sq_ft">Sq Ft</SelectItem>
                        <SelectItem value="job">Job</SelectItem>
                        <SelectItem value="day">Day</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                      min="0"
                      step="1"
                      data-testid={`input-line-item-qty-${index}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unit Price ($)</Label>
                    <Input
                      type="text"
                      value={item.priceDisplay}
                      onChange={(e) => handlePriceChange(index, e.target.value)}
                      onBlur={() => handlePriceBlur(index)}
                      onFocus={() => handlePriceFocus(index)}
                      placeholder="0.00"
                      data-testid={`input-line-item-price-${index}`}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between py-1">
                  <Label className="text-sm font-normal">Taxable</Label>
                  <Switch
                    checked={item.taxable}
                    onCheckedChange={(checked) => updateLineItem(index, 'taxable', checked)}
                  />
                </div>
                <div className="flex items-center justify-between py-1 border-t pt-2">
                  <div>
                    <Label className="text-sm font-normal">Save to Price Book</Label>
                    <p className="text-xs text-slate-500">Add as reusable template</p>
                  </div>
                  <Switch
                    checked={item.saveToPriceBook}
                    onCheckedChange={(checked) => updateLineItem(index, 'saveToPriceBook', checked)}
                  />
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Total</span>
                  <span className="text-base font-semibold">{formatCurrency(calculateLineTotal(item))}</span>
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setLineItemsModalOpen(false);
                  setPriceBookPickerOpen(true);
                }}
                className="flex-1"
                data-testid="button-add-from-price-book"
              >
                <Plus className="h-4 w-4 mr-2" />
                From Price Book
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={addLineItem}
                className="flex-1"
                data-testid="button-add-line-item"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New
              </Button>
            </div>

            <div className="pt-4 border-t">
              <div className="flex justify-between text-base font-semibold">
                <span>Subtotal</span>
                <span>{formatCurrency(calculateSubtotal())}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setLineItemsModalOpen(false)} data-testid="button-done-line-items">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PRICE BOOK PICKER Modal */}
      <PriceBookPickerModal
        open={priceBookPickerOpen}
        onOpenChange={setPriceBookPickerOpen}
        onAddItem={addLineItemFromPriceBook}
        existingItems={lineItems}
      />

      {/* SCHEDULE Modal */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Schedule</DialogTitle>
            <button
              onClick={() => setScheduleModalOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="scheduleDate">Date</Label>
              <Input
                id="scheduleDate"
                type="date"
                value={schedule.date}
                onChange={(e) => setSchedule({ ...schedule, date: e.target.value })}
                data-testid="input-schedule-date"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scheduleTime">Time</Label>
              <TimeWheelPicker
                value={schedule.time}
                onChange={(time) => setSchedule({ ...schedule, time })}
                label="Time"
              />
            </div>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <Button onClick={() => setScheduleModalOpen(false)} data-testid="button-done-schedule" className="w-full h-10 rounded-xl">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* EMPLOYEES Modal */}
      <Dialog open={employeesModalOpen} onOpenChange={setEmployeesModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Assign Employees</DialogTitle>
            <button
              onClick={() => setEmployeesModalOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <ScrollArea className="max-h-64 bg-white dark:bg-slate-900">
            {companyEmployees.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No employees found
              </div>
            ) : (
              <div className="py-1">
                {companyEmployees.map((employee, index) => {
                  const employeeName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Unnamed';
                  const isSelected = assignedEmployees.includes(employee.id);
                  return (
                    <div key={employee.id}>
                      <button
                        onClick={() => toggleEmployee(employee.id)}
                        className={`w-full flex items-center gap-3 px-4 min-h-[56px] text-left transition-colors ${
                          isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                        }`}
                        data-testid={`checkbox-employee-${employee.id}`}
                      >
                        <Checkbox
                          id={`employee-${employee.id}`}
                          checked={isSelected}
                          onCheckedChange={() => {}}
                          className="pointer-events-none"
                        />
                        <Avatar className="w-9 h-9 flex-shrink-0">
                          <AvatarImage
                            src={employee.profileImageUrl || undefined}
                            alt={employeeName}
                          />
                          <AvatarFallback className="text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {(employee.firstName?.[0] || '').toUpperCase()}{(employee.lastName?.[0] || '').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{employeeName}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{employee.email || ''}</p>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          {employee.role}
                        </span>
                      </button>
                      {index < companyEmployees.length - 1 && (
                        <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="flex justify-between items-center px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-sm text-slate-500">{assignedEmployees.length} selected</span>
            <Button onClick={() => setEmployeesModalOpen(false)} data-testid="button-done-employees" className="h-10 rounded-xl">
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* JOB TYPE Picker Modal */}
      <Dialog open={jobTypeModalOpen} onOpenChange={setJobTypeModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0">
          <div className="flex items-center px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setJobTypeModalOpen(false)}
              className="mr-3 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              data-testid="button-back-job-type"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <DialogTitle className="flex-1 text-center text-base font-semibold">Job type</DialogTitle>
            <div className="w-8" />
          </div>

          <ScrollArea className="max-h-96">
            <div className="py-2">
              {JOB_TYPES.map((type) => (
                <button
                  key={type}
                  className="w-full flex items-center justify-between px-4 py-3 text-left border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => {
                    setJobType(type);
                    setJobTypeModalOpen(false);
                  }}
                  data-testid={`job-type-${type.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <span className="text-slate-900 dark:text-slate-100">{type}</span>
                  {jobType === type && (
                    <Check className="h-5 w-5 text-blue-600" />
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* TAGS Modal */}
      <Dialog open={tagsModalOpen} onOpenChange={setTagsModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Job Tags</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Existing Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="px-3 py-1 text-sm gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="ml-1 hover:text-red-500"
                      data-testid={`button-remove-tag-${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Add Tag Input */}
            <div className="flex gap-2">
              <Input
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                placeholder="Enter tag name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                data-testid="input-new-tag"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addTag}
                disabled={!newTagInput.trim()}
                data-testid="button-add-tag"
              >
                Add
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setTagsModalOpen(false)} data-testid="button-done-tags">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
