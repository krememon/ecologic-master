/**
 * EcoLogic private internal dashboard — root component.
 *
 * Mounted in place of the customer app whenever the hostname resolves to
 * a dashboard subdomain (or the local override is set). Keeps its own
 * Wouter <Switch> so customer-app routes never collide with dashboard
 * routes — the two apps share the same SPA bundle but never the same router.
 */

import { Switch, Route } from "wouter";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardAccess } from "./lib/dashboardAuth";
import { setAppMode } from "./lib/host";
import { DashboardLayout } from "./components/DashboardLayout";
import Overview from "./pages/Overview";
import Subscribers from "./pages/Subscribers";
import Sources from "./pages/Sources";
import Campaigns from "./pages/Campaigns";
import Creators from "./pages/Creators";
import Platforms from "./pages/Platforms";
import Settings from "./pages/Settings";
import AccessDenied from "./pages/AccessDenied";

/**
 * Send the user to the customer hostname's /login. From a real dashboard
 * subdomain we cross-host to the matching customer subdomain. On local dev
 * we just flip the override to customer mode and reload.
 */
function goToLogin() {
  const host = window.location.hostname;
  if (/^staging-dashboard\./i.test(host)) {
    window.location.assign("https://staging.ecologicc.com/login");
    return;
  }
  if (/^dashboard\./i.test(host)) {
    window.location.assign("https://app.ecologicc.com/login");
    return;
  }
  setAppMode("customer");
  window.location.assign("/login");
}

export default function DashboardApp() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { state, email } = useDashboardAccess();

  useEffect(() => {
    document.title = "EcoLogic Dashboard";
  }, []);

  // Plain white placeholder while we figure out auth — no spinner, no flash.
  if (authLoading || state === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="min-h-screen"
        style={{ backgroundColor: "#FFFFFF" }}
        data-testid="dashboard-loading"
      >
        <span className="sr-only">Loading dashboard</span>
      </div>
    );
  }

  // Not signed in → bounce to the customer app's login page. We hand off
  // intentionally rather than building a separate dashboard login: same auth,
  // same session, same Replit/Google/Apple flows. After login the user can
  // navigate back to the dashboard hostname.
  if (!isAuthenticated || state === "unauthenticated") {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: "#FFFFFF" }}
      >
        <div className="max-w-sm w-full text-center space-y-4">
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              fontSize: "1.75rem",
              color: "#0B0B0D",
            }}
          >
            EcoLogic Dashboard
          </div>
          <p className="text-sm text-slate-500">Please sign in to continue.</p>
          <button
            type="button"
            onClick={goToLogin}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            data-testid="btn-dashboard-signin"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  // Signed in but not on the allow-list → access denied (no data leaked).
  if (state === "forbidden") {
    return <AccessDenied email={email} />;
  }

  // Allowed → full dashboard shell.
  return (
    <DashboardLayout email={email}>
      <Switch>
        <Route path="/" component={Overview} />
        <Route path="/subscribers" component={Subscribers} />
        <Route path="/sources" component={Sources} />
        <Route path="/campaigns" component={Campaigns} />
        <Route path="/creators" component={Creators} />
        <Route path="/platforms" component={Platforms} />
        <Route path="/settings">{() => <Settings email={email} />}</Route>
        <Route>
          <div className="text-sm text-slate-500">Page not found.</div>
        </Route>
      </Switch>
    </DashboardLayout>
  );
}
