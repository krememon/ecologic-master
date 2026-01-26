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
  Plus, Search, X, StickyNote, Wrench, Check, List, Trash2, DollarSign, Percent, Loader2
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import LocationInput from "@/components/LocationInput";
import { PriceBookPickerModal } from "./PriceBookPickerModal";
import { TimeWheelPicker } from "./TimeWheelPicker";
import { SelectCustomerModal } from "./CustomerModals";
import type { Customer } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";
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
  taxId: number | null;
  taxRatePercentSnapshot: string | null;
  taxNameSnapshot: string | null;
  saveToPriceBook: boolean;
}

interface CompanyTax {
  id: number;
  companyId: number;
  name: string;
  ratePercent: string;
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
  const [locationState, setLocationState] = useState("");
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
    { name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, taxId: null, taxRatePercentSnapshot: null, taxNameSnapshot: null, saveToPriceBook: false }
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

  // Fetch company taxes
  const { data: companyTaxes = [] } = useQuery<CompanyTax[]>({
    queryKey: ['/api/company/taxes'],
  });

  // Tax picker modal state
  const [taxPickerOpen, setTaxPickerOpen] = useState(false);
  const [taxPickerLineItemIndex, setTaxPickerLineItemIndex] = useState<number | null>(null);
  const [taxPickerShowCreate, setTaxPickerShowCreate] = useState(false);
  const [newTaxName, setNewTaxName] = useState("");
  const [newTaxRate, setNewTaxRate] = useState("");
  const [newTaxError, setNewTaxError] = useState<string | null>(null);

  // Create tax mutation
  const createTaxMutation = useMutation({
    mutationFn: async (data: { name: string; ratePercent: string }) => {
      const res = await apiRequest('POST', '/api/company/taxes', data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create tax');
      }
      return res.json();
    },
    onSuccess: (createdTax: CompanyTax) => {
      queryClient.invalidateQueries({ queryKey: ['/api/company/taxes'] });
      if (taxPickerLineItemIndex !== null) {
        setLineItemTax(taxPickerLineItemIndex, createdTax);
      }
      setNewTaxName("");
      setNewTaxRate("");
      setNewTaxError(null);
      setTaxPickerShowCreate(false);
    },
    onError: (err: Error) => {
      setNewTaxError(err.message);
    },
  });

  const handleCreateTax = () => {
    setNewTaxError(null);
    const trimmedName = newTaxName.trim();
    if (!trimmedName) {
      setNewTaxError("Tax name is required");
      return;
    }
    if (trimmedName.length < 2 || trimmedName.length > 40) {
      setNewTaxError("Tax name must be 2-40 characters");
      return;
    }
    const rate = parseFloat(newTaxRate);
    if (isNaN(rate)) {
      setNewTaxError("Please enter a valid percentage");
      return;
    }
    if (rate < 0 || rate > 20) {
      setNewTaxError("Rate must be between 0 and 20");
      return;
    }
    createTaxMutation.mutate({ name: trimmedName, ratePercent: rate.toString() });
  };

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
          taxId: item.taxId || null,
          taxRatePercentSnapshot: item.taxRatePercentSnapshot || null,
          taxNameSnapshot: item.taxNameSnapshot || null,
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

