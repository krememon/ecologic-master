/**
 * Safe `returnTo` handling for the staging-dashboard / dashboard sign-in flow.
 *
 * The customer login page (e.g. staging.ecologicc.com/login) accepts a
 * `?returnTo=<url>` query parameter so that after a successful sign-in we can
 * send the user back to the dashboard subdomain instead of the default
 * `/jobs` landing.
 *
 * Security: only a strict allow-list of hostnames is honored — never an
 * arbitrary URL — so this can't be turned into an open redirect.
 */

const SESSION_KEY = "ecologic-dashboard-returnTo";

const SAFE_PROD_HOSTS = new Set<string>([
  "staging-dashboard.ecologicc.com",
  "dashboard.ecologicc.com",
]);

/**
 * Local-only dev hosts. We deliberately do NOT include wildcards like
 * `*.replit.dev` or `*.replit.app` here — anyone can register a subdomain
 * on those suffixes, which would turn this into an open redirect.
 *
 * These hosts are only accepted when the bundle is running in DEV mode
 * (`import.meta.env.DEV`). In a production build, loopback is never a
 * valid returnTo target, even if an attacker manages to inject one.
 */
function isSafeDevHost(host: string): boolean {
  if (!import.meta.env.DEV) return false;
  return host === "localhost" || host === "127.0.0.1";
}

/**
 * True if the given URL is on the strict allow-list of dashboard hosts.
 * Rejects:
 *   - non-http(s) protocols (javascript:, data:, etc.)
 *   - http:// for production dashboard hosts (only https allowed in prod)
 *   - URLs with embedded credentials (user:pass@) — a known phishing trick
 *   - any host outside the explicit allow-list (no wildcard suffix matching)
 *   - localhost/127.0.0.1 in production builds
 */
export function isSafeReturnTo(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  // Block "https://evil@dashboard.ecologicc.com.attacker.com" style URLs
  // — the userinfo trick where the visible label fools humans but the
  // hostname the browser actually navigates to is something else.
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (SAFE_PROD_HOSTS.has(host)) {
    // Production dashboard hosts must always be reached over https.
    return parsed.protocol === "https:";
  }
  if (isSafeDevHost(host)) return true;
  return false;
}

/**
 * Build a customer-app /login URL that carries a returnTo back to the
 * current dashboard URL. Used by the dashboard "Sign in" button.
 */
export function buildLoginUrlWithReturnTo(loginBase: string): string {
  const here = window.location.href;
  if (!isSafeReturnTo(here)) return loginBase;
  const sep = loginBase.includes("?") ? "&" : "?";
  return `${loginBase}${sep}returnTo=${encodeURIComponent(here)}`;
}

/**
 * Read `?returnTo=` from the current URL and persist it to sessionStorage
 * so the value survives the multi-step login wizard, OAuth round-trips,
 * etc.
 *
 * Crucially, if the current URL has NO `returnTo` (or an unsafe one), we
 * actively CLEAR any previously stored value. That prevents a stale
 * dashboard returnTo from leaking into a later, unrelated customer login.
 *
 * Safe to call repeatedly.
 */
export function captureReturnToFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("returnTo");
    if (r && isSafeReturnTo(r)) {
      sessionStorage.setItem(SESSION_KEY, r);
      return r;
    }
    // No (or unsafe) returnTo on this visit — wipe any stale value so the
    // next normal login can't accidentally fly off to the dashboard.
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
  return null;
}

/**
 * Look up a previously-captured returnTo without removing it. Used when
 * deciding whether to short-circuit an already-authenticated visitor.
 */
export function peekReturnTo(): string | null {
  try {
    const r = sessionStorage.getItem(SESSION_KEY);
    if (r && isSafeReturnTo(r)) return r;
  } catch {}
  // Also accept it directly from the URL if no session value yet.
  try {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("returnTo");
    if (r && isSafeReturnTo(r)) return r;
  } catch {}
  return null;
}

/**
 * Consume the previously-captured returnTo (returns it AND clears it).
 * Call this at the moment of successful authentication, just before
 * navigating away from /login.
 */
export function consumeReturnTo(): string | null {
  let value: string | null = null;
  try {
    value = sessionStorage.getItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
  if (value && isSafeReturnTo(value)) return value;
  // Fallback: still trust the URL param if it's safe.
  try {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("returnTo");
    if (r && isSafeReturnTo(r)) return r;
  } catch {}
  return null;
}
