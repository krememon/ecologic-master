import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Compass,
  Megaphone,
  Sparkles,
  Smartphone,
  Settings as SettingsIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { href: "/", label: "Overview", Icon: LayoutDashboard },
  { href: "/subscribers", label: "Subscribers", Icon: Users },
  { href: "/sources", label: "Sources", Icon: Compass },
  { href: "/campaigns", label: "Campaigns", Icon: Megaphone },
  { href: "/creators", label: "Creators", Icon: Sparkles },
  { href: "/platforms", label: "Platforms", Icon: Smartphone },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function DashboardLayout({
  children,
  email,
}: {
  children: React.ReactNode;
  email: string | null;
}) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#F7F8FA", color: "#0B0B0D" }}>
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-64 flex-col border-r border-slate-200 bg-white">
        <div className="px-6 py-6 border-b border-slate-100">
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              fontSize: "1.5rem",
              color: "#0B0B0D",
              lineHeight: 1.05,
            }}
          >
            EcoLogic
          </div>
          <div className="text-xs uppercase tracking-wider text-slate-500 mt-1">
            Dashboard
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ href, label, Icon }) => {
            const active =
              href === "/"
                ? location === "/" || location === ""
                : location === href || location.startsWith(href + "/");
            return (
              <Link key={href} href={href}>
                <a
                  className={
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors " +
                    (active
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")
                  }
                  data-testid={`dashboard-nav-${label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-slate-100 text-xs text-slate-500">
          <div className="truncate" title={email ?? undefined}>
            {email ?? "—"}
          </div>
          <div className="mt-1 text-slate-400">Signed in as admin</div>
        </div>
      </aside>

      {/* Mobile top bar (sidebar collapses) */}
      <div className="flex-1 flex flex-col">
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              fontSize: "1.25rem",
              color: "#0B0B0D",
            }}
          >
            EcoLogic Dashboard
          </div>
        </header>

        {/* Mobile nav strip */}
        <nav className="md:hidden bg-white border-b border-slate-200 overflow-x-auto">
          <div className="flex gap-1 px-2 py-2 min-w-max">
            {NAV.map(({ href, label }) => {
              const active =
                href === "/"
                  ? location === "/" || location === ""
                  : location === href;
              return (
                <Link key={href} href={href}>
                  <a
                    className={
                      "px-3 py-1.5 rounded-md text-xs whitespace-nowrap " +
                      (active
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-slate-600 hover:bg-slate-50")
                    }
                  >
                    {label}
                  </a>
                </Link>
              );
            })}
          </div>
        </nav>

        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
