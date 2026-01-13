import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  User, Calendar, Users, MapPin, ChevronRight, 
  Plus, Search, X, StickyNote, Wrench, Check, List, Trash2, DollarSign
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import LocationInput from "@/components/LocationInput";
import { PriceBookPickerModal } from "./PriceBookPickerModal";
import type { Customer } from "@shared/schema";

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

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
  profileImageUrl?: string | null;
}

interface ScheduleData {
  date: string;
  startTime: string;
  endTime: string;
}

interface NewJobSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobCreated?: (job: any) => void;
  initialJob?: any;
  isEditMode?: boolean;
  onJobUpdated?: (job: any) => void;
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

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
      {title}
    </div>
  );
}

function InfoRow({ 
  icon: Icon, 
  label, 
  value, 
  onClick,
  required = false,
  testId
}: { 
  icon: React.ElementType; 
  label: string; 
  value?: string; 
  onClick?: () => void;
  required?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
      data-testid={testId}
    >
      <Icon className="h-5 w-5 text-slate-400 flex-shrink-0" />
      <span className={`flex-1 text-sm ${value ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
        {value || label}
        {required && !value && <span className="text-red-500 ml-1">*</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </button>
  );
}


export function NewJobSheet({ open, onOpenChange, onJobCreated, initialJob, isEditMode = false, onJobUpdated }: NewJobSheetProps) {
  const { toast } = useToast();
  const [isInitialized, setIsInitialized] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [locationLat, setLocationLat] = useState<number | undefined>();
  const [locationLng, setLocationLng] = useState<number | undefined>();
  const [locationPlaceId, setLocationPlaceId] = useState("");
  const [locationIsManualOverride, setLocationIsManualOverride] = useState(false);
  const [priority, setPriority] = useState("medium");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData>({ date: "", startTime: "", endTime: "" });
  const [assignedEmployees, setAssignedEmployees] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [jobType, setJobType] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }
  ]);

  // Modal states
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [employeesModalOpen, setEmployeesModalOpen] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [jobTypeModalOpen, setJobTypeModalOpen] = useState(false);
  const [lineItemsModalOpen, setLineItemsModalOpen] = useState(false);
  const [priceBookPickerOpen, setPriceBookPickerOpen] = useState(false);
  const [locationUpdateConfirmOpen, setLocationUpdateConfirmOpen] = useState(false);
  const [pendingCustomerForLocation, setPendingCustomerForLocation] = useState<Customer | null>(null);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");

  // New customer form
  const [newCustomer, setNewCustomer] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: ""
  });

  // Fetch customers
  const { data: apiCustomers = [], isLoading: customersLoading, error: customersError, refetch: refetchCustomers } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
  });

  // Fetch company employees
  const { data: employeesData, isLoading: employeesLoading } = useQuery<{ users: Employee[]; total: number }>({
    queryKey: ['/api/org/users'],
  });
  const allEmployees = employeesData?.users || [];

  // Employee search
  const [employeeSearch, setEmployeeSearch] = useState("");

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return apiCustomers;
    const search = customerSearch.toLowerCase();
    return apiCustomers.filter(c => {
      const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
      const email = (c.email || '').toLowerCase();
      return name.includes(search) || email.includes(search);
    });
  }, [apiCustomers, customerSearch]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    const ASSIGNABLE_ROLES = ['TECHNICIAN', 'SUPERVISOR', 'PROJECT_MANAGER', 'ADMIN_ASSISTANT', 'DISPATCHER', 'ESTIMATOR'];
    const assignable = allEmployees.filter(e => ASSIGNABLE_ROLES.includes(e.role?.toUpperCase()));
    if (!employeeSearch.trim()) return assignable;
    const search = employeeSearch.toLowerCase();
    return assignable.filter(e => {
      const name = `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase();
      return name.includes(search) || (e.email || '').toLowerCase().includes(search);
    });
  }, [allEmployees, employeeSearch]);

  // Hydrate form state from initialJob when in edit mode
  useEffect(() => {
    if (isEditMode && initialJob && open && !isInitialized) {
      setTitle(initialJob.title || "");
      setDescription(initialJob.description || "");
      setLocation(initialJob.location || "");
      setCity(initialJob.city || "");
      setPostalCode(initialJob.postalCode || "");
      setLocationLat(initialJob.locationLat || undefined);
      setLocationLng(initialJob.locationLng || undefined);
      setLocationPlaceId(initialJob.locationPlaceId || "");
      setPriority(initialJob.priority || "medium");
      setNotes(initialJob.notes || "");
      setJobType(initialJob.jobType || null);
      
      // Set schedule if available
      if (initialJob.scheduleDate || initialJob.scheduleStartTime || initialJob.scheduleEndTime) {
        setSchedule({
          date: initialJob.scheduleDate || "",
          startTime: initialJob.scheduleStartTime || "",
          endTime: initialJob.scheduleEndTime || "",
        });
      }
      
      // Set assigned employees if available
      if (initialJob.assignedEmployeeIds && Array.isArray(initialJob.assignedEmployeeIds)) {
        setAssignedEmployees(initialJob.assignedEmployeeIds);
      }
      
      // Set customer if available - use hydrated customer object directly from API
      if (initialJob.customer) {
        setSelectedCustomer({
          id: initialJob.customer.id,
          firstName: initialJob.customer.firstName || null,
          lastName: initialJob.customer.lastName || null,
          email: initialJob.customer.email || null,
          phone: initialJob.customer.phone || null,
          address: initialJob.customer.address || null,
          companyId: 0,
          createdAt: null,
        } as Customer);
      }
      
      // Set line items if available
      if (initialJob.lineItems && Array.isArray(initialJob.lineItems) && initialJob.lineItems.length > 0) {
        setLineItems(initialJob.lineItems.map((item: any) => ({
          name: item.name || "",
          description: item.description || "",
          taskCode: item.taskCode || "",
          quantity: item.quantity?.toString() || "1",
          unitPriceCents: item.unitPriceCents || 0,
          priceDisplay: formatCurrency(item.unitPriceCents || 0),
          unit: item.unit || "each",
          taxable: item.taxable || false,
          saveToPriceBook: false,
        })));
      }
      
      setIsInitialized(true);
    }
  }, [isEditMode, initialJob, open, isInitialized]);
  
  // Separate effect to handle customer lookup from apiCustomers as fallback
  useEffect(() => {
    if (isEditMode && initialJob && open && isInitialized && !selectedCustomer && apiCustomers.length > 0) {
      // Try to find by customerId first
      if (initialJob.customerId) {
        const customer = apiCustomers.find(c => c.id === initialJob.customerId);
        if (customer) {
          setSelectedCustomer(customer);
          return;
        }
      }
      
      // Fallback: try to find by clientName (for legacy jobs without customerId)
      if (initialJob.clientName) {
        const clientNameLower = initialJob.clientName.toLowerCase().trim();
        const customer = apiCustomers.find(c => {
          const fullName = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().trim();
          return fullName === clientNameLower;
        });
        if (customer) {
          setSelectedCustomer(customer);
        }
      }
    }
  }, [isEditMode, initialJob, open, isInitialized, selectedCustomer, apiCustomers]);

  // Reset initialization when dialog closes
  useEffect(() => {
    if (!open) {
      setIsInitialized(false);
    }
  }, [open]);

  // Create customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (customerData: { firstName: string; lastName: string; email?: string; phone?: string; address?: string }) => {
      const response = await apiRequest('POST', '/api/customers', customerData);
      return response.json();
    },
    onSuccess: (newCust: Customer) => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      setSelectedCustomer(newCust);
      // Auto-fill location from new customer's address
      if (newCust.address && (!location.trim() || !locationIsManualOverride)) {
        setLocation(newCust.address);
        setLocationLat(undefined);
        setLocationLng(undefined);
        setLocationPlaceId("");
        setCity("");
        setPostalCode("");
      }
      setAddCustomerModalOpen(false);
      setCustomerModalOpen(false);
      setNewCustomer({ firstName: "", lastName: "", email: "", phone: "", address: "" });
      toast({ title: "Customer added", description: "Customer has been created successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create customer.", variant: "destructive" });
    }
  });

  // Create job mutation - uses new simplified endpoint
  const createJobMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      location?: string;
      city?: string;
      postalCode?: string;
      locationLat?: number;
      locationLng?: number;
      locationPlaceId?: string;
      priority?: string;
      customerId?: number;
      customerName?: string;
      scheduleDate?: string;
      scheduleStartTime?: string;
      scheduleEndTime?: string;
      assignedEmployeeIds?: string[];
      notes?: string;
      jobType?: string;
      lineItems?: { name: string; description?: string; taskCode?: string; quantity: string; unitPriceCents: number; unit: string; taxable: boolean; }[];
    }) => {
      const response = await apiRequest('POST', '/api/jobs/create', data);
      return response.json();
    },
    onSuccess: (newJob) => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      resetForm();
      onOpenChange(false);
      if (onJobCreated) {
        onJobCreated(newJob);
      }
      toast({ title: "Job created", description: "Your new job has been created successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create job", variant: "destructive" });
    }
  });

  // Update job mutation for edit mode
  const updateJobMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      location?: string;
      city?: string;
      postalCode?: string;
      locationLat?: number;
      locationLng?: number;
      locationPlaceId?: string;
      priority?: string;
      customerId?: number;
      customerName?: string;
      scheduleDate?: string;
      scheduleStartTime?: string;
      scheduleEndTime?: string;
      assignedEmployeeIds?: string[];
      notes?: string;
      jobType?: string;
      lineItems?: { name: string; description?: string; taskCode?: string; quantity: string; unitPriceCents: number; unit: string; taxable: boolean; }[];
    }) => {
      const response = await apiRequest('PATCH', `/api/jobs/${initialJob?.id}`, data);
      return response.json();
    },
    onSuccess: (updatedJob) => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', initialJob?.id?.toString()] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${initialJob?.id}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          typeof query.queryKey[0] === 'string' && 
          query.queryKey[0].startsWith('/api/schedule-items')
      });
      resetForm();
      onOpenChange(false);
      if (onJobUpdated) {
        onJobUpdated(updatedJob);
      }
      toast({ title: "Job updated", description: "Your job has been updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update job", variant: "destructive" });
    }
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setLocation("");
    setCity("");
    setPostalCode("");
    setLocationLat(undefined);
    setLocationLng(undefined);
    setLocationPlaceId("");
    setLocationIsManualOverride(false);
    setPriority("medium");
    setSelectedCustomer(null);
    setSchedule({ date: "", startTime: "", endTime: "" });
    setAssignedEmployees([]);
    setNotes("");
    setJobType(null);
    setLineItems([{ name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }]);
    setCustomerSearch("");
    setEmployeeSearch("");
    setPendingCustomerForLocation(null);
  };

  // Helper function to update location from customer address
  const updateLocationFromCustomer = (customer: Customer) => {
    if (customer.address) {
      setLocation(customer.address);
      // Clear geocode data since this is a new address string
      setLocationLat(undefined);
      setLocationLng(undefined);
      setLocationPlaceId("");
      setCity("");
      setPostalCode("");
    }
  };

  // Handle customer selection with automatic location sync
  const handleCustomerSelect = (customer: Customer) => {
    const customerAddress = customer.address;
    
    // If location is empty, always fill from customer
    if (!location.trim()) {
      setSelectedCustomer(customer);
      if (customerAddress) {
        updateLocationFromCustomer(customer);
      }
      setCustomerModalOpen(false);
      return;
    }
    
    // If location was not manually overridden, auto-update
    if (!locationIsManualOverride) {
      setSelectedCustomer(customer);
      if (customerAddress) {
        updateLocationFromCustomer(customer);
      } else {
        toast({ title: "Note", description: "Customer has no address on file." });
      }
      setCustomerModalOpen(false);
      return;
    }
    
    // Location was manually overridden - prompt user
    if (customerAddress) {
      setPendingCustomerForLocation(customer);
      setSelectedCustomer(customer);
      setCustomerModalOpen(false);
      setLocationUpdateConfirmOpen(true);
    } else {
      setSelectedCustomer(customer);
      setCustomerModalOpen(false);
      toast({ title: "Note", description: "Customer has no address on file." });
    }
  };

  // Handle confirmation to update location
  const handleConfirmLocationUpdate = () => {
    if (pendingCustomerForLocation?.address) {
      updateLocationFromCustomer(pendingCustomerForLocation);
    }
    setPendingCustomerForLocation(null);
    setLocationUpdateConfirmOpen(false);
  };

  // Handle keeping current location
  const handleKeepCurrentLocation = () => {
    setPendingCustomerForLocation(null);
    setLocationUpdateConfirmOpen(false);
  };

  const handleSave = () => {
    if (!selectedCustomer) {
      toast({ title: "Customer required", description: "Please select a customer before saving.", variant: "destructive" });
      return;
    }

    const customerName = `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim();
    
    // Filter and prepare line items for submission
    const validItems = lineItems.filter(item => item.name.trim());

    const jobData = {
      title: title || `Job for ${customerName}`,
      description: description || undefined,
      location: location || undefined,
      city: city || undefined,
      postalCode: postalCode || undefined,
      locationLat: locationLat,
      locationLng: locationLng,
      locationPlaceId: locationPlaceId || undefined,
      priority,
      customerId: selectedCustomer.id,
      customerName,
      scheduleDate: schedule.date || undefined,
      scheduleStartTime: schedule.startTime || undefined,
      scheduleEndTime: schedule.endTime || undefined,
      assignedEmployeeIds: assignedEmployees.length > 0 ? assignedEmployees : undefined,
      notes: notes || undefined,
      jobType: jobType || undefined,
      lineItems: validItems.length > 0 ? validItems.map(item => ({
        name: item.name.trim(),
        description: item.description?.trim() || undefined,
        taskCode: item.taskCode?.trim() || undefined,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        unit: item.unit,
        taxable: item.taxable,
      })) : undefined,
    };

    if (isEditMode) {
      updateJobMutation.mutate(jobData);
    } else {
      createJobMutation.mutate(jobData);
    }
  };

  const getEmployeesDisplayText = () => {
    if (assignedEmployees.length === 0) return undefined;
    const names = assignedEmployees.map(id => {
      const emp = allEmployees.find(e => e.id === id);
      return emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : '';
    }).filter(Boolean);
    if (names.length === 1) return names[0];
    if (names.length === 2) return names.join(' & ');
    return `${names.length} assigned`;
  };

  const toggleEmployee = (id: string) => {
    setAssignedEmployees(prev => 
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  };

  // Line item helpers
  const addLineItem = () => {
    setLineItems([...lineItems, { name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }]);
  };

  const addLineItemFromPriceBook = (item: LineItem) => {
    const existingItems = lineItems.filter(i => i.name.trim());
    setLineItems([...existingItems, item]);
  };

  const removeLineItem = (index: number) => {
    const nonEmptyItems = lineItems.filter(i => i.name.trim());
    if (nonEmptyItems.length > 1 || (nonEmptyItems.length === 1 && !lineItems[index].name.trim())) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    } else if (nonEmptyItems.length === 1) {
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

  const getLineItemsSummary = () => {
    const validItems = lineItems.filter(i => i.name.trim());
    if (validItems.length === 0) return undefined;
    const subtotal = calculateSubtotal();
    if (subtotal > 0) {
      return `${validItems.length} item${validItems.length > 1 ? 's' : ''} • ${formatCurrency(subtotal)}`;
    }
    return `${validItems.length} item${validItems.length > 1 ? 's' : ''}`;
  };

  const canSave = !!selectedCustomer;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); } onOpenChange(o); }}>
        <DialogContent className="w-full max-w-lg h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden" hideCloseButton>
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <button 
              onClick={() => { resetForm(); onOpenChange(false); }}
              className="text-sm text-blue-500 font-medium"
              data-testid="button-cancel-job"
            >
              Cancel
            </button>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {isEditMode ? 'Edit Job' : 'New Job'}
            </h3>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || createJobMutation.isPending || updateJobMutation.isPending}
              data-testid="button-save-job"
            >
              {(createJobMutation.isPending || updateJobMutation.isPending) ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <SectionHeader title="Customer" />
            <InfoRow
              icon={User}
              label="Select customer"
              value={selectedCustomer ? `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim() : undefined}
              onClick={() => setCustomerModalOpen(true)}
              required={true}
              testId="row-select-customer"
            />

            <SectionHeader title="Line Items" />
            <InfoRow
              icon={List}
              label="Add line items"
              value={getLineItemsSummary()}
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

            <SectionHeader title="Location" />
            <InfoRow
              icon={MapPin}
              label="Add job location"
              value={location || undefined}
              onClick={() => setLocationModalOpen(true)}
              testId="row-add-location"
            />

            <SectionHeader title="Job Type" />
            <InfoRow
              icon={Wrench}
              label="Choose job type"
              value={jobType || undefined}
              onClick={() => setJobTypeModalOpen(true)}
              testId="row-job-type"
            />

            <SectionHeader title="Schedule" />
            <InfoRow
              icon={Calendar}
              label="Add schedule"
              value={schedule.date ? `${schedule.date}${schedule.startTime ? ` at ${schedule.startTime}` : ''}` : undefined}
              onClick={() => setScheduleModalOpen(true)}
              testId="row-add-schedule"
            />

            <SectionHeader title="Assigned To" />
            <InfoRow
              icon={Users}
              label="Assign technicians"
              value={getEmployeesDisplayText()}
              onClick={() => setEmployeesModalOpen(true)}
              testId="row-assign-technicians"
            />

            <SectionHeader title="Notes" />
            <InfoRow
              icon={StickyNote}
              label="Add notes"
              value={notes ? notes.substring(0, 30) + (notes.length > 30 ? '...' : '') : undefined}
              onClick={() => setNotesModalOpen(true)}
              testId="row-add-notes"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* SELECT CUSTOMER Modal */}
      <Dialog open={customerModalOpen} onOpenChange={setCustomerModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <button onClick={() => setCustomerModalOpen(false)} className="text-sm text-blue-500 font-medium">
              Cancel
            </button>
            <DialogTitle className="text-base font-semibold">SELECT CUSTOMER</DialogTitle>
            <button onClick={() => setCustomerModalOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <ScrollArea className="max-h-64">
            <div className="py-2">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setAddCustomerModalOpen(true)}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="font-medium text-blue-600 dark:text-blue-400">+ Add Customer</span>
              </button>

              {customersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : customersError ? (
                <div className="text-center py-8 text-slate-500">
                  <X className="h-8 w-8 mx-auto mb-2 text-red-400" />
                  <p className="font-medium text-red-600">Failed to load customers</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => refetchCustomers()}>
                    Retry
                  </Button>
                </div>
              ) : filteredCustomers.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <User className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                  <p className="font-medium">No customers found</p>
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                      selectedCustomer?.id === customer.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    onClick={() => {
                      handleCustomerSelect(customer);
                      setCustomerSearch("");
                    }}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                      <User className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {`${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed'}
                      </p>
                      {customer.email && <p className="text-sm text-slate-500 truncate">{customer.email}</p>}
                    </div>
                    {selectedCustomer?.id === customer.id && (
                      <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ADD CUSTOMER Modal */}
      <Dialog open={addCustomerModalOpen} onOpenChange={setAddCustomerModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Add Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input
                  value={newCustomer.firstName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input
                  value={newCustomer.lastName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })}
                  placeholder="Last name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea
                value={newCustomer.address}
                onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                placeholder="Customer address"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setAddCustomerModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => {
                if (!newCustomer.firstName.trim() || !newCustomer.lastName.trim()) {
                  toast({ title: "Error", description: "First and last name are required", variant: "destructive" });
                  return;
                }
                createCustomerMutation.mutate({
                  firstName: newCustomer.firstName,
                  lastName: newCustomer.lastName,
                  email: newCustomer.email || undefined,
                  phone: newCustomer.phone || undefined,
                  address: newCustomer.address || undefined,
                });
              }}
              disabled={createCustomerMutation.isPending}
            >
              {createCustomerMutation.isPending ? 'Adding...' : 'Add Customer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* LOCATION Modal */}
      <Dialog open={locationModalOpen} onOpenChange={setLocationModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Job Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Address</Label>
              <LocationInput
                value={location}
                onChange={(val) => {
                  setLocation(val);
                  setLocationIsManualOverride(true);
                }}
                onAddressSelected={(addr) => {
                  setCity(addr.city);
                  setPostalCode(addr.postalCode);
                  setLocationPlaceId(addr.place_id);
                  setLocation(addr.formatted_address || addr.street);
                  setLocationIsManualOverride(true);
                }}
                placeholder="Start typing an address..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={city} onChange={(e) => { setCity(e.target.value); setLocationIsManualOverride(true); }} placeholder="City" />
              </div>
              <div className="space-y-2">
                <Label>ZIP/Postal Code</Label>
                <Input value={postalCode} onChange={(e) => { setPostalCode(e.target.value); setLocationIsManualOverride(true); }} placeholder="ZIP" />
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setLocationModalOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* SCHEDULE Modal */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={schedule.date}
                onChange={(e) => setSchedule({ ...schedule, date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={schedule.startTime}
                  onChange={(e) => setSchedule({ ...schedule, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={schedule.endTime}
                  onChange={(e) => setSchedule({ ...schedule, endTime: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setScheduleModalOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* EMPLOYEES Modal */}
      <Dialog open={employeesModalOpen} onOpenChange={setEmployeesModalOpen}>
        <DialogContent 
          className="w-[95vw] max-w-md p-0 gap-0" 
          hideCloseButton
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <button onClick={() => setEmployeesModalOpen(false)} className="text-sm text-blue-500 font-medium">
              Cancel
            </button>
            <DialogTitle className="text-base font-semibold">ASSIGN TECHNICIANS</DialogTitle>
            <button onClick={() => setEmployeesModalOpen(false)} className="text-sm text-blue-500 font-medium">
              Done
            </button>
          </div>

          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <ScrollArea className="max-h-64">
            <div className="py-2">
              {employeesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Users className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                  <p className="font-medium">No team members found</p>
                </div>
              ) : (
                filteredEmployees.map((employee) => (
                  <button
                    key={employee.id}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                      assignedEmployees.includes(employee.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    onClick={() => toggleEmployee(employee.id)}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                      <User className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {`${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Unnamed'}
                      </p>
                      <p className="text-xs text-slate-500 capitalize">{employee.role?.toLowerCase()}</p>
                    </div>
                    {assignedEmployees.includes(employee.id) && (
                      <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* NOTES Modal */}
      <Dialog open={notesModalOpen} onOpenChange={setNotesModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Job Notes</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Add notes about this job..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setNotesModalOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* JOB TYPE Picker Modal */}
      <Dialog open={jobTypeModalOpen} onOpenChange={setJobTypeModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0">
          <div className="flex items-center px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setJobTypeModalOpen(false)}
              className="text-sm text-blue-500 font-medium"
            >
              Cancel
            </button>
            <DialogTitle className="flex-1 text-center text-base font-semibold">
              JOB TYPE
            </DialogTitle>
            <div className="w-12" />
          </div>

          <ScrollArea className="max-h-[60vh]">
            <div className="py-2">
              {JOB_TYPES.map((type) => (
                <button
                  key={type}
                  className="w-full flex items-center justify-between px-4 py-3 text-left border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => {
                    setJobType(type);
                    setJobTypeModalOpen(false);
                  }}
                >
                  <span className="text-slate-900 dark:text-slate-100">{type}</span>
                  {jobType === type && (
                    <Check className="h-5 w-5 text-blue-500" />
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* LINE ITEMS Modal */}
      <Dialog open={lineItemsModalOpen} onOpenChange={setLineItemsModalOpen}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Line Items</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
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
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Input
                  placeholder="Name *"
                  value={item.name}
                  onChange={(e) => updateLineItem(index, 'name', e.target.value)}
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
                variant="outline"
                onClick={() => {
                  setLineItemsModalOpen(false);
                  setPriceBookPickerOpen(true);
                }}
                className="flex-1"
              >
                <Plus className="h-4 w-4 mr-2" />
                From Price Book
              </Button>
              <Button
                variant="outline"
                onClick={addLineItem}
                className="flex-1"
              >
                <Plus className="h-4 w-4 mr-2" />
                Custom Item
              </Button>
            </div>

            <div className="pt-4 border-t">
              <div className="flex justify-between text-base font-semibold">
                <span>Subtotal</span>
                <span>{formatCurrency(calculateSubtotal())}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button onClick={() => setLineItemsModalOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* PRICE BOOK PICKER Modal */}
      <PriceBookPickerModal
        open={priceBookPickerOpen}
        onOpenChange={setPriceBookPickerOpen}
        onAddItem={addLineItemFromPriceBook}
        existingItems={lineItems}
      />

      {/* LOCATION UPDATE CONFIRMATION Dialog */}
      <AlertDialog open={locationUpdateConfirmOpen} onOpenChange={setLocationUpdateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Job Location?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to update the job location to match this customer's address?
              {pendingCustomerForLocation?.address && (
                <span className="block mt-2 font-medium text-slate-700 dark:text-slate-300">
                  {pendingCustomerForLocation.address}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleKeepCurrentLocation}>Keep Current</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLocationUpdate}>Update</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
