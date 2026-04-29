/**
 * AppsFlyer integration — EcoLogic native iOS (staging).
 *
 * Plugin : appsflyer-capacitor-plugin@6.17.91
 * Bridge : Capacitor 8.1.0
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WHY we do NOT import("appsflyer-capacitor-plugin") on iOS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * The module's top-level eval calls:
 *   registerPlugin('AppsFlyerPlugin', {})   ← no web fallback
 *
 * Capacitor 8 registerPlugin() immediately creates a Proxy whose
 * get() trap calls createPluginMethodWrapper(prop).  For any prop
 * access, that wrapper:
 *   1. checks pluginHeader.methods for the prop name
 *   2. falls back to the web impl  → undefined (empty {})
 *   3. throws UNIMPLEMENTED in an internal Promise.then() with no
 *      .catch() → orphaned rejection → [UnhandledRejection].
 *
 * Fix: skip the JS module entirely.  Call the Capacitor 8 native
 * bridge helpers directly — they route straight to the iOS bridge's
 * native method dispatcher (CAP_PLUGIN_METHOD / addListener handler)
 * without going through createPluginMethodWrapper.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Verified method names (AppsFlyerPlugin.m + AppsFlyerPlugin.swift)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   CAP_PLUGIN_METHOD(initSDK,         CAPPluginReturnPromise)
 *   CAP_PLUGIN_METHOD(startSDK,        CAPPluginReturnPromise)
 *   CAP_PLUGIN_METHOD(getAppsFlyerUID, CAPPluginReturnPromise)
 *   CAP_PLUGIN_METHOD(logEvent,        CAPPluginReturnPromise)
 *   UDL listener event name = "udl_callback"  (AFConstants.UDL_CALLBACK)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * initSDK parameter keys (AppsFlyerConstants.swift)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   devKey               "devKey"
 *   appID                "appID"
 *   isDebug              "isDebug"
 *   registerOnDeepLink   "registerOnDeepLink"   ← must be true for UDL
 *   manualStart          "manualStart"
 *   waitForATTUserAuth.  "waitForATTUserAuthorization"
 *   minTimeBetweenSess.  "minTimeBetweenSessions"
 *
 * Required env vars (Vite build-time):
 *   VITE_APPSFLYER_DEV_KEY
 *   VITE_APPSFLYER_IOS_APP_ID
 */

import { Capacitor } from "@capacitor/core";
import { isNativePlatform, getPlatform } from "@/lib/capacitor";

// ── Public event name constants ───────────────────────────────────────────────
export const AF_EVENTS = {
  APP_OPEN:               "app_open",
  SIGN_UP:                "sign_up",
  TRIAL_STARTED:          "trial_started",
  SUBSCRIPTION_STARTED:   "subscription_started",
  SUBSCRIPTION_PURCHASED: "subscription_purchased",
  COMPANY_CREATED:        "company_created",
  EMPLOYEE_JOINED:        "employee_joined",
  INVOICE_PAID:           "invoice_paid",
  DEMO_BOOKED:            "demo_booked",
} as const;
export type AfEventName = (typeof AF_EVENTS)[keyof typeof AF_EVENTS];

// ── Env-var config ────────────────────────────────────────────────────────────
const DEV_KEY   = (import.meta.env.VITE_APPSFLYER_DEV_KEY   as string | undefined) || "";
const IOS_APP_ID = (import.meta.env.VITE_APPSFLYER_IOS_APP_ID as string | undefined) || "";
const IS_DEV    = import.meta.env.DEV === true;

// ── Module state ──────────────────────────────────────────────────────────────
let _initStarted   = false;
let _initDone      = false;
let _unavailable   = false;

// ── Logging helper ────────────────────────────────────────────────────────────
function log(...args: unknown[]): void {
  console.log("[appsflyer]", ...args);
}

// ── Bridge accessors ──────────────────────────────────────────────────────────

/**
 * Returns window.Capacitor if the native iOS bridge is present, else null.
 * Accessing nativePromise / nativeCallback through this avoids any import of
 * the appsflyer-capacitor-plugin JS module.
 */
function getCap(): {
  nativePromise: (plugin: string, method: string, options: Record<string, unknown>) => Promise<unknown>;
  nativeCallback: (plugin: string, method: string, options: Record<string, unknown>, callback: (data: unknown) => void) => void;
} | null {
  const win = window as any;
  const cap = win.Capacitor;
  if (
    cap &&
    typeof cap.nativePromise  === "function" &&
    typeof cap.nativeCallback === "function"
  ) {
    return cap;
  }
  return null;
}

