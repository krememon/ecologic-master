/**
 * EcoLogic private internal dashboard — root component.
 *
 * Security gate: a dashboard-specific sessionStorage key is required on top of
 * the main auth session. Each new browser tab / browser session starts with an
 * empty sessionStorage and must complete an explicit sign-in before the
 * dashboard renders. Within the same tab, a page refresh doesn't require re-auth.
 */

import { Switch, Route } from "wouter";
import { useState, useEffect } from "react";
import { useDashboardAccess } from "./lib/dashboardAuth";
import { queryClient } from "@/lib/queryClient";
import { DashboardLayout } from "./components/DashboardLayout";
import Overview from "./pages/Overview";
import Accounts from "./pages/Accounts";
import Subscribers from "./pages/Subscribers";
import Sources from "./pages/Sources";
import Campaigns from "./pages/Campaigns";
import Creators from "./pages/Creators";
import Platforms from "./pages/Platforms";
import Settings from "./pages/Settings";
import AccessDenied from "./pages/AccessDenied";
import ecoLogicIcon from "../../public/ecologic-logo.png";

const SESSION_KEY = "ecologic-dashboard-session";

function isDashboardSessionActive(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}

function markDashboardSessionActive(): void {
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
}

function clearDashboardSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

/** Sign out: clear session, log out main session, reload to gate. */
async function signOut() {
  clearDashboardSession();
  try {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
  } catch {}
  window.location.replace(window.location.origin + window.location.pathname + window.location.search);
}

// ─── Sign-in form ─────────────────────────────────────────────────────────────

function SignInGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/dashboard/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as any).message || "Invalid email or password.");
        return;
      }

      // Session is now established server-side.
      // CRITICAL: do NOT trust queryClient.getQueryData here — when a refetch
      // errors with 401, getQueryData returns the previous (possibly stale)
      // successful data, which would wrongly grant access. We must observe
      // the actual HTTP response status from a direct fetch.
      console.log("[dashboard-auth] login ok, refetching /me");
      const meRes = await fetch("/api/admin/dashboard/me", {
        credentials: "include",
        cache: "no-store",
      });

      if (meRes.status === 401) {
        console.log("[dashboard-auth] /me 401, not authenticated");
        clearDashboardSession();
        queryClient.removeQueries({ queryKey: ["/api/admin/dashboard/me"] });
        setError("Session expired. Please sign in again.");
        return;
      }
      if (!meRes.ok) {
        console.log("[dashboard-auth] /me HTTP error", meRes.status);
        clearDashboardSession();
        queryClient.removeQueries({ queryKey: ["/api/admin/dashboard/me"] });
        setError("Authentication check failed. Please try again.");
        return;
      }

      const me = (await meRes.json()) as {
        authenticated: boolean;
        authorized: boolean;
        email: string | null;
      };
      console.log("[dashboard-auth] final me before enter", me);

      if (!me.authenticated) {
        console.log("[dashboard-auth] /me not authenticated", me);
        clearDashboardSession();
        queryClient.removeQueries({ queryKey: ["/api/admin/dashboard/me"] });
        setError("Authentication failed. Please try again.");
        return;
      }
      if (!me.authorized) {
        console.log("[dashboard-auth] /me not authorized", me);
        clearDashboardSession();
        queryClient.removeQueries({ queryKey: ["/api/admin/dashboard/me"] });
        const acct = me.email ? `${me.email} is` : "Your account is";
        setError(`Access denied. ${acct} not in the admin allow-list.`);
        return;
      }

      console.log("[dashboard-auth] entering dashboard", {
        authenticated: me.authenticated,
        authorized: me.authorized,
      });
      // Populate cache for useDashboardAccess so it doesn't immediately re-fetch.
      queryClient.setQueryData(["/api/admin/dashboard/me"], me);
      markDashboardSessionActive();
      onSignedIn();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundColor: "#FFFFFF" }}
    >
      <div className="w-full max-w-sm space-y-6">
        {/* App icon */}
        <div className="flex justify-center">
          <img
            src={ecoLogicIcon}
            alt="EcoLogic"
            width={100}
            height={100}
            style={{ borderRadius: 22, boxShadow: "0 2px 16px rgba(0,0,0,0.10)" }}
            draggable={false}
          />
        </div>

        {/* Title */}
        <div className="text-center">
          <h1
            style={{
              fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif",
              fontWeight: 700,
              fontSize: "1.375rem",
              letterSpacing: "-0.02em",
              color: "#0B0B0D",
            }}
          >
            Admin Dashboard
          </h1>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1.5px solid #E2E8F0",
              fontSize: 15,
              outline: "none",
              background: "#FAFAFA",
              boxSizing: "border-box",
              color: "#0B0B0D",
            }}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1.5px solid #E2E8F0",
              fontSize: 15,
              outline: "none",
              background: "#FAFAFA",
              boxSizing: "border-box",
              color: "#0B0B0D",
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "13px",
              borderRadius: 12,
              background: loading ? "#93C5FD" : "#2563EB",
              color: "#FFFFFF",
              fontWeight: 600,
              fontSize: 15,
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
              letterSpacing: "-0.01em",
            }}
            data-testid="btn-dashboard-signin"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Root component ────────────────────────────────────────────────────────────

export default function DashboardApp() {
  const { state, email } = useDashboardAccess();

  // Dashboard-specific session. Starts from sessionStorage so a same-tab
  // refresh doesn't log the user out; clears when the tab/browser closes.
  const [sessionGranted, setSessionGranted] = useState(isDashboardSessionActive);

  useEffect(() => {
    document.title = "EcoLogic Dashboard";
  }, []);

  // If the server session expires while the dashboard is open, clear the
  // sessionStorage gate so the sign-in form is shown cleanly next render.
  useEffect(() => {
    if (sessionGranted && state === "unauthenticated") {
      clearDashboardSession();
      setSessionGranted(false);
    }
  }, [sessionGranted, state]);

  function handleSignedIn() {
    // Cache is already fresh from the invalidateQueries in SignInGate.handleSubmit —
    // setting sessionGranted is all that's needed to render the dashboard.
    setSessionGranted(true);
  }

  // Plain white placeholder while auth resolves — no spinner, no flash.
  if (state === "loading") {
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

  // No dashboard session yet (or just cleared after expiry) → sign-in form.
  if (!sessionGranted) {
    return <SignInGate onSignedIn={handleSignedIn} />;
  }

  // Server session expired mid-use: effect will clear sessionGranted next
  // tick; render a blank placeholder to avoid a flash of wrong content.
  if (state === "unauthenticated") {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "#FFFFFF" }} />
    );
  }

  // Authenticated but not on the allow-list → access denied.
  if (state === "forbidden") {
    return <AccessDenied email={email} />;
  }

  // Full dashboard shell.
  return (
    <DashboardLayout email={email} onSignOut={signOut}>
      <Switch>
        <Route path="/" component={Overview} />
        <Route path="/accounts" component={Accounts} />
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
