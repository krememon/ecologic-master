/**
 * Hostname-based app routing.
 *
 * Production:
 *   app.ecologicc.com           → customer
 *   dashboard.ecologicc.com     → dashboard
 * Staging:
 *   staging.ecologicc.com           → customer
 *   staging-dashboard.ecologicc.com → dashboard
 *
 * Local dev override (since we can't easily reach staging-dashboard.* from
 * localhost): the app mode can also be forced by:
 *   • URL query param         ?app=dashboard
 *   • localStorage key        ecologic-app-mode = "dashboard" | "customer"
 *
 * Setting the URL flag once is enough — we mirror it into localStorage so
 * subsequent navigations within the SPA stay in dashboard mode.
 */

export type AppMode = "customer" | "dashboard";

const STORAGE_KEY = "ecologic-app-mode";

/**
 * Whether the user's manual app-mode override is allowed for the current host.
 *
 * Allowed: localhost, 127.0.0.1, and Replit dev/deploy preview hosts. On those
 * we have no choice but to allow overrides because there is no real
 * `dashboard.*` subdomain to visit.
 *
 * Disallowed: real production hostnames (`*.ecologicc.com`). On those, the
 * hostname is authoritative — a stray `?app=dashboard` query or stale
 * localStorage value must NEVER be able to flip the customer site into the
 * admin shell, and vice versa.
 */
function isOverrideAllowedHost(): boolean {
  const host = (typeof window !== "undefined" && window.location?.hostname) || "";
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (/\.replit\.dev$/i.test(host)) return true;
  if (/\.replit\.app$/i.test(host)) return true;
  if (/\.repl\.co$/i.test(host)) return true;
  return false;
}

function readQueryOverride(): AppMode | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("app");
    if (v === "dashboard" || v === "customer") return v;
  } catch {}
  return null;
}

function readStorageOverride(): AppMode | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "dashboard" || v === "customer") return v;
  } catch {}
  return null;
}

function detectFromHostname(): AppMode {
  const host = (typeof window !== "undefined" && window.location?.hostname) || "";
  // Match the production `dashboard.` and staging `staging-dashboard.` subdomains.
  if (/^dashboard\./i.test(host) || /^staging-dashboard\./i.test(host)) {
    return "dashboard";
  }
  return "customer";
}

/** Resolve the current app mode. Persists query overrides to localStorage. */
export function getAppMode(): AppMode {
  // On real production hostnames, hostname wins — overrides are ignored.
  if (!isOverrideAllowedHost()) {
    return detectFromHostname();
  }
  const fromQuery = readQueryOverride();
  if (fromQuery) {
    try {
      window.localStorage.setItem(STORAGE_KEY, fromQuery);
    } catch {}
    return fromQuery;
  }
  const fromStorage = readStorageOverride();
  if (fromStorage) return fromStorage;
  return detectFromHostname();
}

/** Imperatively switch app mode (used by Settings → Switch to customer app). */
export function setAppMode(mode: AppMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {}
}

/** Clear any local override so hostname becomes authoritative again. */
export function clearAppModeOverride(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export const DASHBOARD_STORAGE_KEY = STORAGE_KEY;