// ── UDL (Unified Deep Linking) handler ───────────────────────────────────────
function handleUdlEvent(rawEvent: unknown): void {
  const ev = rawEvent as any;
  const status = ev?.status ?? "(unknown)";
  const dl     = ev?.deepLink ?? ev?.deep_link ?? {};
  let parsed: Record<string, any> = {};
  if (typeof dl === "string") {
    try { parsed = JSON.parse(dl); } catch { parsed = {}; }
  } else if (dl && typeof dl === "object") {
    parsed = dl as Record<string, any>;
  }

  const get = (key: string): string | null => {
    const want = key.toLowerCase();
    for (const [k, v] of Object.entries(parsed)) {
      if (k.toLowerCase() === want && v != null && String(v).trim() !== "") {
        return String(v);
      }
    }
    return null;
  };

  console.log("[appsflyer-attribution] udl_callback status=" + status, parsed);
  import("@/lib/attribution")
    .then(({ saveAppsflyerAttribution }) => {
      saveAppsflyerAttribution({
        referralCode:  get("deep_link_value"),
        sourceType:    get("deep_link_sub1"),
        campaignId:    get("deep_link_sub2"),
        campaignName:  get("deep_link_sub3"),
        sourceName:    get("deep_link_sub4"),
      });
    })
    .catch((err) => {
      log("udl_callback → attribution import failed:", String(err));
    });
}

// ── Main init function ────────────────────────────────────────────────────────

/**
 * Initialise the AppsFlyer SDK via direct Capacitor native bridge calls.
 * Never imports appsflyer-capacitor-plugin — safe on web/Android.
 */
