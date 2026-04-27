import { setAppMode, clearAppModeOverride } from "../lib/host";

export default function Settings({ email }: { email: string | null }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Dashboard preferences and admin tools.
        </p>
      </header>

      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="font-medium text-slate-900">Account</h2>
        <div className="text-sm text-slate-600">
          Signed in as <span className="font-mono">{email ?? "—"}</span>
        </div>
        <div className="text-xs text-slate-400">
          Dashboard admins are managed via the <code className="bg-slate-100 px-1 py-0.5 rounded">DASHBOARD_ADMIN_EMAILS</code> environment variable.
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="font-medium text-slate-900">App switcher</h2>
        <p className="text-sm text-slate-600">
          You're viewing the dashboard. Use these to override the local app mode (useful for development on localhost).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAppMode("customer");
              window.location.assign("/");
            }}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
            data-testid="btn-switch-to-customer"
          >
            Switch to customer app
          </button>
          <button
            type="button"
            onClick={() => {
              clearAppModeOverride();
              window.location.reload();
            }}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
            data-testid="btn-clear-override"
          >
            Clear local override
          </button>
        </div>
      </section>
    </div>
  );
}
