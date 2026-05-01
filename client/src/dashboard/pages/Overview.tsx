/**
 * Dashboard → Overview page
 * ─────────────────────────
 * KPI cards + live charts:
 *   • Subscriber growth over time (area)
 *   • Revenue / MRR over time (bar)
 *   • Platform breakdown (horizontal bar)
 *   • Top sources & campaigns (bar / table)
 *
 * Data: /api/admin/dashboard/overview  (KPI cards)
 *       /api/admin/dashboard/overview/charts?range=N  (charts)
 */

import { useState, type ReactNode } from "react";
import { useQuery }  from "@tanstack/react-query";
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";
import { GROWTH_SOURCE_LABELS, type GrowthSourceType } from "@shared/growthSources";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  totalSubscribers: number;
  trialing: number;
  paid: number;
  canceled: number;
  currentMrr: number;
  totalRevenue: number;
  topSource: { sourceType: string | null; count: number } | null;
  topCampaign: { campaignId: number | null; name: string | null; count: number } | null;
  generatedAt: string;
}

interface SignupDataPoint  { date: string; signups: number; trialing: number; paid: number; }
interface RevenueDataPoint { date: string; revenue: number; }
interface PlatformRow {
  platform: string; subscribers: number; trialing: number;
  paid: number; canceled: number; monthlyRevenue: number; totalRevenue: number;
}
interface OverviewCharts {
  signupsByDay:      SignupDataPoint[];
  revenueByDay:      RevenueDataPoint[];
  platformBreakdown: PlatformRow[];
  topSources:        Array<{ sourceType: string | null; subscribers: number; monthlyRevenue: number; totalRevenue: number; }>;
  topCampaigns:      Array<{ campaignId: number | null; name: string | null; subscribers: number; mrr: number; totalRevenue: number; }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

type Range = "7" | "30" | "90" | "all";

const RANGE_OPTIONS: { label: string; value: Range }[] = [
  { label: "7d",     value: "7"   },
  { label: "30d",    value: "30"  },
  { label: "90d",    value: "90"  },
  { label: "All",    value: "all" },
];

const PLATFORM_LABELS: Record<string, string> = {
  apple: "Apple", google_play: "Google Play", stripe: "Stripe",
  manual: "Manual", unknown: "Unknown",
};

const PLATFORM_COLORS: Record<string, string> = {
  apple: "#1e293b", google_play: "#16a34a", stripe: "#6366f1",
  manual: "#94a3b8", unknown: "#cbd5e1",
};

const CHART_COLORS = {
  trialing: "#f59e0b",
  paid:     "#16a34a",
  total:    "#3b82f6",
  revenue:  "#10b981",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n || 0);
}

