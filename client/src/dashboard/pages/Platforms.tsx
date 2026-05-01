/**
 * Dashboard → Platforms page
 * ──────────────────────────
 * Subscription health broken into 3 platform cards: Apple, Google Play, Stripe.
 * Clicking a card opens a detail drawer with the full subscriber list,
 * filterable by status and plan.
 *
 * Data source: growth_subscribers (platform column).
 */

import { useMemo, useState, type ReactNode } from "react";
import { useQuery }          from "@tanstack/react-query";
import { SiApple, SiGoogleplay, SiStripe } from "react-icons/si";
import { Badge }   from "@/components/ui/badge";
import { Input }   from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { subscriptionPlans } from "@shared/subscriptionPlans";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlatformRow {
  platform: string;
  subscribers: number;
  trialing: number;
  paid: number;
  canceled: number;
  monthlyRevenue: number;
  totalRevenue: number;
}

interface PlatformSubscriberRow {
  id: number;
  companyName: string | null;
  ownerEmail: string | null;
  plan: string | null;
  subscriptionStatus: string;
  platform: string;
  monthlyRevenue: string | null;
  totalRevenue: string | null;
  sourceType: string | null;
  sourceName: string | null;
  campaignId: number | null;
  campaignName: string | null;
  referralCode: string | null;
  signupAt: string | null;
  onboardingCompletedAt: string | null;
  trialStartedAt: string | null;
  becamePaidAt: string | null;
  canceledAt: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_DEFS = [
  { key: "apple",       label: "Apple",         accent: "text-slate-900",  bg: "bg-slate-50"  },
  { key: "google_play", label: "Google Play",   accent: "text-green-700",  bg: "bg-green-50"  },
  { key: "stripe",      label: "Stripe",        accent: "text-indigo-700", bg: "bg-indigo-50" },
] as const;

type PlatformKey = typeof PLATFORM_DEFS[number]["key"];

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  unknown:  { label: "Unknown",   cls: "bg-slate-100 text-slate-500 border-slate-200"  },
  trialing: { label: "Trialing",  cls: "bg-amber-50  text-amber-700  border-amber-200"  },
  active:   { label: "Active",    cls: "bg-green-50  text-green-700  border-green-200"  },
  past_due: { label: "Past due",  cls: "bg-orange-50 text-orange-700 border-orange-200" },
  canceled: { label: "Canceled",  cls: "bg-red-50    text-red-600    border-red-200"    },
  expired:  { label: "Expired",   cls: "bg-red-50    text-red-600    border-red-200"    },
  unpaid:   { label: "Unpaid",    cls: "bg-red-50    text-red-600    border-red-200"    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0";
  if (v === 0) return "$0";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return "—"; }
}

function planLabel(key: string | null | undefined, status?: string | null): string {
  if (!key) return status === "trialing" ? "Free trial" : "—";
  const p = (subscriptionPlans as Record<string, { label: string; price: number }>)[key];
  if (!p) return key;
  const base = `${p.label} ($${p.price.toFixed(0)}/mo)`;
  return status === "trialing" ? `Free trial – ${base}` : base;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function PlatformIcon({ platformKey }: { platformKey: PlatformKey }) {
  if (platformKey === "apple")       return <SiApple       className="w-6 h-6 text-slate-800" />;
  if (platformKey === "google_play") return <SiGoogleplay  className="w-6 h-6 text-green-600" />;
  if (platformKey === "stripe")      return <SiStripe      className="w-6 h-6 text-indigo-600" />;
  return null;
}

function healthBadge(m: PlatformRow | undefined) {
  if (!m || m.subscribers === 0)
    return <Badge variant="outline" className="text-xs border-slate-200 text-slate-400">No users</Badge>;
  if (m.paid > 0)
    return <Badge variant="outline" className="text-xs border-green-200 bg-green-50 text-green-700">Active</Badge>;
  if (m.trialing > 0)
    return <Badge variant="outline" className="text-xs border-amber-200 bg-amber-50 text-amber-700">Trials only</Badge>;
  return <Badge variant="outline" className="text-xs border-slate-200 text-slate-500">Inactive</Badge>;
}

// ── Platform card ─────────────────────────────────────────────────────────────

function PlatformCard({
  def,
  metrics,
  onClick,
}: {
  def: typeof PLATFORM_DEFS[number];
  metrics: PlatformRow | undefined;
  onClick: () => void;
}) {
  const m = metrics;
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 hover:shadow-sm transition-all group"
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-10 h-10 rounded-xl ${def.bg} flex items-center justify-center`}>
            <PlatformIcon platformKey={def.key} />
          </div>
          <div>
            <p className="font-semibold text-slate-900 text-sm">{def.label}</p>
            <p className="text-xs text-slate-400">{m?.subscribers ?? 0} subscriber{(m?.subscribers ?? 0) !== 1 ? "s" : ""}</p>
          </div>
        </div>
        {healthBadge(m)}
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Trialing", value: m?.trialing ?? 0,  color: "text-amber-600"  },
          { label: "Paid",     value: m?.paid     ?? 0,  color: "text-green-700"  },
          { label: "Canceled", value: m?.canceled ?? 0, color: "text-slate-500"  },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-50 rounded-lg px-2 py-2 text-center">
            <p className={`text-lg font-semibold ${color}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Revenue */}
      <div className="flex justify-between text-sm border-t border-slate-100 pt-3">
        <div>
          <p className="text-xs text-slate-400">MRR</p>
          <p className="font-semibold text-slate-900">{fmtMoney(m?.monthlyRevenue)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Total revenue</p>
          <p className="font-semibold text-slate-900">{fmtMoney(m?.totalRevenue)}</p>
        </div>
      </div>

      <p className="text-xs text-slate-400 group-hover:text-slate-600 mt-3 transition-colors">
        View subscribers →
      </p>
    </button>
  );
}

