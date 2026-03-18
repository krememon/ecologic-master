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
  AlertTriangle
} from "lucide-react";

const DEV_ALLOWLIST = ['pjpell077@gmail.com'];

type SearchMode = "code" | "email" | "name";

interface CompanyResult {
  id: number;
  name: string;
  code: string;
  ownerEmail: string;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  adminFreeAccess: boolean;
  adminBypassSubscription: boolean;
  adminPaused: boolean;
  createdAt: string | null;
}

interface UserResult {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
}

interface JobResult {
  id: number;
  title: string;
  status: string;
  startDate: string | null;
}

interface InvoiceResult {
  id: number;
  invoiceNumber: string;
  totalCents: number;
  paidAmountCents: number;
  status: string;
}

function StatusBadge({ value, trueLabel = "Yes", falseLabel = "No", trueVariant = "default", falseVariant = "secondary" }: {
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
  trueVariant?: "default" | "destructive" | "outline" | "secondary";
  falseVariant?: "default" | "destructive" | "outline" | "secondary";
}) {
  return (
    <Badge variant={value ? trueVariant : falseVariant}>
      {value ? trueLabel : falseLabel}
    </Badge>
  );
}

function SubscriptionBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">None</Badge>;
  const map: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
    active: "default",
    trialing: "outline",
    canceled: "destructive",
    past_due: "destructive",
  };
  return <Badge variant={map[status] ?? "secondary"}>{status}</Badge>;
}

function centsToDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function PlaceholderState({ icon: Icon, title, description }: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
      <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4">
        <Icon className="h-8 w-8 text-slate-400" />
      </div>
      <p className="font-medium text-slate-700 dark:text-slate-300">{title}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">{description}</p>
    </div>
  );
}

