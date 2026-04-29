/**
 * AppsFlyer integration for EcoLogic native mobile wrappers.
 *
 * Plugin: appsflyer-capacitor-plugin@6.17.91
 *   Native iOS class: AppsFlyerPlugin (AppsFlyerPlugin.m + AppsFlyerPlugin.swift)
 *   Capacitor bridge version: 8.1.0
 *
 * === METHOD NAMES (verified from plugin source) ===
 *   initSDK(options)       — CAP_PLUGIN_METHOD(initSDK,  CAPPluginReturnPromise)
 *   startSDK()             — CAP_PLUGIN_METHOD(startSDK, CAPPluginReturnPromise)
 *   getAppsFlyerUID()      — CAP_PLUGIN_METHOD(getAppsFlyerUID, CAPPluginReturnPromise)
 *   logEvent(data)         — CAP_PLUGIN_METHOD(logEvent, CAPPluginReturnPromise)
 *   UDL listener name      — AFConstants.UDL_CALLBACK = "udl_callback"
 *
 * === WHY addListener MUST NOT go through AppsFlyer proxy ===
 *   Capacitor 8 registerPlugin('AppsFlyerPlugin', {}) creates a proxy with an
 *   empty implementation object.  When proxy.addListener() is called:
 *     1. Proxy uses addListenerNative() because pluginHeader exists on native.
 *     2. addListenerNative calls createPluginMethodWrapper('addListener').
 *     3. The wrapper checks pluginHeader.methods for 'addListener' — NOT THERE
 *        (addListener is NOT declared via CAP_PLUGIN_METHOD in AppsFlyerPlugin.m).
 *     4. No web-implementation fallback exists (empty {} passed to registerPlugin).
 *     5. The wrapper throws UNIMPLEMENTED inside an internal Promise.then().
 *     6. The outer promise (p) only has .then, not .catch — orphaned rejection.
 *     7. → [UnhandledRejection] {code:"UNIMPLEMENTED"}.
 *
 *   FIX: Call window.Capacitor.nativeCallback('AppsFlyerPlugin','addListener',...)
 *   directly.  This bypasses createPluginMethodWrapper entirely and routes
 *   straight to the Capacitor iOS bridge's special-case addListener handler,
 *   which IS implemented for all CAPPlugins regardless of CAP_PLUGIN_METHOD.
 *
 * === INIT FLOW ===
 *   Step 1  Capacitor.isPluginAvailable() — synchronous, no import needed.
 *           Must run BEFORE any import of the plugin module.
 *   Step 2  loadPluginAsync() — dynamic import.
 *           Only reached when AppsFlyerPlugin=true.
 *   Step 3  initSDK({ ..., registerOnDeepLink: true })
 *           registerOnDeepLink=true sets appsflyer.deepLinkDelegate = self
 *           so that UDL events actually fire from native.
 *   Step 4  addListener via nativeCallback (direct bridge call, no proxy)
 *   Step 5  startSDK
 *   Step 6  getAppsFlyerUID
 *
 * Required env vars (baked at Vite build time):
 *   VITE_APPSFLYER_DEV_KEY     (required)
 *   VITE_APPSFLYER_IOS_APP_ID  (required for iOS install attribution)
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

// ALL diagnostic logs use console.log (not console.warn/error) so they are
// visible in Xcode console regardless of log-level filters.
function log(...args: unknown[]): void {
  console.log("[appsflyer]", ...args);
}

/**
 * Describe a native-call error. Detects Capacitor's UNIMPLEMENTED code so
 * the fix instructions are printed alongside the method name.
 */
function describeError(method: string, err: unknown): string {
  const anyErr = err as any;
  const code = anyErr?.code ?? anyErr?.errorCode;
  const message = anyErr?.message ?? String(err);
  if (code === "UNIMPLEMENTED") {
    return (
      `${method} → UNIMPLEMENTED. Fix: ` +
      `(1) Ensure -ObjC in Podfile post_install aggregate_targets; ` +
      `(2) cd ios/App && pod install; ` +
      `(3) Xcode: Product → Clean Build Folder (⇧⌘K), then Run.`
    );
  }
  return `${method} → ${code ? `[${code}] ` : ""}${message}`;
}

/**
 * Dynamically imports the plugin JS module.
 *
 * MUST only be called AFTER Capacitor.isPluginAvailable("AppsFlyerPlugin")
 * returns true.  Importing with the plugin absent causes an unhandled rejection
 * because registerPlugin() fires an internal Capacitor ping that rejects UNIMPLEMENTED.
 */
