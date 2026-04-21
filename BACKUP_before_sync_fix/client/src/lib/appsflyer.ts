/**
 * AppsFlyer integration for EcoLogic native mobile wrappers.
 *
 * Plugin: appsflyer-capacitor-plugin@6.17.91
 *   Verified API surface (from node_modules/.../src/definitions.ts):
 *     - initSDK(options: AFInit): Promise<AFRes>
 *     - logEvent(data: AFEvent): Promise<AFRes>
 *     - getAppsFlyerUID(): Promise<AFUid>           // returns { uid: string }
 *   Native iOS class is registered as 'AppsFlyerPlugin' (see ios/Plugin/AppsFlyerPlugin.m).
 *
 * Design goals:
 *   1. Native-only — never call into the plugin on web.
 *   2. Fail-safe — every native call has its own try/catch and logs both
 *      the call boundary and the exact error so the failing method is obvious
 *      in Xcode / Logcat.
 *   3. Single init guard.
 *   4. UNIMPLEMENTED detection — surfaces a clear diagnostic when the native
 *      pod isn't actually linked into the app.
 *
 * Required env vars (baked at Vite build time):
 *   - VITE_APPSFLYER_DEV_KEY     (required)
 *   - VITE_APPSFLYER_IOS_APP_ID  (required for iOS install attribution)
 */

import { Capacitor } from "@capacitor/core";
import { isNativePlatform, getPlatform } from "@/lib/capacitor";

/** Canonical event names — keep in sync with AppsFlyer dashboards. */
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

// Logs are intentionally UNCONDITIONAL while validating on real devices.
function log(...args: unknown[]): void {
  console.log("[appsflyer]", ...args);
}
function warn(...args: unknown[]): void {
  console.warn("[appsflyer]", ...args);
}

/**
 * Format an error from a native call. Detects Capacitor's UNIMPLEMENTED code
 * (raised when the native class for a registered plugin isn't actually linked
 * into the app binary — i.e. pod install / cap sync / clean build wasn't done).
 */
function describeError(method: string, err: unknown): string {
  const anyErr = err as any;
  const code = anyErr?.code ?? anyErr?.errorCode;
  const message = anyErr?.message ?? String(err);

  if (code === "UNIMPLEMENTED") {
    return (
      `${method} → UNIMPLEMENTED. The native AppsFlyer iOS class is not linked ` +
      `into this app build. Fix on Mac: ` +
      `(1) cd ios/App && pod install (must show "Installing AppsflyerCapacitorPlugin"); ` +
      `(2) npx cap sync ios; ` +
      `(3) in Xcode: Product → Clean Build Folder (⇧⌘K), then Run. ` +
      `Original error: ${message}`
    );
  }
  return `${method} → ${code ? `[${code}] ` : ""}${message}`;
}

async function loadPluginAsync(): Promise<any | null> {
  if (_pluginUnavailable) return null;
  try {
    const { AppsFlyer } = await import("appsflyer-capacitor-plugin");
    log("loadPlugin → AppsFlyer import resolved");
    return AppsFlyer;
  } catch (err) {
    _pluginUnavailable = true;
    warn("loadPlugin → import failed:", describeError("import", err));
    return null;
  }
}

/**
 * Initialise the AppsFlyer SDK. Safe to call multiple times.
 * Returns `true` when initialised, `false` when skipped (web / missing config / plugin error).
 */