export default function DevTools() {
  const { user } = useAuth() as { user: any };
  const { toast } = useToast();

  const [searchMode, setSearchMode] = useState<SearchMode>("code");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [company, setCompany] = useState<CompanyResult | null>(null);
  const [users, setUsers] = useState<UserResult[]>([]);
  const [jobs, setJobs] = useState<JobResult[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  if (!user || !DEV_ALLOWLIST.includes(user.email)) {
    return <Redirect to="/jobs" />;
  }

  const placeholderAction = (label: string) => {
    toast({
      title: "Not wired yet",
      description: `"${label}" will be available in the next step.`,
    });
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    setHasSearched(true);
    setCompany(null);
    setUsers([]);
    setJobs([]);
    setInvoices([]);

    try {
      const res = await fetch(`/api/admin/company/lookup?mode=${searchMode}&q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setCompany(data.company ?? null);
        setUsers(data.users ?? []);
        setJobs(data.jobs ?? []);
        setInvoices(data.invoices ?? []);
      } else if (res.status === 404) {
        setCompany(null);
      } else {
        toast({ title: "Search failed", description: "Backend not connected yet.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Search unavailable", description: "Backend read routes not wired yet." });
    } finally {
      setIsSearching(false);
    }
  };

  const searchModes: { key: SearchMode; label: string }[] = [
    { key: "code", label: "Company ID" },
    { key: "email", label: "Owner Email" },
    { key: "name", label: "Company Name" },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">

      {/* ── HEADER ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between pt-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Dev Tools
            </h1>
            <Badge variant="outline" className="text-xs font-mono border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950">
              ADMIN ONLY
            </Badge>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Internal admin controls — not visible to regular users
          </p>
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
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
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

          {/* Empty/not found state */}
          {hasSearched && !isSearching && !company && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-2 pl-1">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              No company found for that query.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── COMPANY OVERVIEW ────────────────────────────────────── */}
      {company && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-500" />
              Company Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <InfoRow icon={Building2} label="Name" value={company.name} />
                  <InfoRow icon={Hash} label="Invite Code" value={<span className="font-mono font-semibold">{company.code}</span>} />
                  <InfoRow icon={Mail} label="Owner Email" value={company.ownerEmail} />
                  <InfoRow icon={CreditCard} label="Plan" value={company.subscriptionPlan ?? "—"} />
                  <InfoRow icon={ShieldCheck} label="Subscription" value={<SubscriptionBadge status={company.subscriptionStatus} />} />
                  <InfoRow icon={ShieldOff} label="Paused" value={<StatusBadge value={company.adminPaused} trueLabel="Paused" falseLabel="Active" trueVariant="destructive" falseVariant="secondary" />} />
                  <InfoRow icon={RefreshCw} label="Free Access Override" value={<StatusBadge value={company.adminFreeAccess} trueLabel="Enabled" falseLabel="Off" trueVariant="default" falseVariant="secondary" />} />
                  <InfoRow icon={ShieldCheck} label="Sub Bypass" value={<StatusBadge value={company.adminBypassSubscription} trueLabel="Bypassed" falseLabel="Off" trueVariant="outline" falseVariant="secondary" />} />
                  {company.createdAt && (
                    <InfoRow icon={Calendar} label="Created" value={new Date(company.createdAt).toLocaleDateString()} />
                  )}
                </div>
              </div>
          </CardContent>
        </Card>
      )}

      {/* ── ADMIN ACTIONS ───────────────────────────────────────── */}
      {company && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Admin Actions
            </CardTitle>
            <CardDescription>These controls affect billing and access. Destructive actions will be enabled in the next step.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Access controls */}
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Access Controls</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => placeholderAction("Toggle Dev Bypass")}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Toggle Dev Bypass
                </Button>
                <Button variant="outline" size="sm" onClick={() => placeholderAction("Force Paywall")}>
                  <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                  Force Paywall
                </Button>
                <Button variant="outline" size="sm" onClick={() => placeholderAction("Remove Subscription")}>
                  <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                  Remove Subscription
                </Button>
              </div>
            </div>

            <Separator />

            {/* Company status */}
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Company Status</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                  onClick={() => placeholderAction("Block Company")}
                >
                  <Ban className="h-3.5 w-3.5 mr-1.5" />
                  Block Company
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950"
                  onClick={() => placeholderAction("Unblock Company")}
                >
                  <Unlock className="h-3.5 w-3.5 mr-1.5" />
                  Unblock Company
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── USERS ───────────────────────────────────────────────── */}
      {company && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              Users
              {users.length > 0 && (
                <Badge variant="secondary" className="ml-1">{users.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <PlaceholderState
                icon={Users}
                title="No users loaded"
                description="User data will appear here once backend routes are wired."
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {u.firstName || u.lastName ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "—"}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs">{u.role}</Badge>
                      <Badge variant={u.status === "active" ? "secondary" : "destructive"} className="text-xs">{u.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── RECENT JOBS ─────────────────────────────────────────── */}
      {company && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-slate-500" />
              Recent Jobs
              {jobs.length > 0 && (
                <Badge variant="secondary" className="ml-1">{jobs.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <PlaceholderState
                icon={Briefcase}
                title="No jobs loaded"
                description="Recent jobs will appear here once backend routes are wired."
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {jobs.map((j) => (
                  <div key={j.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{j.title}</p>
                      {j.startDate && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {new Date(j.startDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{j.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── RECENT INVOICES ─────────────────────────────────────── */}
      {company && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-500" />
              Recent Invoices
              {invoices.length > 0 && (
                <Badge variant="secondary" className="ml-1">{invoices.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <PlaceholderState
                icon={CreditCard}
                title="No invoices loaded"
                description="Invoice data will appear here once backend routes are wired."
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium font-mono text-slate-900 dark:text-slate-100">{inv.invoiceNumber}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Paid: {centsToDisplay(inv.paidAmountCents)} / {centsToDisplay(inv.totalCents)}
                      </p>
                    </div>
                    <Badge variant={inv.status === "paid" ? "default" : "outline"} className="text-xs shrink-0">{inv.status}</Badge>
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