function fmtXDate(dateStr: string, range: Range): string {
  const d = new Date(dateStr + "T12:00:00Z");
  if (range === "7")   return d.toLocaleDateString("en-US", { weekday: "short" });
  if (range === "30")  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (range === "90")  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function sourceLabel(t: string | null): string {
  if (!t) return "Unknown";
  return GROWTH_SOURCE_LABELS[t as GrowthSourceType] ?? t;
}

// Reduce X-axis tick density for readability
function xTickInterval(data: unknown[], range: Range): number {
  if (range === "7")   return 0;
  if (range === "30")  return Math.max(0, Math.floor(data.length / 8));
  if (range === "90")  return Math.max(0, Math.floor(data.length / 10));
  return Math.max(0, Math.floor(data.length / 10));
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function StatCard({
  label, value, hint, testId, small,
}: {
  label: string; value: string | number;
  hint?: string; testId?: string; small?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid={testId}>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={small
        ? "mt-2 text-lg font-semibold text-slate-900 leading-snug break-words"
        : "mt-2 text-3xl font-semibold text-slate-900"}
        title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ message = "No data in this period." }: { message?: string }) {
  return (
    <div className="h-44 flex items-center justify-center text-sm text-slate-400">
      {message}
    </div>
  );
}

// Tooltip formatters
function CurrencyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-md">
      <p className="text-slate-500 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color ?? p.fill }} className="font-medium">
          {p.name}: {fmtCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-md">
      <p className="text-slate-500 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color ?? p.fill }} className="font-medium">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

// ── Chart components ───────────────────────────────────────────────────────────

function SubscriberGrowthChart({ data, range }: { data: SignupDataPoint[]; range: Range }) {
  if (!data.length) return <EmptyChart />;
  const interval = xTickInterval(data, range);
  const formatted = data.map((d) => ({ ...d, label: fmtXDate(d.date, range) }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="gradTrialing" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={CHART_COLORS.trialing} stopOpacity={0.25} />
            <stop offset="95%" stopColor={CHART_COLORS.trialing} stopOpacity={0}    />
          </linearGradient>
          <linearGradient id="gradPaid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={CHART_COLORS.paid} stopOpacity={0.25} />
            <stop offset="95%" stopColor={CHART_COLORS.paid} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} interval={interval} />
        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
        <Tooltip content={<CountTooltip />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Area
          type="monotone" dataKey="trialing" name="Trialing"
          stroke={CHART_COLORS.trialing} fill="url(#gradTrialing)"
          strokeWidth={1.5} dot={false} />
        <Area
          type="monotone" dataKey="paid" name="Paid"
          stroke={CHART_COLORS.paid} fill="url(#gradPaid)"
          strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RevenueChart({ data, range }: { data: RevenueDataPoint[]; range: Range }) {
  if (!data.length) return <EmptyChart message="No paid subscribers in this period." />;
  const formatted = data.map((d) => ({ ...d, label: fmtXDate(d.date, range) }));
  const interval = xTickInterval(data, range);
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} interval={interval} />
        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => `$${v}`} />
        <Tooltip content={<CurrencyTooltip />} />
        <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.revenue} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PlatformChart({ data }: { data: PlatformRow[] }) {
  const main = data
    .filter((r) => ["apple", "google_play", "stripe"].includes(r.platform))
    .map((r) => ({
      name: PLATFORM_LABELS[r.platform] ?? r.platform,
      Subscribers: r.subscribers,
      Paid: r.paid,
      Trialing: r.trialing,
      color: PLATFORM_COLORS[r.platform] ?? "#94a3b8",
    }));
  if (!main.length) return <EmptyChart message="No platform data yet." />;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={main} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
        <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#64748b" }} width={82} />
        <Tooltip content={<CountTooltip />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Paid" fill={CHART_COLORS.paid} radius={[0, 3, 3, 0]} stackId="a" />
        <Bar dataKey="Trialing" fill={CHART_COLORS.trialing} radius={[0, 3, 3, 0]} stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SourcesChart({ data }: { data: OverviewCharts["topSources"] }) {
  const items = data
    .filter((s) => s.subscribers > 0)
    .map((s) => ({ name: sourceLabel(s.sourceType), Subscribers: s.subscribers }));
  if (!items.length) return <EmptyChart message="No source data yet." />;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={items} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
        <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#64748b" }} width={90} />
        <Tooltip content={<CountTooltip />} />
        <Bar dataKey="Subscribers" radius={[0, 3, 3, 0]}>
          {items.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS.total} fillOpacity={1 - i * 0.1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function CampaignsTable({ data }: { data: OverviewCharts["topCampaigns"] }) {
  const items = data.filter((c) => c.subscribers > 0);
  if (!items.length) return <EmptyChart message="No campaign data yet." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
            <th className="text-left py-2 pr-4">Campaign</th>
            <th className="text-right py-2 px-2">Subscribers</th>
            <th className="text-right py-2 px-2">MRR</th>
            <th className="text-right py-2 pl-2">Total rev</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((c, i) => (
            <tr key={c.campaignId ?? i} className="hover:bg-slate-50">
              <td className="py-2 pr-4 text-slate-800 font-medium truncate max-w-[180px]">
                {c.name ?? `Campaign #${c.campaignId}`}
              </td>
              <td className="py-2 px-2 text-right tabular-nums text-slate-700">{c.subscribers}</td>
              <td className="py-2 px-2 text-right tabular-nums text-green-700">{fmtCurrency(c.mrr)}</td>
              <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{fmtCurrency(c.totalRevenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Overview() {
  const [range, setRange] = useState<Range>("30");

  const { data: kpi, isLoading: kpiLoading } = useQuery<OverviewData>({
    queryKey: ["/api/admin/dashboard/overview"],
  });

  const { data: charts, isLoading: chartsLoading } = useQuery<OverviewCharts>({
    queryKey: ["/api/admin/dashboard/overview/charts", range],
    queryFn: async () => {
      const res = await fetch(`/api/admin/dashboard/overview/charts?range=${range}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          EcoLogic subscriber growth, revenue, and platform health — sourced from live data.
        </p>
      </header>

      {/* KPI stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total subscribers" value={kpiLoading ? "—" : kpi?.totalSubscribers ?? 0} testId="card-total-subscribers" />
        <StatCard label="Trialing"          value={kpiLoading ? "—" : kpi?.trialing ?? 0}           testId="card-trialing" />
        <StatCard label="Paid subscribers"  value={kpiLoading ? "—" : kpi?.paid ?? 0}               hint="active or past_due" testId="card-paid" />
        <StatCard label="Canceled"          value={kpiLoading ? "—" : kpi?.canceled ?? 0}            hint="canceled or expired" testId="card-canceled" />
        <StatCard label="Current MRR"       value={kpiLoading ? "—" : fmtCurrency(kpi?.currentMrr ?? 0)} hint="paid subscribers only — trials excluded" testId="card-mrr" />
        <StatCard label="Total revenue"     value={kpiLoading ? "—" : fmtCurrency(kpi?.totalRevenue ?? 0)} hint="all-time" testId="card-total-revenue" />
        <StatCard
          label="Top source"
          value={kpiLoading ? "—" : sourceLabel(kpi?.topSource?.sourceType ?? null)}
          hint={kpi?.topSource ? `${kpi.topSource.count} subscriber${kpi.topSource.count === 1 ? "" : "s"}` : undefined}
          testId="card-top-source" small
        />
        <StatCard
          label="Top campaign"
          value={kpiLoading ? "—" : kpi?.topCampaign?.name ?? "—"}
          hint={kpi?.topCampaign ? `${kpi.topCampaign.count} subscriber${kpi.topCampaign.count === 1 ? "" : "s"}` : undefined}
          testId="card-top-campaign" small
        />
      </div>

      {/* Date range selector */}
      <div className="flex items-center gap-1 border border-slate-200 rounded-lg bg-white p-1 w-fit">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setRange(opt.value)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              range === opt.value
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {chartsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse h-64" />
          ))}
        </div>
      ) : (
        <>
          {/* Row 1: Subscriber growth (full width) */}
          <ChartCard
            title="Subscriber growth"
            subtitle="New signups per day — trialing vs paid"
          >
            <SubscriberGrowthChart data={charts?.signupsByDay ?? []} range={range} />
          </ChartCard>

          {/* Row 2: Revenue + Platform (side by side) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard
              title="Revenue by day"
              subtitle="Monthly revenue from subscribers who converted in this period"
            >
              <RevenueChart data={charts?.revenueByDay ?? []} range={range} />
            </ChartCard>

            <ChartCard
              title="Platform breakdown"
              subtitle="Apple · Google Play · Stripe — paid vs trialing"
            >
              <PlatformChart data={charts?.platformBreakdown ?? []} />
            </ChartCard>
          </div>

          {/* Row 3: Top sources + Top campaigns (side by side) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard
              title="Top sources"
              subtitle="Subscriber count by acquisition source"
            >
              <SourcesChart data={charts?.topSources ?? []} />
            </ChartCard>

            <ChartCard
              title="Top campaigns"
              subtitle="Performance by referral campaign"
            >
              <CampaignsTable data={charts?.topCampaigns ?? []} />
            </ChartCard>
          </div>
        </>
      )}

      <p className="text-xs text-slate-400">
        Live data from{" "}
        <code className="bg-slate-100 px-1 py-0.5 rounded">growth_subscribers</code>.
        MRR counts only active paid subscribers. Revenue is based on{" "}
        <code className="bg-slate-100 px-1 py-0.5 rounded">monthly_revenue</code>{" "}
        at conversion date — connect Stripe webhooks for complete lifetime revenue.
      </p>
    </div>
  );
}
