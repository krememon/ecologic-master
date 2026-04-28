/**
 * Client-side attribution capture
 * ───────────────────────────────
 * Captures `?ref`, `?source`, and `?campaign` query params from the URL on
 * customer-app load and persists them locally for 90 days. First-touch wins:
 * if attribution already exists with a referralCode/sourceType, we never
 * overwrite it — only `lastSeenAt` is bumped.
 *
 * Storage:
 *   • localStorage  ecologic-attribution           (durable, primary store)
 *   • cookie        ecologic_attribution           (90 days, helps server-side
 *                                                   reads if ever needed)
 *
 * Safety:
 *   • Skipped on dashboard hostnames (admins should never get attributed).
 *   • Wrapped in try/catch — must never throw and must never block app boot.
 */

import { coerceGrowthSourceType, type GrowthSourceType } from "@shared/growthSources";

const STORAGE_KEY = "ecologic-attribution";
const COOKIE_KEY = "ecologic_attribution";
const TTL_DAYS = 90;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

export interface Attribution {
  referralCode: string | null;
  sourceType: GrowthSourceType | null;
  campaignParam: string | null;
  firstSeenAt: string;   // ISO
  lastSeenAt: string;    // ISO
  landingPath: string;   // pathname captured on first touch
}

function isDashboardHost(): boolean {
  try {
    const host = window.location?.hostname || "";
    return /^dashboard\./i.test(host) || /^staging-dashboard\./i.test(host);
  } catch {
    return false;
  }
}

function normalizeReferralCode(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, "");
  return s.length ? s : null;
}

function readLocalStorage(): Attribution | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Attribution & { _expiresAt?: number };
    if (parsed && typeof parsed === "object") {
      // TTL check based on firstSeenAt
      if (parsed.firstSeenAt) {
        const ageMs = Date.now() - new Date(parsed.firstSeenAt).getTime();
        if (Number.isFinite(ageMs) && ageMs > TTL_MS) {
          window.localStorage.removeItem(STORAGE_KEY);
          return null;
        }
      }
      return {
        referralCode: parsed.referralCode ?? null,
        sourceType: parsed.sourceType ?? null,
        campaignParam: parsed.campaignParam ?? null,
        firstSeenAt: parsed.firstSeenAt ?? new Date().toISOString(),
        lastSeenAt: parsed.lastSeenAt ?? new Date().toISOString(),
        landingPath: parsed.landingPath ?? "/",
      };
    }
  } catch {
    // ignore — corrupt JSON or storage blocked
  }
  return null;
}

function writeLocalStorage(value: Attribution): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage may be full or blocked by user — ignore
  }
}

function writeCookie(value: Attribution): void {
  try {
    const encoded = encodeURIComponent(JSON.stringify(value));
    const maxAge = Math.floor(TTL_MS / 1000);
    const isHttps =
      typeof window !== "undefined" && window.location?.protocol === "https:";
    const secureFlag = isHttps ? "; Secure" : "";
    document.cookie = `${COOKIE_KEY}=${encoded}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureFlag}`;
  } catch {
    // cookies disabled — ignore
  }
}

/**
 * Run on app boot. Reads the URL, persists attribution if any new params are
 * found, and returns the final Attribution (or null if none has ever been set).
 */
export function captureAttributionFromUrl(): Attribution | null {
  try {
    if (isDashboardHost()) {
      // Never attribute dashboard hostname visits.
      return null;
    }

    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return readLocalStorage();
    }

    const refRaw = params.get("ref");
    const srcRaw = params.get("source");
    const campRaw = params.get("campaign");

    const ref = normalizeReferralCode(refRaw);
    const source = coerceGrowthSourceType(srcRaw);
    const campaign = campRaw ? campRaw.trim() : null;

    const existing = readLocalStorage();
    const now = new Date().toISOString();

    if (!ref && !source && !campaign) {
      // No params on this URL.
      if (existing) {
        // Bump lastSeenAt opportunistically.
        const bumped: Attribution = { ...existing, lastSeenAt: now };
        writeLocalStorage(bumped);
        return bumped;
      }
      // Quiet log only when user hits any URL with neither attribution nor params
      console.log("[attribution] no attribution params found");
      return null;
    }

    // First-touch wins: if existing already has ref or source, we keep it.
    if (existing && (existing.referralCode || existing.sourceType)) {
      const bumped: Attribution = { ...existing, lastSeenAt: now };
      writeLocalStorage(bumped);
      writeCookie(bumped);
      console.log(
        `[attribution] existing attribution kept ref=${existing.referralCode ?? "—"} source=${existing.sourceType ?? "—"}`
      );
      return bumped;
    }

    const next: Attribution = {
      referralCode: ref,
      sourceType: source,
      campaignParam: campaign,
      firstSeenAt: now,
      lastSeenAt: now,
      landingPath: (() => {
        try {
          return window.location.pathname || "/";
        } catch {
          return "/";
        }
      })(),
    };
    writeLocalStorage(next);
    writeCookie(next);
    console.log(
      `[attribution] captured from URL ref=${next.referralCode ?? "—"} source=${next.sourceType ?? "—"} campaign=${next.campaignParam ?? "—"}`
    );
    return next;
  } catch (err) {
    // Never throw out of the boot path.
    try { console.warn("[attribution] capture error (ignored):", err); } catch {}
    return null;
  }
}

