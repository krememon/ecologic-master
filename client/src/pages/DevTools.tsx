import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Redirect } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search, Building2, Users, CreditCard,
  ShieldOff, ShieldCheck, Ban, Unlock, RefreshCw,
  UserCircle, Mail, Calendar, Hash, Loader2,
  AlertTriangle, ChevronRight, ChevronLeft, DollarSign, RotateCcw,
  CheckCircle2, XCircle, Zap
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

interface TransactionData {
  id: number;
  amountCents: number;
  paymentMethod: string | null;
  status: string;
  paidDate: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  refundedAmountCents: number;
  createdAt: string | null;
}

interface BillingSnapshot {
  companyId: number;
  companyCode: string | null;
  effectiveLabel: string;
  rawBillingState: string;
  allowed: boolean;
  source: string;
  hasFreeAccess: boolean;   // true if adminFreeAccess OR adminBypassSubscription
  hasUserBypass: boolean;   // true if any user at this company has subscriptionBypass=true
  hasActivePaid: boolean;   // true if active paid subscription (Apple, Google Play, or Stripe) with valid period
  hasTrial: boolean;
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  subscriptionPlatform: string | null;  // 'apple' | 'google_play' | 'stripe' | null (null = legacy Stripe record)
  isPaused: boolean;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function centsToDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function methodLabel(method: string | null): string {
  if (!method) return "Unknown";
  const map: Record<string, string> = {
    cash: "Cash",
    check: "Check",
    credit_card: "Card",
    bank_transfer: "Bank Transfer",
    stripe: "Card (Stripe)",
    other: "Other",
  };
  return map[method] ?? method;
}

// ── Badge components ──────────────────────────────────────────────────────

function SubscriptionBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">None</Badge>;
  if (status === "active") return <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800">Active</Badge>;
  if (status === "trialing") return <Badge variant="outline">Trial</Badge>;
  if (status === "past_due") return <Badge variant="destructive">Past Due</Badge>;
  if (status === "canceled" || status === "cancelled" || status === "inactive") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function UserStatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") {
    return <Badge className="text-xs bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800">Active</Badge>;
  }
  return <Badge variant="destructive" className="text-xs">{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
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

function EffectiveAccessBadge({ label }: { label: string }) {
  if (label.startsWith("Full Access")) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
        <CheckCircle2 className="h-4 w-4" />
        {label}
      </span>
    );
  }
  if (label === "Trial Access") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
        <Zap className="h-4 w-4" />
        {label}
      </span>
    );
  }
  if (label === "Paywall Active" || label === "Access Removed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
        <XCircle className="h-4 w-4" />
        {label}
      </span>
    );
  }
  if (label === "Paused by Admin") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <Ban className="h-4 w-4" />
        {label}
      </span>
    );
  }
  // Fallback (includes any unexpected label)
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4" />
      {label}
    </span>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────

