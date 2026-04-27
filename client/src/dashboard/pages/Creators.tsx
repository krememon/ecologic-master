import { useQuery } from "@tanstack/react-query";
import type { GrowthCreator } from "@shared/schema";

export default function Creators() {
  const { data, isLoading } = useQuery<GrowthCreator[]>({
    queryKey: ["/api/admin/dashboard/creators"],
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Creators</h1>
        <p className="text-sm text-slate-500 mt-1">
          Influencers and content creators promoting EcoLogic.
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No creators yet.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Instagram</th>
                <th className="text-left px-4 py-3">TikTok</th>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-3">{c.instagramHandle ?? "—"}</td>
                  <td className="px-4 py-3">{c.tiktokHandle ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.referralCode ?? "—"}</td>
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3 text-right">{c.cost ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