/** Returns the current saved attribution, or null. Read-only — no side effects. */
export function getAttribution(): Attribution | null {
  return readLocalStorage();
}

/** Clear the saved attribution. */
export function clearAttribution(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  try {
    document.cookie = `${COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {}
}

// ── AppsFlyer deferred-deep-link save ────────────────────────────────────────
// Called from client/src/lib/appsflyer.ts when AppsFlyer's Unified Deep
// Linking callback fires — both on cold start (deferred deep link, after
// install from a OneLink) and on warm reopen (direct deep link tap). Mirrors
// `captureAttributionFromUrl` semantics:
//   • First-touch wins. If an existing record already has a referralCode or
//     sourceType (i.e. the user was previously attributed from a web URL or
//     a prior deep link), we never overwrite it.
//   • Skipped on dashboard hosts (defence-in-depth — the dashboard never
//     bundles the AppsFlyer SDK in practice but the guard is cheap).
//   • Wrapped in try/catch — must never throw out of the SDK callback.
//
// Logs use the `[appsflyer-attribution]` prefix so they're filterable in
// Xcode/Logcat alongside the other `[appsflyer]` SDK lines.
export interface AppsflyerAttributionInput {
  referralCode?: string | null;
  sourceType?: string | null;
  campaignId?: string | number | null;
  campaignName?: string | null;
  sourceName?: string | null;
}

export type AppsflyerSaveOutcome =
  | { status: "saved"; attribution: Attribution }
  | { status: "kept"; attribution: Attribution }
  | { status: "skipped"; reason: string };

export function saveAppsflyerAttribution(
  input: AppsflyerAttributionInput,
): AppsflyerSaveOutcome {
  try {
    if (isDashboardHost()) {
      return { status: "skipped", reason: "dashboard-host" };
    }

    const ref = normalizeReferralCode(input.referralCode);
    const source = coerceGrowthSourceType(input.sourceType ?? null);

    if (!ref && !source) {
      // Nothing useful in this UDL payload — happens when AppsFlyer reports
      // an organic open or a non-OneLink direct app launch.
      console.log("[appsflyer-attribution] deep link received with no referral/source — ignored");
      return { status: "skipped", reason: "no-attributable-fields" };
    }

    if (ref) {
      console.log(`[appsflyer-attribution] referralCode received ref=${ref}`);
    }

    const existing = readLocalStorage();
    const now = new Date().toISOString();

    // First-touch wins: if existing already has either ref OR source, keep it.
    // This mirrors captureAttributionFromUrl exactly so web + native paths
    // never disagree about who "owns" the user.
    if (existing && (existing.referralCode || existing.sourceType)) {
      const bumped: Attribution = { ...existing, lastSeenAt: now };
      writeLocalStorage(bumped);
      writeCookie(bumped);
      console.log(
        `[appsflyer-attribution] existing attribution kept ref=${existing.referralCode ?? "—"} source=${existing.sourceType ?? "—"}`,
      );
      return { status: "kept", attribution: bumped };
    }

    // No prior attribution → write the AppsFlyer-provided one. We use
    // campaignName for `campaignParam` so it shows up alongside web-captured
    // attribution in onboarding's existing display fields without any
    // schema changes.
    const next: Attribution = {
      referralCode: ref,
      sourceType: source,
      campaignParam:
        (input.campaignName && String(input.campaignName).trim()) ||
        (input.campaignId != null ? String(input.campaignId) : null),
      firstSeenAt: now,
      lastSeenAt: now,
      landingPath: (() => {
        try {
          return window.location?.pathname || "/";
        } catch {
          return "/";
        }
      })(),
    };
    writeLocalStorage(next);
    writeCookie(next);
    console.log(
      `[appsflyer-attribution] saved attribution ref=${next.referralCode ?? "—"} source=${next.sourceType ?? "—"} campaign=${next.campaignParam ?? "—"} sub4=${input.sourceName ?? "—"}`,
    );
    return { status: "saved", attribution: next };
  } catch (err) {
    try {
      console.warn("[appsflyer-attribution] save error (ignored):", err);
    } catch {}
    return { status: "skipped", reason: "exception" };
  }
}
