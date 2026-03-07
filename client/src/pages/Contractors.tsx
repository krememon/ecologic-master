import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  CheckCircle, XCircle, Clock, ArrowRight, Percent, Share2, Copy, MapPin,
} from "lucide-react";
import { useLocation } from "wouter";
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


function contractorDisplayName(sub: any): string {
  return sub.companyName || sub.name || 'Unknown';
}

function contractorPersonalName(sub: any): string | null {
  if (sub.companyName && sub.name && sub.name !== sub.companyName) return sub.name;
  return null;
}

interface BusinessSuggestion {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
}

function ContractorForm({
  onSubmit,
  isLoading,
  initialData,
  isEdit,
}: {
  onSubmit: (data: any) => void;
  isLoading: boolean;
  initialData?: any;
  isEdit?: boolean;
}) {
  const [formData, setFormData] = useState({
    companyName: initialData?.companyName || initialData?.name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    companyWebsite: initialData?.companyWebsite || "",
    personalName: (initialData?.companyName && initialData?.name && initialData.name !== initialData.companyName) ? initialData.name : "",
  });

  const [suggestions, setSuggestions] = useState<BusinessSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSearchLoading(true);
    setSearchError(false);
    try {
      const res = await fetch(`/api/business-search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data: BusinessSuggestion[] = await res.json();
      setSuggestions(data);
      setShowSuggestions(data.length > 0 || query.length >= 2);
    } catch {
      setSuggestions([]);
      setSearchError(true);
      setShowSuggestions(true);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleCompanyNameChange = (value: string) => {
    setFormData({ ...formData, companyName: value });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 2) {
      debounceRef.current = setTimeout(() => fetchSuggestions(value.trim()), 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (s: BusinessSuggestion) => {
    setFormData((prev) => ({
      ...prev,
      companyName: s.name,
      phone: s.phone || prev.phone,
      email: s.email || prev.email,
      companyWebsite: s.website || prev.companyWebsite,
    }));
    setShowSuggestions(false);
    setSuggestions([]);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const companyName = formData.companyName.trim();
    const personalName = formData.personalName.trim();
    onSubmit({
      name: personalName || companyName,
      email: formData.email || null,
      phone: formData.phone || null,
      companyName: companyName,
      companyWebsite: normalizeWebsite(formData.companyWebsite) || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 w-full">
      <div className="space-y-1 relative" ref={wrapperRef}>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Company Name <span className="text-red-400 text-xs">*</span></label>
        <Input
          placeholder="Company Name"
          value={formData.companyName}
          onChange={(e) => handleCompanyNameChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          required
          autoComplete="off"
          className="h-10"
        />
        {showSuggestions && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-52 overflow-y-auto">
            {searchLoading ? (
              <div className="flex items-center justify-center py-4 gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching...
              </div>
            ) : searchError ? (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">Search unavailable</div>
            ) : suggestions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">No trade businesses found</div>
            ) : (
              suggestions.map((s, i) => {
                const sub = [s.city, s.state].filter(Boolean).join(', ') || s.website || s.phone || '';
                return (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors first:rounded-t-xl last:rounded-b-xl"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectSuggestion(s)}
                  >
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{s.name}</p>
                    {sub && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{sub}</p>}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Email</label>
        <Input type="email" placeholder="Email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="h-10" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Phone</label>
        <Input placeholder="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: formatPhoneInput(e.target.value) })} inputMode="numeric" autoComplete="tel" className="h-10" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Company Website</label>
        <Input placeholder="Company Website" value={formData.companyWebsite} onChange={(e) => setFormData({ ...formData, companyWebsite: e.target.value })} className="h-10" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Personal Name</label>
        <Input placeholder="Personal Name" value={formData.personalName} onChange={(e) => setFormData({ ...formData, personalName: e.target.value })} className="h-10" />
      </div>
      <Button type="submit" className="w-full h-11 mt-2" disabled={isLoading}>
        {isLoading ? "Saving..." : isEdit ? "Update Contractor" : "Add Contractor"}
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


function feeBadge(type: string, value: string) {
  const v = parseFloat(value || '0');
  if (type === 'percent') return `${v}%`;
  return `$${v.toFixed(2)}`;
}

function jobSecondaryInfo(job: any): string {
  const parts: string[] = [];
  const titleLower = (job.title || '').toLowerCase();
  const clientName = job.clientName || job.customerName || '';
  if (clientName && !titleLower.includes(clientName.toLowerCase())) {
    parts.push(clientName);
  }
  const loc = job.location || job.address || '';
  if (loc) {
    const short = loc.length > 40 ? loc.substring(0, 40) + '...' : loc;
    parts.push(short);
  }
  return parts.join(' · ');
}

export default function Contractors() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("contractors");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState<Subcontractor | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sendModalOpen, setSendModalOpen] = useState(false);

  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [receiverCompanyId, setReceiverCompanyId] = useState<string>("");
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<string>("");
  const [contractorSearchQuery, setContractorSearchQuery] = useState<string>("");
  const [contractorPickerOpen, setContractorPickerOpen] = useState(false);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [referralType, setReferralType] = useState<string>("percent");
  const [referralValue, setReferralValue] = useState<string>("");
  const [referralMessage, setReferralMessage] = useState<string>("");
  const [allowPriceChange, setAllowPriceChange] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [feeError, setFeeError] = useState<string>("");
  const [isSharing, setIsSharing] = useState(false);

  const { data: membership } = useQuery<{ role: string }>({
    queryKey: ["/api/user/membership"],
    enabled: isAuthenticated,
  });
  const userRole = (membership?.role || "").toUpperCase();
  const canSend = userRole === "OWNER" || userRole === "ADMIN";
  const canView = canSend || userRole === "SUPERVISOR";

  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontractors"],
    enabled: isAuthenticated,
  });

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
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
    const q = searchQuery.toLowerCase().trim();
    return sub.name?.toLowerCase().includes(q) || sub.companyName?.toLowerCase().includes(q) || sub.email?.toLowerCase().includes(q) || sub.phone?.toLowerCase().includes(q);
  });

  const filteredJobs = jobs.filter((j: any) => {
    if (!jobSearchQuery.trim()) return true;
    const q = jobSearchQuery.toLowerCase();
    return j.title?.toLowerCase().includes(q) || j.clientName?.toLowerCase().includes(q) || j.customerName?.toLowerCase().includes(q);
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
      toast({ title: "Contractor updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteSubcontractorMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/subcontractors/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const sendReferralMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/referrals/send", payload);
      return await res.json();
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
    setSelectedSubcontractorId("");
    setContractorSearchQuery("");
    setContractorPickerOpen(false);
    setJobPickerOpen(false);
    setReferralType("percent");
    setReferralValue("");
    setReferralMessage("");
    setAllowPriceChange(false);
    setJobSearchQuery("");
    setFeeError("");
    setIsSharing(false);
  }

  function validateFee(type: string, val: string): string {
    const num = parseFloat(val);
    if (!val || isNaN(num) || num <= 0) return type === 'percent' ? 'Must be between 1 and 100' : 'Must be greater than 0';
    if (type === 'percent' && num > 100) return 'Cannot exceed 100%';
    return '';
  }

  function handleFeeChange(val: string) {
    setReferralValue(val);
    if (val) setFeeError(validateFee(referralType, val));
    else setFeeError('');
  }

  function handleFeeTypeChange(type: string) {
    setReferralType(type);
    if (referralValue) setFeeError(validateFee(type, referralValue));
  }

  const selectedJob = jobs.find((j: any) => j.id === selectedJobId);
  const jobPrice = selectedJob ? parseFloat(selectedJob.estimatedCost || selectedJob.actualCost || selectedJob.totalCents || '0') : 0;
  const feeNum = parseFloat(referralValue || '0');
  const estimatedEarnings = referralType === 'percent' ? jobPrice * (feeNum / 100) : feeNum;
  const canSubmitSend = !!selectedJobId && !!selectedSubcontractorId && !!referralValue && !feeError && !sendReferralMutation.isPending && !isSharing;

  async function handleShareInvite() {
    const err = validateFee(referralType, referralValue);
    if (err) { setFeeError(err); return; }
    setIsSharing(true);
    try {
      const selectedSub = subcontractors.find((s: any) => String(s.id) === selectedSubcontractorId);
      const result = await sendReferralMutation.mutateAsync({
        jobId: selectedJobId,
        receiverCompanyId: null,
        referralType,
        referralValue: feeNum,
        message: referralMessage || null,
        allowPriceChange,
      });

      const inviteUrl = result.inviteUrl;
      if (!inviteUrl) {
        toast({ title: "Error", description: "No invite link returned", variant: "destructive" });
        setIsSharing(false);
        return;
      }

      const companyName = selectedSub ? contractorDisplayName(selectedSub) : "contractor";
      const jobTitle = selectedJob?.title || "Job";
      const customerName = selectedJob?.customerName || "";
      const address = selectedJob?.address || selectedJob?.location || "";

      let shareText = `EcoLogic Job Offer\nJob: ${jobTitle}`;
      if (customerName) shareText += `\nCustomer: ${customerName}`;
      if (address) shareText += `\nAddress: ${address}`;
      shareText += `\n\nAccept or Decline: ${inviteUrl}`;

      let shared = false;
      if (navigator.share) {
        try {
          await navigator.share({ title: "EcoLogic Job Offer", text: shareText });
          shared = true;
          toast({ title: "Invite ready", description: "Choose how to share" });
        } catch (shareErr: any) {
          if (shareErr.name !== "AbortError") {
            console.log("[share] navigator.share failed, falling back to clipboard");
          }
        }
      }

      if (!shared) {
        try {
          await navigator.clipboard.writeText(shareText);
          toast({ title: "Invite link copied", description: "Paste it in any app to share" });
        } catch {
          toast({ title: "Invite created", description: inviteUrl });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/referrals/outgoing"] });
      setSendModalOpen(false);
      resetSendForm();
    } catch {
    } finally {
      setIsSharing(false);
    }
  }

  if (isLoading || !isAuthenticated || subcontractorsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600" />
      </div>
    );
  }

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
          {canView ? (
            <TabsTrigger value="incoming" className="text-xs sm:text-sm relative">
              <Inbox className="w-4 h-4 mr-1.5 hidden sm:inline-block" />
              Incoming
              {incomingReferrals.filter((r: any) => r.status === 'pending').length > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {incomingReferrals.filter((r: any) => r.status === 'pending').length}
                </span>
              )}
            </TabsTrigger>
          ) : (
            <TabsTrigger value="incoming" disabled className="text-xs sm:text-sm opacity-40">Incoming</TabsTrigger>
          )}
          {canView ? (
            <TabsTrigger value="sent" className="text-xs sm:text-sm">
              <ArrowUpRight className="w-4 h-4 mr-1.5 hidden sm:inline-block" />
              Sent
            </TabsTrigger>
          ) : (
            <TabsTrigger value="sent" disabled className="text-xs sm:text-sm opacity-40">Sent</TabsTrigger>
          )}
        </TabsList>

        {/* ====== CONTRACTORS TAB ====== */}
        <TabsContent value="contractors" className="mt-5 space-y-5">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
                <button onClick={() => setIsDialogOpen(false)} className="absolute right-4 top-1/2 -translate-y-1/2"><X className="h-5 w-5 text-slate-500 dark:text-slate-400" /></button>
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
                <button onClick={() => setEditingSubcontractor(null)} className="absolute right-4 top-1/2 -translate-y-1/2"><X className="h-5 w-5 text-slate-500 dark:text-slate-400" /></button>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit Contractor</h3>
              </div>
              <div className="p-4">
                <ContractorForm
                  onSubmit={(data) => updateSubcontractorMutation.mutate({ subcontractorId: editingSubcontractor!.id, subcontractorData: data })}
                  isLoading={updateSubcontractorMutation.isPending}
                  initialData={editingSubcontractor}
                  isEdit
                />
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
              All Contractors ({subcontractors.length})
            </h3>
            <div className="flex gap-2">
              {canSend && (
                <Button onClick={() => { resetSendForm(); setSendModalOpen(true); }} variant="outline" size="sm">
                  <Send className="w-4 h-4 mr-1.5" />
                  Send Job
                </Button>
              )}
              <Button onClick={() => setIsDialogOpen(true)} size="sm">
                <Plus className="w-4 h-4 mr-1.5" />
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
                <Button onClick={() => setIsDialogOpen(true)}><Plus className="w-4 h-4 mr-2" />Add Your First Contractor</Button>
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
              {filteredSubcontractors.map((sub: any) => (
                <Card key={sub.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/subcontractors/${sub.id}`)}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        {contractorDisplayName(sub)}
                      </CardTitle>
                      <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950" onClick={() => setEditingSubcontractor(sub)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"><Trash2 className="h-3.5 w-3.5" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="sm:max-w-[350px] rounded-2xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Contractor</AlertDialogTitle>
                              <AlertDialogDescription>Are you sure you want to delete "{contractorDisplayName(sub)}"? This action cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteSubcontractorMutation.mutate(sub.id)} className="bg-red-600 hover:bg-red-700" disabled={deleteSubcontractorMutation.isPending}>
                                {deleteSubcontractorMutation.isPending ? "Deleting..." : "Delete"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    {contractorPersonalName(sub) && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{contractorPersonalName(sub)}</p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    {sub.email && (
                      <a
                        href={`mailto:${sub.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                      >
                        <Mail className="h-4 w-4 shrink-0" />
                        <span className="truncate">{sub.email}</span>
                      </a>
                    )}
                    {sub.phone && (
                      <a
                        href={`tel:${sub.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                      >
                        <Phone className="h-4 w-4 shrink-0" />
                        <span className="truncate">{sub.phone}</span>
                      </a>
                    )}
                    {sub.companyWebsite && (
                      <a
                        href={sub.companyWebsite.startsWith('http') ? sub.companyWebsite : `https://${sub.companyWebsite}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                      >
                        <Globe className="h-4 w-4 shrink-0" />
                        <span className="truncate">{sub.companyWebsite.replace(/^https?:\/\//, '')}</span>
                      </a>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                      <p className="text-xs text-slate-400">Added {new Date(sub.createdAt).toLocaleDateString()}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ====== INCOMING TAB ====== */}
        {canView && (
          <TabsContent value="incoming" className="mt-5 space-y-3">
            {incomingLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : incomingReferrals.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Inbox className="h-12 w-12 text-slate-400 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No incoming referrals</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-center">Job offers from other contractors will appear here.</p>
                </CardContent>
              </Card>
            ) : (
              incomingReferrals.map((ref: any) => {
                const sc = STATUS_CONFIG[ref.status] || STATUS_CONFIG.pending;
                const StatusIcon = sc.icon;
                return (
                  <div key={ref.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                            <Briefcase className="w-4 h-4 text-slate-400 shrink-0" />
                            {ref.jobTitle || 'Untitled Job'}
                          </p>
                          {ref.customerName && <p className="text-xs text-slate-500 dark:text-slate-400 ml-[22px]">{ref.customerName}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-[11px] font-bold px-2 py-0.5 rounded-full">
                            {feeBadge(ref.referralType, ref.referralValue)}
                          </span>
                          <span className={`${sc.color} text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 ml-[22px]">
                        <Building2 className="w-3.5 h-3.5" />
                        From: <span className="font-medium text-slate-700 dark:text-slate-300">{ref.senderCompanyName || 'Unknown'}</span>
                      </div>

                      {ref.message && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2 italic ml-[22px]">"{ref.message}"</p>
                      )}

                      {ref.status === 'pending' && canSend && (
                        <div className="flex gap-2 pt-1 ml-[22px]">
                          <Button size="sm" className="flex-1 h-9 text-sm" onClick={() => acceptReferralMutation.mutate(ref.id)} disabled={acceptReferralMutation.isPending || declineReferralMutation.isPending}>
                            {acceptReferralMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
                            Accept
                          </Button>
                          <Button size="sm" variant="outline" className="flex-1 h-9 text-sm text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950" onClick={() => declineReferralMutation.mutate(ref.id)} disabled={acceptReferralMutation.isPending || declineReferralMutation.isPending}>
                            {declineReferralMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
                            Decline
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>
        )}

        {/* ====== SENT TAB ====== */}
        {canView && (
          <TabsContent value="sent" className="mt-5 space-y-3">
            {canSend && (
              <div className="flex justify-end mb-1">
                <Button onClick={() => { resetSendForm(); setSendModalOpen(true); }} size="sm">
                  <Send className="w-4 h-4 mr-1.5" />Send Job
                </Button>
              </div>
            )}
            {outgoingLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : outgoingReferrals.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <ArrowUpRight className="h-12 w-12 text-slate-400 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No sent referrals</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-center">Jobs you send to other contractors will appear here.</p>
                </CardContent>
              </Card>
            ) : (
              outgoingReferrals.map((ref: any) => {
                const sc = STATUS_CONFIG[ref.status] || STATUS_CONFIG.pending;
                const StatusIcon = sc.icon;
                const jPrice = parseFloat(ref.jobEstimatedCost || '0');
                const rVal = parseFloat(ref.referralValue || '0');
                const earnings = ref.referralType === 'percent' ? jPrice * (rVal / 100) : rVal;

                return (
                  <div key={ref.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                            <Briefcase className="w-4 h-4 text-slate-400 shrink-0" />
                            {ref.jobTitle || 'Untitled Job'}
                          </p>
                          {ref.customerName && <p className="text-xs text-slate-500 dark:text-slate-400 ml-[22px]">{ref.customerName}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-[11px] font-bold px-2 py-0.5 rounded-full">
                            {feeBadge(ref.referralType, ref.referralValue)}
                          </span>
                          <span className={`${sc.color} text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 ml-[22px]">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          To: <span className="font-medium text-slate-700 dark:text-slate-300">{ref.receiverCompanyName || 'Unknown'}</span>
                        </span>
                        {jPrice > 0 && earnings > 0 && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <DollarSign className="w-3.5 h-3.5" />
                            Expected: ${earnings.toFixed(2)}
                          </span>
                        )}
                      </div>

                      {ref.message && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2 italic ml-[22px]">"{ref.message}"</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* ====== SEND JOB MODAL ====== */}
      {canSend && (
        <Dialog open={sendModalOpen} onOpenChange={(open) => { if (!open) { setSendModalOpen(false); resetSendForm(); } }}>
          <DialogContent hideCloseButton className="w-[95vw] max-w-lg p-0 gap-0 rounded-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-center py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative shrink-0">
              <button onClick={() => { setSendModalOpen(false); resetSendForm(); }} className="absolute right-4 top-1/2 -translate-y-1/2">
                <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              </button>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Send Job Offer</h3>
            </div>

            <div className="px-4 pt-3 pb-4 space-y-3 overflow-y-auto flex-1">
              {/* Select Job */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Select Job <span className="text-red-400 text-xs">*</span></label>
                {selectedJob ? (
                  <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center shrink-0">
                        <Briefcase className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{selectedJob.title}</p>
                        {jobSecondaryInfo(selectedJob) && (
                          <p className="text-xs text-slate-500 truncate">{jobSecondaryInfo(selectedJob)}</p>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setSelectedJobId(null)} className="text-slate-400 hover:text-slate-600 ml-2 shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setJobPickerOpen(true)}
                    className="w-full flex items-center justify-between h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                  >
                    <span>Choose a job</span>
                    <Search className="h-4 w-4 text-slate-400" />
                  </button>
                )}
              </div>

              {/* Select Contractor */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Select Contractor <span className="text-red-400 text-xs">*</span></label>
                {(() => {
                  const selectedSub = subcontractors.find((s: any) => String(s.id) === selectedSubcontractorId);
                  if (selectedSub) {
                    const personal = contractorPersonalName(selectedSub);
                    return (
                      <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                            {(selectedSub.companyName || selectedSub.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{contractorDisplayName(selectedSub)}</p>
                            {personal && <p className="text-xs text-slate-500 truncate">{personal}</p>}
                          </div>
                        </div>
                        <button onClick={() => setSelectedSubcontractorId("")} className="text-slate-400 hover:text-slate-600 ml-2 shrink-0"><X className="w-4 h-4" /></button>
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => setContractorPickerOpen(true)}
                      className="w-full flex items-center justify-between h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                    >
                      <span>Choose a contractor</span>
                      <Search className="h-4 w-4 text-slate-400" />
                    </button>
                  );
                })()}
              </div>

              {/* Fee */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Fee Type <span className="text-red-400 text-xs">*</span></label>
                  <Select value={referralType} onValueChange={handleFeeTypeChange}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="percent">Percentage</SelectItem>
                      <SelectItem value="flat">Flat Amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">
                    {referralType === 'percent' ? 'Percentage (%)' : 'Flat Amount ($)'} <span className="text-red-400 text-xs">*</span>
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step={referralType === 'percent' ? '1' : '0.01'}
                      min="0"
                      max={referralType === 'percent' ? '100' : undefined}
                      value={referralValue}
                      onChange={(e) => handleFeeChange(e.target.value)}
                      className={`h-10 pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${feeError ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
                      {referralType === 'percent' ? '%' : '$'}
                    </span>
                  </div>
                  {feeError && <p className="text-xs text-red-500 mt-0.5">{feeError}</p>}
                </div>
              </div>

              {/* Fee Summary */}
              {referralValue && !feeError && feeNum > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1">
                    {referralType === 'percent' ? <Percent className="w-3 h-3" /> : <DollarSign className="w-3 h-3" />}
                    Referral: {referralType === 'percent' ? `${feeNum}%` : `$${feeNum.toFixed(2)}`}
                  </span>
                  {jobPrice > 0 && estimatedEarnings > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                      <ArrowRight className="w-3 h-3" />
                      Estimated earnings: ${estimatedEarnings.toFixed(2)}
                    </span>
                  )}
                </div>
              )}

              {/* Message */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Message</label>
                <Textarea placeholder="Add a note for the contractor (optional)" value={referralMessage} onChange={(e) => setReferralMessage(e.target.value)} rows={2} className="resize-none text-sm" />
              </div>

              {/* Price change toggle */}
              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Allow price changes</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Let the contractor modify the job price</p>
                </div>
                <Switch checked={allowPriceChange} onCheckedChange={setAllowPriceChange} />
              </div>

              <Button onClick={handleShareInvite} className="w-full h-11" disabled={!canSubmitSend}>
                {isSharing || sendReferralMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Creating invite...</>
                ) : (
                  <><Share2 className="w-4 h-4 mr-2" />Share Invite</>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Contractor Picker Modal */}
      <Dialog open={contractorPickerOpen} onOpenChange={(open) => { if (!open) { setContractorPickerOpen(false); setContractorSearchQuery(""); } }}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="min-w-[44px]" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Select Contractor</h3>
            <button
              onClick={() => { setContractorPickerOpen(false); setContractorSearchQuery(""); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-3 bg-white dark:bg-slate-900">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search contractors..."
                value={contractorSearchQuery}
                onChange={(e) => setContractorSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          <div className="max-h-80 overflow-y-auto bg-white dark:bg-slate-900">
            {(() => {
              const cq = contractorSearchQuery.toLowerCase().trim();
              const filtered = subcontractors.filter((sub: any) => {
                if (!cq) return true;
                return (sub.companyName || '').toLowerCase().includes(cq)
                  || (sub.name || '').toLowerCase().includes(cq)
                  || (sub.email || '').toLowerCase().includes(cq)
                  || (sub.phone || '').toLowerCase().includes(cq);
              });

              if (subcontractors.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <Building2 className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="font-medium text-slate-600 dark:text-slate-400 text-center">No saved contractors yet</p>
                  </div>
                );
              }

              if (filtered.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <Search className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="font-medium text-slate-600 dark:text-slate-400 text-center">No contractors found</p>
                    <p className="text-sm text-slate-400 mt-1">Try a different search term</p>
                  </div>
                );
              }

              return (
                <div className="py-1">
                  {filtered.map((sub: any, index: number) => {
                    const personal = contractorPersonalName(sub);
                    const initial = (sub.companyName || sub.name || '?').charAt(0).toUpperCase();
                    return (
                      <div key={sub.id}>
                        <button
                          type="button"
                          className="w-full flex items-center gap-3 px-4 min-h-[60px] text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800 transition-colors"
                          onClick={() => {
                            setSelectedSubcontractorId(String(sub.id));
                            setContractorSearchQuery("");
                            setContractorPickerOpen(false);
                          }}
                        >
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                            {initial}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{contractorDisplayName(sub)}</p>
                            {personal && <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{personal}</p>}
                            {!personal && sub.email && <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{sub.email}</p>}
                          </div>
                        </button>
                        {index < filtered.length - 1 && (
                          <div className="h-px bg-slate-100 dark:bg-slate-800 ml-[68px] mr-4" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Job Picker Modal */}
      <Dialog open={jobPickerOpen} onOpenChange={(open) => { if (!open) { setJobPickerOpen(false); setJobSearchQuery(""); } }}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="min-w-[44px]" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Select Job</h3>
            <button
              onClick={() => { setJobPickerOpen(false); setJobSearchQuery(""); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-3 bg-white dark:bg-slate-900">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search jobs..."
                value={jobSearchQuery}
                onChange={(e) => setJobSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          <div className="max-h-80 overflow-y-auto bg-white dark:bg-slate-900">
            {(() => {
              if (jobs.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <Briefcase className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="font-medium text-slate-600 dark:text-slate-400 text-center">No jobs to send yet. Create a job first.</p>
                  </div>
                );
              }

              if (filteredJobs.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <Search className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="font-medium text-slate-600 dark:text-slate-400 text-center">No jobs found</p>
                    <p className="text-sm text-slate-400 mt-1">Try a different search term</p>
                  </div>
                );
              }

              return (
                <div className="py-1">
                  {filteredJobs.slice(0, 30).map((job: any, index: number) => {
                    const secondary = jobSecondaryInfo(job);
                    return (
                      <div key={job.id}>
                        <button
                          type="button"
                          className="w-full flex items-center gap-3 px-4 min-h-[60px] text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800 transition-colors"
                          onClick={() => {
                            setSelectedJobId(job.id);
                            setJobSearchQuery("");
                            setJobPickerOpen(false);
                          }}
                        >
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center shrink-0">
                            <Briefcase className="h-4.5 w-4.5 text-slate-600 dark:text-slate-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{job.title}</p>
                            {secondary && <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{secondary}</p>}
                          </div>
                        </button>
                        {index < filteredJobs.length - 1 && (
                          <div className="h-px bg-slate-100 dark:bg-slate-800 ml-[68px] mr-4" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
