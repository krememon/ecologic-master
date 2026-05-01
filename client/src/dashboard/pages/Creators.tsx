/**
 * Dashboard → Creators page
 * ─────────────────────────
 * Performance view for every creator/influencer in the growth programme.
 * Metrics are derived from:
 *   • growth_subscribers  — signups, trials, paid, MRR, revenue
 *   • growth_campaigns    — tracking links, spend (campaign cost)
 *   • growth_mobile_events — click counts by referral code
 *   • growth_creators.cost — creator-level spend/deal cost
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Badge }   from "@/components/ui/badge";
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
import {
  Copy,
  ExternalLink,
  Power,
  Instagram,
  Users,
  TrendingUp,
  DollarSign,
  Activity,
} from "lucide-react";
import { GROWTH_SOURCE_LABELS, type GrowthSourceType } from "@shared/growthSources";
import type { GrowthSubscriber } from "@shared/schema";

// ── Local types (mirror server CreatorWithMetrics / CreatorDetail) ────────────

interface CampaignSummary {
  id: number;
  name: string;
  trackingUrl: string | null;
  appsflyerOnelinkUrl: string | null;
  referralCode: string | null;
  sourceType: string | null;
  sourceName: string | null;
}

interface CreatorWithMetrics {
  id: number;
  name: string;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  referralCode: string | null;
  campaignId: number | null;
  cost: string | null;
  status: "active" | "inactive";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // enriched
  campaigns: CampaignSummary[];
  signups: number;
  trials: number;
  paid: number;
  mrr: number;
  totalRevenue: number;
  clicks: number;
  spend: number;
  handle: string | null;
  sourceType: string | null;
  /** true = derived from campaign source_name; no growth_creators record exists */
  campaignDerived: boolean;
}

interface CreatorDetail extends CreatorWithMetrics {
  subscribers: GrowthSubscriber[];
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtRoi(revenue: number, spend: number): string {
  if (spend === 0) return "—";
  const pct = ((revenue - spend) / spend) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function fmtProfit(revenue: number, spend: number): string {
  if (spend === 0 && revenue === 0) return "—";
  return fmtMoney(revenue - spend);
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d as string).toLocaleDateString(); } catch { return "—"; }
}

function sourceLabel(t: string | null | undefined): string {
  if (!t) return "—";
  return (GROWTH_SOURCE_LABELS as Record<string, string>)[t] ?? t;
}

const PLATFORM_LABELS: Record<string, string> = {
  unknown: "Unknown", stripe: "Stripe", apple: "Apple", google_play: "Google Play", manual: "Manual",
};
const STATUS_LABELS: Record<string, string> = {
  unknown: "Unknown", trialing: "Trial", active: "Active",
  past_due: "Past due", canceled: "Canceled", expired: "Expired", unpaid: "Unpaid",
};

function bestLink(campaigns: CampaignSummary[]): string | null {
  for (const c of campaigns) {
    if (c.trackingUrl)         return c.trackingUrl;
    if (c.appsflyerOnelinkUrl) return c.appsflyerOnelinkUrl;
  }
  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={
        status === "active"
          ? "border-green-200 bg-green-50 text-green-700 text-xs"
          : "border-slate-200 bg-slate-50 text-slate-500 text-xs"
      }
    >
      {status === "active" ? "Active" : "Inactive"}
    </Badge>
  );
}

// ── Creator detail drawer ─────────────────────────────────────────────────────

