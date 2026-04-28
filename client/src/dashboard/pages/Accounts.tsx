/**
 * Dashboard → Accounts page
 * ─────────────────────────
 * Lists EVERY customer company (attributed or not) joined with their owner,
 * subscription state, attribution, and internal admin metadata. Click a row
 * to open a side drawer for editing status / notes / attribution and
 * triggering a one-off Stripe subscription refresh.
 *
 * Different from /subscribers, which only shows attributed signups.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { GROWTH_SOURCE_LABELS, type GrowthSourceType, GROWTH_SOURCE_TYPES } from "@shared/growthSources";
import { subscriptionPlans } from "@shared/subscriptionPlans";
import { ACCOUNT_ADMIN_STATUSES, type AccountAdminStatus } from "@shared/schema";
import { RefreshCw, Trash2, AlertTriangle } from "lucide-react";

// ── Local types (mirror server/dashboard/storage.ts) ─────────────────────
interface AccountListRow {
  companyId: number;
  companyName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
  accountStatus: AccountAdminStatus;
  subscriptionStatus: string | null;
  plan: string | null;
  platform: string | null;
  monthlyRevenue: string | null;
  sourceType: string | null;
  sourceName: string | null;
  campaignId: number | null;
  campaignName: string | null;
  referralCode: string | null;
  signupAt: string | null;
  onboardingCompletedAt: string | null;
  hasGrowthSubscriber: boolean;
}

interface AccountDetailMember {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  joinedAt: string | null;
}

interface AccountDetail extends AccountListRow {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  appleOriginalTransactionId: string | null;
  appleTransactionId: string | null;
  googlePurchaseToken: string | null;
  googleOrderId: string | null;
  notes: string | null;
  members: AccountDetailMember[];
  // Server-derived flag from ALLOW_DASHBOARD_ACCOUNT_DELETION env-var.
  // Hide the destructive UI entirely when false.
  deletionEnabled?: boolean;
}

interface DeletePreview {
  exists: boolean;
  companyId: number;
  companyName: string | null;
  ownerEmail: string | null;
  counts: {
    members: number;
    jobs: number;
    customers: number;
    invoices: number;
    payments: number;
    documents: number;
    conversations: number;
    messages: number;
    growthSubscribers: number;
  };
  subscription: {
    platform: string | null;
    status: string | null;
    hasStripeSub: boolean;
    hasStripeCustomer: boolean;
    hasAppleSub: boolean;
    hasGoogleSub: boolean;
  };
  warnings: string[];
  deletionEnabled: boolean;
  protected: boolean;
  protectedReason: string | null;
}

// ── Display helpers ──────────────────────────────────────────────────────
const PLATFORM_LABELS: Record<string, string> = {
  unknown: "Unknown",
  stripe: "Stripe (web)",
  apple: "Apple",
  google_play: "Google Play",
  manual: "Manual",
};

const STATUS_LABELS: Record<string, string> = {
  unknown: "Unknown",
  trialing: "Free trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  expired: "Expired",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Incomplete (expired)",
};

const ACCOUNT_STATUS_LABELS: Record<AccountAdminStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  test: "Test account",
  internal: "Internal / EcoLogic",
  blocked: "Blocked",
};

const ACCOUNT_STATUS_COLORS: Record<AccountAdminStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive: "bg-slate-100 text-slate-600 border-slate-200",
  test: "bg-amber-50 text-amber-700 border-amber-200",
  internal: "bg-blue-50 text-blue-700 border-blue-200",
  blocked: "bg-rose-50 text-rose-700 border-rose-200",
};

function platformLabel(p: string | null | undefined): string {
  if (!p) return "—";
  return PLATFORM_LABELS[p] ?? p;
}

function statusLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return STATUS_LABELS[s] ?? s;
}

function planLabel(planKey: string | null | undefined, status: string | null | undefined): string {
  if (!planKey) return status === "trialing" ? "Free trial" : "—";
  const plan = (subscriptionPlans as Record<string, { label: string; price: number }>)[planKey];
  const planName = plan?.label ?? planKey;
  const price = plan ? `$${plan.price.toFixed(2)}/mo` : null;
  const base = price ? `${planName} (${price})` : planName;
  return status === "trialing" ? `Free trial – ${base}` : base;
}

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(0)}`;
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return "—";
  }
}

function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return "—";
  }
}

export default function Accounts() {
  const { data, isLoading } = useQuery<AccountListRow[]>({
    queryKey: ["/api/admin/dashboard/accounts"],
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [subStatusFilter, setSubStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [attributionFilter, setAttributionFilter] = useState<string>("all"); // all / attributed / unattributed
  const [openCompanyId, setOpenCompanyId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((a) => {
      if (statusFilter !== "all" && a.accountStatus !== statusFilter) return false;
      if (subStatusFilter !== "all" && (a.subscriptionStatus ?? "") !== subStatusFilter) return false;
      if (platformFilter !== "all" && (a.platform ?? "") !== platformFilter) return false;
      if (attributionFilter === "attributed" && !a.hasGrowthSubscriber) return false;
      if (attributionFilter === "unattributed" && a.hasGrowthSubscriber) return false;
      if (q) {
        const hay = [
          a.companyName ?? "",
          a.ownerEmail ?? "",
          a.ownerName ?? "",
          a.referralCode ?? "",
          a.sourceName ?? "",
          a.campaignName ?? "",
          String(a.companyId),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, statusFilter, subStatusFilter, platformFilter, attributionFilter]);

  // Build dropdown option lists from the data we actually have so the UI
  // doesn't show empty options.
  const subStatusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of data ?? []) if (a.subscriptionStatus) set.add(a.subscriptionStatus);
    return Array.from(set).sort();
  }, [data]);

  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of data ?? []) if (a.platform) set.add(a.platform);
    return Array.from(set).sort();
  }, [data]);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Accounts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every customer company — attributed or not. Click a row for the full detail and admin actions.
        </p>
      </header>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label className="text-xs text-slate-500">Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Company, email, code, ID…"
            className="h-8 text-sm"
            data-testid="accounts-search"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Account status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="accounts-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {ACCOUNT_ADMIN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-500">Subscription</Label>
          <Select value={subStatusFilter} onValueChange={setSubStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs" data-testid="accounts-substatus-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {subStatusOptions.map((s) => (
                <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-500">Platform</Label>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-32 h-8 text-xs" data-testid="accounts-platform-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {platformOptions.map((p) => (
                <SelectItem key={p} value={p}>{platformLabel(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-500">Attribution</Label>
          <Select value={attributionFilter} onValueChange={setAttributionFilter}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="accounts-attribution-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="attributed">With attribution</SelectItem>
              <SelectItem value="unattributed">Missing attribution</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-slate-400 ml-auto pb-1">
          {filtered.length} account{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No accounts match these filters.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3">Owner</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Subscription</th>
                  <th className="text-left px-4 py-3">Platform</th>
                  <th className="text-right px-4 py-3">MRR</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Campaign</th>
                  <th className="text-left px-4 py-3">Signed up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a) => (
                  <tr
                    key={a.companyId}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setOpenCompanyId(a.companyId)}
                    data-testid={`account-row-${a.companyId}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{a.companyName ?? "—"}</div>
                      <div className="text-xs text-slate-400">#{a.companyId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{a.ownerEmail ?? "—"}</div>
                      {a.ownerName && <div className="text-xs text-slate-400">{a.ownerName}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex items-center px-2 py-0.5 rounded text-xs border " +
                          ACCOUNT_STATUS_COLORS[a.accountStatus]
                        }
                      >
                        {ACCOUNT_STATUS_LABELS[a.accountStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{planLabel(a.plan, a.subscriptionStatus)}</td>
                    <td className="px-4 py-3 text-slate-700">{statusLabel(a.subscriptionStatus)}</td>
                    <td className="px-4 py-3 text-slate-700">{platformLabel(a.platform)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {fmtMoney(a.monthlyRevenue)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {a.sourceType
                        ? GROWTH_SOURCE_LABELS[a.sourceType as GrowthSourceType] ?? a.sourceType
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {a.campaignName ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(a.signupAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <AccountDetailDrawer
        companyId={openCompanyId}
        onClose={() => setOpenCompanyId(null)}
      />
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────
function AccountDetailDrawer({
  companyId,
  onClose,
}: {
  companyId: number | null;
  onClose: () => void;
}) {
  const open = companyId != null;
  const { toast } = useToast();

  // The default queryFn only fetches `queryKey[0]`, so we provide an explicit
  // queryFn that constructs the per-company URL. Keeping companyId as a
  // separate cache segment lets us invalidate ['…/accounts'] AND the per-id
  // entry without colliding with the list query.
  const { data: account, isLoading } = useQuery<AccountDetail>({
    queryKey: ["/api/admin/dashboard/accounts", companyId],
    enabled: open && companyId != null,
    queryFn: async () => {
      const res = await fetch(`/api/admin/dashboard/accounts/${companyId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  // ── Local form state, hydrated from `account` whenever it changes ──────
  const [status, setStatus] = useState<AccountAdminStatus>("active");
  const [notes, setNotes] = useState<string>("");
  const [sourceType, setSourceType] = useState<string>("__none__");
  const [sourceName, setSourceName] = useState<string>("");
  const [referralCode, setReferralCode] = useState<string>("");

  useEffect(() => {
    if (account) {
      setStatus(account.accountStatus);
      setNotes(account.notes ?? "");
      setSourceType(account.sourceType ?? "__none__");
      setSourceName(account.sourceName ?? "");
      setReferralCode(account.referralCode ?? "");
    }
  }, [account]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/accounts"] });
    if (companyId != null) {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/accounts", companyId] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/subscribers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/overview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/sources"] });
  };

  const statusMutation = useMutation({
    mutationFn: async (next: AccountAdminStatus) => {
      const res = await apiRequest("PATCH", `/api/admin/dashboard/accounts/${companyId}/status`, { status: next });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update status", description: err?.message, variant: "destructive" });
    },
  });

  const notesMutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await apiRequest("PATCH", `/api/admin/dashboard/accounts/${companyId}/notes`, { notes: next });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notes saved" });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save notes", description: err?.message, variant: "destructive" });
    },
  });

  const attributionMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        sourceType: sourceType === "__none__" ? null : sourceType,
        sourceName: sourceName.trim() ? sourceName.trim() : null,
        referralCode: referralCode.trim() ? referralCode.trim() : null,
      };
      const res = await apiRequest("PATCH", `/api/admin/dashboard/accounts/${companyId}/attribution`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Attribution updated" });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update attribution", description: err?.message, variant: "destructive" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/dashboard/accounts/${companyId}/refresh-subscription`);
      return res.json() as Promise<{ refreshed: boolean; reason?: string; status?: string | null }>;
    },
    onSuccess: (r) => {
      if (r.refreshed) {
        toast({ title: "Subscription refreshed", description: `Status: ${r.status ?? "unknown"}` });
      } else {
        toast({ title: "Nothing to refresh", description: r.reason ?? "" });
      }
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Refresh failed", description: err?.message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        {!open ? null : isLoading || !account ? (
          <div className="p-8 text-sm text-slate-400">Loading…</div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-slate-900">{account.companyName}</SheetTitle>
              <SheetDescription>
                Company #{account.companyId} · Owned by {account.ownerEmail ?? "—"}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 mt-6">
              {/* Subscription summary */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">Subscription</h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={refreshMutation.isPending || !account.stripeSubscriptionId}
                    onClick={() => refreshMutation.mutate()}
                    data-testid="account-refresh-subscription"
                  >
                    <RefreshCw className={"h-3.5 w-3.5 mr-1 " + (refreshMutation.isPending ? "animate-spin" : "")} />
                    Refresh from Stripe
                  </Button>
                </div>
                <dl className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm">
                  <Field label="Plan" value={planLabel(account.plan, account.subscriptionStatus)} />
                  <Field label="Status" value={statusLabel(account.subscriptionStatus)} />
                  <Field label="Platform" value={platformLabel(account.platform)} />
                  <Field label="MRR" value={fmtMoney(account.monthlyRevenue)} />
                  <Field label="Stripe customer" mono value={account.stripeCustomerId ?? "—"} />
                  <Field label="Stripe sub" mono value={account.stripeSubscriptionId ?? "—"} />
                  {account.appleOriginalTransactionId && (
                    <Field label="Apple original tx" mono value={account.appleOriginalTransactionId} />
                  )}
                  {account.googlePurchaseToken && (
                    <Field label="Google order" mono value={account.googleOrderId ?? "—"} />
                  )}
                </dl>
                {!account.stripeSubscriptionId && (
                  <p className="text-xs text-slate-400">
                    No Stripe subscription on file — refresh is disabled.
                  </p>
                )}
              </section>

              <Separator />

              {/* Internal status + notes */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Internal admin</h3>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Label className="text-xs text-slate-500">Account status</Label>
                    <Select value={status} onValueChange={(v) => setStatus(v as AccountAdminStatus)}>
                      <SelectTrigger className="h-9 text-sm" data-testid="account-status-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_ADMIN_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    onClick={() => statusMutation.mutate(status)}
                    disabled={statusMutation.isPending || status === account.accountStatus}
                    data-testid="account-status-save"
                  >
                    {statusMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
                <p className="text-xs text-slate-400">
                  Status is informational only — it does not block customer-app access.
                </p>

                <div>
                  <Label className="text-xs text-slate-500">Notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    placeholder="Internal notes on this account…"
                    data-testid="account-notes"
                  />
                  <div className="flex justify-end mt-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => notesMutation.mutate(notes)}
                      disabled={notesMutation.isPending || notes === (account.notes ?? "")}
                      data-testid="account-notes-save"
                    >
                      {notesMutation.isPending ? "Saving…" : "Save notes"}
                    </Button>
                  </div>
                </div>
              </section>

              <Separator />

              {/* Attribution */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Attribution</h3>
                {!account.hasGrowthSubscriber && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    No attribution row yet. Saving will create one and surface this account on Subscribers.
                  </p>
                )}
                <div>
                  <Label className="text-xs text-slate-500">Source type</Label>
                  <Select value={sourceType} onValueChange={setSourceType}>
                    <SelectTrigger className="h-9 text-sm" data-testid="account-source-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {GROWTH_SOURCE_TYPES.map((s) => (
                        <SelectItem key={s} value={s}>{GROWTH_SOURCE_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Source name</Label>
                  <Input
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="e.g. Joe's Plumbing"
                    data-testid="account-source-name"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Referral code</Label>
                  <Input
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value)}
                    placeholder="e.g. joe2025"
                    data-testid="account-referral-code"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    If the code matches an active campaign, that campaign is linked automatically.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => attributionMutation.mutate()}
                    disabled={attributionMutation.isPending}
                    data-testid="account-attribution-save"
                  >
                    {attributionMutation.isPending ? "Saving…" : "Save attribution"}
                  </Button>
                </div>
                {account.campaignName && (
                  <p className="text-xs text-slate-500">
                    Currently linked to campaign: <span className="font-medium">{account.campaignName}</span>
                  </p>
                )}
              </section>

              <Separator />

              {/* Lifecycle */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">Lifecycle</h3>
                <dl className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm">
                  <Field label="Signed up" value={fmtDateTime(account.signupAt)} />
                  <Field label="Onboarded" value={fmtDateTime(account.onboardingCompletedAt)} />
                </dl>
              </section>

              <Separator />

              {/* Members */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  Team ({account.members.length})
                </h3>
                {account.members.length === 0 ? (
                  <p className="text-xs text-slate-400">No team members on this company.</p>
                ) : (
                  <ul className="text-sm divide-y divide-slate-100 border border-slate-200 rounded-md">
                    {account.members.map((m) => (
                      <li key={m.userId} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-slate-800">{m.email ?? "—"}</div>
                          {m.name && <div className="text-xs text-slate-400">{m.name}</div>}
                        </div>
                        <Badge variant="outline" className="text-xs">{m.role}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Danger zone — visually separated, only when env-var enables it. */}
              {account.deletionEnabled && (
                <>
                  <Separator />
                  <section className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                      <div>
                        <h3 className="text-sm font-semibold text-red-900">Danger zone</h3>
                        <p className="text-xs text-red-800 mt-0.5">
                          Permanently delete this account and all related EcoLogic data. This action cannot be undone.
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <DeleteAccountButton
                        companyId={account.companyId}
                        companyName={account.companyName}
                        onDeleted={() => {
                          invalidate();
                          onClose();
                        }}
                      />
                    </div>
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Destructive: Delete Account button + confirmation modal ─────────────
function DeleteAccountButton({
  companyId,
  companyName,
  onDeleted,
}: {
  companyId: number;
  companyName: string;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [understood, setUnderstood] = useState(false);

  // Re-fetch a fresh preview every time the modal opens — counts can drift.
  const { data: preview, isLoading: previewLoading } = useQuery<DeletePreview>({
    queryKey: ["/api/admin/dashboard/accounts", companyId, "delete-preview"],
    enabled: open,
    queryFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/admin/dashboard/accounts/${companyId}/delete-preview`,
      );
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "DELETE",
        `/api/admin/dashboard/accounts/${companyId}`,
        { confirmText: "DELETE", understood: true },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account deleted permanently." });
      setOpen(false);
      setConfirmText("");
      setUnderstood(false);
      onDeleted();
    },
    onError: (err: any) => {
      toast({
        title: "Delete failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const protectedReason = preview?.protected ? preview.protectedReason : null;
  const canSubmit =
    !!preview &&
    !preview.protected &&
    confirmText === "DELETE" &&
    understood &&
    !deleteMutation.isPending;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="account-delete-button"
      >
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        Delete account
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(false);
            setConfirmText("");
            setUnderstood(false);
          }
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-900">
              Delete this account permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this company and all related EcoLogic data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-sm">
            {previewLoading ? (
              <p className="text-slate-400">Loading preview…</p>
            ) : !preview ? (
              <p className="text-slate-400">Preview unavailable.</p>
            ) : (
              <>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Company</span>
                    <span className="font-medium text-slate-900 truncate" title={preview.companyName ?? companyName}>
                      {preview.companyName ?? companyName}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Company ID</span>
                    <span className="font-mono text-xs text-slate-700">#{preview.companyId}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Owner email</span>
                    <span className="text-slate-700 truncate" title={preview.ownerEmail ?? "—"}>
                      {preview.ownerEmail ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Subscription</span>
                    <span className="text-slate-700">
                      {preview.subscription.platform ?? "—"} · {preview.subscription.status ?? "—"}
                    </span>
                  </div>
                </div>

                <div className="rounded border border-slate-200 bg-white px-3 py-2 grid grid-cols-2 gap-y-1 gap-x-3 text-xs">
                  <CountRow label="Team members" v={preview.counts.members} />
                  <CountRow label="Jobs" v={preview.counts.jobs} />
                  <CountRow label="Customers" v={preview.counts.customers} />
                  <CountRow label="Invoices" v={preview.counts.invoices} />
                  <CountRow label="Payments" v={preview.counts.payments} />
                  <CountRow label="Documents" v={preview.counts.documents} />
                  <CountRow label="Conversations" v={preview.counts.conversations} />
                  <CountRow label="Messages" v={preview.counts.messages} />
                  <CountRow label="Growth attribution rows" v={preview.counts.growthSubscribers} />
                </div>

                {preview.warnings.length > 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                    {preview.warnings.map((w, i) => (
                      <div key={i} className="flex gap-1.5">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {protectedReason && (
                  <div className="rounded border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-900">
                    <strong>Cannot delete:</strong> {protectedReason}
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <Label className="text-xs text-slate-700">
                    Type <span className="font-mono font-bold">DELETE</span> to confirm
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                    autoComplete="off"
                    disabled={preview.protected}
                    data-testid="account-delete-confirm-input"
                  />
                </div>

                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <Checkbox
                    checked={understood}
                    onCheckedChange={(v) => setUnderstood(!!v)}
                    disabled={preview.protected}
                    data-testid="account-delete-understood"
                  />
                  <span>I understand this cannot be undone.</span>
                </label>
              </>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel data-testid="account-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canSubmit}
              onClick={(e) => {
                e.preventDefault();
                if (!canSubmit) return;
                deleteMutation.mutate();
              }}
              className="bg-red-600 hover:bg-red-700 text-white disabled:bg-red-300 disabled:cursor-not-allowed"
              data-testid="account-delete-submit"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CountRow({ label, v }: { label: string; v: number }) {
  return (
    <>
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800 tabular-nums">{v.toLocaleString()}</span>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={"text-slate-800 truncate " + (mono ? "font-mono text-xs" : "")} title={value}>
        {value}
      </dd>
    </>
  );
}
