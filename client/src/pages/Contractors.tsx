import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Plus, UserCheck, Mail, Phone, Edit, Trash2, Globe, Building2, Search, X,
  Send, Inbox, ArrowUpRight, Briefcase, DollarSign, Loader2,
  CheckCircle, XCircle, Clock, ArrowRight,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { type InsertSubcontractor, type Subcontractor } from "@shared/schema";
import { formatPhoneInput } from "@shared/phoneUtils";

function normalizeWebsite(url: string): string {
  if (!url) return '';
  let normalized = url.trim();
  if (normalized && !normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  return normalized;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ContractorForm({
  onSubmit,
  isLoading,
  initialData,
  isEdit
}: {
  onSubmit: (data: any) => void;
  isLoading: boolean;
  initialData?: any;
  isEdit?: boolean;
}) {
  const [formData, setFormData] = useState({
    name: initialData?.name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    companyName: initialData?.companyName || "",
    companyWebsite: initialData?.companyWebsite || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
      companyName: formData.companyName || null,
      companyWebsite: normalizeWebsite(formData.companyWebsite) || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 w-full">
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Name <span className="text-red-400 text-xs">*</span></label>
        <Input placeholder="Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required className="h-10" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Email</label>
        <Input type="email" placeholder="Email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="h-10" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Phone</label>
        <Input placeholder="Phone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: formatPhoneInput(e.target.value)})} inputMode="numeric" autoComplete="tel" className="h-10" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Company Name</label>
        <Input placeholder="Company Name" value={formData.companyName} onChange={(e) => setFormData({...formData, companyName: e.target.value})} className="h-10" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Company Website</label>
        <Input placeholder="Company Website" value={formData.companyWebsite} onChange={(e) => setFormData({...formData, companyWebsite: e.target.value})} className="h-10" />
      </div>
      <Button type="submit" className="w-full h-11 mt-2" disabled={isLoading}>
        {isLoading ? "Saving..." : (isEdit ? "Update Contractor" : "Add Contractor")}
      </Button>
    </form>
  );
}

const STATUS_CONFIG: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending: { color: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400", icon: Clock, label: "Pending" },
  accepted: { color: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400", icon: CheckCircle, label: "Accepted" },
  declined: { color: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400", icon: XCircle, label: "Declined" },
  completed: { color: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400", icon: CheckCircle, label: "Completed" },
};

export default function Contractors() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("contractors");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState<Subcontractor | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sendModalOpen, setSendModalOpen] = useState(false);

  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [receiverCompanyId, setReceiverCompanyId] = useState<string>("");
  const [referralType, setReferralType] = useState<string>("percent");
  const [referralValue, setReferralValue] = useState<string>("");
  const [referralMessage, setReferralMessage] = useState<string>("");
  const [allowPriceChange, setAllowPriceChange] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");

  const { data: membership } = useQuery<{ role: string }>({
    queryKey: ["/api/user/membership"],
    enabled: isAuthenticated,
  });
  const userRole = (membership?.role || "").toUpperCase();
  const canSend = userRole === "OWNER" || userRole === "ADMIN";
  const canView = canSend || userRole === "SUPERVISOR";
  const isTechnician = userRole === "TECHNICIAN";

  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontractors"],
    enabled: isAuthenticated,
  });

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated && canSend,
  });

  const { data: networkCompanies = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/companies/network"],
    enabled: isAuthenticated && canSend,
  });

  const { data: incomingReferrals = [], isLoading: incomingLoading } = useQuery<any[]>({
    queryKey: ["/api/referrals/incoming"],
    enabled: isAuthenticated && canView,
  });

  const { data: outgoingReferrals = [], isLoading: outgoingLoading } = useQuery<any[]>({
    queryKey: ["/api/referrals/outgoing"],
    enabled: isAuthenticated && canView,
  });

  const filteredSubcontractors = subcontractors.filter((sub) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return (
      sub.name?.toLowerCase().includes(query) ||
      sub.companyName?.toLowerCase().includes(query) ||
      sub.email?.toLowerCase().includes(query) ||
      sub.phone?.toLowerCase().includes(query)
    );
  });

  const filteredJobs = jobs.filter((j: any) => {
    if (!jobSearchQuery.trim()) return true;
    const q = jobSearchQuery.toLowerCase();
    return j.title?.toLowerCase().includes(q) || j.clientName?.toLowerCase().includes(q);
  });

  const createSubcontractorMutation = useMutation({
    mutationFn: async (data: InsertSubcontractor) => {
      const res = await apiRequest("POST", "/api/subcontractors", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateSubcontractorMutation = useMutation({
    mutationFn: async ({ subcontractorId, subcontractorData }: { subcontractorId: number; subcontractorData: InsertSubcontractor }) => {
      const res = await apiRequest("PATCH", `/api/subcontractors/${subcontractorId}`, subcontractorData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      setEditingSubcontractor(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteSubcontractorMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/subcontractors/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] }); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const sendReferralMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/referrals/send", payload);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/outgoing"] });
      setSendModalOpen(false);
      resetSendForm();
      toast({ title: "Job offer sent", description: "The contractor has been notified." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    },
  });

  const acceptReferralMutation = useMutation({
    mutationFn: async (referralId: number) => {
      const res = await apiRequest("POST", `/api/referrals/accept/${referralId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/incoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/outgoing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Referral accepted", description: "The job has been transferred to your company." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const declineReferralMutation = useMutation({
    mutationFn: async (referralId: number) => {
      const res = await apiRequest("POST", `/api/referrals/decline/${referralId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/incoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/outgoing"] });
      toast({ title: "Referral declined" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function resetSendForm() {
    setSelectedJobId(null);
    setReceiverCompanyId("");
    setReferralType("percent");
    setReferralValue("");
    setReferralMessage("");
    setAllowPriceChange(false);
    setJobSearchQuery("");
  }

  function handleSendSubmit() {
    if (!selectedJobId || !receiverCompanyId || !referralValue) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    sendReferralMutation.mutate({
      jobId: selectedJobId,
      receiverCompanyId: parseInt(receiverCompanyId),
      referralType,
      referralValue: parseFloat(referralValue),
      message: referralMessage || null,
      allowPriceChange,
    });
  }

  if (isLoading || !isAuthenticated || subcontractorsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600" />
      </div>
    );
  }

  const selectedJob = jobs.find((j: any) => j.id === selectedJobId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Contractor Network</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage contractors and job referrals</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-3 h-11">
          <TabsTrigger value="contractors" className="text-xs sm:text-sm">
            <Building2 className="w-4 h-4 mr-1.5 hidden sm:inline-block" />
            Contractors
          </TabsTrigger>
          {canView && (
            <TabsTrigger value="incoming" className="text-xs sm:text-sm relative">
              <Inbox className="w-4 h-4 mr-1.5 hidden sm:inline-block" />
              Incoming
              {incomingReferrals.filter((r: any) => r.status === 'pending').length > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {incomingReferrals.filter((r: any) => r.status === 'pending').length}
                </span>
              )}
            </TabsTrigger>
          )}
          {canView && (
            <TabsTrigger value="sent" className="text-xs sm:text-sm">
              <ArrowUpRight className="w-4 h-4 mr-1.5 hidden sm:inline-block" />
              Sent
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="contractors" className="mt-5 space-y-5">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
                <button onClick={() => setIsDialogOpen(false)} className="absolute right-4 top-1/2 -translate-y-1/2">
                  <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                </button>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add New Contractor</h3>
              </div>
              <div className="p-4">
                <ContractorForm onSubmit={createSubcontractorMutation.mutate} isLoading={createSubcontractorMutation.isPending} />
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!editingSubcontractor} onOpenChange={(open) => !open && setEditingSubcontractor(null)}>
            <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
                <button onClick={() => setEditingSubcontractor(null)} className="absolute right-4 top-1/2 -translate-y-1/2">
                  <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                </button>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit Contractor</h3>
              </div>
              <div className="p-4">
                <ContractorForm
                  onSubmit={(data) => updateSubcontractorMutation.mutate({ subcontractorId: editingSubcontractor!.id, subcontractorData: data })}
                  isLoading={updateSubcontractorMutation.isPending}
                  initialData={editingSubcontractor}
                  isEdit={true}
                />
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
              All Contractors ({subcontractors.length})
            </h3>
            <div className="flex gap-2">
              {canSend && (
                <Button onClick={() => { resetSendForm(); setSendModalOpen(true); }} variant="outline" className="shrink-0">
                  <Send className="w-4 h-4 mr-2" />
                  Send Job
                </Button>
              )}
              <Button onClick={() => setIsDialogOpen(true)} className="shrink-0">
                <Plus className="w-4 h-4 mr-2" />
                Add Contractor
              </Button>
            </div>
          </div>

          {subcontractors.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search contractors" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 pr-9" />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {subcontractors.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <UserCheck className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No contractors yet</h3>
                <p className="text-slate-600 dark:text-slate-400 text-center mb-4">Build your network by adding trusted contractors.</p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Contractor
                </Button>
              </CardContent>
            </Card>
          ) : filteredSubcontractors.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Search className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No contractors found</h3>
                <p className="text-slate-600 dark:text-slate-400 text-center">Try a different search</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredSubcontractors.map((subcontractor: any) => (
                <Card key={subcontractor.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2">
                      <UserCheck className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                      {subcontractor.name}
                    </CardTitle>
                    {subcontractor.companyName && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {subcontractor.companyName}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {subcontractor.email && (
                      <a href={`mailto:${subcontractor.email}`} className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer">
                        <Mail className="h-4 w-4" />
                        {subcontractor.email}
                      </a>
                    )}
                    {subcontractor.phone && (
                      <a href={`tel:${subcontractor.phone}`} className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer">
                        <Phone className="h-4 w-4" />
                        {subcontractor.phone}
                      </a>
                    )}
                    {subcontractor.companyWebsite && (
                      <a href={subcontractor.companyWebsite} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer">
                        <Globe className="h-4 w-4" />
                        Website
                      </a>
                    )}
                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <p className="text-xs text-slate-500">Added {new Date(subcontractor.createdAt).toLocaleDateString()}</p>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950" onClick={() => setEditingSubcontractor(subcontractor)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="sm:max-w-[350px] rounded-2xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Contractor</AlertDialogTitle>
                              <AlertDialogDescription>Are you sure you want to delete "{subcontractor.name}"? This action cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteSubcontractorMutation.mutate(subcontractor.id)} className="bg-red-600 hover:bg-red-700" disabled={deleteSubcontractorMutation.isPending}>
                                {deleteSubcontractorMutation.isPending ? "Deleting..." : "Delete"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {canView && (
          <TabsContent value="incoming" className="mt-5 space-y-4">
            {incomingLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : incomingReferrals.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Inbox className="h-12 w-12 text-slate-400 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No incoming referrals</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-center">Job offers from other contractors will appear here.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {incomingReferrals.map((ref: any) => {
                  const sc = STATUS_CONFIG[ref.status] || STATUS_CONFIG.pending;
                  const StatusIcon = sc.icon;
                  const feeDisplay = ref.referralType === 'percent'
                    ? `${ref.referralValue}%`
                    : `$${parseFloat(ref.referralValue || '0').toFixed(2)}`;

                  return (
                    <div key={ref.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Briefcase className="w-4 h-4 text-slate-400 shrink-0" />
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{ref.jobTitle || 'Untitled Job'}</p>
                            </div>
                            {ref.customerName && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 ml-6">{ref.customerName}</p>
                            )}
                          </div>
                          <span className={`${sc.color} text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 shrink-0`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5" />
                            From: {ref.senderCompanyName || 'Unknown'}
                          </span>
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5" />
                            Referral fee: {feeDisplay}
                          </span>
                        </div>

                        {ref.message && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg p-2.5 italic">
                            "{ref.message}"
                          </p>
                        )}

                        {ref.status === 'pending' && canSend && (
                          <div className="flex gap-2 pt-1">
                            <Button
                              size="sm"
                              className="flex-1 h-9 text-sm"
                              onClick={() => acceptReferralMutation.mutate(ref.id)}
                              disabled={acceptReferralMutation.isPending || declineReferralMutation.isPending}
                            >
                              {acceptReferralMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                              Accept Job
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 h-9 text-sm text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                              onClick={() => declineReferralMutation.mutate(ref.id)}
                              disabled={acceptReferralMutation.isPending || declineReferralMutation.isPending}
                            >
                              {declineReferralMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
                              Decline
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        )}

        {canView && (
          <TabsContent value="sent" className="mt-5 space-y-4">
            {canSend && (
              <div className="flex justify-end">
                <Button onClick={() => { resetSendForm(); setSendModalOpen(true); }} size="sm">
                  <Send className="w-4 h-4 mr-2" />
                  Send Job
                </Button>
              </div>
            )}
            {outgoingLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : outgoingReferrals.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <ArrowUpRight className="h-12 w-12 text-slate-400 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No sent referrals</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-center">Jobs you send to other contractors will appear here.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {outgoingReferrals.map((ref: any) => {
                  const sc = STATUS_CONFIG[ref.status] || STATUS_CONFIG.pending;
                  const StatusIcon = sc.icon;
                  const feeDisplay = ref.referralType === 'percent'
                    ? `${ref.referralValue}%`
                    : `$${parseFloat(ref.referralValue || '0').toFixed(2)}`;

                  const jobCost = parseFloat(ref.jobEstimatedCost || '0');
                  let expectedEarnings = '';
                  if (jobCost > 0) {
                    if (ref.referralType === 'percent') {
                      const earn = jobCost * (parseFloat(ref.referralValue || '0') / 100);
                      expectedEarnings = `$${earn.toFixed(2)}`;
                    } else {
                      expectedEarnings = `$${parseFloat(ref.referralValue || '0').toFixed(2)}`;
                    }
                  }

                  return (
                    <div key={ref.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Briefcase className="w-4 h-4 text-slate-400 shrink-0" />
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{ref.jobTitle || 'Untitled Job'}</p>
                            </div>
                            {ref.customerName && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 ml-6">{ref.customerName}</p>
                            )}
                          </div>
                          <span className={`${sc.color} text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 shrink-0`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5" />
                            To: {ref.receiverCompanyName || 'Unknown'}
                          </span>
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5" />
                            Fee: {feeDisplay}
                          </span>
                          {expectedEarnings && (
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                              <ArrowRight className="w-3.5 h-3.5" />
                              Expected: {expectedEarnings}
                            </span>
                          )}
                        </div>

                        {ref.message && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg p-2.5 italic">
                            "{ref.message}"
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={sendModalOpen} onOpenChange={(open) => { if (!open) { setSendModalOpen(false); resetSendForm(); } }}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-lg p-0 gap-0 rounded-2xl overflow-hidden max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative shrink-0">
            <button onClick={() => { setSendModalOpen(false); resetSendForm(); }} className="absolute right-4 top-1/2 -translate-y-1/2">
              <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            </button>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Send Job Offer</h3>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Select Job <span className="text-red-400 text-xs">*</span></label>
              {selectedJob ? (
                <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{selectedJob.title}</p>
                    {selectedJob.clientName && <p className="text-xs text-slate-500">{selectedJob.clientName}</p>}
                  </div>
                  <button onClick={() => setSelectedJobId(null)} className="text-slate-400 hover:text-slate-600 ml-2 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input placeholder="Search jobs..." value={jobSearchQuery} onChange={(e) => setJobSearchQuery(e.target.value)} className="pl-9 h-10" />
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredJobs.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">No jobs found</p>
                    ) : (
                      filteredJobs.slice(0, 20).map((job: any) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => { setSelectedJobId(job.id); setJobSearchQuery(""); }}
                          className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{job.title}</p>
                          {job.clientName && <p className="text-xs text-slate-500 truncate">{job.clientName}</p>}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Select Contractor <span className="text-red-400 text-xs">*</span></label>
              <Select value={receiverCompanyId} onValueChange={setReceiverCompanyId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Choose a contractor company" />
                </SelectTrigger>
                <SelectContent>
                  {networkCompanies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Fee Type <span className="text-red-400 text-xs">*</span></label>
                <Select value={referralType} onValueChange={setReferralType}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage</SelectItem>
                    <SelectItem value="flat">Flat Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">
                  {referralType === 'percent' ? 'Percentage' : 'Amount ($)'} <span className="text-red-400 text-xs">*</span>
                </label>
                <Input
                  type="number"
                  step={referralType === 'percent' ? '1' : '0.01'}
                  min="0"
                  placeholder={referralType === 'percent' ? '10' : '500.00'}
                  value={referralValue}
                  onChange={(e) => setReferralValue(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Message</label>
              <Textarea
                placeholder="Add a note for the contractor (optional)"
                value={referralMessage}
                onChange={(e) => setReferralMessage(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-3">
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Allow price changes</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Let the contractor modify the job price</p>
              </div>
              <Switch checked={allowPriceChange} onCheckedChange={setAllowPriceChange} />
            </div>

            <Button
              onClick={handleSendSubmit}
              className="w-full h-11"
              disabled={sendReferralMutation.isPending || !selectedJobId || !receiverCompanyId || !referralValue}
            >
              {sendReferralMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Send Job Offer</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