async function loadPluginAsync(): Promise<any | null> {
  if (_pluginUnavailable) return null;
  try {
    const { AppsFlyer } = await import("appsflyer-capacitor-plugin");
    log("loadPlugin → method=import resolved");
    return AppsFlyer;
  } catch (err) {
    _pluginUnavailable = true;
    log("loadPlugin → method=import FAILED:", describeError("import", err));
    return null;
  }
}

/**
 * Register the Unified Deep Linking listener using window.Capacitor.nativeCallback
 * instead of AppsFlyer.addListener().
 *
 * WHY: Capacitor 8's proxy addListener() routes through createPluginMethodWrapper
 * which looks up 'addListener' in pluginHeader.methods.  'addListener' is NOT
 * declared via CAP_PLUGIN_METHOD in AppsFlyerPlugin.m.  With no web fallback
 * (registerPlugin('AppsFlyerPlugin', {})), the wrapper throws UNIMPLEMENTED
 * inside an internal Promise.then() that has no .catch() — orphaned rejection.
 *
 * nativeCallback goes directly to the Capacitor iOS bridge's built-in addListener
 * handler which works for every CAPPlugin regardless of method declarations.
 */
function registerUdlListenerViaNativeCallback(handler: (event: any) => void): boolean {
  try {
    const cap = (window as any).Capacitor;
    if (typeof cap?.nativeCallback !== "function") {
      log("registerUdlListener → Capacitor.nativeCallback not available (web?), skipping");
      return false;
    }
    log("BEFORE method=addListener eventName=udl_callback (via nativeCallback)");
    cap.nativeCallback(
      "AppsFlyerPlugin",
      "addListener",
      { eventName: "udl_callback" },
      (event: any) => {
        try {
          handler(event);
        } catch (err) {
          log("udl_callback handler threw:", describeError("udl_callback handler", err));
        }
      }
    );
    log("AFTER  method=addListener registered (via nativeCallback)");
    return true;
  } catch (err) {
    log("registerUdlListener → sync threw:", describeError("addListener nativeCallback", err));
    return false;
  }
}

/**
 * Handle a raw UDL event payload from the native side.
 * Parses deep_link_value / sub1-4 and persists attribution via saveAppsflyerAttribution.
 */
function handleUdlEvent(event: any): void {
  const status = event?.status ?? "(unknown)";
  const dl = event?.deepLink ?? event?.deep_link ?? {};
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
        referralCode: get("deep_link_value"),
        sourceType: get("deep_link_sub1"),
        campaignId: get("deep_link_sub2"),
        campaignName: get("deep_link_sub3"),
        sourceName: get("deep_link_sub4"),
      });
    })
    .catch((err) => {
      log("udl_callback → attribution import failed:", describeError("import attribution", err));
    });
}

/**
 * Initialise the AppsFlyer SDK. Safe to call multiple times.
 * Returns `true` when initialised, `false` when skipped or errored.
 */
