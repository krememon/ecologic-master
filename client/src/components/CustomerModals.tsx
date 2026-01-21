import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Plus, X, ChevronLeft, User } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";

interface SelectCustomerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCustomer: (customer: Customer) => void;
  canCreateCustomer: boolean;
}

export function SelectCustomerModal({
  open,
  onOpenChange,
  onSelectCustomer,
  canCreateCustomer,
}: SelectCustomerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
    enabled: open,
  });

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const query = searchQuery.toLowerCase();
    return customers.filter((c) => {
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
      return fullName.includes(query) || 
             c.email?.toLowerCase().includes(query) ||
             c.companyName?.toLowerCase().includes(query);
    });
  }, [customers, searchQuery]);

  const handleSelectCustomer = (customer: Customer) => {
    onSelectCustomer(customer);
    setSearchQuery("");
    onOpenChange(false);
  };

  const handleCustomerCreated = (customer: Customer) => {
    setShowAddCustomer(false);
    handleSelectCustomer(customer);
  };

  const handleClose = () => {
    setSearchQuery("");
    setShowAddCustomer(false);
    onOpenChange(false);
  };

  if (showAddCustomer) {
    return (
      <AddCustomerModal
        open={open}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddCustomer(false);
          }
        }}
        onBack={() => setShowAddCustomer(false)}
        onCustomerCreated={handleCustomerCreated}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden" preventAutoFocus>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <button 
            onClick={handleClose} 
            className="text-sm text-blue-500 font-medium"
            data-testid="button-cancel-select-customer"
          >
            Cancel
          </button>
          <DialogTitle className="text-base font-semibold">SELECT CUSTOMER</DialogTitle>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-customer"
            />
          </div>
        </div>

        <ScrollArea className="max-h-64">
          <div className="py-2">
            {canCreateCustomer && (
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setShowAddCustomer(true)}
                data-testid="button-add-customer"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="font-medium text-blue-600 dark:text-blue-400">+ Add Customer</span>
              </button>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
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
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => handleSelectCustomer(customer)}
                  data-testid={`customer-row-${customer.id}`}
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
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

interface AddCustomerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onCustomerCreated: (customer: Customer) => void;
}

function AddCustomerModal({
  open,
  onOpenChange,
  onBack,
  onCustomerCreated,
}: AddCustomerModalProps) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [hasCompany, setHasCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyNumber, setCompanyNumber] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  const createCustomerMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/customers", data);
      return response.json();
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
      resetForm();
      onCustomerCreated(customer);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create customer",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setHasCompany(false);
    setCompanyName("");
    setCompanyNumber("");
    setJobTitle("");
  };

  const handleSubmit = () => {
    if (!firstName.trim()) {
      toast({
        title: "Validation Error",
        description: "First name is required",
        variant: "destructive",
      });
      return;
    }
    if (!lastName.trim()) {
      toast({
        title: "Validation Error",
        description: "Last name is required",
        variant: "destructive",
      });
      return;
    }

    createCustomerMutation.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      companyName: hasCompany ? companyName.trim() || null : null,
      companyNumber: hasCompany ? companyNumber.trim() || null : null,
      jobTitle: hasCompany ? jobTitle.trim() || null : null,
    });
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b flex flex-row items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-primary font-normal p-0 h-auto gap-1"
            onClick={onBack}
            data-testid="button-back-add-customer"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <DialogTitle className="text-sm font-semibold tracking-wide uppercase">
            Add Customer
          </DialogTitle>
          <div className="w-12" />
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  data-testid="input-customer-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  data-testid="input-customer-last-name"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                data-testid="input-customer-email"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                placeholder="555-123-4567"
                inputMode="numeric"
                autoComplete="tel"
                data-testid="input-customer-phone"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, City, State 12345"
                rows={2}
                data-testid="input-customer-address"
              />
            </div>

            <div className="flex items-center justify-between pt-2 pb-1">
              <Label htmlFor="hasCompany" className="font-medium">Has a company?</Label>
              <Switch
                id="hasCompany"
                checked={hasCompany}
                onCheckedChange={setHasCompany}
                data-testid="switch-has-company"
              />
            </div>

            {hasCompany && (
              <div className="space-y-4 pt-2 border-t">
                <div className="space-y-1.5">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Inc."
                    data-testid="input-customer-company-name"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="companyNumber">Company Number</Label>
                  <Input
                    id="companyNumber"
                    value={companyNumber}
                    onChange={(e) => setCompanyNumber(e.target.value)}
                    placeholder="EIN or registration number"
                    data-testid="input-customer-company-number"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="jobTitle">Job Title</Label>
                  <Input
                    id="jobTitle"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="CEO, Manager, etc."
                    data-testid="input-customer-job-title"
                  />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t">
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={createCustomerMutation.isPending}
            data-testid="button-save-customer"
          >
            {createCustomerMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Customer"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
