import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Search, User, Phone, Mail, Calendar, Loader2, MoreVertical, Trash2, Pencil, ChevronRight, StickyNote, X, Megaphone } from "lucide-react";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SelectCustomerModal } from "@/components/CustomerModals";
import type { Customer } from "@shared/schema";

interface Lead {
  id: number;
  companyId: number;
  customerId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  notes: string | null;
  status: string;
  source: string | null;
  campaignId: number | null;
  campaignSubject: string | null;
  interestMessage: string | null;
  campaignResponseAt: string | null;
  createdAt: string;
  customer?: Customer;
}


const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

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

export default function Leads() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("create") === "true") {
      setIsAddSheetOpen(true);
      navigate("/leads", { replace: true });
    }
  }, [search, navigate]);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState({
    customerId: null as number | null,
    description: "",
  });
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);

  const [tempDescription, setTempDescription] = useState("");

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { customerId: number; description: string }) => {
      const res = await apiRequest("POST", "/api/leads", data);
      if (!res.ok) throw new Error("Failed to create lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      closeSheet();
    },
    onError: () => {
      toast({ title: "Failed to create lead", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { customerId?: number; description?: string } }) => {
      const res = await apiRequest("PATCH", `/api/leads/${id}`, data);
      if (!res.ok) throw new Error("Failed to update lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      closeSheet();
    },
    onError: () => {
      toast({ title: "Failed to update lead", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/leads/${id}`);
      if (!res.ok) throw new Error("Failed to delete lead");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: () => {
      toast({ title: "Failed to delete lead", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      customerId: null,
      description: "",
    });
    setSelectedCustomer(null);
  };

  const closeSheet = () => {
    setIsAddSheetOpen(false);
    setEditingLead(null);
    resetForm();
  };

  const openAddSheet = () => {
    resetForm();
    setIsAddSheetOpen(true);
  };

  const openEditSheet = (lead: Lead) => {
    setEditingLead(lead);
    setFormData({
      customerId: lead.customerId,
      description: lead.description || "",
    });
    setSelectedCustomer(lead.customer || null);
    setIsAddSheetOpen(true);
  };

  const isFormValid = () => {
    const hasCustomer = formData.customerId !== null;
    const hasDescription = formData.description.trim().length > 0;
    return hasCustomer && hasDescription;
  };

  const handleSave = () => {
    if (!isFormValid()) return;
    
    if (editingLead) {
      updateMutation.mutate({ 
        id: editingLead.id, 
        data: {
          customerId: formData.customerId!,
          description: formData.description,
        }
      });
    } else {
      createMutation.mutate({
        customerId: formData.customerId!,
        description: formData.description,
      });
    }
  };

  const handleSelectCustomer = (customer: Customer) => {
    setFormData({ ...formData, customerId: customer.id });
    setSelectedCustomer(customer);
  };

  const openDescriptionModal = () => {
    setTempDescription(formData.description);
    setDescriptionModalOpen(true);
  };

  const saveDescriptionModal = () => {
    setFormData({ ...formData, description: tempDescription });
    setDescriptionModalOpen(false);
  };

  const filteredLeads = leads.filter((lead) => {
    if (!searchQuery.trim()) return true;
    const searchLower = searchQuery.toLowerCase();
    const customerName = lead.customer 
      ? `${lead.customer.firstName || ""} ${lead.customer.lastName || ""}`.toLowerCase()
      : "";
    return (
      customerName.includes(searchLower) ||
      (lead.customer?.email?.toLowerCase()?.includes(searchLower) ?? false) ||
      (lead.description?.toLowerCase()?.includes(searchLower) ?? false)
    );
  });

  const customerDisplay = selectedCustomer 
    ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}`.trim()
    : undefined;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Leads</h1>
        <Button onClick={openAddSheet}>
          <Plus className="h-4 w-4 mr-2" />
          Add Lead
        </Button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search leads..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {filteredLeads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <User className="h-12 w-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
              {searchQuery ? "No leads found" : "No leads yet"}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {searchQuery ? "Try a different search term" : "Add your first lead to get started"}
            </p>
            {!searchQuery && (
              <Button onClick={openAddSheet}>
                <Plus className="h-4 w-4 mr-2" />
                Add Lead
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredLeads.map((lead) => (
            <Card 
              key={lead.id} 
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/leads/${lead.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                        {lead.customer
                          ? `${lead.customer.firstName || ""} ${lead.customer.lastName || ""}`.trim()
                          : lead.firstName || lead.lastName
                            ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim()
                            : "Unknown"}
                      </h3>
                      {lead.status === "won" && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                          Won
                        </span>
                      )}
                      {lead.source === "campaign" && (
                        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          <Megaphone className="h-3 w-3" />
                          Campaign
                        </span>
                      )}
                    </div>

                    {lead.source === "campaign" && lead.campaignSubject && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mb-1 font-medium">
                        {lead.campaignSubject}
                      </p>
                    )}

                    {(lead.interestMessage || lead.description) && (
                      <p className="text-sm text-slate-700 dark:text-slate-300 mb-2 line-clamp-2">
                        {lead.interestMessage || lead.description}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-4 text-sm text-slate-500 dark:text-slate-400">
                      {lead.customer?.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          {lead.customer.email}
                        </span>
                      )}
                      {lead.customer?.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          {lead.customer.phone}
                        </span>
                      )}
                      {lead.createdAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(lead.createdAt), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => openEditSheet(lead)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => deleteMutation.mutate(lead.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Lead Sheet - iOS Style */}
      <Dialog open={isAddSheetOpen} onOpenChange={(open) => !open && closeSheet()}>
        <DialogContent hideCloseButton className="max-w-md h-[85vh] p-0 flex flex-col rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button 
              type="button"
              onClick={closeSheet}
              className="text-blue-600 text-sm font-medium"
            >
              Cancel
            </button>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {editingLead ? "Edit Lead" : "New Lead"}
            </h2>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isFormValid() || createMutation.isPending || updateMutation.isPending}
              className={`text-sm font-medium ${isFormValid() ? 'text-blue-600' : 'text-slate-300 dark:text-slate-600'}`}
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
            <SectionHeader title="Customer" />
            <InfoRow
              icon={User}
              label="Select customer"
              value={customerDisplay}
              onClick={() => setCustomerModalOpen(true)}
              required
            />

            <SectionHeader title="Details" />
            <InfoRow
              icon={StickyNote}
              label="Add description"
              value={formData.description || undefined}
              onClick={openDescriptionModal}
              required
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Select Customer Modal */}
      <SelectCustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        onSelectCustomer={handleSelectCustomer}
        canCreateCustomer={true}
      />

      {/* Description Edit Modal */}
      <Dialog open={descriptionModalOpen} onOpenChange={setDescriptionModalOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
            <button 
              onClick={() => setDescriptionModalOpen(false)} 
              className="absolute left-4 top-1/2 -translate-y-1/2"
            >
              <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            </button>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Description</h3>
          </div>
          <div className="p-4 space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Description <span className="text-red-400 text-xs">*</span>
              </label>
              <Textarea
                value={tempDescription}
                onChange={(e) => setTempDescription(e.target.value)}
                placeholder="What service is the lead interested in?"
                className="min-h-[120px] resize-none text-sm"
              />
            </div>
            <Button 
              onClick={saveDescriptionModal} 
              className="w-full h-11"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