export async function initAppsFlyer(): Promise<boolean> {
  if (_initDone) return true;
  if (_initStarted) {
    log("initAppsFlyer → init already in progress, skipping duplicate call");
    return false;
  }
  _initStarted = true;

  try {
    if (!isNativePlatform()) {
      log("initAppsFlyer → skipping (not a native platform)");
      return false;
    }

    if (!DEV_KEY) {
      warn("initAppsFlyer → VITE_APPSFLYER_DEV_KEY missing, skipping");
      return false;
    }

    const platform = getPlatform();
    log(`initAppsFlyer → platform=${platform} devKey=${DEV_KEY.slice(0, 4)}… iosAppId=${IOS_APP_ID || "(none)"}`);

    if (platform === "ios" && !IOS_APP_ID) {
      warn("initAppsFlyer → VITE_APPSFLYER_IOS_APP_ID missing — install attribution will be limited");
    }

    const AppsFlyer = await loadPluginAsync();
    if (!AppsFlyer) {
      warn("initAppsFlyer → plugin unavailable, aborting");
      return false;
    }

    // ── initSDK ───────────────────────────────────────────────────────────────
    try {
      console.log('[appsflyer] Capacitor Plugins =', Object.keys((window as any).Capacitor?.Plugins || {}));
      log("initAppsFlyer → BEFORE initSDK call");
      const initRes = await AppsFlyer.initSDK({
        devKey: DEV_KEY,
        appID: IOS_APP_ID,        // ignored on Android
        isDebug: IS_DEV,
        waitForATTUserAuthorization: 10,
        minTimeBetweenSessions: 4,
        registerOnDeepLink: false,
        registerConversionListener: false,
        registerOnAppOpenAttribution: false,
      });
      log("initAppsFlyer → AFTER initSDK success:", initRes);
      _initDone = true;
    } catch (err) {
      warn("initAppsFlyer → initSDK FAILED:", describeError("initSDK", err));
      // Fatal — without initSDK nothing else will work.
      return false;
    }

    // ── IDFV via @capacitor/device (separate plugin, separate failure mode) ──
    try {
      log("initAppsFlyer → BEFORE Device.getId()");
      const { Device } = await import("@capacitor/device");
      const info = await Device.getId();
      const idfv = (info as any).identifier ?? (info as any).uuid ?? "(unknown)";
      log(`initAppsFlyer → AFTER Device.getId() — 📱 IDFV: ${idfv}`);
    } catch (err) {
      warn("initAppsFlyer → Device.getId FAILED:", describeError("Device.getId", err));
      // Non-fatal — continue.
    }

    // ── AppsFlyer UID ─────────────────────────────────────────────────────────
    try {
      log("initAppsFlyer → BEFORE getAppsFlyerUID");
      const afid = await AppsFlyer.getAppsFlyerUID();
      const uid = (afid as any)?.uid ?? String(afid);
      log(`initAppsFlyer → AFTER getAppsFlyerUID — 📱 AppsFlyer UID: ${uid}`);
    } catch (err) {
      warn("initAppsFlyer → getAppsFlyerUID FAILED:", describeError("getAppsFlyerUID", err));
      // Non-fatal — continue.
    }

    log("initAppsFlyer → COMPLETE");
    return true;
  } catch (err) {
    warn("initAppsFlyer → outer catch:", describeError("initAppsFlyer", err));
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
      log(`trackAppsFlyerEvent(${eventName}) → SDK not ready, attempting lazy init`);
      const ok = await initAppsFlyer();
      if (!ok) {
        warn(`trackAppsFlyerEvent(${eventName}) → lazy init failed, dropping event`);
        return;
      }
    }
    const AppsFlyer = await loadPluginAsync();
    if (!AppsFlyer) {
      warn(`trackAppsFlyerEvent(${eventName}) → plugin unavailable, dropping event`);
      return;
    }

    try {
      log(`trackAppsFlyerEvent → BEFORE logEvent ${eventName}`, eventValues);
      const res = await AppsFlyer.logEvent({
        eventName,
        // AppsFlyer expects string values; coerce loosely.
        eventValue: eventValues as Record<string, string>,
      });
      log(`trackAppsFlyerEvent → AFTER logEvent ${eventName} success:`, res);
    } catch (err) {
      warn(`trackAppsFlyerEvent → logEvent ${eventName} FAILED:`, describeError("logEvent", err));
    }
  } catch (err) {
    warn(`trackAppsFlyerEvent(${eventName}) → outer catch:`, describeError("trackAppsFlyerEvent", err));
  }
}
