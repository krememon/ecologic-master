import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  User, Calendar, Users, MapPin, ChevronRight, 
  Plus, Search, X, StickyNote, Wrench, Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import LocationInput from "@/components/LocationInput";
import type { Customer } from "@shared/schema";

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


export function NewJobSheet({ open, onOpenChange, onJobCreated }: NewJobSheetProps) {
  const { toast } = useToast();

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [locationLat, setLocationLat] = useState<number | undefined>();
  const [locationLng, setLocationLng] = useState<number | undefined>();
  const [locationPlaceId, setLocationPlaceId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData>({ date: "", startTime: "", endTime: "" });
  const [assignedEmployees, setAssignedEmployees] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [jobType, setJobType] = useState<string | null>(null);

  // Modal states
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [employeesModalOpen, setEmployeesModalOpen] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [jobTypeModalOpen, setJobTypeModalOpen] = useState(false);

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

  // Create customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (customerData: { firstName: string; lastName: string; email?: string; phone?: string; address?: string }) => {
      const response = await apiRequest('POST', '/api/customers', customerData);
      return response.json();
    },
    onSuccess: (newCust: Customer) => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      setSelectedCustomer(newCust);
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

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setLocation("");
    setCity("");
    setPostalCode("");
    setLocationLat(undefined);
    setLocationLng(undefined);
    setLocationPlaceId("");
    setPriority("medium");
    setSelectedCustomer(null);
    setSchedule({ date: "", startTime: "", endTime: "" });
    setAssignedEmployees([]);
    setNotes("");
    setJobType(null);
    setCustomerSearch("");
    setEmployeeSearch("");
  };

  const handleSave = () => {
    if (!selectedCustomer) {
      toast({ title: "Customer required", description: "Please select a customer before saving.", variant: "destructive" });
      return;
    }

    const customerName = `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim();

    createJobMutation.mutate({
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
    });
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
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">New Job</h3>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || createJobMutation.isPending}
              data-testid="button-save-job"
            >
              {createJobMutation.isPending ? 'Saving...' : 'Save'}
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
                      setSelectedCustomer(customer);
                      setCustomerModalOpen(false);
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
                onChange={setLocation}
                onAddressSelected={(addr) => {
                  setCity(addr.city);
                  setPostalCode(addr.postalCode);
                  setLocationPlaceId(addr.place_id);
                  setLocation(addr.formatted_address || addr.street);
                }}
                placeholder="Start typing an address..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
              </div>
              <div className="space-y-2">
                <Label>ZIP/Postal Code</Label>
                <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="ZIP" />
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
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0">
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
    </>
  );
}
