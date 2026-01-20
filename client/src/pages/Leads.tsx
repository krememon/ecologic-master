import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Search, User, Phone, Mail, Calendar, Loader2, MoreVertical, Trash2, Pencil, ChevronRight, FileText, StickyNote } from "lucide-react";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Lead {
  id: number;
  companyId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  contacted: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  qualified: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  converted: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  lost: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-3 mt-4 first:mt-0 bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
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
      className="w-full flex items-center gap-3 px-4 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
    >
      <Icon className="h-5 w-5 flex-shrink-0 text-slate-400" />
      <span className={`flex-1 text-sm ${value ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
        {value || label}
        {required && !value && <span className="text-slate-400 ml-1">*</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </button>
  );
}

export default function Leads() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    description: "",
    notes: "",
  });

  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);

  const [tempFirstName, setTempFirstName] = useState("");
  const [tempLastName, setTempLastName] = useState("");
  const [tempPhone, setTempPhone] = useState("");
  const [tempEmail, setTempEmail] = useState("");
  const [tempDescription, setTempDescription] = useState("");
  const [tempNotes, setTempNotes] = useState("");
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
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
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
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
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      description: "",
      notes: "",
    });
  };

  const closeSheet = () => {
    setIsAddSheetOpen(false);
    setEditingLead(null);
    resetForm();
    setHasAttemptedSave(false);
  };

  const openAddSheet = () => {
    resetForm();
    setHasAttemptedSave(false);
    setIsAddSheetOpen(true);
  };

  const openEditSheet = (lead: Lead) => {
    setEditingLead(lead);
    setFormData({
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      email: lead.email || "",
      phone: lead.phone || "",
      description: lead.description || "",
      notes: lead.notes || "",
    });
    setIsAddSheetOpen(true);
  };

  const isFormValid = () => {
    const hasDescription = formData.description.trim().length > 0;
    const hasContact = formData.email.trim().length > 0 || formData.phone.trim().length > 0;
    return hasDescription && hasContact;
  };

  const handleSave = () => {
    setHasAttemptedSave(true);
    if (!isFormValid()) return;
    
    if (editingLead) {
      updateMutation.mutate({ id: editingLead.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const openNameModal = () => {
    setTempFirstName(formData.firstName);
    setTempLastName(formData.lastName);
    setNameModalOpen(true);
  };

  const saveNameModal = () => {
    setFormData({ ...formData, firstName: tempFirstName, lastName: tempLastName });
    setNameModalOpen(false);
  };

  const openPhoneModal = () => {
    setTempPhone(formData.phone);
    setPhoneModalOpen(true);
  };

  const savePhoneModal = () => {
    setFormData({ ...formData, phone: tempPhone });
    setPhoneModalOpen(false);
  };

  const openEmailModal = () => {
    setTempEmail(formData.email);
    setEmailModalOpen(true);
  };

  const saveEmailModal = () => {
    setFormData({ ...formData, email: tempEmail });
    setEmailModalOpen(false);
  };

  const openDescriptionModal = () => {
    setTempDescription(formData.description);
    setDescriptionModalOpen(true);
  };

  const saveDescriptionModal = () => {
    setFormData({ ...formData, description: tempDescription });
    setDescriptionModalOpen(false);
  };

  const openNotesModal = () => {
    setTempNotes(formData.notes);
    setNotesModalOpen(true);
  };

  const saveNotesModal = () => {
    setFormData({ ...formData, notes: tempNotes });
    setNotesModalOpen(false);
  };

  const filteredLeads = leads.filter((lead) => {
    const searchLower = searchQuery.toLowerCase();
    const name = `${lead.firstName || ""} ${lead.lastName || ""}`.toLowerCase();
    return (
      name.includes(searchLower) ||
      lead.email?.toLowerCase().includes(searchLower) ||
      lead.phone?.includes(searchQuery) ||
      lead.description?.toLowerCase().includes(searchLower)
    );
  });

  const nameDisplay = formData.firstName || formData.lastName
    ? `${formData.firstName} ${formData.lastName}`.trim()
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
            <Card key={lead.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                        {lead.firstName || lead.lastName
                          ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim()
                          : "Unnamed Lead"}
                      </h3>
                      <Badge className={statusColors[lead.status] || statusColors.new}>
                        {lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}
                      </Badge>
                    </div>

                    {lead.description && (
                      <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">
                        {lead.description}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-4 text-sm text-slate-500 dark:text-slate-400">
                      {lead.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          {lead.email}
                        </span>
                      )}
                      {lead.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          {lead.phone}
                        </span>
                      )}
                      {lead.createdAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(lead.createdAt), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>

                    {lead.notes && (
                      <p className="text-xs text-slate-400 mt-2 italic">{lead.notes}</p>
                    )}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
            <SectionHeader title="Contact" />
            <InfoRow
              icon={User}
              label="Add name"
              value={nameDisplay}
              onClick={openNameModal}
            />
            <InfoRow
              icon={Phone}
              label="Add phone"
              value={formData.phone || undefined}
              onClick={openPhoneModal}
            />
            <InfoRow
              icon={Mail}
              label="Add email"
              value={formData.email || undefined}
              onClick={openEmailModal}
            />

            <SectionHeader title="Details" />
            <InfoRow
              icon={FileText}
              label="Add description"
              value={formData.description || undefined}
              onClick={openDescriptionModal}
              required
            />
            <InfoRow
              icon={StickyNote}
              label="Add notes"
              value={formData.notes || undefined}
              onClick={openNotesModal}
            />

            {hasAttemptedSave && !isFormValid() && (
              <div className="px-4 py-4 mt-4 text-sm text-slate-500 dark:text-slate-400">
                {!formData.description.trim() && <p>Add a description</p>}
                {!formData.email.trim() && !formData.phone.trim() && <p>Add a phone number or email</p>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Name Edit Modal */}
      <Dialog open={nameModalOpen} onOpenChange={setNameModalOpen}>
        <DialogContent className="max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setNameModalOpen(false)} className="text-blue-600 text-sm font-medium">
              Cancel
            </button>
            <h3 className="text-base font-semibold">Name</h3>
            <button onClick={saveNameModal} className="text-blue-600 text-sm font-medium">
              Done
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">First Name</label>
              <Input
                value={tempFirstName}
                onChange={(e) => setTempFirstName(e.target.value)}
                placeholder="John"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Last Name</label>
              <Input
                value={tempLastName}
                onChange={(e) => setTempLastName(e.target.value)}
                placeholder="Doe"
                className="mt-1"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Phone Edit Modal */}
      <Dialog open={phoneModalOpen} onOpenChange={setPhoneModalOpen}>
        <DialogContent className="max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setPhoneModalOpen(false)} className="text-blue-600 text-sm font-medium">
              Cancel
            </button>
            <h3 className="text-base font-semibold">Phone</h3>
            <button onClick={savePhoneModal} className="text-blue-600 text-sm font-medium">
              Done
            </button>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Phone Number</label>
            <Input
              value={tempPhone}
              onChange={(e) => setTempPhone(formatPhoneNumber(e.target.value))}
              placeholder="555-123-4567"
              className="mt-1"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Email Edit Modal */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setEmailModalOpen(false)} className="text-blue-600 text-sm font-medium">
              Cancel
            </button>
            <h3 className="text-base font-semibold">Email</h3>
            <button onClick={saveEmailModal} className="text-blue-600 text-sm font-medium">
              Done
            </button>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email Address</label>
            <Input
              type="email"
              value={tempEmail}
              onChange={(e) => setTempEmail(e.target.value)}
              placeholder="john@example.com"
              className="mt-1"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Description Edit Modal */}
      <Dialog open={descriptionModalOpen} onOpenChange={setDescriptionModalOpen}>
        <DialogContent className="max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setDescriptionModalOpen(false)} className="text-blue-600 text-sm font-medium">
              Cancel
            </button>
            <h3 className="text-base font-semibold">Description</h3>
            <button onClick={saveDescriptionModal} className="text-blue-600 text-sm font-medium">
              Done
            </button>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Description <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={tempDescription}
              onChange={(e) => setTempDescription(e.target.value)}
              placeholder="What service is the lead interested in?"
              className="mt-1"
              rows={4}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Notes Edit Modal */}
      <Dialog open={notesModalOpen} onOpenChange={setNotesModalOpen}>
        <DialogContent className="max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setNotesModalOpen(false)} className="text-blue-600 text-sm font-medium">
              Cancel
            </button>
            <h3 className="text-base font-semibold">Notes</h3>
            <button onClick={saveNotesModal} className="text-blue-600 text-sm font-medium">
              Done
            </button>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes (optional)</label>
            <Textarea
              value={tempNotes}
              onChange={(e) => setTempNotes(e.target.value)}
              placeholder="Additional notes..."
              className="mt-1"
              rows={4}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
