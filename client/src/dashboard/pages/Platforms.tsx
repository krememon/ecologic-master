export default function Platforms() {
  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Platforms</h1>
        <p className="text-sm text-slate-500 mt-1">
          Stripe, Apple, and Google Play subscription health.
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <div className="text-sm text-slate-500">Platform breakdowns coming soon.</div>
        <div className="text-xs text-slate-400 mt-2">
          Will show MRR, active counts, and webhook status per platform.
        </div>
      </div>
    </div>
  );
}
