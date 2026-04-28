/**
 * Dashboard → Platforms page
 * ──────────────────────────
 * Aggregates growth_subscribers by platform (Stripe / Apple / Google Play /
 * Unknown / Manual) and shows signups, trial/paid/canceled counts and MRR.
 */

import { useQuery } from "@tanstack/react-query";

interface PlatformRow {
  platform: string;
  subscribers: number;
  trialing: number;
  paid: number;
  canceled: number;
  monthlyRevenue: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  stripe: "Stripe (web)",
  apple: "Apple",
  google_play: "Google Play",
  manual: "Manual",
  unknown: "Unknown",
};

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] ?? p;
}

function fmtMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toFixed(0)}`;
}

export default function Platforms() {
  const { data, isLoading } = useQuery<PlatformRow[]>({
    queryKey: ["/api/admin/dashboard/platforms"],
  });

  const totals = (data ?? []).reduce(
    (acc, r) => ({
      subscribers: acc.subscribers + (r.subscribers || 0),
      trialing: acc.trialing + (r.trialing || 0),
      paid: acc.paid + (r.paid || 0),
      canceled: acc.canceled + (r.canceled || 0),
      monthlyRevenue: acc.monthlyRevenue + (r.monthlyRevenue || 0),
    }),
    { subscribers: 0, trialing: 0, paid: 0, canceled: 0, monthlyRevenue: 0 },
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Platforms</h1>
        <p className="text-sm text-slate-500 mt-1">
          Stripe, Apple, and Google Play subscription health. Counts are sourced from
          live <code className="bg-slate-100 px-1 py-0.5 rounded">growth_subscribers</code> data.
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No subscribers yet.</div>
            <div className="text-xs text-slate-400 mt-2">
              As users sign up via Stripe, Apple, or Google Play, breakdowns appear here.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Platform</th>
                <th className="text-right px-4 py-3">Subscribers</th>
                <th className="text-right px-4 py-3">Trialing</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Canceled</th>
                <th className="text-right px-4 py-3">MRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((r) => (
                <tr key={r.platform} data-testid={`platform-row-${r.platform}`}>
                  <td className="px-4 py-3 text-slate-900">{platformLabel(r.platform)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.subscribers}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600">{r.trialing}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{r.paid}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.canceled}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(r.monthlyRevenue)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-medium text-slate-700">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.subscribers}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.trialing}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.paid}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.canceled}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.monthlyRevenue)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