  // Helper to save line items to price book (after job save succeeds)
  const saveToPriceBook = async (items: LineItem[]) => {
    const itemsToSave = items.filter(item => item.saveToPriceBook && item.name.trim());
    for (const item of itemsToSave) {
      try {
        await apiRequest('POST', '/api/service-catalog/save-from-line-item', {
          name: item.name.trim(),
          description: item.description?.trim() || null,
          defaultPriceCents: item.unitPriceCents,
          unit: item.unit,
          taskCode: item.taskCode?.trim() || null,
          taxable: item.taxable,
        });
      } catch (error) {
        // Silently fail - the job was already saved successfully
        console.error('Failed to save item to price book:', error);
      }
    }
    // Refresh price book list
    if (itemsToSave.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
    }
  };

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
    onSuccess: async (newJob) => {
      // Save any line items with saveToPriceBook=true to the price book
      await saveToPriceBook(lineItems);
      
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      // Invalidate payments queries (auto-invoice creates invoice when job has line items)
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payments/breakdown'] });
      // Invalidate the customer's jobs list so it appears immediately on their detail page
      if (newJob.customerId) {
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${newJob.customerId}/jobs`] });
      }
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
      // No success toast per user preference - visual feedback via UI update
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
    onSuccess: async (updatedJob) => {
      // Save any line items with saveToPriceBook=true to the price book
      await saveToPriceBook(lineItems);
      
      const jobIdStr = String(initialJob?.id);
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobIdStr] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${initialJob?.id}`] });
      // Invalidate crew assignments query so the JobDetails page shows updated assignments
      // JobDetails uses string jobId from router, so use string for cache key match
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobIdStr, 'crew'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', initialJob?.id, 'crew'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      // Invalidate payments queries (invoice may be created/updated when job has line items)
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payments/breakdown'] });
      // Invalidate customer jobs for both old and new customer if changed
      if (updatedJob.customerId) {
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${updatedJob.customerId}/jobs`] });
      }
      if (initialJob?.customerId && initialJob.customerId !== updatedJob.customerId) {
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${initialJob.customerId}/jobs`] });
      }
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
      // No success toast per user preference - visual feedback via UI update
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
    setLineItems([{ name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, taxId: null, taxRatePercentSnapshot: null, taxNameSnapshot: null, saveToPriceBook: false }]);
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

    // Validate: if any line item has saveToPriceBook=true, it must have a name
    const itemsToSaveToPriceBook = lineItems.filter(item => item.saveToPriceBook);
    const invalidPriceBookItem = itemsToSaveToPriceBook.find(item => !item.name.trim());
    if (invalidPriceBookItem) {
      toast({ title: "Name required", description: "Name is required to save to Price Book", variant: "destructive" });
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
      assignedEmployeeIds: isEditMode ? assignedEmployees : (assignedEmployees.length > 0 ? assignedEmployees : undefined),
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
        taxId: item.taxable && item.taxId ? item.taxId : undefined,
        taxRatePercentSnapshot: item.taxable && item.taxRatePercentSnapshot ? item.taxRatePercentSnapshot : undefined,
        taxNameSnapshot: item.taxable && item.taxNameSnapshot ? item.taxNameSnapshot : undefined,
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
    setLineItems([...lineItems, { name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, taxId: null, taxRatePercentSnapshot: null, taxNameSnapshot: null, saveToPriceBook: false }]);
  };

  const addLineItemFromPriceBook = (item: LineItem) => {
    setLineItems(prev => [...prev.filter(i => i.name.trim()), item]);
  };

  const removeLineItem = (index: number) => {
    const nonEmptyItems = lineItems.filter(i => i.name.trim());
    if (nonEmptyItems.length > 1 || (nonEmptyItems.length === 1 && !lineItems[index].name.trim())) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    } else if (nonEmptyItems.length === 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number | boolean | null) => {
    const updated = [...lineItems];
    if (field === 'unitPriceCents') {
      updated[index][field] = typeof value === 'number' ? value : Math.round(parseFloat(String(value)) * 100) || 0;
    } else if (field === 'taxable') {
      updated[index][field] = value as boolean;
      // Clear tax selection when taxable is turned off
      if (!value) {
        updated[index].taxId = null;
        updated[index].taxRatePercentSnapshot = null;
        updated[index].taxNameSnapshot = null;
      }
    } else if (field === 'saveToPriceBook') {
      updated[index][field] = value as boolean;
    } else if (field === 'taxId') {
      updated[index][field] = value as number | null;
    } else if (field === 'taxRatePercentSnapshot' || field === 'taxNameSnapshot') {
      updated[index][field] = value as string | null;
    } else {
      updated[index][field] = value as string;
    }
    setLineItems(updated);
  };

  const setLineItemTax = (index: number, tax: CompanyTax) => {
    const updated = [...lineItems];
    updated[index].taxId = tax.id;
    updated[index].taxRatePercentSnapshot = tax.ratePercent;
    updated[index].taxNameSnapshot = tax.name;
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

  const calculateLineSubtotal = (item: LineItem): number => {
    const qty = parseFloat(item.quantity) || 0;
    return Math.round(qty * item.unitPriceCents);
  };

  const calculateLineTax = (item: LineItem): number => {
    if (!item.taxable || !item.taxRatePercentSnapshot) return 0;
    const subtotal = calculateLineSubtotal(item);
    const taxRate = parseFloat(item.taxRatePercentSnapshot) || 0;
    return Math.round(subtotal * taxRate / 100);
  };

  const calculateLineTotal = (item: LineItem): number => {
    return calculateLineSubtotal(item) + calculateLineTax(item);
  };

  const calculateSubtotal = (): number => {
    return lineItems.reduce((sum, item) => sum + calculateLineSubtotal(item), 0);
  };

  const calculateTotalTax = (): number => {
    return lineItems.reduce((sum, item) => sum + calculateLineTax(item), 0);
  };

  const calculateGrandTotal = (): number => {
    return calculateSubtotal() + calculateTotalTax();
  };

  const getLineItemsSummary = () => {
    const validItems = lineItems.filter(i => i.name.trim());
    if (validItems.length === 0) return undefined;
    const grandTotal = calculateGrandTotal();
    if (grandTotal > 0) {
      return `${validItems.length} item${validItems.length > 1 ? 's' : ''} • ${formatCurrency(grandTotal)}`;
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
              value={schedule.date ? formatScheduleDisplay(schedule.date, schedule.startTime) : undefined}
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
      <SelectCustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        onSelectCustomer={(customer) => {
          handleCustomerSelect(customer);
        }}
        canCreateCustomer={true}
      />

      {/* LOCATION Modal */}
      <Dialog open={locationModalOpen} onOpenChange={setLocationModalOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <DialogHeader className="p-0">
              <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Job Location</DialogTitle>
            </DialogHeader>
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <Label>Street Address</Label>
              <LocationInput
                value={location}
                onChange={(val) => {
                  setLocation(val);
                  setLocationIsManualOverride(true);
                }}
                onAddressSelected={(addr) => {
                  setCity(addr.city);
                  setLocationState(addr.state);
                  setPostalCode(addr.postalCode);
                  setLocationPlaceId(addr.place_id);
                  setLocation(addr.formatted_address || addr.street);
                  setLocationIsManualOverride(true);
                }}
                placeholder="Street Address"
              />
            </div>
            <div className="space-y-1">
              <Label>City</Label>
              <Input value={city} onChange={(e) => { setCity(e.target.value); setLocationIsManualOverride(true); }} placeholder="City" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>State</Label>
                <Input value={locationState} onChange={(e) => { setLocationState(e.target.value); setLocationIsManualOverride(true); }} placeholder="State" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label>ZIP Code</Label>
                <Input value={postalCode} onChange={(e) => { setPostalCode(e.target.value); setLocationIsManualOverride(true); }} placeholder="ZIP Code" className="h-9" />
              </div>
            </div>
          </div>
          <div className="flex justify-end px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <Button onClick={() => setLocationModalOpen(false)} className="h-10 rounded-xl">Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* SCHEDULE Modal */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
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
              <Label>Date</Label>
              <Input
                type="date"
                value={schedule.date}
                onChange={(e) => setSchedule({ ...schedule, date: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Time</Label>
                <TimeWheelPicker
                  value={schedule.startTime}
                  onChange={(time) => setSchedule({ ...schedule, startTime: time })}
                  label="Start Time"
                />
              </div>
              <div className="space-y-1">
                <Label>End Time</Label>
                <TimeWheelPicker
                  value={schedule.endTime}
                  onChange={(time) => setSchedule({ ...schedule, endTime: time })}
                  label="End Time"
                />
              </div>
            </div>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <Button onClick={() => setScheduleModalOpen(false)} className="w-full h-10 rounded-xl">Done</Button>
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
        <DialogContent hideCloseButton className="w-[95vw] max-w-md">
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
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Job Type
            </DialogTitle>
            <button
              onClick={() => setJobTypeModalOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <ScrollArea className="max-h-[60vh]">
            <div className="py-1 bg-white dark:bg-slate-900">
              {JOB_TYPES.map((type, index) => (
                <div key={type}>
                  <button
                    className={`w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors ${
                      jobType === type
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                    }`}
                    onClick={() => {
                      setJobType(type);
                      setJobTypeModalOpen(false);
                    }}
                  >
                    <span className="font-medium text-slate-900 dark:text-slate-100">{type}</span>
                    {jobType === type && (
                      <Check className="h-5 w-5 text-blue-500" />
                    )}
                  </button>
                  {index < JOB_TYPES.length - 1 && (
                    <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
                  )}
                </div>
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
                {item.taxable && (
                  <button
                    type="button"
                    onClick={() => {
                      setTaxPickerLineItemIndex(index);
                      setTaxPickerOpen(true);
                    }}
                    className="w-full flex items-center justify-between py-2 px-1 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md transition-colors"
                  >
                    <span className="text-sm text-slate-600 dark:text-slate-400">Tax rate</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {item.taxNameSnapshot 
                          ? `${item.taxNameSnapshot} (${parseFloat(item.taxRatePercentSnapshot || '0').toFixed(3)}%)`
                          : 'Select tax rate'}
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </div>
                  </button>
                )}
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
                <div className="pt-2 border-t space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Subtotal</span>
                    <span className="text-sm">{formatCurrency(calculateLineSubtotal(item))}</span>
                  </div>
                  {item.taxable && item.taxRatePercentSnapshot && calculateLineTax(item) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        Tax ({parseFloat(item.taxRatePercentSnapshot).toFixed(3)}%)
                      </span>
                      <span className="text-sm">{formatCurrency(calculateLineTax(item))}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Total</span>
                    <span className="text-base font-semibold">{formatCurrency(calculateLineTotal(item))}</span>
                  </div>
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
                Add New
              </Button>
            </div>

            <div className="pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                <span>{formatCurrency(calculateSubtotal())}</span>
              </div>
              {calculateTotalTax() > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Tax</span>
                  <span>{formatCurrency(calculateTotalTax())}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold pt-1 border-t">
                <span>Total</span>
                <span>{formatCurrency(calculateGrandTotal())}</span>
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

      {/* TAX PICKER Modal - Full Screen */}
      <Dialog open={taxPickerOpen} onOpenChange={(open) => {
        setTaxPickerOpen(open);
        if (!open) {
          setTaxPickerShowCreate(false);
          setNewTaxName("");
          setNewTaxRate("");
          setNewTaxError(null);
        }
      }}>
        <DialogContent hideCloseButton className="w-full h-full max-w-none max-h-none md:max-w-[640px] md:max-h-[85vh] md:h-auto rounded-none md:rounded-xl flex flex-col p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                if (taxPickerShowCreate) {
                  setTaxPickerShowCreate(false);
                  setNewTaxName("");
                  setNewTaxRate("");
                  setNewTaxError(null);
                } else {
                  setTaxPickerOpen(false);
                  setTaxPickerLineItemIndex(null);
                }
              }}
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              {taxPickerShowCreate ? "Back" : "Cancel"}
            </button>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {taxPickerShowCreate ? "New Tax" : "Tax rates"}
            </h2>
            {!taxPickerShowCreate ? (
              <button
                type="button"
                onClick={() => setTaxPickerShowCreate(true)}
                className="p-1 text-teal-600 hover:text-teal-700"
              >
                <Plus className="h-5 w-5" />
              </button>
            ) : (
              <div className="w-6" />
            )}
          </div>

          {taxPickerShowCreate ? (
            <div className="flex-1 overflow-auto p-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="newTaxName">Tax Name</Label>
                  <Input
                    id="newTaxName"
                    value={newTaxName}
                    onChange={(e) => setNewTaxName(e.target.value)}
                    placeholder="e.g., NY State Tax"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="newTaxRate">Percentage</Label>
                  <div className="relative mt-1">
                    <Input
                      id="newTaxRate"
                      type="number"
                      step="0.001"
                      min="0"
                      max="20"
                      value={newTaxRate}
                      onChange={(e) => setNewTaxRate(e.target.value)}
                      placeholder="8.625"
                      className="pr-8"
                    />
                    <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>
                {newTaxError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{newTaxError}</p>
                )}
                <Button
                  type="button"
                  onClick={handleCreateTax}
                  disabled={createTaxMutation.isPending}
                  className="w-full bg-teal-600 hover:bg-teal-700"
                >
                  {createTaxMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-2">
                {companyTaxes.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <Percent className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
                    <p className="text-sm font-medium">No tax rates yet</p>
                    <p className="text-xs mt-1">Tap + to create your first tax rate</p>
                  </div>
                ) : (
                  companyTaxes.map((tax) => {
                    const isSelected = taxPickerLineItemIndex !== null && 
                      lineItems[taxPickerLineItemIndex]?.taxId === tax.id;
                    return (
                      <button
                        key={tax.id}
                        type="button"
                        onClick={() => {
                          if (taxPickerLineItemIndex !== null) {
                            setLineItemTax(taxPickerLineItemIndex, tax);
                            setTaxPickerOpen(false);
                            setTaxPickerLineItemIndex(null);
                          }
                        }}
                        className="w-full flex items-center justify-between py-3.5 px-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <div className="text-left">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{tax.name}</span>
                          <span className="text-sm text-slate-500 dark:text-slate-400 ml-2">({parseFloat(tax.ratePercent).toFixed(3)}%)</span>
                        </div>
                        {isSelected && (
                          <Check className="h-5 w-5 text-teal-600" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
