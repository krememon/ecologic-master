export default function AccessDenied({ email }: { email: string | null }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundColor: "#FFFFFF" }}
    >
      <div className="max-w-md text-center">
        <div
          style={{
            fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            fontSize: "1.75rem",
            color: "#0B0B0D",
          }}
          className="mb-2"
        >
          EcoLogic Dashboard
        </div>
        <h1 className="text-lg font-medium text-slate-900 mb-2">Access denied</h1>
        <p className="text-sm text-slate-500">
          Your account ({email ?? "unknown"}) is not authorized to view this dashboard.
        </p>
        <p className="text-xs text-slate-400 mt-4">
          If you believe this is a mistake, contact the EcoLogic owner to be added to the admin allow-list.
        </p>
      </div>
    </div>
  );
}
