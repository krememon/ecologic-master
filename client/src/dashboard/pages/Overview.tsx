import { useQuery } from "@tanstack/react-query";
import { GROWTH_SOURCE_LABELS, type GrowthSourceType } from "@shared/growthSources";

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

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

function friendlySourceLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "—";
  return GROWTH_SOURCE_LABELS[sourceType as GrowthSourceType] ?? sourceType;
}

function StatCard({
  label,
  value,
  hint,
  testId,
  small,
}: {
  label: string;
  value: string | number;
  hint?: string;
  testId?: string;
  small?: boolean;
}) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-5"
      data-testid={testId}
    >
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={
          small
            ? "mt-2 text-lg font-semibold text-slate-900 leading-snug break-words"
            : "mt-2 text-3xl font-semibold text-slate-900"
        }
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default function Overview() {
  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ["/api/admin/dashboard/overview"],
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          A summary of EcoLogic subscribers and revenue across all platforms.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total subscribers"
          value={isLoading ? "—" : data?.totalSubscribers ?? 0}
          testId="card-total-subscribers"
        />
        <StatCard
          label="Trialing"
          value={isLoading ? "—" : data?.trialing ?? 0}
          testId="card-trialing"
        />
        <StatCard
          label="Paid subscribers"
          value={isLoading ? "—" : data?.paid ?? 0}
          hint="active or past_due"
          testId="card-paid"
        />
        <StatCard
          label="Canceled"
          value={isLoading ? "—" : data?.canceled ?? 0}
          hint="canceled or expired"
          testId="card-canceled"
        />
        <StatCard
          label="Current MRR"
          value={isLoading ? "—" : formatCurrency(data?.currentMrr ?? 0)}
          hint="paid subscribers only — trials excluded"
          testId="card-mrr"
        />
        <StatCard
          label="Total revenue"
          value={isLoading ? "—" : formatCurrency(data?.totalRevenue ?? 0)}
          hint="all-time"
          testId="card-total-revenue"
        />
        <StatCard
          label="Top source"
          value={isLoading ? "—" : friendlySourceLabel(data?.topSource?.sourceType ?? null)}
          hint={data?.topSource ? `${data.topSource.count} subscriber${data.topSource.count === 1 ? "" : "s"}` : undefined}
          testId="card-top-source"
          small
        />
        <StatCard
          label="Top campaign"
          value={isLoading ? "—" : data?.topCampaign?.name ?? "—"}
          hint={data?.topCampaign ? `${data.topCampaign.count} subscriber${data.topCampaign.count === 1 ? "" : "s"}` : undefined}
          testId="card-top-campaign"
          small
        />
      </div>

      <p className="text-xs text-slate-400">
        Showing live data from <code className="bg-slate-100 px-1 py-0.5 rounded">growth_subscribers</code>.
        MRR counts only active paid subscribers — trials are tracked separately.
      </p>
    </div>
  );
}
