import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  User, List, Calendar, Users, SlidersHorizontal, Tag, ChevronRight, 
  Plus, Trash2, Search, X, ArrowLeft, Check, DollarSign
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PriceBookPickerModal } from "./PriceBookPickerModal";
import type { Customer } from "@shared/schema";

interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
  profileImageUrl?: string | null;
}

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

interface NewEstimateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEstimateCreated?: () => void;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

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
  testId
}: { 
  icon: React.ElementType; 
  label: string; 
  value?: string; 
  onClick?: () => void;
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
      <span className="flex-1 text-slate-900 dark:text-slate-100 text-sm">
        {value || label}
      </span>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </button>
  );
}

export function NewEstimateSheet({ open, onOpenChange, onEstimateCreated }: NewEstimateSheetProps) {
  const { toast } = useToast();

  // Form state
  const [notes, setNotes] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
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
  const [jobType, setJobType] = useState<string | null>(null);

  // Modal states
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [lineItemsModalOpen, setLineItemsModalOpen] = useState(false);
  const [priceBookPickerOpen, setPriceBookPickerOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [employeesModalOpen, setEmployeesModalOpen] = useState(false);
  const [jobTypeModalOpen, setJobTypeModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);

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

  // Create customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (customerData: { firstName: string; lastName: string; email?: string; phone?: string; address?: string }) => {
      const response = await apiRequest('POST', '/api/customers', customerData);
      return response.json();
    },
    onSuccess: (newCustomer: Customer) => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      setSelectedCustomer(newCustomer);
      setAddCustomerModalOpen(false);
      setCustomerModalOpen(false);
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
      toast({ title: "Customer added", description: "Customer has been created successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create customer.", variant: "destructive" });
    }
  });

  // Create estimate mutation - uses standalone /api/estimates endpoint
  const createEstimateMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      notes?: string;
      customerId?: number;
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      customerAddress?: string;
      taxCents: number;
      assignedEmployeeIds: string[];
      jobType?: string;
      items: { name: string; quantity: string; unitPriceCents: number }[];
    }) => {
      const response = await apiRequest('POST', '/api/estimates', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      resetForm();
      onOpenChange(false);
      toast({ title: "Estimate created", description: "Your estimate has been saved successfully." });
      onEstimateCreated?.();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create estimate.", 
        variant: "destructive" 
      });
    }
  });

  // Filter customers by search using useMemo
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return apiCustomers;
    
    const searchLower = customerSearch.toLowerCase().trim();
    const searchDigits = customerSearch.replace(/\D/g, '');
    
    return apiCustomers.filter((c) => {
      const firstName = (c.firstName || '').toLowerCase();
      const lastName = (c.lastName || '').toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = (c.email || '').toLowerCase();
      const phoneDigits = (c.phone || '').replace(/\D/g, '');
      
      return firstName.includes(searchLower) ||
             lastName.includes(searchLower) ||
             fullName.includes(searchLower) ||
             email.includes(searchLower) ||
             (searchDigits && phoneDigits.includes(searchDigits));
    });
  }, [apiCustomers, customerSearch]);

  // Filter employees by search
  const filteredEmployees = useMemo(() => {
    if (!employeeSearch.trim()) return allEmployees;
    
    const searchLower = employeeSearch.toLowerCase().trim();
    
    return allEmployees.filter((emp) => {
      const firstName = (emp.firstName || '').toLowerCase();
      const lastName = (emp.lastName || '').toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = (emp.email || '').toLowerCase();
      const role = (emp.role || '').toLowerCase();
      
      return firstName.includes(searchLower) ||
             lastName.includes(searchLower) ||
             fullName.includes(searchLower) ||
             email.includes(searchLower) ||
             role.includes(searchLower);
    });
  }, [allEmployees, employeeSearch]);

  // Helper to format employee name
  const formatEmployeeName = (employee: Employee) => {
    return `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Unnamed';
  };

  // Get display text for selected employees
  const getEmployeesDisplayText = () => {
    if (assignedEmployees.length === 0) return undefined;
    const selectedEmps = allEmployees.filter(emp => assignedEmployees.includes(emp.id));
    if (selectedEmps.length === 0) return `${assignedEmployees.length} selected`;
    if (selectedEmps.length === 1) return formatEmployeeName(selectedEmps[0]);
    if (selectedEmps.length === 2) {
      return selectedEmps.map(e => e.firstName || 'Unknown').join(', ');
    }
    const first = selectedEmps[0].firstName || 'Unknown';
    return `${first} +${selectedEmps.length - 1}`;
  };

  const resetForm = () => {
    setNotes("");
    setSelectedCustomer(null);
    setLineItems([{ name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }]);
    setSchedule({ date: "", time: "" });
    setAssignedEmployees([]);
    setEstimateFields({ showSubtotal: true, showTax: true, taxRate: "0", validDays: "30" });
    setTags([]);
    setNewTagInput("");
    setJobType(null);
  };

  const handleSave = async () => {
    // Validation
    const validItems = lineItems.filter(item => item.name.trim());
    if (validItems.length === 0) {
      toast({ title: "Missing items", description: "Please add at least one line item.", variant: "destructive" });
      return;
    }

    // Save items to price book if requested
    const itemsToSave = validItems.filter(item => item.saveToPriceBook);
    for (const item of itemsToSave) {
      try {
        await apiRequest('POST', '/api/service-catalog', {
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

    // Create estimate via standalone API (no job required)
    const taxRate = parseFloat(estimateFields.taxRate) || 0;
    const subtotal = calculateSubtotal();
    const taxCents = Math.round(subtotal * (taxRate / 100));

    createEstimateMutation.mutate({
      title: autoTitle,
      notes: notes || undefined,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer ? `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim() : undefined,
      customerEmail: selectedCustomer?.email || undefined,
      customerPhone: selectedCustomer?.phone || undefined,
      customerAddress: selectedCustomer?.address || undefined,
      taxCents,
      assignedEmployeeIds: assignedEmployees,
      jobType: jobType || undefined,
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

  // Line item helpers
  const addLineItem = () => {
    setLineItems([...lineItems, { name: "", description: "", taskCode: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, saveToPriceBook: false }]);
  };

  const addLineItemFromPriceBook = (item: LineItem) => {
    // Filter out empty placeholder items and add the new item
    const existingItems = lineItems.filter(i => i.name.trim());
    setLineItems([...existingItems, item]);
  };

  const removeLineItem = (index: number) => {
    const nonEmptyItems = lineItems.filter(i => i.name.trim());
    if (nonEmptyItems.length > 1 || (nonEmptyItems.length === 1 && !lineItems[index].name.trim())) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    } else if (nonEmptyItems.length === 1) {
      // Keep at least one item but allow removing
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

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); } onOpenChange(o); }}>
        <DialogContent className="w-full max-w-lg h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <button 
              onClick={() => { resetForm(); onOpenChange(false); }}
              className="text-sm text-blue-500 font-medium"
              data-testid="button-cancel-create"
            >
              Cancel
            </button>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">New Estimate</h3>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={createEstimateMutation.isPending}
              data-testid="button-save-estimate"
            >
              {createEstimateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <SectionHeader title="Customer Info" />
            <InfoRow
              icon={User}
              label="Add customer"
              value={selectedCustomer ? `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim() : undefined}
              onClick={() => setCustomerModalOpen(true)}
              testId="row-add-customer"
            />

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

            <SectionHeader title="Schedule" />
            <InfoRow
              icon={Calendar}
              label="Add schedule"
              value={schedule.date ? `${schedule.date}${schedule.time ? ` at ${schedule.time}` : ''}` : undefined}
              onClick={() => setScheduleModalOpen(true)}
              testId="row-add-schedule"
            />

            <SectionHeader title="Dispatch To" />
            <InfoRow
              icon={Users}
              label="My employees"
              value={getEmployeesDisplayText()}
              onClick={() => setEmployeesModalOpen(true)}
              testId="row-my-employees"
            />

            <SectionHeader title="Job Type" />
            <InfoRow
              icon={SlidersHorizontal}
              label="Choose job type"
              value={jobType || undefined}
              onClick={() => setJobTypeModalOpen(true)}
              testId="row-job-type"
            />

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
      <Dialog open={customerModalOpen} onOpenChange={setCustomerModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <button 
              onClick={() => setCustomerModalOpen(false)}
              className="text-sm text-blue-500 font-medium"
              data-testid="button-cancel-customer"
            >
              Cancel
            </button>
            <DialogTitle className="text-base font-semibold">SELECT CUSTOMER</DialogTitle>
            <button 
              onClick={() => setCustomerModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
              data-testid="button-close-customer"
            >
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
                data-testid="input-search-customers"
              />
            </div>
          </div>

          <ScrollArea className="max-h-64">
            <div className="py-2">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => {
                  setAddCustomerModalOpen(true);
                }}
                data-testid="button-add-new-customer"
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
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2"
                    onClick={() => refetchCustomers()}
                  >
                    Retry
                  </Button>
                </div>
              ) : apiCustomers.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <User className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                  <p className="font-medium">No customers yet</p>
                  <p className="text-sm">Add your first customer above</p>
                </div>
              ) : filteredCustomers.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Search className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                  <p className="font-medium">No results found</p>
                  <p className="text-sm">Try a different search</p>
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                      selectedCustomer?.id === customer.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setCustomerModalOpen(false);
                      setCustomerSearch("");
                    }}
                    data-testid={`button-select-customer-${customer.id}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                      <User className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {`${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed'}
                      </p>
                      {customer.email && (
                        <p className="text-sm text-slate-500 truncate">{customer.email}</p>
                      )}
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

          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={newCustomer.firstName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={newCustomer.lastName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={newCustomer.address}
                onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                placeholder="123 Main St"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCustomerModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                createCustomerMutation.mutate({
                  firstName: newCustomer.firstName,
                  lastName: newCustomer.lastName,
                  email: newCustomer.email || undefined,
                  phone: newCustomer.phone || undefined,
                  address: newCustomer.address || undefined
                });
              }}
              disabled={!newCustomer.firstName || !newCustomer.lastName || createCustomerMutation.isPending}
            >
              {createCustomerMutation.isPending ? 'Adding...' : 'Add Customer'}
            </Button>
          </DialogFooter>
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

          <DialogFooter>
            <Button onClick={() => setLineItemsModalOpen(false)}>
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
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="scheduleDate">Date</Label>
              <Input
                id="scheduleDate"
                type="date"
                value={schedule.date}
                onChange={(e) => setSchedule({ ...schedule, date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduleTime">Time</Label>
              <Input
                id="scheduleTime"
                type="time"
                value={schedule.time}
                onChange={(e) => setSchedule({ ...schedule, time: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setScheduleModalOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EMPLOYEES Modal */}
      <Dialog open={employeesModalOpen} onOpenChange={(open) => {
        setEmployeesModalOpen(open);
        if (!open) setEmployeeSearch("");
      }}>
        <DialogContent className="w-[95vw] max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Assign Employees</DialogTitle>
          </DialogHeader>

          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search employees..."
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <ScrollArea className="flex-1 min-h-0 max-h-[50vh]">
            {employeesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                {employeeSearch ? 'No employees match your search' : 'No employees found'}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredEmployees.map((employee) => {
                  const isSelected = assignedEmployees.includes(employee.id);
                  return (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setAssignedEmployees(assignedEmployees.filter(id => id !== employee.id));
                        } else {
                          setAssignedEmployees([...assignedEmployees, employee.id]);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {}}
                        className="pointer-events-none"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {formatEmployeeName(employee)}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {employee.email || employee.role}
                        </div>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {employee.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="pt-2 border-t">
            <div className="flex justify-between items-center w-full">
              <span className="text-sm text-slate-500">
                {assignedEmployees.length} selected
              </span>
              <Button onClick={() => {
                setEmployeesModalOpen(false);
                setEmployeeSearch("");
              }}>
                Save
              </Button>
            </div>
          </DialogFooter>
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
                    <Check className="h-5 w-5 text-blue-500" />
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
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

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
              />
              <Button
                type="button"
                variant="outline"
                onClick={addTag}
                disabled={!newTagInput.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setTagsModalOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