function CreatorDrawer({
  creatorId,
  onClose,
}: {
  creatorId: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: creator, isLoading } = useQuery<CreatorDetail>({
    queryKey: ["/api/admin/dashboard/creators", creatorId, "detail"],
    enabled: creatorId != null,
    queryFn: async () => {
      const res = await fetch(`/api/admin/dashboard/creators/${creatorId}/detail`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (next: "active" | "inactive") =>
      apiRequest("PATCH", `/api/admin/dashboard/creators/${creatorId}`, { status: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/dashboard/creators/metrics"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/dashboard/creators", creatorId, "detail"] });
      toast({ title: "Creator status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const handleCopyLink = () => {
    if (!creator) return;
    const link = bestLink(creator.campaigns);
    if (!link) { toast({ title: "No tracking link available" }); return; }
    navigator.clipboard.writeText(link);
    toast({ title: "Link copied to clipboard" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-slate-400">
        Loading…
      </div>
    );
  }
  if (!creator) {
    return (
      <div className="p-6 text-sm text-slate-500">Creator not found.</div>
    );
  }

  const spend      = Number(creator.spend ?? 0);
  const revenue    = Number(creator.totalRevenue ?? 0);
  const mrr        = Number(creator.mrr ?? 0);
  const profit     = revenue - spend;
  const roiStr     = fmtRoi(revenue, spend);

  // Platform breakdown
  const platformCounts: Record<string, number> = {};
  for (const s of creator.subscribers) {
    const p = s.platform ?? "unknown";
    platformCounts[p] = (platformCounts[p] ?? 0) + 1;
  }

  // Trial vs paid
  const trialing = creator.subscribers.filter((s) => s.subscriptionStatus === "trialing").length;
  const active   = creator.subscribers.filter((s) => s.subscriptionStatus === "active").length;
  const canceled = creator.subscribers.filter((s) => s.subscriptionStatus === "canceled").length;

  const recentSubs = creator.subscribers.slice(0, 15);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{creator.name}</h2>
            {creator.handle && (
              <p className="text-sm text-slate-500 mt-0.5">{creator.handle}</p>
            )}
            {creator.sourceType && (
              <p className="text-xs text-slate-400 mt-0.5">{sourceLabel(creator.sourceType)}</p>
            )}
          </div>
          <StatusBadge status={creator.status} />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={handleCopyLink}>
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Copy link
          </Button>
          {creator.campaigns[0] && (
            <Button size="sm" variant="outline" asChild>
              <a
                href={`/campaigns?highlight=${creator.campaigns[0].id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                Open campaign
              </a>
            </Button>
          )}
          {!creator.campaignDerived && (
            <Button
              size="sm"
              variant="outline"
              disabled={toggleMutation.isPending}
              onClick={() =>
                toggleMutation.mutate(creator.status === "active" ? "inactive" : "active")
              }
            >
              <Power className="w-3.5 h-3.5 mr-1.5" />
              {creator.status === "active" ? "Deactivate" : "Activate"}
            </Button>
          )}
        </div>
        {creator.campaignDerived && (
          <p className="text-xs text-slate-400 mt-3">
            Derived from campaign data — add a creator record to enable status management.
          </p>
        )}
      </div>

      {/* Metrics grid */}
      <div className="px-6 py-4 grid grid-cols-2 gap-3 border-b border-slate-100">
        {[
          { label: "Signups",    value: creator.signups },
          { label: "Trials",     value: creator.trials },
          { label: "Paid",       value: creator.paid },
          { label: "Clicks",     value: creator.clicks },
          { label: "MRR",        value: fmtMoney(mrr) },
          { label: "Revenue",    value: fmtMoney(revenue) },
          { label: "Spend",      value: fmtMoney(spend) },
          { label: "Profit",     value: fmtProfit(revenue, spend) },
          { label: "ROI",        value: roiStr },
          { label: "Referral",   value: creator.referralCode ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-400 font-medium">{label}</p>
            <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Campaigns */}
      {creator.campaigns.length > 0 && (
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Campaigns ({creator.campaigns.length})
          </p>
          <div className="space-y-2">
            {creator.campaigns.map((c) => (
              <div key={c.id} className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
                <p className="font-medium text-slate-800">{c.name}</p>
                {c.referralCode && (
                  <p className="text-xs text-slate-400 font-mono mt-0.5">Code: {c.referralCode}</p>
                )}
                {(c.trackingUrl || c.appsflyerOnelinkUrl) && (
                  <button
                    className="text-xs text-indigo-600 hover:underline mt-0.5 truncate max-w-full block text-left"
                    onClick={() => {
                      const link = c.trackingUrl ?? c.appsflyerOnelinkUrl ?? "";
                      navigator.clipboard.writeText(link);
                      toast({ title: "Link copied" });
                    }}
                  >
                    <Copy className="w-3 h-3 inline mr-1" />
                    {c.trackingUrl ?? c.appsflyerOnelinkUrl}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform & status breakdown */}
      <div className="px-6 py-4 border-b border-slate-100 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Platform
          </p>
          {Object.keys(platformCounts).length === 0 ? (
            <p className="text-xs text-slate-400">—</p>
          ) : (
            <div className="space-y-1">
              {Object.entries(platformCounts).map(([p, n]) => (
                <div key={p} className="flex justify-between text-xs">
                  <span className="text-slate-600">{PLATFORM_LABELS[p] ?? p}</span>
                  <span className="font-medium text-slate-800">{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Status
          </p>
          <div className="space-y-1">
            {[
              ["Trialing", trialing],
              ["Active (paid)", active],
              ["Canceled", canceled],
            ].map(([label, n]) => (
              <div key={label as string} className="flex justify-between text-xs">
                <span className="text-slate-600">{label}</span>
                <span className="font-medium text-slate-800">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent subscribers */}
      <div className="px-6 py-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Recent signups {creator.subscribers.length > 15 ? `(showing 15 of ${creator.subscribers.length})` : `(${creator.subscribers.length})`}
        </p>
        {recentSubs.length === 0 ? (
          <p className="text-xs text-slate-400">No signups yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recentSubs.map((s) => (
              <div key={s.id} className="bg-slate-50 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 truncate">{s.companyName ?? s.ownerEmail ?? `#${s.id}`}</p>
                    {s.ownerEmail && s.companyName && (
                      <p className="text-slate-400 truncate">{s.ownerEmail}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium text-slate-700">{STATUS_LABELS[s.subscriptionStatus] ?? s.subscriptionStatus}</p>
                    {s.monthlyRevenue && Number(s.monthlyRevenue) > 0 && (
                      <p className="text-slate-400">{fmtMoney(s.monthlyRevenue)}/mo</p>
                    )}
                  </div>
                </div>
                <p className="text-slate-400 mt-1">{PLATFORM_LABELS[s.platform] ?? s.platform} · Signed up {fmtDate(s.signupAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      {creator.notes && (
        <div className="px-6 pb-6">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</p>
          <p className="text-xs text-slate-600 whitespace-pre-wrap">{creator.notes}</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Creators() {
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPerf,   setFilterPerf]   = useState("all");
  const [drawerOpen,   setDrawerOpen]   = useState(false);
  const [selectedId,   setSelectedId]   = useState<number | null>(null);

  const { data, isLoading } = useQuery<CreatorWithMetrics[]>({
    queryKey: ["/api/admin/dashboard/creators/metrics"],
  });

  // ── Summary totals (over ALL creators, not just filtered) ─────────────────
  const summary = useMemo(() => {
    if (!data) return { total: 0, active: 0, signups: 0, paid: 0, mrr: 0, spend: 0 };
    return {
      total:   data.length,
      active:  data.filter((c) => c.status === "active").length,
      signups: data.reduce((s, c) => s + c.signups, 0),
      paid:    data.reduce((s, c) => s + c.paid, 0),
      mrr:     data.reduce((s, c) => s + Number(c.mrr ?? 0), 0),
      spend:   data.reduce((s, c) => s + Number(c.spend ?? 0), 0),
    };
  }, [data]);

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    return data.filter((c) => {
      if (q) {
        const haystack = [c.name, c.handle, c.referralCode, c.instagramHandle, c.tiktokHandle]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (filterPerf === "has_signups" && c.signups === 0) return false;
      if (filterPerf === "has_paid"    && c.paid    === 0) return false;
      return true;
    });
  }, [data, search, filterStatus, filterPerf]);

  const openDrawer = (id: number) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Creators</h1>
        <p className="text-sm text-slate-500 mt-1">
          Influencers and content creators promoting EcoLogic — signups, revenue, and ROI.
        </p>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Total creators"   value={summary.total} />
        <MetricCard label="Active creators"  value={summary.active} />
        <MetricCard label="Total signups"    value={summary.signups} />
        <MetricCard label="Paid subscribers" value={summary.paid} />
        <MetricCard label="Current MRR"      value={fmtMoney(summary.mrr)} />
        <MetricCard label="Total spend"      value={fmtMoney(summary.spend)} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name, handle, code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPerf} onValueChange={setFilterPerf}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Performance" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All performance</SelectItem>
            <SelectItem value="has_signups">Has signups</SelectItem>
            <SelectItem value="has_paid">Has paid subscribers</SelectItem>
          </SelectContent>
        </Select>
        {(search || filterStatus !== "all" || filterPerf !== "all") && (
          <button
            className="text-xs text-slate-400 hover:text-slate-600 underline"
            onClick={() => { setSearch(""); setFilterStatus("all"); setFilterPerf("all"); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !filtered || filtered.length === 0 ? (
          <div className="p-12 text-center">
            {data && data.length > 0 ? (
              <>
                <p className="text-sm font-medium text-slate-700">No creators match your filters.</p>
                <p className="text-xs text-slate-400 mt-1">Try adjusting the search or filters above.</p>
              </>
            ) : (
              <>
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-700">No creators yet</p>
                <p className="text-xs text-slate-400 mt-1">
                  Add creators on the Creators setup page or link them to campaigns.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Creator</th>
                  <th className="text-left px-4 py-3">Handle</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-right px-4 py-3">Campaigns</th>
                  <th className="text-right px-4 py-3">Clicks</th>
                  <th className="text-right px-4 py-3">Signups</th>
                  <th className="text-right px-4 py-3">Trials</th>
                  <th className="text-right px-4 py-3">Paid</th>
                  <th className="text-right px-4 py-3">MRR</th>
                  <th className="text-right px-4 py-3">Revenue</th>
                  <th className="text-right px-4 py-3">Spend</th>
                  <th className="text-right px-4 py-3">Profit</th>
                  <th className="text-right px-4 py-3">ROI</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const rev     = Number(c.totalRevenue ?? 0);
                  const spend   = Number(c.spend ?? 0);
                  const mrr     = Number(c.mrr ?? 0);
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => openDrawer(c.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{c.name}</p>
                        {c.referralCode && (
                          <p className="text-xs font-mono text-slate-400">{c.referralCode}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.handle ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{sourceLabel(c.sourceType)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{c.campaigns.length}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{c.clicks}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{c.signups}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{c.trials}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{c.paid}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmtMoney(mrr)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmtMoney(rev)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(spend)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${rev - spend >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {fmtProfit(rev, spend)}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${spend === 0 ? "text-slate-400" : rev - spend >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {fmtRoi(rev, spend)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Row count */}
      {!isLoading && data && data.length > 0 && (
        <p className="text-xs text-slate-400 text-right">
          Showing {filtered.length} of {data.length} creator{data.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Detail drawer */}
      <Sheet open={drawerOpen} onOpenChange={(open) => { if (!open) { setDrawerOpen(false); setSelectedId(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>Creator detail</SheetTitle>
          </SheetHeader>
          {selectedId != null && (
            <CreatorDrawer creatorId={selectedId} onClose={() => setDrawerOpen(false)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
