import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import LocationInput from "@/components/LocationInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Plus, X, ChevronLeft, User, Users } from "lucide-react";
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

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || '';
  const last = lastName?.charAt(0)?.toUpperCase() || '';
  return first + last || '?';
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
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Select Customer
          </DialogTitle>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            data-testid="button-cancel-select-customer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-3 bg-white dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-0"
              data-testid="input-search-customer"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        <ScrollArea className="max-h-80">
          <div className="bg-white dark:bg-slate-900">
            {canCreateCustomer && (
              <button
                className="w-full flex items-center gap-3 px-4 min-h-[56px] text-left hover:bg-blue-50 dark:hover:bg-blue-950/30 active:bg-blue-100 dark:active:bg-blue-950/50 transition-colors"
                onClick={() => setShowAddCustomer(true)}
                data-testid="button-add-customer"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-blue-600 flex items-center justify-center shadow-sm">
                  <Plus className="h-5 w-5 text-white" />
                </div>
                <span className="font-semibold text-blue-600 dark:text-blue-400">Add Customer</span>
              </button>
            )}

            {canCreateCustomer && (filteredCustomers.length > 0 || isLoading) && (
              <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
            )}

            {isLoading ? (
              <div className="py-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-28 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                      <div className="h-3 w-40 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                  <Users className="h-7 w-7 text-slate-400" />
                </div>
                <p className="font-medium text-slate-600 dark:text-slate-400 text-center">
                  {searchQuery ? "No customers match your search" : "No customers yet"}
                </p>
                {searchQuery && (
                  <p className="text-sm text-slate-400 mt-1">Try a different search term</p>
                )}
              </div>
            ) : (
              <div className="py-1">
                {filteredCustomers.map((customer, index) => (
                  <div key={customer.id}>
                    <button
                      className="w-full flex items-center gap-3 px-4 min-h-[60px] text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800 transition-colors"
                      onClick={() => handleSelectCustomer(customer)}
                      data-testid={`customer-row-${customer.id}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                        {getInitials(customer.firstName, customer.lastName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {`${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed'}
                        </p>
                        {customer.email && (
                          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{customer.email}</p>
                        )}
                      </div>
                    </button>
                    {index < filteredCustomers.length - 1 && (
                      <div className="h-px bg-slate-100 dark:bg-slate-800 ml-[68px] mr-4" />
                    )}
                  </div>
                ))}
              </div>
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
      <DialogContent
        className="sm:max-w-md p-0 gap-0 overflow-hidden rounded-2xl"
        onPointerDownOutside={(e) => {
          if ((e.detail.originalEvent.target as Element)?.closest?.('.pac-container')) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          if (((e as CustomEvent).detail?.originalEvent?.target as Element)?.closest?.('.pac-container')) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="px-4 h-14 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-600 dark:text-blue-400 font-medium p-0 h-auto gap-1 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-transparent min-h-[44px]"
            onClick={onBack}
            data-testid="button-back-add-customer"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
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
                  placeholder="First Name"
                  data-testid="input-customer-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last Name"
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
                placeholder="Email"
                data-testid="input-customer-email"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                placeholder="Phone Number"
                inputMode="numeric"
                autoComplete="tel"
                data-testid="input-customer-phone"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <LocationInput
                value={address}
                onChange={setAddress}
                onAddressSelected={(a) => setAddress(a.formatted_address || a.street)}
                placeholder="Address"
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

        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <Button
            className="w-full h-12 rounded-xl font-semibold"
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
