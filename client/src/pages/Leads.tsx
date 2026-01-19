import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Search, User, Phone, Mail, MapPin, Calendar, Loader2, MoreVertical, Trash2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Lead {
  id: number;
  companyId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  estimatedValue: number | null;
  serviceType: string | null;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  contacted: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  qualified: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  converted: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  lost: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

export default function Leads() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    source: "",
    status: "new",
    notes: "",
    serviceType: "",
    estimatedValue: "",
  });

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        ...data,
        estimatedValue: data.estimatedValue ? Math.round(parseFloat(data.estimatedValue) * 100) : null,
      };
      const res = await apiRequest("POST", "/api/leads", payload);
      if (!res.ok) throw new Error("Failed to create lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setIsAddDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Failed to create lead", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const payload = {
        ...data,
        estimatedValue: data.estimatedValue ? Math.round(parseFloat(data.estimatedValue) * 100) : null,
      };
      const res = await apiRequest("PATCH", `/api/leads/${id}`, payload);
      if (!res.ok) throw new Error("Failed to update lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setEditingLead(null);
      resetForm();
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
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
      source: "",
      status: "new",
      notes: "",
      serviceType: "",
      estimatedValue: "",
    });
  };

  const openEditDialog = (lead: Lead) => {
    setEditingLead(lead);
    setFormData({
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      email: lead.email || "",
      phone: lead.phone || "",
      addressLine1: lead.addressLine1 || "",
      city: lead.city || "",
      state: lead.state || "",
      postalCode: lead.postalCode || "",
      source: lead.source || "",
      status: lead.status,
      notes: lead.notes || "",
      serviceType: lead.serviceType || "",
      estimatedValue: lead.estimatedValue ? (lead.estimatedValue / 100).toString() : "",
    });
  };

  const handleSubmit = () => {
    if (editingLead) {
      updateMutation.mutate({ id: editingLead.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const filteredLeads = leads.filter((lead) => {
    const searchLower = searchQuery.toLowerCase();
    const name = `${lead.firstName || ""} ${lead.lastName || ""}`.toLowerCase();
    return (
      name.includes(searchLower) ||
      lead.email?.toLowerCase().includes(searchLower) ||
      lead.phone?.includes(searchQuery) ||
      lead.serviceType?.toLowerCase().includes(searchLower)
    );
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

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
        <Button onClick={() => setIsAddDialogOpen(true)}>
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
              <Button onClick={() => setIsAddDialogOpen(true)}>
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
                      {lead.estimatedValue && (
                        <span className="text-sm font-medium text-green-600 dark:text-green-400">
                          {formatCurrency(lead.estimatedValue)}
                        </span>
                      )}
                    </div>

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
                      {(lead.city || lead.state) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {[lead.city, lead.state].filter(Boolean).join(", ")}
                        </span>
                      )}
                      {lead.createdAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(lead.createdAt), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>

                    {lead.serviceType && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
                        Service: {lead.serviceType}
                      </p>
                    )}
                    {lead.source && (
                      <p className="text-xs text-slate-400 mt-1">Source: {lead.source}</p>
                    )}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(lead)}>
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

      {/* Add/Edit Lead Dialog */}
      <Dialog
        open={isAddDialogOpen || !!editingLead}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddDialogOpen(false);
            setEditingLead(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLead ? "Edit Lead" : "Add Lead"}</DialogTitle>
            <DialogDescription>
              {editingLead ? "Update lead information" : "Enter the lead's contact information"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="addressLine1">Address</Label>
              <Input
                id="addressLine1"
                value={formData.addressLine1}
                onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="postalCode">ZIP</Label>
                <Input
                  id="postalCode"
                  value={formData.postalCode}
                  onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                    <SelectItem value="converted">Converted</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="source">Source</Label>
                <Input
                  id="source"
                  placeholder="e.g., Website, Referral"
                  value={formData.source}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="serviceType">Service Type</Label>
                <Input
                  id="serviceType"
                  placeholder="e.g., Plumbing, HVAC"
                  value={formData.serviceType}
                  onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="estimatedValue">Estimated Value ($)</Label>
                <Input
                  id="estimatedValue"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.estimatedValue}
                  onChange={(e) => setFormData({ ...formData, estimatedValue: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="mt-1"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                setEditingLead(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingLead ? "Save Changes" : "Add Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
