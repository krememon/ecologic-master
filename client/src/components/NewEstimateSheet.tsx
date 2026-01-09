import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Plus, Trash2, Loader2, Search, X, Building2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Customer, Job } from "@shared/schema";

interface LineItem {
  name: string;
  quantity: string;
  unitPriceCents: number;
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

interface NewEstimateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedJob?: Job | null;
  onJobSelect?: () => void;
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

export function NewEstimateSheet({ open, onOpenChange, selectedJob, onJobSelect }: NewEstimateSheetProps) {
  const { toast } = useToast();

  // Form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { name: "", quantity: "1", unitPriceCents: 0 }
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
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [lineItemsModalOpen, setLineItemsModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [employeesModalOpen, setEmployeesModalOpen] = useState(false);
  const [estimateFieldsModalOpen, setEstimateFieldsModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [jobPickerModalOpen, setJobPickerModalOpen] = useState(false);

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
  const { data: apiCustomers = [] } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
  });

  // Fetch jobs for job picker
  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ['/api/jobs'],
  });

  // Filter customers by search
  const filteredCustomers = apiCustomers.filter((c) => {
    const searchLower = customerSearch.toLowerCase();
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    return fullName.includes(searchLower) || 
           (c.email || '').toLowerCase().includes(searchLower) ||
           (c.phone || '').includes(customerSearch);
  });

  // Local job state for this sheet
  const [localSelectedJob, setLocalSelectedJob] = useState<Job | null>(selectedJob || null);

  useEffect(() => {
    if (selectedJob) {
      setLocalSelectedJob(selectedJob);
    }
  }, [selectedJob]);

  const resetForm = () => {
    setTitle("");
    setNotes("");
    setSelectedCustomer(null);
    setLineItems([{ name: "", quantity: "1", unitPriceCents: 0 }]);
    setSchedule({ date: "", time: "" });
    setAssignedEmployees([]);
    setEstimateFields({ showSubtotal: true, showTax: true, taxRate: "0", validDays: "30" });
    setTags([]);
    setNewTagInput("");
    setLocalSelectedJob(selectedJob || null);
  };

  const handleSave = () => {
    console.log({
      jobId: localSelectedJob?.id,
      title,
      notes,
      customer: selectedCustomer,
      lineItems,
      schedule,
      assignedEmployees,
      estimateFields,
      tags
    });
    toast({ title: "Estimate saved", description: "Your estimate has been created." });
    resetForm();
    onOpenChange(false);
  };

  // Line item helpers
  const addLineItem = () => {
    setLineItems([...lineItems, { name: "", quantity: "1", unitPriceCents: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems];
    if (field === 'unitPriceCents') {
      updated[index][field] = typeof value === 'number' ? value : Math.round(parseFloat(value) * 100) || 0;
    } else {
      updated[index][field] = value as string;
    }
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

  // Job search for picker
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const filteredJobs = jobs.filter((job) => {
    const searchLower = jobSearchQuery.toLowerCase();
    return job.title.toLowerCase().includes(searchLower);
  });

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
              data-testid="button-save-estimate"
            >
              Save
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <SectionHeader title="Job" />
            <InfoRow
              icon={Building2}
              label="Select job"
              value={localSelectedJob?.title}
              onClick={() => setJobPickerModalOpen(true)}
              testId="row-select-job"
            />

            <SectionHeader title="Title" />
            <InfoRow
              icon={List}
              label="Add title"
              value={title || undefined}
              onClick={() => setTitleModalOpen(true)}
              testId="row-add-title"
            />

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
              onClick={() => setLineItemsModalOpen(true)}
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
              value={assignedEmployees.length > 0 ? `${assignedEmployees.length} selected` : undefined}
              onClick={() => setEmployeesModalOpen(true)}
              testId="row-my-employees"
            />

            <SectionHeader title="Estimate Fields" />
            <InfoRow
              icon={SlidersHorizontal}
              label="Estimate fields"
              onClick={() => setEstimateFieldsModalOpen(true)}
              testId="row-estimate-fields"
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

      {/* JOB PICKER Modal */}
      <Dialog open={jobPickerModalOpen} onOpenChange={setJobPickerModalOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <button 
              onClick={() => setJobPickerModalOpen(false)}
              className="text-sm text-blue-500 font-medium"
            >
              Cancel
            </button>
            <DialogTitle className="text-base font-semibold">SELECT JOB</DialogTitle>
            <button 
              onClick={() => setJobPickerModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search jobs"
                value={jobSearchQuery}
                onChange={(e) => setJobSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-jobs"
              />
            </div>
          </div>

          <ScrollArea className="max-h-64">
            <div className="py-2">
              {filteredJobs.length === 0 ? (
                <p className="text-center text-slate-500 py-4">No jobs found</p>
              ) : (
                filteredJobs.map((job) => (
                  <button
                    key={job.id}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => {
                      setLocalSelectedJob(job);
                      setJobPickerModalOpen(false);
                      setJobSearchQuery("");
                    }}
                    data-testid={`button-select-job-${job.id}`}
                  >
                    <Building2 className="h-4 w-4 text-slate-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{job.title}</p>
                    </div>
                    {localSelectedJob?.id === job.id && (
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

      {/* TITLE Modal */}
      <Dialog open={titleModalOpen} onOpenChange={setTitleModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Estimate Title</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="estimateTitle">Title *</Label>
              <Input
                id="estimateTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Kitchen Renovation Estimate"
                data-testid="input-estimate-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="estimateNotes">Notes (optional)</Label>
              <Textarea
                id="estimateNotes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes or terms..."
                rows={3}
                data-testid="input-estimate-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setTitleModalOpen(false)} data-testid="button-done-title">
              Done
            </Button>
          </DialogFooter>
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
                  setCustomerModalOpen(false);
                  setAddCustomerModalOpen(true);
                }}
                data-testid="button-add-new-customer"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="font-medium text-blue-600 dark:text-blue-400">+ Add Customer</span>
              </button>

              {filteredCustomers.map((customer) => (
                <button
                  key={customer.id}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
              ))}
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
                setSelectedCustomer({
                  id: Date.now(),
                  companyId: 0,
                  firstName: newCustomer.firstName,
                  lastName: newCustomer.lastName,
                  email: newCustomer.email || null,
                  phone: newCustomer.phone || null,
                  address: newCustomer.address || null,
                  companyName: newCustomer.companyName || null,
                  companyNumber: newCustomer.companyNumber || null,
                  jobTitle: newCustomer.jobTitle || null,
                  createdAt: new Date(),
                  updatedAt: new Date()
                });
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
                setAddCustomerModalOpen(false);
              }}
              disabled={!newCustomer.firstName || !newCustomer.lastName}
            >
              Add Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LINE ITEMS Modal */}
      <Dialog open={lineItemsModalOpen} onOpenChange={setLineItemsModalOpen}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
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
                  placeholder="Description"
                  value={item.name}
                  onChange={(e) => updateLineItem(index, 'name', e.target.value)}
                />
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
                      type="number"
                      value={(item.unitPriceCents / 100).toFixed(2)}
                      onChange={(e) => updateLineItem(index, 'unitPriceCents', e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
                <div className="text-right text-sm font-medium">
                  Total: {formatCurrency(calculateLineTotal(item))}
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              onClick={addLineItem}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Line Item
            </Button>

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
      <Dialog open={employeesModalOpen} onOpenChange={setEmployeesModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Employees</DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-center text-slate-500 dark:text-slate-400">
              Employee assignment will be available soon.
            </p>
          </div>

          <DialogFooter>
            <Button onClick={() => setEmployeesModalOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ESTIMATE FIELDS Modal */}
      <Dialog open={estimateFieldsModalOpen} onOpenChange={setEstimateFieldsModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Estimate Fields</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="showSubtotal">Show Subtotal</Label>
              <Checkbox
                id="showSubtotal"
                checked={estimateFields.showSubtotal}
                onCheckedChange={(checked) => 
                  setEstimateFields({ ...estimateFields, showSubtotal: !!checked })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="showTax">Show Tax</Label>
              <Checkbox
                id="showTax"
                checked={estimateFields.showTax}
                onCheckedChange={(checked) => 
                  setEstimateFields({ ...estimateFields, showTax: !!checked })
                }
              />
            </div>
            {estimateFields.showTax && (
              <div className="space-y-2">
                <Label htmlFor="taxRate">Tax Rate (%)</Label>
                <Input
                  id="taxRate"
                  type="number"
                  value={estimateFields.taxRate}
                  onChange={(e) => setEstimateFields({ ...estimateFields, taxRate: e.target.value })}
                  min="0"
                  max="100"
                  step="0.1"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="validDays">Valid for (days)</Label>
              <Input
                id="validDays"
                type="number"
                value={estimateFields.validDays}
                onChange={(e) => setEstimateFields({ ...estimateFields, validDays: e.target.value })}
                min="1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setEstimateFieldsModalOpen(false)}>
              Done
            </Button>
          </DialogFooter>
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
