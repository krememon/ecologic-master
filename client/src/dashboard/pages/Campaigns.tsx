import { useQuery } from "@tanstack/react-query";
import type { GrowthCampaign } from "@shared/schema";

export default function Campaigns() {
  const { data, isLoading } = useQuery<GrowthCampaign[]>({
    queryKey: ["/api/admin/dashboard/campaigns"],
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Campaigns</h1>
        <p className="text-sm text-slate-500 mt-1">
          Marketing campaigns, supply-house promos, and creator codes.
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No campaigns yet.</div>
            <div className="text-xs text-slate-400 mt-2">
              Create them via <code className="bg-slate-100 px-1 py-0.5 rounded">POST /api/admin/dashboard/campaigns</code> for now.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Cost</th>
                <th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-3">
                    {c.sourceType}
                    {c.sourceName ? ` · ${c.sourceName}` : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.referralCode ?? "—"}</td>
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3 text-right">{c.cost ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