export async function initAppsFlyer(): Promise<boolean> {
  // Confirm this JS bundle is running (matches APP_VERSION in main.tsx).
  console.log("[appsflyer] DIAGNOSTIC BUILD 2026.04.29.3 LOADED"); // version-stamp

  if (_initDone)    return true;
  if (_initStarted) { log("already in progress, skipping duplicate call"); return false; }
  _initStarted = true;

  try {
    // Web / Android: skip entirely
    if (!isNativePlatform()) { log("skipping — not a native platform"); return false; }

    if (!DEV_KEY) { log("VITE_APPSFLYER_DEV_KEY missing, skipping"); return false; }

    const platform = getPlatform();
    log(`platform=${platform} devKey=${DEV_KEY.slice(0, 4)}… iosAppId=${IOS_APP_ID || "(none)"}`);
    if (platform === "ios" && !IOS_APP_ID) {
      log("WARNING: VITE_APPSFLYER_IOS_APP_ID missing — install attribution limited");
    }

    // ── Step 1 : Synchronous bridge availability check ─────────────────────
    // Must happen BEFORE any import of appsflyer-capacitor-plugin.
    let bridgeHasPlugin = false;
    try {
      const av_af  = Capacitor.isPluginAvailable("AppsFlyer");
      const av_afp = Capacitor.isPluginAvailable("AppsFlyerPlugin");
      const av_pod = Capacitor.isPluginAvailable("AppsflyerCapacitorPlugin");
      const bridgePlugins =
        Object.keys((window as any).Capacitor?.Plugins || {}).join(", ") || "(none)";
      console.log(
        `[appsflyer] plugin availability — AppsFlyer=${av_af} AppsFlyerPlugin=${av_afp} AppsflyerCapacitorPlugin=${av_pod}`
      );
      console.log(`[appsflyer] registered bridge plugins: ${bridgePlugins}`);
      bridgeHasPlugin = av_afp;
    } catch (err) {
      log("availability check threw (non-fatal):", String(err));
    }

    if (!bridgeHasPlugin) {
      console.log(
        "[appsflyer-attribution] AppsFlyerPlugin not on bridge — " +
        "ensure -ObjC in Podfile, then pod install + Clean Build Folder + Run"
      );
      _unavailable = true;
      return false;
    }

    // ── Step 2 : Obtain direct bridge reference ────────────────────────────
    // We do NOT import appsflyer-capacitor-plugin here.
    // All calls go through window.Capacitor.nativePromise / nativeCallback.
    const cap = getCap();
    if (!cap) {
      log("window.Capacitor.nativePromise/nativeCallback not available");
      _unavailable = true;
      return false;
    }

    // ── Step 3 : initSDK ──────────────────────────────────────────────────
    //   registerOnDeepLink: true  → sets appsflyer.deepLinkDelegate = self
    //                               (required for udl_callback to fire)
    //   manualStart: true         → defer session until listener registered
    try {
      log("BEFORE nativePromise initSDK");
      const initRes = await cap.nativePromise("AppsFlyerPlugin", "initSDK", {
        devKey:                        DEV_KEY,
        appID:                         IOS_APP_ID,
        isDebug:                       IS_DEV,
        waitForATTUserAuthorization:   10,
        minTimeBetweenSessions:        4,
        registerOnDeepLink:            true,
        registerConversionListener:    false,
        registerOnAppOpenAttribution:  false,
        manualStart:                   true,
      });
      log("AFTER nativePromise initSDK success:", JSON.stringify(initRes));
      _initDone = true;
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorCode;
      log(`nativePromise initSDK FAILED code=${code ?? "(none)"}: ${String(err)}`);
      if (code === "UNIMPLEMENTED") {
        _unavailable = true;
        console.log(
          "[appsflyer-attribution] initSDK UNIMPLEMENTED — " +
          "rebuild with -ObjC in Podfile → pod install → Clean Build Folder"
        );
      }
      return false;
    }

    // ── Step 4 : addListener for UDL (udl_callback) ───────────────────────
    //   Use nativeCallback, NOT the plugin proxy addListener().
    //   nativeCallback routes directly to the iOS bridge addListener handler;
    //   the callback is invoked each time native calls notifyListeners("udl_callback").
    try {
      log("BEFORE nativeCallback addListener udl_callback");
      cap.nativeCallback(
        "AppsFlyerPlugin",
        "addListener",
        { eventName: "udl_callback" },
        (event: unknown) => {
          try {
            handleUdlEvent(event);
          } catch (handlerErr) {
            log("udl_callback handler threw:", String(handlerErr));
          }
        }
      );
      log("AFTER nativeCallback addListener registered");
    } catch (err) {
      log("nativeCallback addListener FAILED:", String(err));
      // Non-fatal — SDK still tracks installs without deep-link data.
    }

    // ── Step 5 : startSDK ─────────────────────────────────────────────────
    try {
      log("BEFORE nativePromise startSDK");
      const startRes = await cap.nativePromise("AppsFlyerPlugin", "startSDK", {});
      log("AFTER nativePromise startSDK success:", JSON.stringify(startRes));
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorCode;
      log(`nativePromise startSDK FAILED code=${code ?? "(none)"}: ${String(err)}`);
      // Non-fatal — events still queue for later reporting.
    }

    // ── Step 6 : AppsFlyer UID (diagnostic) ──────────────────────────────
    try {
      log("BEFORE nativePromise getAppsFlyerUID");
      const afidRes = await cap.nativePromise("AppsFlyerPlugin", "getAppsFlyerUID", {});
      const uid = (afidRes as any)?.uid ?? String(afidRes);
      log(`AFTER nativePromise getAppsFlyerUID uid=${uid}`);
    } catch (err) {
      log("nativePromise getAppsFlyerUID FAILED:", String(err));
    }

    log("initAppsFlyer COMPLETE");
    return true;

  } catch (err) {
    log("initAppsFlyer outer catch:", String(err));
    return false;
  }
}

// ── Event tracking ────────────────────────────────────────────────────────────

/**
 * Track an in-app event. No-ops on web or when SDK is unavailable.
 * Also does NOT import appsflyer-capacitor-plugin — calls nativePromise directly.
 */
export async function trackAppsFlyerEvent(
  eventName: AfEventName | string,
  eventValues: Record<string, unknown> = {}
): Promise<void> {
  try {
    if (!isNativePlatform()) return;
    if (_unavailable) {
      log(`trackEvent(${eventName}) → plugin unavailable, dropping`);
      return;
    }
    if (!_initDone) {
      log(`trackEvent(${eventName}) → SDK not ready, lazy init`);
      const ok = await initAppsFlyer();
      if (!ok) { log(`trackEvent(${eventName}) → lazy init failed, dropping`); return; }
    }
    const cap = getCap();
    if (!cap) {
      log(`trackEvent(${eventName}) → bridge unavailable`);
      return;
    }
    try {
      log(`BEFORE nativePromise logEvent eventName=${eventName}`);
      const res = await cap.nativePromise("AppsFlyerPlugin", "logEvent", {
        eventName,
        eventValue: eventValues as Record<string, string>,
      });
      log(`AFTER nativePromise logEvent ${eventName} success:`, JSON.stringify(res));
    } catch (err) {
      log(`nativePromise logEvent ${eventName} FAILED:`, String(err));
    }
  } catch (err) {
    log(`trackAppsFlyerEvent(${eventName}) outer catch:`, String(err));
  }
}
