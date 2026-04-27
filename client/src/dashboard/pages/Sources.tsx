/**
 * Dashboard → Sources page
 * ────────────────────────
 * Aggregates growth_subscribers by source_type and shows signups, trial/paid/
 * canceled counts and revenue. Revenue stays $0 until Stripe/Apple/Google sync
 * is wired up.
 */

import { useQuery } from "@tanstack/react-query";
import { GROWTH_SOURCE_LABELS, type GrowthSourceType } from "@shared/growthSources";

interface SourceRow {
  sourceType: string | null;
  subscribers: number;
  trialing: number;
  paid: number;
  canceled: number;
  monthlyRevenue: number;
  totalRevenue: number;
}

function fmtMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toFixed(0)}`;
}

export default function Sources() {
  const { data, isLoading } = useQuery<SourceRow[]>({
    queryKey: ["/api/admin/dashboard/sources"],
  });

  const totals = (data ?? []).reduce(
    (acc, r) => ({
      subscribers: acc.subscribers + (r.subscribers || 0),
      trialing: acc.trialing + (r.trialing || 0),
      paid: acc.paid + (r.paid || 0),
      canceled: acc.canceled + (r.canceled || 0),
      monthlyRevenue: acc.monthlyRevenue + (r.monthlyRevenue || 0),
      totalRevenue: acc.totalRevenue + (r.totalRevenue || 0),
    }),
    { subscribers: 0, trialing: 0, paid: 0, canceled: 0, monthlyRevenue: 0, totalRevenue: 0 },
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Sources</h1>
        <p className="text-sm text-slate-500 mt-1">
          Where subscribers are coming from, grouped by source type. Revenue values are populated
          once subscription sync is connected.
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No source attribution data yet.</div>
            <div className="text-xs text-slate-400 mt-2">
              Once attributed signups complete onboarding, breakdowns appear here.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-right px-4 py-3">Signups</th>
                <th className="text-right px-4 py-3">Trialing</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Canceled</th>
                <th className="text-right px-4 py-3">MRR</th>
                <th className="text-right px-4 py-3">Total revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((r, i) => (
                <tr key={`${r.sourceType ?? "null"}-${i}`} data-testid={`source-row-${r.sourceType ?? "unknown"}`}>
                  <td className="px-4 py-3 text-slate-900">
                    {r.sourceType
                      ? GROWTH_SOURCE_LABELS[r.sourceType as GrowthSourceType] ?? r.sourceType
                      : <span className="text-slate-400">unknown</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.subscribers}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600">{r.trialing}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{r.paid}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.canceled}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(r.monthlyRevenue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(r.totalRevenue)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-medium text-slate-700">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.subscribers}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.trialing}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.paid}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.canceled}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.monthlyRevenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.totalRevenue)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
