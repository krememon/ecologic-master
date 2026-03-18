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
  Search, Building2, Users, CreditCard,
  ShieldOff, ShieldCheck, Ban, Unlock, RefreshCw,
  UserCircle, Mail, Calendar, Hash, Loader2,
  AlertTriangle, ChevronRight, DollarSign, RotateCcw
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
  if (status === "canceled" || status === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
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

function AdminAction({ icon: Icon, label, description, onClick, className = "" }: {
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={onClick} className={`w-fit ${className}`}>
        <Icon className="h-3.5 w-3.5 mr-1.5" />
        {label}
      </Button>
      <p className="text-xs text-slate-400 dark:text-slate-500 pl-1">{description}</p>
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

  if (!user || !DEV_ALLOWLIST.includes(user.email)) {
    return <Redirect to="/jobs" />;
  }

  const placeholderAction = (label: string) => {
    toast({ title: "Coming soon", description: `"${label}" will be wired in the next step.` });
  };

  const clearDetail = () => {
    setCompany(null);
    setUsers([]);
    setTransactions([]);
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

  // Total revenue across fetched transactions (paid only, excluding fully refunded)
  const totalRevenueCents = transactions
    .filter(t => t.status === "paid")
    .reduce((sum, t) => sum + Math.max(0, t.amountCents - (t.refundedAmountCents ?? 0)), 0);

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

          {showNoResults && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-1 pl-1">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              No company found for that query.
            </div>
          )}
        </CardContent>
      </Card>

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
                <BoolBadge value={company.adminFreeAccess} trueLabel="Enabled" falseLabel="Off" />
              } />
              <InfoRow icon={ShieldOff} label="Subscription Bypass" value={
                <BoolBadge value={company.adminBypassSubscription} trueLabel="Bypassed" falseLabel="Off" trueVariant="outline" />
              } />
              {company.createdAt && (
                <InfoRow icon={Calendar} label="Created" value={formatDate(company.createdAt)} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── ADMIN ACTIONS ────────────────────────────────────── */}
      {company && !isLoadingDetail && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Admin Actions
            </CardTitle>
            <CardDescription>Actions will be wired in the next step — previewing labels only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Access Controls</p>
              <AdminAction
                icon={RefreshCw}
                label="Grant Free Access"
                description="Lets this company use the full app without a paid subscription."
                onClick={() => placeholderAction("Grant Free Access")}
              />
              <AdminAction
                icon={ShieldOff}
                label="Show Paywall"
                description="Removes free access so this company sees the billing screen."
                onClick={() => placeholderAction("Show Paywall")}
              />
              <AdminAction
                icon={CreditCard}
                label="Remove Paid Plan"
                description="Cancels and clears the active subscription from this company."
                onClick={() => placeholderAction("Remove Paid Plan")}
              />
            </div>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Company Status</p>
              <AdminAction
                icon={Ban}
                label="Pause Company"
                description="Blocks all users at this company from logging in."
                onClick={() => placeholderAction("Pause Company")}
                className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              />
              <AdminAction
                icon={Unlock}
                label="Unpause Company"
                description="Restores normal access for this company's users."
                onClick={() => placeholderAction("Unpause Company")}
                className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950"
              />
            </div>
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
                          {/* Amount + method */}
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
                          {/* Customer + invoice + date */}
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                            {[
                              t.customerName,
                              t.invoiceNumber,
                              formatDate(t.paidDate ?? t.createdAt),
                            ].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        {/* Right side: method badge + status */}
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
