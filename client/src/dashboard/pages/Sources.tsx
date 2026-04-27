import { useQuery } from "@tanstack/react-query";

interface SourceRow {
  sourceType: string | null;
  subscribers: number;
  trialing: number;
  paid: number;
  monthlyRevenue: number;
}

export default function Sources() {
  const { data, isLoading } = useQuery<SourceRow[]>({
    queryKey: ["/api/admin/dashboard/sources"],
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Sources</h1>
        <p className="text-sm text-slate-500 mt-1">
          Where subscribers are coming from, grouped by source type.
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No source attribution data yet.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-right px-4 py-3">Subscribers</th>
                <th className="text-right px-4 py-3">Trialing</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">MRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((r, i) => (
                <tr key={`${r.sourceType ?? "null"}-${i}`}>
                  <td className="px-4 py-3">{r.sourceType ?? "—"}</td>
                  <td className="px-4 py-3 text-right">{r.subscribers}</td>
                  <td className="px-4 py-3 text-right">{r.trialing}</td>
                  <td className="px-4 py-3 text-right">{r.paid}</td>
                  <td className="px-4 py-3 text-right">
                    ${Number(r.monthlyRevenue ?? 0).toFixed(0)}
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