// ── Platform detail drawer ────────────────────────────────────────────────────

function PlatformDrawer({ platform }: { platform: PlatformKey }) {
  const def = PLATFORM_DEFS.find((d) => d.key === platform)!;

  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [planFilter,    setPlanFilter]    = useState("all");

  const { data, isLoading } = useQuery<PlatformSubscriberRow[]>({
    queryKey: ["/api/admin/dashboard/platforms", platform, "subscribers"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/dashboard/platforms/${platform}/subscribers`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((s) => {
      if (statusFilter !== "all" && s.subscriptionStatus !== statusFilter) return false;
      if (planFilter   !== "all" && (s.plan ?? "")        !== planFilter)   return false;
      if (q) {
        const hay = [s.companyName, s.ownerEmail, s.referralCode, s.sourceName, s.campaignName]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, statusFilter, planFilter]);

  // Summary of the filtered set
  const totals = useMemo(() => ({
    subscribers: filtered.length,
    trialing: filtered.filter((s) => s.subscriptionStatus === "trialing").length,
    paid:     filtered.filter((s) => ["active","past_due"].includes(s.subscriptionStatus)).length,
    canceled: filtered.filter((s) => ["canceled","expired"].includes(s.subscriptionStatus)).length,
    mrr:      filtered.filter((s) => ["active","past_due"].includes(s.subscriptionStatus))
                      .reduce((s, r) => s + Number(r.monthlyRevenue ?? 0), 0),
    revenue:  filtered.reduce((s, r) => s + Number(r.totalRevenue ?? 0), 0),
  }), [filtered]);

  const planOptions = useMemo(() => {
    if (!data) return [];
    const keys = new Set(data.map((s) => s.plan).filter(Boolean));
    return Array.from(keys) as string[];
  }, [data]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl ${def.bg} flex items-center justify-center`}>
            <PlatformIcon platformKey={platform} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{def.label}</h2>
            <p className="text-xs text-slate-400">{data?.length ?? "—"} total subscribers</p>
          </div>
        </div>

        {/* Summary metrics */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Trialing",  value: totals.trialing,         color: "text-amber-600"  },
            { label: "Paid",      value: totals.paid,             color: "text-green-700"  },
            { label: "Canceled",  value: totals.canceled,         color: "text-slate-500"  },
            { label: "MRR",       value: fmtMoney(totals.mrr),    color: "text-slate-900"  },
            { label: "Revenue",   value: fmtMoney(totals.revenue),color: "text-slate-900"  },
            { label: "Total",     value: totals.subscribers,      color: "text-slate-900"  },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-50 rounded-lg px-2 py-2">
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`text-sm font-semibold ${color} mt-0.5`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <Input
          placeholder="Search company, email, code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs flex-1 min-w-[160px]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="trialing">Trialing</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="past_due">Past due</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        {planOptions.length > 0 && (
          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger className="h-8 text-xs w-32">
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {planOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {(subscriptionPlans as Record<string, { label: string }>)[p]?.label ?? p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {(search || statusFilter !== "all" || planFilter !== "all") && (
          <button
            className="text-xs text-slate-400 hover:text-slate-600 underline px-1"
            onClick={() => { setSearch(""); setStatusFilter("all"); setPlanFilter("all"); }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Subscriber list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {data && data.length > 0 ? "No subscribers match your filters." : "No subscribers on this platform yet."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((s) => {
              const mrr = Number(s.monthlyRevenue ?? 0);
              const rev = Number(s.totalRevenue   ?? 0);
              return (
                <div key={s.id} className="px-6 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {s.companyName ?? s.ownerEmail ?? `#${s.id}`}
                      </p>
                      {s.ownerEmail && s.companyName && (
                        <p className="text-xs text-slate-400 truncate">{s.ownerEmail}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">
                        {planLabel(s.plan, s.subscriptionStatus)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusBadge status={s.subscriptionStatus} />
                      {mrr > 0 && (
                        <p className="text-xs font-medium text-green-700 mt-1">{fmtMoney(mrr)}/mo</p>
                      )}
                      {rev > 0 && mrr === 0 && (
                        <p className="text-xs text-slate-500 mt-1">{fmtMoney(rev)} total</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-slate-400">
                    {s.signupAt && (
                      <span>Signed up {fmtDate(s.signupAt)}</span>
                    )}
                    {s.onboardingCompletedAt ? (
                      <span className="text-green-600">Onboarded</span>
                    ) : (
                      <span>Not onboarded</span>
                    )}
                    {(s.campaignName ?? s.sourceName) && (
                      <span>via {s.campaignName ?? s.sourceName}</span>
                    )}
                    {s.referralCode && (
                      <span className="font-mono">{s.referralCode}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer count */}
      {!isLoading && filtered.length > 0 && (
        <div className="px-6 py-2 border-t border-slate-100">
          <p className="text-xs text-slate-400">
            Showing {filtered.length} of {data?.length ?? 0} subscriber{(data?.length ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Summary metric card (top-of-page totals) ───────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Platforms() {
  const [drawerPlatform, setDrawerPlatform] = useState<PlatformKey | null>(null);
  const [drawerOpen,     setDrawerOpen]     = useState(false);

  const { data, isLoading } = useQuery<PlatformRow[]>({
    queryKey: ["/api/admin/dashboard/platforms"],
  });

  const platformMap = useMemo(() => {
    const m = new Map<string, PlatformRow>();
    for (const r of data ?? []) m.set(r.platform, r);
    return m;
  }, [data]);

  // Overall totals across ALL platforms (including unknown/manual)
  const totals = useMemo(() => {
    const all = data ?? [];
    return {
      subscribers: all.reduce((s, r) => s + r.subscribers, 0),
      trialing:    all.reduce((s, r) => s + r.trialing,    0),
      paid:        all.reduce((s, r) => s + r.paid,        0),
      canceled:    all.reduce((s, r) => s + r.canceled,    0),
      mrr:         all.reduce((s, r) => s + r.monthlyRevenue, 0),
      revenue:     all.reduce((s, r) => s + r.totalRevenue,   0),
    };
  }, [data]);

  const openDrawer = (k: PlatformKey) => {
    setDrawerPlatform(k);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Platforms</h1>
        <p className="text-sm text-slate-500 mt-1">
          Stripe, Apple, and Google Play subscription health — sourced from live subscriber data.
        </p>
      </header>

      {/* Overall summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total"    value={isLoading ? "—" : totals.subscribers} />
        <SummaryCard label="Trialing" value={isLoading ? "—" : totals.trialing}    />
        <SummaryCard label="Paid"     value={isLoading ? "—" : totals.paid}        />
        <SummaryCard label="Canceled" value={isLoading ? "—" : totals.canceled}    />
        <SummaryCard label="MRR"      value={isLoading ? "—" : fmtMoney(totals.mrr)}     />
        <SummaryCard label="Revenue"  value={isLoading ? "—" : fmtMoney(totals.revenue)} />
      </div>

      {/* 3 platform cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLATFORM_DEFS.map((d) => (
            <div key={d.key} className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse h-52" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLATFORM_DEFS.map((def) => (
            <PlatformCard
              key={def.key}
              def={def}
              metrics={platformMap.get(def.key)}
              onClick={() => openDrawer(def.key)}
            />
          ))}
        </div>
      )}

      {/* Other platforms (unknown / manual) if they have any data */}
      {(() => {
        const other = (data ?? []).filter(
          (r) => !PLATFORM_DEFS.some((d) => d.key === r.platform)
        );
        if (other.length === 0) return null;
        return (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-medium text-slate-700">Other platforms</p>
              <p className="text-xs text-slate-400">Unknown or manually entered subscriptions.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">Platform</th>
                  <th className="text-right px-4 py-2">Subscribers</th>
                  <th className="text-right px-4 py-2">Trialing</th>
                  <th className="text-right px-4 py-2">Paid</th>
                  <th className="text-right px-4 py-2">Canceled</th>
                  <th className="text-right px-4 py-2">MRR</th>
                  <th className="text-right px-4 py-2">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {other.map((r) => (
                  <tr key={r.platform} className="hover:bg-slate-50">
                    <td className="px-4 py-2 capitalize text-slate-700">{r.platform}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.subscribers}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600">{r.trialing}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-700">{r.paid}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{r.canceled}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.monthlyRevenue)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Detail drawer */}
      <Sheet
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) { setDrawerOpen(false); setDrawerPlatform(null); }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>Platform subscribers</SheetTitle>
          </SheetHeader>
          {drawerPlatform && <PlatformDrawer platform={drawerPlatform} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
