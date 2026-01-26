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
  Plus, Search, X, Tag, List, Percent, Loader2, Check, DollarSign, Trash2
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TimeWheelPicker } from "./TimeWheelPicker";
import { PriceBookPickerModal } from "./PriceBookPickerModal";
import { SelectCustomerModal } from "./CustomerModals";
import type { Customer } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";

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
  priceBookItemId?: number | null;
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
    <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {title}
      </span>
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
      className="w-full flex items-center gap-3 px-4 min-h-[52px] bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800 transition-colors text-left"
    >
      <Icon className="h-5 w-5 text-slate-400 flex-shrink-0" />
      <span className={`flex-1 text-sm ${value ? 'text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>
        {value || label}
        {required && !value && <span className="text-red-500 ml-1">*</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />
    </button>
  );
}

export function NewInvoiceSheet({ open, onOpenChange, onInvoiceCreated }: NewInvoiceSheetProps) {
  const { toast } = useToast();

  // Form state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [scheduledAt, setScheduledAt] = useState<{ date: string; time: string }>({ date: "", time: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // Modal states
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
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
    setLineItems([]);
    setCustomerSearch("");
    setTagInput("");
    setTaxPickerShowCreate(false);
    setNewTaxName("");
    setNewTaxRate("");
    setNewTaxError(null);
  };

  const handleSubmit = () => {
    if (!selectedCustomer || !hasValidLineItems) return;
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

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
      onOpenChange(false);
    }
  };

  const addLineItemFromPriceBook = (item: LineItem) => {
    setLineItems(prev => [...prev, item]);
  };

  const removeLineItemByPriceBookId = (priceBookItemId: number) => {
    setLineItems(prev => prev.filter(item => item.priceBookItemId !== priceBookItemId));
  };

  const updateLineItem = (index: number, updates: Partial<LineItem>) => {
    setLineItems(lineItems.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
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
        <DialogContent hideCloseButton className="w-[95vw] max-w-md max-h-[90vh] p-0 flex flex-col rounded-2xl overflow-hidden">
          <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative flex-shrink-0">
            <button 
              type="button"
              onClick={() => handleClose(false)}
              className="absolute right-4 top-1/2 -translate-y-1/2"
            >
              <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            </button>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">New Invoice</h2>
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
                onClick={() => setPriceBookPickerOpen(true)}
                required
              />

              {/* Inline Line Items Editor */}
              {validLineItems.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  {lineItems.map((item, index) => {
                    if (!item.name.trim() && item.unitPriceCents === 0) return null;
                    return (
                      <div key={index} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">{item.name}</p>
                            {item.description && (
                              <p className="text-xs text-slate-500 truncate">{item.description}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLineItem(index)}
                            className="text-red-500 hover:text-red-600 p-1 -mr-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 mb-1.5">
                          <div>
                            <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-0.5">Qty</label>
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(index, { quantity: e.target.value })}
                              className="h-7 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-0.5">Unit</label>
                            <Select value={item.unit} onValueChange={(v) => updateLineItem(index, { unit: v })}>
                              <SelectTrigger className="h-7 text-sm">
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
                            <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-0.5">Price</label>
                            <div className="relative">
                              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                              <Input
                                placeholder="0.00"
                                value={item.priceDisplay}
                                onChange={(e) => handlePriceChange(index, e.target.value)}
                                className="pl-5 h-7 text-sm"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between py-0.5">
                          <span className="text-xs text-slate-600 dark:text-slate-400">Taxable</span>
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
                            className="w-full flex items-center justify-between px-2 py-1 bg-slate-50 dark:bg-slate-800 rounded text-sm mt-0.5"
                          >
                            <span className="flex items-center gap-1">
                              <Percent className="h-3 w-3 text-slate-400" />
                              <span className="text-slate-600 dark:text-slate-400 text-xs">
                                {item.taxNameSnapshot ? `${item.taxNameSnapshot} (${item.taxRatePercentSnapshot}%)` : 'Select tax rate'}
                              </span>
                            </span>
                            <ChevronRight className="h-3 w-3 text-slate-400" />
                          </button>
                        )}

                        <div className="text-right text-[11px] font-medium text-slate-600 dark:text-slate-400 mt-1">
                          Line Total: {formatCurrency(item.unitPriceCents * (parseFloat(item.quantity) || 1))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

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

          {/* Footer Button */}
          <div className="flex-shrink-0 w-full flex justify-center px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 safe-area-bottom">
            <Button
              type="button"
              onClick={() => {
                if (!selectedCustomer) {
                  toast({ title: "Select a customer", variant: "destructive" });
                  return;
                }
                if (!hasValidLineItems) {
                  toast({ title: "Add at least one line item with a price", variant: "destructive" });
                  return;
                }
                handleSubmit();
              }}
              disabled={createInvoiceMutation.isPending}
              className="w-full h-11 text-center"
            >
              {createInvoiceMutation.isPending ? 'Saving...' : 'Save Invoice'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer Picker Modal */}
      <SelectCustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        onSelectCustomer={(customer) => {
          setSelectedCustomer(customer);
          setCustomerModalOpen(false);
        }}
        canCreateCustomer={true}
      />

      {/* Schedule Modal */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Schedule Invoice</DialogTitle>
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
                value={scheduledAt.date}
                onChange={(e) => setScheduledAt({ ...scheduledAt, date: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label>Time (Optional)</Label>
              <TimeWheelPicker
                value={scheduledAt.time || "09:00"}
                onChange={(time) => setScheduledAt({ ...scheduledAt, time })}
              />
            </div>
          </div>
          <div className="flex gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="outline"
              onClick={() => setScheduledAt({ date: "", time: "" })}
              className="flex-1 h-10 rounded-xl"
            >
              Clear
            </Button>
            <Button
              onClick={() => setScheduleModalOpen(false)}
              className="flex-1 h-10 rounded-xl"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tags Modal */}
      <Dialog open={tagsModalOpen} onOpenChange={setTagsModalOpen}>
        <DialogContent hideCloseButton className="max-w-md rounded-2xl">
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
        existingItems={lineItems}
        onAddItem={addLineItemFromPriceBook}
        onRemoveItemByPriceBookId={removeLineItemByPriceBookId}
      />
    </>
  );
}