export async function initAppsFlyer(): Promise<boolean> {
  // Diagnostic build stamp — confirm new JS bundle is running.
  console.log("[appsflyer] DIAGNOSTIC BUILD 2026.04.29.2 LOADED");

  if (_initDone) return true;
  if (_initStarted) {
    log("initAppsFlyer → already in progress, skipping duplicate call");
    return false;
  }
  _initStarted = true;

  try {
    if (!isNativePlatform()) {
      log("initAppsFlyer → skipping (not a native platform)");
      return false;
    }

    if (!DEV_KEY) {
      log("initAppsFlyer → VITE_APPSFLYER_DEV_KEY missing, skipping");
      return false;
    }

    const platform = getPlatform();
    log(`initAppsFlyer → platform=${platform} devKey=${DEV_KEY.slice(0, 4)}… iosAppId=${IOS_APP_ID || "(none)"}`);

    if (platform === "ios" && !IOS_APP_ID) {
      log("initAppsFlyer → WARNING: VITE_APPSFLYER_IOS_APP_ID missing — install attribution limited");
    }

    // ── Step 1: Bridge availability check ────────────────────────────────────
    //
    // Capacitor.isPluginAvailable() is a SYNCHRONOUS lookup of window.Capacitor.Plugins
    // populated at app startup — no import needed.
    // MUST run before loadPluginAsync() to prevent the unhandled-rejection bug.

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
    } catch (diagErr) {
      console.log("[appsflyer] availability check threw (non-fatal):", String(diagErr));
    }

    if (!bridgeHasPlugin) {
      console.log(
        "[appsflyer-attribution] native plugin unavailable — AppsFlyerPlugin not on bridge, skipping init"
      );
      console.log(
        "[appsflyer] Fix: add -ObjC to Podfile post_install → pod install → Clean Build Folder → Run"
      );
      _pluginUnavailable = true;
      return false;
    }

    // ── Step 2: Import JS module facade — ONLY after availability confirmed ──
    const AppsFlyer = await loadPluginAsync();
    if (!AppsFlyer) {
      log("initAppsFlyer → plugin JS import failed, aborting");
      return false;
    }

    // ── Step 3: initSDK ──────────────────────────────────────────────────────
    //   registerOnDeepLink: true — REQUIRED so native sets deepLinkDelegate=self
    //   which enables udl_callback events to actually fire from native.
    //   manualStart: true — defer session-start until after addListener is
    //   registered so cold-start deep-link data isn't lost.
    try {
      log("BEFORE method=initSDK");
      const initRes = await AppsFlyer.initSDK({
        devKey: DEV_KEY,
        appID: IOS_APP_ID,
        isDebug: IS_DEV,
        waitForATTUserAuthorization: 10,
        minTimeBetweenSessions: 4,
        registerOnDeepLink: true,
        registerConversionListener: false,
        registerOnAppOpenAttribution: false,
        manualStart: true,
      });
      log("AFTER  method=initSDK success:", JSON.stringify(initRes));
      _initDone = true;
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorCode;
      log(`INIT   method=initSDK FAILED code=${code ?? "(none)"}:`, describeError("initSDK", err));
      if (code === "UNIMPLEMENTED") {
        _pluginUnavailable = true;
        log("[appsflyer-attribution] initSDK returned UNIMPLEMENTED — plugin not linked correctly");
      }
      return false;
    }

    // ── Step 4: UDL listener via direct nativeCallback ───────────────────────
    //   AppsFlyer.addListener() CANNOT be used here — see file-level comment.
    //   registerUdlListenerViaNativeCallback() uses window.Capacitor.nativeCallback
    //   directly, bypassing the broken Capacitor 8 proxy routing.
    registerUdlListenerViaNativeCallback(handleUdlEvent);

    // ── Step 5: startSDK ─────────────────────────────────────────────────────
    try {
      log("BEFORE method=startSDK");
      const startRes = await AppsFlyer.startSDK();
      log("AFTER  method=startSDK success:", JSON.stringify(startRes));
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorCode;
      log(`START  method=startSDK FAILED code=${code ?? "(none)"}:`, describeError("startSDK", err));
      if (code === "UNIMPLEMENTED") {
        _pluginUnavailable = true;
        log("[appsflyer-attribution] startSDK returned UNIMPLEMENTED");
      }
      // Non-fatal — events still queue.
    }

    // ── Step 6: IDFV via @capacitor/device ───────────────────────────────────
    try {
      log("BEFORE method=Device.getId");
      const { Device } = await import("@capacitor/device");
      const info = await Device.getId();
      const idfv = (info as any).identifier ?? (info as any).uuid ?? "(unknown)";
      log(`AFTER  method=Device.getId IDFV=${idfv}`);
    } catch (err) {
      log("Device.getId FAILED:", describeError("Device.getId", err));
    }

    // ── Step 7: AppsFlyer UID ────────────────────────────────────────────────
    try {
      log("BEFORE method=getAppsFlyerUID");
      const afid = await AppsFlyer.getAppsFlyerUID();
      const uid = (afid as any)?.uid ?? String(afid);
      log(`AFTER  method=getAppsFlyerUID uid=${uid}`);
    } catch (err) {
      log("getAppsFlyerUID FAILED:", describeError("getAppsFlyerUID", err));
    }

    log("initAppsFlyer → COMPLETE");
    return true;
  } catch (err) {
    log("initAppsFlyer → outer catch:", describeError("initAppsFlyer", err));
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
    if (_pluginUnavailable) {
      log(`trackAppsFlyerEvent(${eventName}) → plugin unavailable, dropping`);
      return;
    }
    if (!_initDone) {
      log(`trackAppsFlyerEvent(${eventName}) → SDK not ready, lazy init`);
      const ok = await initAppsFlyer();
      if (!ok) {
        log(`trackAppsFlyerEvent(${eventName}) → lazy init failed, dropping`);
        return;
      }
    }
    const AppsFlyer = await loadPluginAsync();
    if (!AppsFlyer) {
      log(`trackAppsFlyerEvent(${eventName}) → plugin unavailable, dropping`);
      return;
    }
    try {
      log(`BEFORE method=logEvent eventName=${eventName}`);
      const res = await AppsFlyer.logEvent({
        eventName,
        eventValue: eventValues as Record<string, string>,
      });
      log(`AFTER  method=logEvent ${eventName} success:`, JSON.stringify(res));
    } catch (err) {
      log(`logEvent ${eventName} FAILED:`, describeError("logEvent", err));
    }
  } catch (err) {
    log(`trackAppsFlyerEvent(${eventName}) outer catch:`, describeError("trackAppsFlyerEvent", err));
  }
}
