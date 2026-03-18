import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Redirect } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Building2, Users, Briefcase, CreditCard,
  ShieldOff, ShieldCheck, Ban, Unlock, RefreshCw,
  UserCircle, Mail, Calendar, Hash, Loader2,
  AlertTriangle, ChevronRight
} from "lucide-react";

const DEV_ALLOWLIST = ['pjpell077@gmail.com'];

type SearchMode = "code" | "email" | "name";

interface CompanyBasic {
  id: number;
  name: string;
  companyCode: string | null;
  ownerEmail: string | null;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  adminFreeAccess: boolean;
  adminBypassSubscription: boolean;
  adminPaused: boolean;
  adminIsDemo: boolean;
  createdAt: string | null;
}

interface UserData {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

interface JobData {
  id: number;
  title: string;
  status: string;
  clientName: string | null;
  startDate: string | null;
  createdAt: string | null;
}

interface InvoiceData {
  id: number;
  invoiceNumber: string;
  totalCents: number;
  paidAmountCents: number;
  balanceDueCents: number;
  status: string;
  paidAt: string | null;
  createdAt: string | null;
}

function SubscriptionBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">None</Badge>;
  const map: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
    active: "default",
    trialing: "outline",
    canceled: "destructive",
    past_due: "destructive",
    inactive: "secondary",
  };
  return <Badge variant={map[status] ?? "secondary"}>{status}</Badge>;
}

function BoolBadge({ value, trueLabel, falseLabel, trueVariant = "default", falseVariant = "secondary" }: {
  value: boolean;
  trueLabel: string;
  falseLabel: string;
  trueVariant?: "default" | "destructive" | "outline" | "secondary";
  falseVariant?: "default" | "destructive" | "outline" | "secondary";
}) {
  return <Badge variant={value ? trueVariant : falseVariant}>{value ? trueLabel : falseLabel}</Badge>;
}

function centsToDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function EmptySection({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400 dark:text-slate-500">
      <Icon className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function DevTools() {
  const { user } = useAuth() as { user: any };
  const { toast } = useToast();

  const [searchMode, setSearchMode] = useState<SearchMode>("code");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Multiple results (name search)
  const [searchResults, setSearchResults] = useState<CompanyBasic[]>([]);

  // Selected company + detail data
  const [company, setCompany] = useState<CompanyBasic | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);

  if (!user || !DEV_ALLOWLIST.includes(user.email)) {
    return <Redirect to="/jobs" />;
  }

  const placeholderAction = (label: string) => {
    toast({ title: "Not wired yet", description: `"${label}" will be enabled in the next step.` });
  };

  const clearDetail = () => {
    setCompany(null);
    setUsers([]);
    setJobs([]);
    setInvoices([]);
  };

  const loadDetail = async (id: number) => {
    setIsLoadingDetail(true);
    clearDetail();
    try {
      const res = await fetch(`/api/admin/company/${id}/detail`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        setCompany(data.company);
        setUsers(data.users ?? []);
        setJobs(data.jobs ?? []);
        setInvoices(data.invoices ?? []);
        setSearchResults([]);
      } else {
        toast({ title: "Failed to load detail", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    setHasSearched(true);
    clearDetail();
    setSearchResults([]);

    try {
      const res = await fetch(`/api/admin/company/search?mode=${searchMode}&q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Search failed");

      const results: CompanyBasic[] = data.companies ?? [];

      if (results.length === 0) {
        // nothing — hasSearched will show "not found"
      } else if (results.length === 1) {
        // Single result — auto-select and load detail
        await loadDetail(results[0].id);
      } else {
        // Multiple results (name search) — show picker
        setSearchResults(results);
      }
    } catch (e: any) {
      toast({ title: "Search failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const searchModes: { key: SearchMode; label: string }[] = [
    { key: "code", label: "Company ID" },
    { key: "email", label: "Owner Email" },
    { key: "name", label: "Company Name" },
  ];

  const showNoResults = hasSearched && !isSearching && !isLoadingDetail && !company && searchResults.length === 0;
  const showPicker = searchResults.length > 1 && !company;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">

      {/* ── HEADER ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between pt-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Dev Tools</h1>
            <Badge variant="outline" className="text-xs font-mono border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950">
              ADMIN ONLY
            </Badge>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Internal admin controls — not visible to regular users</p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 mt-1">
          <UserCircle className="h-3.5 w-3.5" />
          <span className="font-mono">{user.email}</span>
        </div>
      </div>

      {/* ── LOOKUP ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-500" />
            Find Company
          </CardTitle>
          <CardDescription>Look up any company by company ID, owner email, or name</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search mode tabs */}
          <div className="flex gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 w-fit">
            {searchModes.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setSearchMode(key); setSearchQuery(""); }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  searchMode === key
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => {
                const raw = e.target.value;
                setSearchQuery(searchMode === "code" ? raw.toUpperCase().slice(0, 6) : raw);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              maxLength={searchMode === "code" ? 6 : undefined}
              placeholder={
                searchMode === "code" ? "Enter company ID..." :
                searchMode === "email" ? "owner@company.com" :
                "Company name..."
              }
              className="font-mono text-sm"
            />
            <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()} className="shrink-0">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">Search</span>
            </Button>
          </div>

          {/* No results */}
          {showNoResults && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-2 pl-1">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              No company found for that query.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── MULTIPLE RESULTS PICKER ──────────────────────────────── */}
      {showPicker && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-500" />
              Select a Company
            </CardTitle>
            <CardDescription>{searchResults.length} matches found — tap one to load its details</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadDetail(r.id)}
                  className="w-full flex items-center justify-between px-6 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">{r.companyCode ?? "—"} · {r.ownerEmail ?? "no owner"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <SubscriptionBadge status={r.subscriptionStatus} />
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── DETAIL LOADING ────────────────────────────────────────── */}
      {isLoadingDetail && (
        <div className="flex items-center justify-center py-12 gap-3 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading company data…</span>
        </div>
      )}

      {/* ── COMPANY OVERVIEW ────────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-500" />
                {company.name}
              </CardTitle>
              <div className="flex gap-1.5 shrink-0">
                {company.adminIsDemo && <Badge variant="outline" className="text-xs">Demo</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoRow icon={Hash} label="Company ID" value={<span className="font-mono font-semibold">{company.companyCode ?? "—"}</span>} />
              <InfoRow icon={Mail} label="Owner Email" value={company.ownerEmail ?? "—"} />
              <InfoRow icon={CreditCard} label="Plan" value={company.subscriptionPlan ?? "—"} />
              <InfoRow icon={ShieldCheck} label="Subscription" value={<SubscriptionBadge status={company.subscriptionStatus} />} />
              <InfoRow icon={ShieldOff} label="Account Status" value={<BoolBadge value={company.adminPaused} trueLabel="Paused" falseLabel="Active" trueVariant="destructive" falseVariant="secondary" />} />
              <InfoRow icon={RefreshCw} label="Free Access Override" value={<BoolBadge value={company.adminFreeAccess} trueLabel="Enabled" falseLabel="Off" />} />
              <InfoRow icon={ShieldCheck} label="Sub Bypass" value={<BoolBadge value={company.adminBypassSubscription} trueLabel="Bypassed" falseLabel="Off" trueVariant="outline" />} />
              {company.createdAt && (
                <InfoRow icon={Calendar} label="Created" value={formatDate(company.createdAt)} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── ADMIN ACTIONS ───────────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Admin Actions
            </CardTitle>
            <CardDescription>Destructive controls will be enabled in the next step.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Access Controls</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => placeholderAction("Toggle Dev Bypass")}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Toggle Dev Bypass
                </Button>
                <Button variant="outline" size="sm" onClick={() => placeholderAction("Force Paywall")}>
                  <ShieldOff className="h-3.5 w-3.5 mr-1.5" />Force Paywall
                </Button>
                <Button variant="outline" size="sm" onClick={() => placeholderAction("Remove Subscription")}>
                  <CreditCard className="h-3.5 w-3.5 mr-1.5" />Remove Subscription
                </Button>
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Company Status</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950" onClick={() => placeholderAction("Block Company")}>
                  <Ban className="h-3.5 w-3.5 mr-1.5" />Block Company
                </Button>
                <Button variant="outline" size="sm" className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950" onClick={() => placeholderAction("Unblock Company")}>
                  <Unlock className="h-3.5 w-3.5 mr-1.5" />Unblock Company
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── USERS ───────────────────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              Users
              <Badge variant="secondary" className="ml-1">{users.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {users.length === 0 ? (
              <div className="px-6">
                <EmptySection icon={Users} message="No users found for this company." />
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-6 py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {u.firstName || u.lastName ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "—"}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{u.email}</p>
                      {u.lastLoginAt && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Last login: {formatDate(u.lastLoginAt)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="text-xs">{u.role}</Badge>
                      <Badge variant={u.status === "ACTIVE" ? "secondary" : "destructive"} className="text-xs">{u.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── RECENT JOBS ─────────────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-slate-500" />
              Recent Jobs
              <Badge variant="secondary" className="ml-1">{jobs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {jobs.length === 0 ? (
              <div className="px-6">
                <EmptySection icon={Briefcase} message="No jobs found for this company." />
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {jobs.map((j) => (
                  <div key={j.id} className="flex items-center justify-between px-6 py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{j.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {j.clientName ? `${j.clientName} · ` : ""}
                        {j.startDate ? formatDate(j.startDate) : formatDate(j.createdAt)}
                      </p>
                    </div>
                    <JobStatusBadge status={j.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── RECENT INVOICES ─────────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-500" />
              Recent Invoices
              <Badge variant="secondary" className="ml-1">{invoices.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {invoices.length === 0 ? (
              <div className="px-6">
                <EmptySection icon={CreditCard} message="No invoices found for this company." />
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between px-6 py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium font-mono text-slate-900 dark:text-slate-100">{inv.invoiceNumber}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {centsToDisplay(inv.paidAmountCents)} paid of {centsToDisplay(inv.totalCents)}
                        {inv.paidAt ? ` · ${formatDate(inv.paidAt)}` : ""}
                      </p>
                    </div>
                    <InvoiceStatusBadge status={inv.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">{label}</p>
        <div className="text-sm text-slate-800 dark:text-slate-200 mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
    completed: "default",
    active: "outline",
    pending: "secondary",
    cancelled: "destructive",
  };
  return <Badge variant={map[status] ?? "secondary"} className="text-xs shrink-0">{status}</Badge>;
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
    paid: "default",
    partial: "outline",
    pending: "secondary",
    overdue: "destructive",
    cancelled: "destructive",
  };
  return <Badge variant={map[status] ?? "secondary"} className="text-xs shrink-0">{status}</Badge>;
}
