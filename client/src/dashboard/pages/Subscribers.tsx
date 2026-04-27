import { useQuery } from "@tanstack/react-query";
import type { GrowthSubscriber } from "@shared/schema";

export default function Subscribers() {
  const { data, isLoading } = useQuery<GrowthSubscriber[]>({
    queryKey: ["/api/admin/dashboard/subscribers"],
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Subscribers</h1>
        <p className="text-sm text-slate-500 mt-1">
          Unified view of all subscribers across Stripe, Apple, Google Play, and manual entries.
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No subscribers tracked yet.</div>
            <div className="text-xs text-slate-400 mt-2">
              Once the attribution pipeline is wired up, every signup will appear here.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Owner</th>
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3">Platform</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">MRR</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Signed up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">{s.ownerEmail ?? "—"}</td>
                    <td className="px-4 py-3">{s.companyName ?? "—"}</td>
                    <td className="px-4 py-3">{s.platform}</td>
                    <td className="px-4 py-3">{s.subscriptionStatus}</td>
                    <td className="px-4 py-3">{s.plan ?? "—"}</td>
                    <td className="px-4 py-3">{s.monthlyRevenue ?? "—"}</td>
                    <td className="px-4 py-3">{s.sourceType ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {s.signupAt ? new Date(s.signupAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
