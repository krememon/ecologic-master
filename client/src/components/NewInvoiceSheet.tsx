import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  User, Calendar, ChevronRight, 
  Plus, Search, X, Tag, List, Trash2, DollarSign, Percent, Loader2, Check
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TimeWheelPicker } from "./TimeWheelPicker";
import { PriceBookPickerModal } from "./PriceBookPickerModal";
import type { Customer } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";

interface LineItem {
  name: string;
  description: string;
  quantity: string;
  unitPriceCents: number;
  priceDisplay: string;
  unit: string;
  taxable: boolean;
  taxId: number | null;
  taxRatePercentSnapshot: string | null;
  taxNameSnapshot: string | null;
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

interface NewInvoiceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvoiceCreated?: (invoice: any) => void;
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
  required = false,
}: { 
  icon: React.ElementType; 
  label: string; 
  value?: string; 
  onClick?: () => void;
  required?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
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

export function NewInvoiceSheet({ open, onOpenChange, onInvoiceCreated }: NewInvoiceSheetProps) {
  const { toast } = useToast();

  // Form state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [scheduledAt, setScheduledAt] = useState<{ date: string; time: string }>({ date: "", time: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { name: "", description: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, taxId: null, taxRatePercentSnapshot: null, taxNameSnapshot: null }
  ]);

  // Modal states
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [lineItemsModalOpen, setLineItemsModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [priceBookPickerOpen, setPriceBookPickerOpen] = useState(false);
  const [taxPickerOpen, setTaxPickerOpen] = useState(false);
  const [taxPickerLineItemIndex, setTaxPickerLineItemIndex] = useState<number | null>(null);
  const [taxPickerShowCreate, setTaxPickerShowCreate] = useState(false);
  const [newTaxName, setNewTaxName] = useState("");
  const [newTaxRate, setNewTaxRate] = useState("");
  const [newTaxError, setNewTaxError] = useState<string | null>(null);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");

  // Tag input
  const [tagInput, setTagInput] = useState("");

  // New customer form
  const [newCustomer, setNewCustomer] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: ""
  });

  // Fetch customers
  const { data: apiCustomers = [], isLoading: customersLoading, refetch: refetchCustomers } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
  });

  // Fetch company taxes
  const { data: companyTaxes = [] } = useQuery<CompanyTax[]>({
    queryKey: ['/api/company/taxes'],
  });

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return apiCustomers;
    const search = customerSearch.toLowerCase();
    return apiCustomers.filter((c) => 
      (c.firstName?.toLowerCase().includes(search)) ||
      (c.lastName?.toLowerCase().includes(search)) ||
      (c.email?.toLowerCase().includes(search))
    );
  }, [apiCustomers, customerSearch]);

  // Calculate totals
  const { subtotalCents, taxCents, totalCents } = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    
    lineItems.forEach((item) => {
      const qty = parseFloat(item.quantity) || 0;
      const lineTotal = item.unitPriceCents * qty;
      subtotal += lineTotal;
      
      if (item.taxable && item.taxRatePercentSnapshot) {
        const taxRate = parseFloat(item.taxRatePercentSnapshot) / 100;
        tax += Math.round(lineTotal * taxRate);
      }
    });
    
    return {
      subtotalCents: Math.round(subtotal),
      taxCents: Math.round(tax),
      totalCents: Math.round(subtotal + tax),
    };
  }, [lineItems]);

  // Valid line items (non-empty)
  const validLineItems = lineItems.filter(item => item.name.trim() && item.unitPriceCents > 0);
  const hasValidLineItems = validLineItems.length > 0;
  const isFormValid = selectedCustomer && hasValidLineItems;

  // Create customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/customers', data);
      if (!res.ok) throw new Error('Failed to create customer');
      return res.json();
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      setSelectedCustomer(customer);
      setAddCustomerModalOpen(false);
      setCustomerModalOpen(false);
      setNewCustomer({ firstName: "", lastName: "", email: "", phone: "", address: "" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create invoice mutation
  const createInvoiceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/invoices', data);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Failed to create invoice');
      }
      return res.json();
    },
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      toast({
        title: "Invoice Created",
        description: "Your invoice has been saved",
      });
      onInvoiceCreated?.(invoice);
      resetForm();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create tax mutation
  const createTaxMutation = useMutation({
    mutationFn: async (data: { name: string; ratePercent: string }) => {
      const res = await apiRequest('POST', '/api/company/taxes', data);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create tax');
      }
      return res.json();
    },
    onSuccess: (newTax) => {
      queryClient.invalidateQueries({ queryKey: ['/api/company/taxes'] });
      setNewTaxName("");
      setNewTaxRate("");
      setNewTaxError(null);
      setTaxPickerShowCreate(false);
      // Auto-select the newly created tax
      if (taxPickerLineItemIndex !== null) {
        setLineItemTax(taxPickerLineItemIndex, newTax);
        setTaxPickerOpen(false);
        setTaxPickerLineItemIndex(null);
      }
    },
    onError: (error: Error) => {
      setNewTaxError(error.message);
    },
  });

  const handleCreateTax = () => {
    setNewTaxError(null);
    if (!newTaxName.trim()) {
      setNewTaxError("Tax name is required");
      return;
    }
    const rate = parseFloat(newTaxRate);
    if (isNaN(rate) || rate < 0 || rate > 20) {
      setNewTaxError("Rate must be between 0 and 20%");
      return;
    }
    createTaxMutation.mutate({ name: newTaxName.trim(), ratePercent: rate.toFixed(3) });
  };

  const resetForm = () => {
    setSelectedCustomer(null);
    setScheduledAt({ date: "", time: "" });
    setTags([]);
    setLineItems([
      { name: "", description: "", quantity: "1", unitPriceCents: 0, priceDisplay: "", unit: "each", taxable: false, taxId: null, taxRatePercentSnapshot: null, taxNameSnapshot: null }
    ]);
    setCustomerSearch("");
    setTagInput("");
    setTaxPickerShowCreate(false);
    setNewTaxName("");
    setNewTaxRate("");
    setNewTaxError(null);
  };

  const handleSubmit = () => {
    if (!isFormValid) return;

    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);

    let scheduledAtISO: string | null = null;
    if (scheduledAt.date && scheduledAt.time) {
      scheduledAtISO = new Date(`${scheduledAt.date}T${scheduledAt.time}`).toISOString();
    } else if (scheduledAt.date) {
      scheduledAtISO = new Date(`${scheduledAt.date}T09:00:00`).toISOString();
    }

    const invoiceData = {
      customerId: selectedCustomer.id,
      invoiceNumber: `INV-${Date.now()}`,
      amount: (totalCents / 100).toFixed(2),
      subtotalCents,
      taxCents,
      totalCents,
      status: "draft",
      issueDate: today.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      scheduledAt: scheduledAtISO,
      tags: tags.length > 0 ? tags : [],
      lineItems: validLineItems.map(item => ({
        name: item.name,
        description: item.description,
        quantity: parseFloat(item.quantity) || 1,
        unitPriceCents: item.unitPriceCents,
        unit: item.unit,
        taxable: item.taxable,
        taxId: item.taxId,
        taxRatePercentSnapshot: item.taxRatePercentSnapshot,
        taxNameSnapshot: item.taxNameSnapshot,
      })),
    };

    createInvoiceMutation.mutate(invoiceData);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { 
      name: "", 
      description: "", 
      quantity: "1", 
      unitPriceCents: 0, 
      priceDisplay: "", 
      unit: "each", 
      taxable: false, 
      taxId: null, 
      taxRatePercentSnapshot: null, 
      taxNameSnapshot: null 
    }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, updates: Partial<LineItem>) => {
    setLineItems(lineItems.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const handlePriceChange = (index: number, value: string) => {
    const numericValue = value.replace(/[^\d.]/g, '');
    const parts = numericValue.split('.');
    let formatted = parts[0];
    if (parts.length > 1) {
      formatted += '.' + parts[1].slice(0, 2);
    }
    const cents = Math.round((parseFloat(formatted) || 0) * 100);
    updateLineItem(index, { priceDisplay: formatted, unitPriceCents: cents });
  };

  const setLineItemTax = (index: number, tax: CompanyTax | null) => {
    if (tax) {
      updateLineItem(index, {
        taxId: tax.id,
        taxRatePercentSnapshot: tax.ratePercent,
        taxNameSnapshot: tax.name,
      });
    } else {
      updateLineItem(index, {
        taxId: null,
        taxRatePercentSnapshot: null,
        taxNameSnapshot: null,
      });
    }
    setTaxPickerOpen(false);
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  // Format schedule display
  const scheduleDisplay = useMemo(() => {
    if (!scheduledAt.date) return null;
    const date = new Date(scheduledAt.date + 'T12:00:00');
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (scheduledAt.time) {
      const [hours, minutes] = scheduledAt.time.split(':');
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${dateStr} at ${displayHour}:${minutes} ${ampm}`;
    }
    return dateStr;
  }, [scheduledAt]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md h-[90vh] p-0 flex flex-col rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button 
              type="button"
              onClick={handleClose}
              className="text-blue-600 text-sm font-medium"
            >
              Cancel
            </button>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">NEW INVOICE</h2>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isFormValid || createInvoiceMutation.isPending}
              className={`text-sm font-medium ${isFormValid && !createInvoiceMutation.isPending ? 'text-blue-600' : 'text-slate-400'}`}
            >
              {createInvoiceMutation.isPending ? 'Saving...' : 'Done'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
              <SectionHeader title="Customer" />
              <InfoRow
                icon={User}
                label="Add customer"
                value={selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}` : undefined}
                onClick={() => setCustomerModalOpen(true)}
                required
              />

              <SectionHeader title="Line Items" />
              <InfoRow
                icon={List}
                label="Add line items"
                value={hasValidLineItems ? `${validLineItems.length} item${validLineItems.length !== 1 ? 's' : ''} • ${formatCurrency(subtotalCents)}` : undefined}
                onClick={() => setLineItemsModalOpen(true)}
                required
              />

              <SectionHeader title="Schedule" />
              <InfoRow
                icon={Calendar}
                label="Add schedule"
                value={scheduleDisplay || undefined}
                onClick={() => setScheduleModalOpen(true)}
              />

              <SectionHeader title="Tags" />
              <InfoRow
                icon={Tag}
                label="Add job tags"
                value={tags.length > 0 ? tags.join(', ') : undefined}
                onClick={() => setTagsModalOpen(true)}
              />

              {totalCents > 0 && (
                <>
                  <SectionHeader title="Summary" />
                  <div className="bg-white dark:bg-slate-900 px-4 py-3 space-y-2 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="text-slate-900 dark:text-slate-100">{formatCurrency(subtotalCents)}</span>
                    </div>
                    {taxCents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Tax</span>
                        <span className="text-slate-900 dark:text-slate-100">{formatCurrency(taxCents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-slate-900 dark:text-slate-100">Total</span>
                      <span className="text-slate-900 dark:text-slate-100">{formatCurrency(totalCents)}</span>
                    </div>
                  </div>
                </>
              )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer Picker Modal */}
      <Dialog open={customerModalOpen} onOpenChange={setCustomerModalOpen}>
        <DialogContent className="max-w-md h-[80vh] p-0 flex flex-col rounded-2xl overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <DialogTitle>Select Customer</DialogTitle>
          </DialogHeader>
          <div className="px-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search customers..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              <button
                type="button"
                onClick={() => setAddCustomerModalOpen(true)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Plus className="h-5 w-5 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-blue-600">Add New Customer</span>
              </button>
              {customersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : filteredCustomers.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  No customers found
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setCustomerModalOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                      <User className="h-5 w-5 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {customer.firstName} {customer.lastName}
                      </p>
                      {customer.email && (
                        <p className="text-xs text-slate-500 truncate">{customer.email}</p>
                      )}
                    </div>
                    {selectedCustomer?.id === customer.id && (
                      <Check className="h-5 w-5 text-blue-600" />
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Add Customer Modal */}
      <Dialog open={addCustomerModalOpen} onOpenChange={setAddCustomerModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">First Name *</label>
                <Input
                  value={newCustomer.firstName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
                  placeholder="John"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Last Name *</label>
                <Input
                  value={newCustomer.lastName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
              <Input
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Phone</label>
              <Input
                type="tel"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: formatPhoneInput(e.target.value) })}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Address</label>
              <Input
                value={newCustomer.address}
                onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                placeholder="123 Main St"
              />
            </div>
            <Button
              onClick={() => {
                if (!newCustomer.firstName || !newCustomer.lastName) {
                  toast({ title: "Error", description: "First and last name are required", variant: "destructive" });
                  return;
                }
                createCustomerMutation.mutate({
                  firstName: newCustomer.firstName,
                  lastName: newCustomer.lastName,
                  email: newCustomer.email || null,
                  phone: newCustomer.phone ? getRawPhoneValue(newCustomer.phone) : null,
                  address: newCustomer.address || null,
                });
              }}
              disabled={createCustomerMutation.isPending}
              className="w-full"
            >
              {createCustomerMutation.isPending ? 'Creating...' : 'Add Customer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Line Items Modal */}
      <Dialog open={lineItemsModalOpen} onOpenChange={setLineItemsModalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] p-0 flex flex-col rounded-2xl overflow-hidden">
          <DialogHeader className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
            <DialogTitle className="text-base">Line Items</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 px-3 py-2">
            <div className="space-y-3">
              {lineItems.map((item, index) => (
                <div key={index} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Item {index + 1}</span>
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        className="text-red-500 hover:text-red-600 p-0.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  
                  <Input
                    placeholder="Item name *"
                    value={item.name}
                    onChange={(e) => updateLineItem(index, { name: e.target.value })}
                    className="h-9"
                  />
                  
                  <Input
                    placeholder="Description (optional)"
                    value={item.description}
                    onChange={(e) => updateLineItem(index, { description: e.target.value })}
                    className="h-9 text-sm"
                  />
                  
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase tracking-wide">Qty</label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, { quantity: e.target.value })}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase tracking-wide">Unit</label>
                      <Select value={item.unit} onValueChange={(v) => updateLineItem(index, { unit: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="each">Each</SelectItem>
                          <SelectItem value="hour">Hour</SelectItem>
                          <SelectItem value="ft">Ft</SelectItem>
                          <SelectItem value="sq_ft">Sq Ft</SelectItem>
                          <SelectItem value="job">Job</SelectItem>
                          <SelectItem value="day">Day</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase tracking-wide">Price</label>
                      <div className="relative">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input
                          placeholder="0.00"
                          value={item.priceDisplay}
                          onChange={(e) => handlePriceChange(index, e.target.value)}
                          className="pl-6 h-9"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-1 px-1">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Taxable</span>
                    <Switch
                      checked={item.taxable}
                      onCheckedChange={(checked) => {
                        updateLineItem(index, { 
                          taxable: checked,
                          ...(checked ? {} : { taxId: null, taxRatePercentSnapshot: null, taxNameSnapshot: null })
                        });
                      }}
                    />
                  </div>

                  {item.taxable && (
                    <button
                      type="button"
                      onClick={() => {
                        setTaxPickerLineItemIndex(index);
                        setTaxPickerOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-md text-sm"
                    >
                      <span className="flex items-center gap-1.5">
                        <Percent className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-slate-600 dark:text-slate-400 text-xs">
                          {item.taxNameSnapshot ? `${item.taxNameSnapshot} (${item.taxRatePercentSnapshot}%)` : 'Select tax rate'}
                        </span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  )}

                  <div className="text-right text-xs font-medium text-slate-700 dark:text-slate-300 pt-1">
                    Line Total: {formatCurrency(item.unitPriceCents * (parseFloat(item.quantity) || 1))}
                  </div>
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLineItem}
                  className="flex-1 h-9"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Item
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPriceBookPickerOpen(true)}
                  className="flex-1 h-9"
                >
                  <List className="h-3.5 w-3.5 mr-1.5" />
                  Price Book
                </Button>
              </div>
            </div>
          </ScrollArea>
          <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-medium">{formatCurrency(subtotalCents)}</span>
            </div>
            {taxCents > 0 && (
              <div className="flex justify-between text-xs mt-0.5">
                <span className="text-slate-500">Tax</span>
                <span className="font-medium">{formatCurrency(taxCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800">
              <span>Total</span>
              <span>{formatCurrency(totalCents)}</span>
            </div>
            <Button
              onClick={() => setLineItemsModalOpen(false)}
              className="w-full mt-2 h-9"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule Modal */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Schedule Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</label>
              <Input
                type="date"
                value={scheduledAt.date}
                onChange={(e) => setScheduledAt({ ...scheduledAt, date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Time (Optional)</label>
              <TimeWheelPicker
                value={scheduledAt.time || "09:00"}
                onChange={(time) => setScheduledAt({ ...scheduledAt, time })}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setScheduledAt({ date: "", time: "" })}
                className="flex-1"
              >
                Clear
              </Button>
              <Button
                onClick={() => setScheduleModalOpen(false)}
                className="flex-1"
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tags Modal */}
      <Dialog open={tagsModalOpen} onOpenChange={setTagsModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Job Tags</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Add a tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button onClick={addTag} size="icon">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Button onClick={() => setTagsModalOpen(false)} className="w-full">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tax Picker Modal - Full Screen */}
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
              className="text-sm text-primary hover:text-primary/80 font-medium"
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
                className="p-1 text-primary hover:text-primary/80"
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
                  className="w-full"
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
                          <Check className="h-5 w-5 text-primary" />
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

      {/* Price Book Picker */}
      <PriceBookPickerModal
        open={priceBookPickerOpen}
        onOpenChange={setPriceBookPickerOpen}
        existingItems={lineItems.map(li => ({
          ...li,
          taskCode: "",
          saveToPriceBook: false,
          priceBookItemId: null,
        }))}
        onAddItem={(item) => {
          const newItem: LineItem = {
            name: item.name,
            description: item.description || "",
            quantity: "1",
            unitPriceCents: item.unitPriceCents || 0,
            priceDisplay: ((item.unitPriceCents || 0) / 100).toFixed(2),
            unit: item.unit || "each",
            taxable: false,
            taxId: null,
            taxRatePercentSnapshot: null,
            taxNameSnapshot: null,
          };
          
          const existingNonEmpty = lineItems.filter(li => li.name.trim());
          if (existingNonEmpty.length === 0) {
            setLineItems([newItem]);
          } else {
            setLineItems([...existingNonEmpty, newItem]);
          }
        }}
      />
    </>
  );
}
