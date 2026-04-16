/**
 * AppsFlyer integration for EcoLogic native mobile wrappers.
 *
 * Design goals:
 *   1. Only initialise / track on Capacitor native (iOS + Android).
 *      Web sessions must never call into the plugin.
 *   2. Fail safely — every call is wrapped in try/catch so a missing
 *      plugin, missing config, or runtime error can NEVER crash the app.
 *   3. Single init guard so calling `initAppsFlyer()` multiple times is a no-op.
 *   4. Config driven by env vars:
 *        - VITE_APPSFLYER_DEV_KEY    (required)
 *        - VITE_APPSFLYER_IOS_APP_ID (required for iOS; Apple numeric App Store ID)
 *
 * Usage:
 *   import { initAppsFlyer, trackAppsFlyerEvent, AF_EVENTS } from "@/lib/appsflyer";
 *   await initAppsFlyer();
 *   await trackAppsFlyerEvent(AF_EVENTS.SIGN_UP, { method: "email" });
 */

import { isNativePlatform, getPlatform } from "@/lib/capacitor";

/** Canonical event names — keep in sync with server-side/AppsFlyer dashboards. */
export const AF_EVENTS = {
  APP_OPEN: "app_open",
  SIGN_UP: "sign_up",
  TRIAL_STARTED: "trial_started",
  SUBSCRIPTION_STARTED: "subscription_started",
  SUBSCRIPTION_PURCHASED: "subscription_purchased",
  COMPANY_CREATED: "company_created",
  EMPLOYEE_JOINED: "employee_joined",
  INVOICE_PAID: "invoice_paid",
  DEMO_BOOKED: "demo_booked",
} as const;

export type AfEventName = (typeof AF_EVENTS)[keyof typeof AF_EVENTS];

const DEV_KEY = (import.meta.env.VITE_APPSFLYER_DEV_KEY as string | undefined) || "";
const IOS_APP_ID = (import.meta.env.VITE_APPSFLYER_IOS_APP_ID as string | undefined) || "";
const IS_DEV = import.meta.env.DEV === true;

let _initStarted = false;
let _initDone = false;
let _pluginUnavailable = false;

// NOTE: logs are intentionally UNCONDITIONAL (not dev-only) while we validate
// the AppsFlyer integration on real devices via Xcode/Logcat. Once confirmed
// working in production builds, these can be downgraded to dev-only.
function log(...args: unknown[]): void {
  console.log("[appsflyer]", ...args);
}
function warn(...args: unknown[]): void {
  console.warn("[appsflyer]", ...args);
}

async function loadPlugin(): Promise<any | null> {
  if (_pluginUnavailable) return null;
  try {
    const mod = await import("appsflyer-capacitor-plugin");
    // Plugin exports { AppsFlyer } — both default and named are safe-guarded.
    return (mod as any).AppsFlyer ?? (mod as any).default ?? null;
  } catch (err) {
    _pluginUnavailable = true;
    warn("plugin import failed — AppsFlyer disabled:", err);
    return null;
  }
}

/**
 * Initialise the AppsFlyer SDK. Safe to call multiple times.
 * Returns `true` when initialised, `false` when skipped (web / missing config / plugin error).
 */
export async function initAppsFlyer(): Promise<boolean> {
  try {
    if (_initDone) return true;
    if (_initStarted) return false;
    _initStarted = true;

    if (!isNativePlatform()) {
      log("skipping init — not a native platform");
      return false;
    }

    if (!DEV_KEY) {
      warn("VITE_APPSFLYER_DEV_KEY is not set — init skipped");
      return false;
    }

    const platform = getPlatform(); // "ios" | "android" | "web"
    if (platform === "ios" && !IOS_APP_ID) {
      warn("VITE_APPSFLYER_IOS_APP_ID is not set — iOS install attribution will be limited");
    }

    const AppsFlyer = await loadPlugin();
    if (!AppsFlyer) return false;

    await AppsFlyer.initSDK({
      devKey: DEV_KEY,
      appID: IOS_APP_ID,        // ignored on Android
      isDebug: IS_DEV,
      waitForATTUserAuthorization: 10, // iOS ATT prompt tolerance in seconds
      minTimeBetweenSessions: 4,
      registerOnDeepLink: false,
      registerConversionListener: false,
      registerOnAppOpenAttribution: false,
    });

    _initDone = true;
    log(`initialised — platform=${platform} devKey=${DEV_KEY.slice(0, 4)}…`);

    // ── Test-device identifier dump ───────────────────────────────────────────
    // Logs IDFV (per-vendor, EcoLogic-scoped) and the AppsFlyer ID so they can
    // be copy/pasted into AppsFlyer dashboard → Configuration → Test Devices.
    // These are the two identifiers AppsFlyer accepts when IDFA is unavailable
    // (i.e. ATT denied / IDFA returns all zeros). Wrapped in its own try/catch
    // so any plugin error never breaks SDK init.
    try {
      const { Device } = await import("@capacitor/device");
      const info = await Device.getId();
      log(`📱 IDFV (paste into AppsFlyer Test Devices): ${(info as any).identifier ?? (info as any).uuid}`);
    } catch (e) {
      warn("could not read IDFV from @capacitor/device:", e);
    }
    try {
      const afid = await AppsFlyer.getAppsFlyerUID();
      log(`📱 AppsFlyer ID (also accepted by Test Devices): ${(afid as any)?.uid ?? afid}`);
    } catch (e) {
      warn("could not read AppsFlyer UID:", e);
    }

    return true;
  } catch (err) {
    warn("initSDK failed:", err);
    return false;
  }
}

/**
 * Log an in-app event to AppsFlyer.
 * Silently no-ops on web / when SDK unavailable / if plugin throws.
 */
export async function trackAppsFlyerEvent(
  eventName: AfEventName | string,
  eventValues: Record<string, unknown> = {}
): Promise<void> {
  try {
    if (!isNativePlatform()) return;
    if (!_initDone) {
      // Best-effort lazy init if the caller fires an event before init completed.
      const ok = await initAppsFlyer();
      if (!ok) return;
    }
    const AppsFlyer = await loadPlugin();
    if (!AppsFlyer) return;

    await AppsFlyer.logEvent({
      eventName,
      eventValue: eventValues as Record<string, string>,
    });
    log(`event logged — ${eventName}`);
  } catch (err) {
    warn(`logEvent failed for ${eventName}:`, err);
  }
}