function EmptySection({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400 dark:text-slate-500 px-6">
      <Icon className="h-4 w-4 shrink-0" />
      <span>{message}</span>
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

function FactItem({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm font-medium ${
        positive === true ? "text-green-600 dark:text-green-400" :
        positive === false ? "text-slate-400 dark:text-slate-500" :
        "text-slate-700 dark:text-slate-300"
      }`}>{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function DevTools() {
  const { user } = useAuth() as { user: any };
  const { toast } = useToast();

  const [searchMode, setSearchMode] = useState<SearchMode>("code");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [searchResults, setSearchResults] = useState<CompanyBasic[]>([]);
  const [company, setCompany] = useState<CompanyBasic | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [isBillingMutating, setIsBillingMutating] = useState<string | null>(null);
  const [confirmRemovePaidPlan, setConfirmRemovePaidPlan] = useState(false);

  // Paginated company directory
  const [listItems, setListItems] = useState<CompanyBasic[]>([]);
  const [listPage, setListPage] = useState(1);
  const [listHasNext, setListHasNext] = useState(false);
  const [listHasPrev, setListHasPrev] = useState(false);
  const [isListLoading, setIsListLoading] = useState(false);

  const loadListPage = async (page: number) => {
    setIsListLoading(true);
    try {
      const res = await fetch(`/api/admin/company/list?page=${page}&pageSize=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        setListItems(data.items ?? []);
        setListPage(data.page);
        setListHasNext(data.hasNext);
        setListHasPrev(data.hasPrev);
      }
    } catch (e: any) {
      // silent — list is best-effort; search still works
    } finally {
      setIsListLoading(false);
    }
  };

  useEffect(() => { loadListPage(1); }, []);

  if (!user || !DEV_ALLOWLIST.includes(user.email)) {
    return <Redirect to="/jobs" />;
  }

  const clearDetail = () => {
    setCompany(null);
    setUsers([]);
    setTransactions([]);
    setBilling(null);
  };

  const loadBilling = async (id: number) => {
    setIsBillingLoading(true);
    try {
      const res = await fetch(`/api/admin/company/${id}/billing`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        setBilling(data.billing);
      } else {
        toast({ title: "Billing load failed", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error loading billing", description: e.message, variant: "destructive" });
    } finally {
      setIsBillingLoading(false);
    }
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
        setTransactions(data.transactions ?? []);
        setSearchResults([]);
        await loadBilling(id);
      } else {
        toast({ title: "Failed to load detail", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const runBillingAction = async (action: string) => {
    if (!company) return;
    setIsBillingMutating(action);
    try {
      const res = await fetch(`/api/admin/company/${company.id}/billing/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setBilling(data.billing);
      // Also refresh company overview flags
      setCompany(prev => prev ? {
        ...prev,
        adminFreeAccess: data.billing.hasFreeAccess,
        adminBypassSubscription: data.billing.hasBypass,
        subscriptionStatus: data.billing.subscriptionStatus,
        subscriptionPlan: data.billing.subscriptionPlan,
      } : prev);

      const actionLabels: Record<string, string> = {
        "grant-bypass": "Free access granted",
        "remove-bypass": "Free access removed",
        "remove-paid-plan": "Paid plan removed",
        "force-paywall": "Paywall enabled",
      };
      toast({
        title: actionLabels[action] ?? "Done",
        description: `Effective access is now: ${data.billing.effectiveLabel}`,
      });
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setIsBillingMutating(null);
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
        // hasSearched shows "not found"
      } else if (results.length === 1) {
        await loadDetail(results[0].id);
      } else {
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

  const totalRevenueCents = transactions
    .filter(t => t.status === "paid")
    .reduce((sum, t) => sum + Math.max(0, t.amountCents - (t.refundedAmountCents ?? 0)), 0);

  const isMutating = isBillingMutating !== null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">

      {/* ── HEADER ───────────────────────────────────────────── */}
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

      {/* ── FIND COMPANY ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-500" />
            Find Company
          </CardTitle>
          <CardDescription>Look up any company by company ID, owner email, or name</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => {
                const raw = e.target.value;
                const next = searchMode === "code" ? raw.toUpperCase().slice(0, 6) : raw;
                setSearchQuery(next);
                if (!next.trim()) {
                  setHasSearched(false);
                  setSearchResults([]);
                  clearDetail();
                }
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

          {showNoResults && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-1 pl-1">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              No company found for that query.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── COMPANY DIRECTORY (default list when no search) ───── */}
      {!searchQuery.trim() && !company && !isLoadingDetail && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-400" />
                Company Directory
              </CardTitle>
              {isListLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
              {!isListLoading && (
                <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                  page {listPage}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Column headers */}
            <div className="grid grid-cols-[64px_1fr_1fr] gap-2 px-5 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">ID</span>
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Owner Email</span>
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Company Name</span>
            </div>

            {isListLoading && listItems.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-slate-400 dark:text-slate-500 gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading companies…</span>
              </div>
            ) : listItems.length === 0 ? (
              <div className="py-6 px-5 text-sm text-slate-400 dark:text-slate-500">No companies found.</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {listItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => loadDetail(item.id)}
                    className="w-full grid grid-cols-[64px_1fr_1fr] gap-2 items-center px-5 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                  >
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{item.id}</span>
                    <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{item.ownerEmail ?? "—"}</span>
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate flex items-center gap-1">
                      {item.name}
                      <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 shrink-0" />
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Pagination controls */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => { const p = listPage - 1; setListPage(p); loadListPage(p); }}
                disabled={!listHasPrev || isListLoading}
                className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed hover:text-slate-800 dark:hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                &lt;- Prev
              </button>
              <button
                onClick={() => { const p = listPage + 1; setListPage(p); loadListPage(p); }}
                disabled={!listHasNext || isListLoading}
                className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed hover:text-slate-800 dark:hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Next -&gt;
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── MULTI-RESULT PICKER ───────────────────────────────── */}
      {showPicker && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-500" />
              Select a Company
            </CardTitle>
            <CardDescription>{searchResults.length} matches — tap one to load details</CardDescription>
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
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-mono">{r.companyCode ?? "—"} · {r.ownerEmail ?? "no owner"}</p>
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

      {/* ── LOADING ───────────────────────────────────────────── */}
      {isLoadingDetail && (
        <div className="flex items-center justify-center py-12 gap-3 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading company data…</span>
        </div>
      )}

      {/* ── COMPANY OVERVIEW ──────────────────────────────────── */}
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
              <InfoRow icon={Ban} label="Company Status" value={
                <BoolBadge value={company.adminPaused} trueLabel="Paused" falseLabel="Active" trueVariant="destructive" falseVariant="secondary" />
              } />
              <InfoRow icon={RefreshCw} label="Free Access" value={
                <BoolBadge value={company.adminFreeAccess || company.adminBypassSubscription} trueLabel="Enabled" falseLabel="Off" />
              } />
              {company.createdAt && (
                <InfoRow icon={Calendar} label="Created" value={formatDate(company.createdAt)} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── BILLING CONTROLS ──────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-blue-500" />
              Billing Controls
            </CardTitle>
            <CardDescription>Control this company's access and subscription state</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Effective access status */}
            {isBillingLoading && !billing ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading billing status…
              </div>
            ) : billing ? (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Effective Access</p>
                  <EffectiveAccessBadge label={billing.effectiveLabel} />
                  <p className="text-xs text-slate-400 dark:text-slate-500 pl-0.5 mt-1">{billing.rawBillingState}</p>
                </div>

                <Separator />

                {/* Quick facts */}
                <div className="space-y-0.5">
                  {billing.hasUserBypass && (
                    <FactItem
                      label="User Override"
                      value="On — personal access override active"
                      positive={true}
                    />
                  )}
                  <FactItem
                    label="Free Access"
                    value={billing.hasFreeAccess ? "On — admin override, no paid plan required" : "Off"}
                    positive={billing.hasFreeAccess}
                  />
                  <FactItem
                    label="Subscription"
                    value={billing.hasActivePaid
                      ? (() => {
                          const planLabel = billing.subscriptionPlan ?? "plan";
                          const store =
                            billing.subscriptionPlatform === 'apple' ? 'Apple Plan' :
                            billing.subscriptionPlatform === 'google_play' ? 'Google Play Plan' :
                            'Web Plan';
                          const end = billing.currentPeriodEnd
                            ? `renews ${new Date(billing.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                            : "no renewal date";
                          return `${store} (${planLabel}) · ${end}`;
                        })()
                      : "None"}
                    positive={billing.hasActivePaid}
                  />
                  <FactItem
                    label="Trial"
                    value={billing.hasTrial
                      ? `Active · ends ${billing.trialEndsAt
                          ? new Date(billing.trialEndsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : "unknown"}`
                      : "None"}
                    positive={billing.hasTrial ? true : undefined}
                  />
                  <FactItem
                    label="Billing Source"
                    value={
                      billing.source === 'apple' ? 'Apple' :
                      billing.source === 'google_play' ? 'Google Play' :
                      billing.source === 'stripe' ? 'Web (Stripe)' :
                      billing.source === 'free_access' ? 'Free Access' :
                      billing.source === 'trial' ? 'Trial' :
                      billing.source === 'user_bypass' ? 'User Override' :
                      'None'
                    }
                    positive={billing.allowed ? true : undefined}
                  />
                  <FactItem
                    label="Paywall"
                    value={billing.allowed ? "Hidden" : "Showing"}
                    positive={billing.allowed ? undefined : false}
                  />
                </div>

                <Separator />

                {/* Action buttons */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Actions</p>
                  <div className="flex flex-wrap gap-2">

                    {/* Grant Free Access — disabled if already on or user-level bypass makes it redundant */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || billing.hasFreeAccess}
                      onClick={() => runBillingAction("grant-bypass")}
                      className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950 disabled:opacity-40"
                    >
                      {isBillingMutating === "grant-bypass" ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Grant Free Access
                    </Button>

                    {/* Remove Free Access — disabled if already off */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || !billing.hasFreeAccess}
                      onClick={() => runBillingAction("remove-bypass")}
                      className="disabled:opacity-40"
                    >
                      {isBillingMutating === "remove-bypass" ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Remove Free Access
                    </Button>

                    {/* Show Paywall — disabled if already fully blocked (no bypass of any kind) */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || (!billing.allowed && !billing.hasFreeAccess && !billing.hasUserBypass)}
                      onClick={() => runBillingAction("force-paywall")}
                      className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-40"
                    >
                      {isBillingMutating === "force-paywall" ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Show Paywall
                    </Button>

                    {/* Remove Paid Plan — opens confirmation dialog */}
                    {(() => {
                      const isStripePlan = billing.source === 'stripe';
                      const isApplePlan = billing.subscriptionPlatform === 'apple';
                      const buttonLabel = isStripePlan
                        ? "Cancel Web Subscription"
                        : "Remove Paid Plan";
                      const buttonClass = isStripePlan
                        ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-40"
                        : "border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950 disabled:opacity-40";
                      return (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isMutating || (
                              !billing.hasActivePaid &&
                              !billing.hasTrial &&
                              billing.source !== 'stripe' &&
                              billing.source !== 'apple' &&
                              billing.source !== 'google_play'
                            )}
                            onClick={() => setConfirmRemovePaidPlan(true)}
                            className={buttonClass}
                          >
                            {isBillingMutating === "remove-paid-plan" ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            ) : (
                              <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                            )}
                            {buttonLabel}
                          </Button>

                          <AlertDialog open={confirmRemovePaidPlan} onOpenChange={setConfirmRemovePaidPlan}>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle className="flex items-center gap-2">
                                  <AlertTriangle className={`h-5 w-5 ${isStripePlan ? "text-red-500" : "text-orange-500"}`} />
                                  {isStripePlan ? "Cancel web subscription?" : "Remove paid plan?"}
                                </AlertDialogTitle>
                                <AlertDialogDescription className="text-left space-y-2">
                                  {isStripePlan ? (
                                    <>
                                      <span className="block">
                                        This will <strong>immediately cancel</strong> <strong>{company?.name}</strong>'s Stripe web subscription and revoke all access to EcoLogic.
                                        They will need to subscribe again to continue.
                                      </span>
                                      <span className="block text-slate-500 dark:text-slate-400 text-xs">
                                        The Stripe subscription will be canceled now — not at period end. EcoLogic access is revoked at the same time.
                                        Company and user data are preserved. Admin free-access bypass is unaffected.
                                      </span>
                                    </>
                                  ) : isApplePlan ? (
                                    <>
                                      <span className="block">
                                        This will revoke <strong>{company?.name}</strong>'s Apple subscription access in EcoLogic.
                                      </span>
                                      <span className="block text-slate-500 dark:text-slate-400 text-xs">
                                        Apple subscriptions cannot be canceled server-side — this only removes access within EcoLogic.
                                        The user must cancel their Apple subscription separately in the App Store.
                                        Company and user data are preserved.
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="block">
                                        This will immediately revoke <strong>{company?.name}</strong>'s paid access in EcoLogic and require a new subscription to continue.
                                      </span>
                                      <span className="block text-slate-500 dark:text-slate-400 text-xs">
                                        All paid entitlement fields will be cleared. Company and user data are preserved. Admin free-access bypass is unaffected.
                                      </span>
                                    </>
                                  )}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={isBillingMutating === "remove-paid-plan"}>
                                  Keep subscription
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  disabled={isBillingMutating === "remove-paid-plan"}
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    setConfirmRemovePaidPlan(false);
                                    await runBillingAction("remove-paid-plan");
                                  }}
                                  className={isStripePlan ? "bg-red-600 hover:bg-red-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}
                                >
                                  {isBillingMutating === "remove-paid-plan" ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : null}
                                  {isStripePlan
                                    ? "Cancel subscription and remove access"
                                    : isApplePlan
                                    ? "Remove Apple plan access"
                                    : "Remove paid plan"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      );
                    })()}

                    {/* Refresh */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isMutating || isBillingLoading}
                      onClick={() => loadBilling(company.id)}
                      className="text-slate-500 dark:text-slate-400"
                    >
                      {isBillingLoading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Refresh Status
                    </Button>

                  </div>

                  {/* Contextual hints */}
                  {billing.hasUserBypass && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 pt-1">
                      A user at this company has a personal access override — they get in regardless of company billing.
                    </p>
                  )}
                  {!billing.hasUserBypass && billing.hasFreeAccess && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">
                      Free Access is ON — this company has full access with no active Apple, Google Play, or web subscription required.
                    </p>
                  )}
                  {!billing.allowed && !billing.hasFreeAccess && !billing.hasUserBypass && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">
                      This company is hitting the paywall. Grant Free Access or remove the paid plan block to let them in.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Could not load billing status.{" "}
                <button onClick={() => loadBilling(company.id)} className="underline text-slate-500 hover:text-slate-700">Retry</button>
              </div>
            )}

          </CardContent>
        </Card>
      )}

      {/* ── ADMIN ACTIONS (Company Status only) ──────────────── */}
      {company && !isLoadingDetail && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Company Status
            </CardTitle>
            <CardDescription>Suspend or restore this company's users — coming in next step.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled
                className="border-red-300 text-red-600 dark:border-red-800 dark:text-red-400 opacity-50 cursor-not-allowed"
              >
                <Ban className="h-3.5 w-3.5 mr-1.5" />
                Pause Company
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400 opacity-50 cursor-not-allowed"
              >
                <Unlock className="h-3.5 w-3.5 mr-1.5" />
                Unpause Company
              </Button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">These controls will be wired in the next step.</p>
          </CardContent>
        </Card>
      )}

      {/* ── USERS ────────────────────────────────────────────── */}
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
              <EmptySection icon={Users} message="No users found for this company." />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => {
                  const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
                  return (
                    <div key={u.id} className="flex items-center justify-between px-6 py-3.5 gap-3">
                      <div className="min-w-0">
                        {fullName && (
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{fullName}</p>
                        )}
                        <p className={`truncate ${fullName ? "text-xs text-slate-500 dark:text-slate-400" : "text-sm font-medium text-slate-900 dark:text-slate-100"}`}>
                          {u.email}
                        </p>
                        {u.lastLoginAt && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Last login {formatDate(u.lastLoginAt)}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="outline" className="text-xs">{u.role}</Badge>
                        <UserStatusBadge status={u.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── TRANSACTIONS ─────────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-slate-500" />
                  Transactions
                  <Badge variant="secondary" className="ml-1">{transactions.length}</Badge>
                </CardTitle>
                <CardDescription className="mt-1">Completed payments only — most recent first</CardDescription>
              </div>
              {transactions.length > 0 && (
                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-400 dark:text-slate-500">Total collected</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{centsToDisplay(totalRevenueCents)}</p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {transactions.length === 0 ? (
              <EmptySection icon={DollarSign} message="No completed transactions found." />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {transactions.map((t) => {
                  const isRefunded = t.status === "refunded";
                  const netCents = Math.max(0, t.amountCents - (t.refundedAmountCents ?? 0));
                  return (
                    <div key={t.id} className="px-6 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-base font-semibold ${isRefunded ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>
                              {centsToDisplay(t.amountCents)}
                            </span>
                            {isRefunded && netCents < t.amountCents && (
                              <span className="text-sm text-slate-500 dark:text-slate-400">
                                (net {centsToDisplay(netCents)})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                            {[
                              t.customerName,
                              t.invoiceNumber,
                              formatDate(t.paidDate ?? t.createdAt),
                            ].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {isRefunded ? (
                            <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
                              <RotateCcw className="h-3 w-3 mr-1" />Refunded
                            </Badge>
                          ) : (
                            <Badge className="text-xs bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800">
                              Paid
                            </Badge>
                          )}
                          {t.paymentMethod && (
                            <span className="text-xs text-slate-400 dark:text-slate-500">{methodLabel(t.paymentMethod)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
