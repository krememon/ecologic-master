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
 *   4. Bridge-availability check runs BEFORE any native call and bails
 *      cleanly when the plugin is not registered on the Capacitor bridge,
 *      preventing UNIMPLEMENTED rejections entirely.
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

// ALL diagnostic logs use console.log (not console.warn/error) so they are
// visible in Xcode console regardless of log-level filters. console.warn is
// invisible in some Xcode log configurations even when console.log shows fine.
function log(...args: unknown[]): void {
  console.log("[appsflyer]", ...args);
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
      `${method} → UNIMPLEMENTED. Fix on Mac: ` +
      `(1) Update ios/App/Podfile — add -ObjC in post_install aggregate_targets block; ` +
      `(2) cd ios/App && pod install; ` +
      `(3) Xcode: Product → Clean Build Folder (⇧⌘K), then Run. ` +
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
    log("loadPlugin → import FAILED:", describeError("import", err));
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
      log("initAppsFlyer → VITE_APPSFLYER_DEV_KEY missing, skipping");
      return false;
    }

    const platform = getPlatform();
    log(`initAppsFlyer → platform=${platform} devKey=${DEV_KEY.slice(0, 4)}… iosAppId=${IOS_APP_ID || "(none)"}`);

    if (platform === "ios" && !IOS_APP_ID) {
      log("initAppsFlyer → WARNING: VITE_APPSFLYER_IOS_APP_ID missing — install attribution will be limited");
    }

    // ── Step 1: Import the JS module facade (no native calls happen here) ───
    const AppsFlyer = await loadPluginAsync();
    if (!AppsFlyer) {
      log("initAppsFlyer → plugin JS import failed, aborting");
      return false;
    }

    // ── Step 2: Bridge availability check (MUST run before any native call) ─
    //
    // Capacitor.isPluginAvailable(name) inspects the native bridge's plugin
    // registry that was populated at app startup by CAPBridgeViewController's
    // registerPlugins() method.  On iOS this works by:
    //   1. Reading packageClassList from capacitor.config.json
    //   2. NSClassFromString(className) — finds the Swift class
    //   3. Casting to (CAPPlugin & CAPBridgedPlugin).Type
    //   4. If cast succeeds → plugin registered + added to PluginHeaders
    //
    // With appsflyer-capacitor-plugin, CAPBridgedPlugin conformance comes
    // ONLY from the ObjC category created by the CAP_PLUGIN() macro in
    // AppsFlyerPlugin.m.  When building with use_frameworks! :linkage => :static
    // the linker STRIPS ObjC categories unless -ObjC is in OTHER_LDFLAGS.
    // Without -ObjC: cast fails → NOT in PluginHeaders → isPluginAvailable=false.
    //
    // Fix: ios/App/Podfile post_install block must set -ObjC in aggregate_targets
    // xcconfigs, then pod install + Clean Build Folder + Run.

    let bridgeHasPlugin = false;
    try {
      const av_af  = Capacitor.isPluginAvailable("AppsFlyer");
      const av_afp = Capacitor.isPluginAvailable("AppsFlyerPlugin");
      const av_pod = Capacitor.isPluginAvailable("AppsflyerCapacitorPlugin");
      const bridgePlugins = Object.keys((window as any).Capacitor?.Plugins || {}).join(", ") || "(none)";
      // Use console.log for ALL availability output — never console.warn here
      // because console.warn is filtered in some Xcode log configurations.
      console.log(
        `[appsflyer] plugin availability — AppsFlyer=${av_af} AppsFlyerPlugin=${av_afp} AppsflyerCapacitorPlugin=${av_pod}`
      );
      console.log(`[appsflyer] registered bridge plugins: ${bridgePlugins}`);
      bridgeHasPlugin = av_afp;
    } catch (diagErr) {
      // isPluginAvailable should never throw, but guard just in case.
      console.log("[appsflyer] availability check threw (non-fatal):", String(diagErr));
    }

    if (!bridgeHasPlugin) {
      // The JS facade loaded successfully but AppsFlyerPlugin is NOT registered
      // on the native Capacitor bridge.  Every native call would return
      // UNIMPLEMENTED.  Bail out NOW so no native calls are attempted and no
      // unhandled rejections can leak out.
      console.log("[appsflyer-attribution] native plugin unavailable — AppsFlyerPlugin not on bridge, skipping AppsFlyer init");
      console.log("[appsflyer] Action required: add -ObjC to Podfile post_install → pod install → Clean Build Folder → Run");
      _pluginUnavailable = true;
      return false;
    }

    // ── Step 3: initSDK ──────────────────────────────────────────────────────
    // manualStart=true defers session-start until after the UDL listener is
    // registered so cold-start deep-link data isn't lost.
    try {
      log("initAppsFlyer → BEFORE initSDK");
      const initRes = await AppsFlyer.initSDK({
        devKey: DEV_KEY,
        appID: IOS_APP_ID,
        isDebug: IS_DEV,
        waitForATTUserAuthorization: 10,
        minTimeBetweenSessions: 4,
        registerOnDeepLink: false,
        registerConversionListener: false,
        registerOnAppOpenAttribution: false,
        manualStart: true,
      });
      log("initAppsFlyer → AFTER initSDK success:", initRes);
      _initDone = true;
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorCode;
      console.log(`[appsflyer] initSDK FAILED code=${code ?? "(none)"}:`, describeError("initSDK", err));
      if (code === "UNIMPLEMENTED") {
        _pluginUnavailable = true;
        console.log("[appsflyer-attribution] native plugin unavailable — initSDK returned UNIMPLEMENTED");
      }
      return false;
    }

    // ── Step 4: Unified Deep Linking listener ────────────────────────────────
    // MUST be registered before startSDK() so the cold-start deferred
    // deep-link payload lands in our handler on the very first install launch.
    //
    // Capacitor 8 addListener on native calls addListenerNative() internally,
    // which creates TWO promises: an inner `call` (the actual native bridge
    // call) and an outer `p` (resolves to { remove } when `call` resolves).
    // If `call` rejects (e.g. native error), `p` never settles and `call`'s
    // rejection is orphaned inside Capacitor's internals — it cannot be caught
    // from the outside via handle.catch().
    //
    // Mitigation: we only reach this code when bridgeHasPlugin=true, which
    // means the native plugin IS registered and addListener should succeed.
    // Belt-and-suspenders: wrap in a try/catch for any sync throw, and attach
    // Promise.resolve(handle).catch() for the outer promise rejection path.
    try {
      log("initAppsFlyer → BEFORE addListener(udl_callback)");
      const handle = AppsFlyer.addListener("udl_callback", (event: any) => {
        try {
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
          console.log("[appsflyer-attribution] deep link received status=" + status, parsed);
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
        } catch (err) {
          log("udl_callback → handler threw:", describeError("udl_callback handler", err));
        }
      });
      // Attach .catch on the outer handle promise to suppress any rejection
      // that surfaces from addListenerNative's outer `p` promise.
      // (The inner `call` orphan rejection from addListenerNative cannot be
      // caught from here — it's internal to Capacitor — but bridgeHasPlugin=true
      // means the native call should succeed so `call` should resolve.)
      Promise.resolve(handle)
        .catch((err: unknown) => {
          log("initAppsFlyer → addListener(udl_callback) handle-promise rejected:", describeError("addListener", err));
        });
      log("initAppsFlyer → AFTER addListener(udl_callback) registered");
    } catch (err) {
      log("initAppsFlyer → addListener(udl_callback) sync-threw:", describeError("addListener", err));
      // Non-fatal — continue to startSDK.
    }

    // ── Step 5: startSDK ─────────────────────────────────────────────────────
    try {
      log("initAppsFlyer → BEFORE startSDK");
      const startRes = await AppsFlyer.startSDK();
      log("initAppsFlyer → AFTER startSDK success:", startRes);
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorCode;
      console.log(`[appsflyer] startSDK FAILED code=${code ?? "(none)"}:`, describeError("startSDK", err));
      if (code === "UNIMPLEMENTED") {
        _pluginUnavailable = true;
        console.log("[appsflyer-attribution] native plugin unavailable — startSDK returned UNIMPLEMENTED");
      }
      // Non-fatal — events still queue.
    }

    // ── Step 6: IDFV via @capacitor/device ──────────────────────────────────
    try {
      log("initAppsFlyer → BEFORE Device.getId()");
      const { Device } = await import("@capacitor/device");
      const info = await Device.getId();
      const idfv = (info as any).identifier ?? (info as any).uuid ?? "(unknown)";
      log(`initAppsFlyer → AFTER Device.getId() — 📱 IDFV: ${idfv}`);
    } catch (err) {
      log("initAppsFlyer → Device.getId FAILED:", describeError("Device.getId", err));
    }

    // ── Step 7: AppsFlyer UID ────────────────────────────────────────────────
    try {
      log("initAppsFlyer → BEFORE getAppsFlyerUID");
      const afid = await AppsFlyer.getAppsFlyerUID();
      const uid = (afid as any)?.uid ?? String(afid);
      log(`initAppsFlyer → AFTER getAppsFlyerUID — 📱 AppsFlyer UID: ${uid}`);
    } catch (err) {
      log("initAppsFlyer → getAppsFlyerUID FAILED:", describeError("getAppsFlyerUID", err));
    }

    log("initAppsFlyer → COMPLETE");
    return true;
  } catch (err) {
    console.log("[appsflyer] initAppsFlyer → outer catch:", describeError("initAppsFlyer", err));
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
      log(`trackAppsFlyerEvent(${eventName}) → plugin unavailable, dropping event`);
      return;
    }
    if (!_initDone) {
      log(`trackAppsFlyerEvent(${eventName}) → SDK not ready, attempting lazy init`);
      const ok = await initAppsFlyer();
      if (!ok) {
        log(`trackAppsFlyerEvent(${eventName}) → lazy init failed, dropping event`);
        return;
      }
    }
    const AppsFlyer = await loadPluginAsync();
    if (!AppsFlyer) {
      log(`trackAppsFlyerEvent(${eventName}) → plugin unavailable, dropping event`);
      return;
    }

    try {
      log(`trackAppsFlyerEvent → BEFORE logEvent ${eventName}`, eventValues);
      const res = await AppsFlyer.logEvent({
        eventName,
        eventValue: eventValues as Record<string, string>,
      });
      log(`trackAppsFlyerEvent → AFTER logEvent ${eventName} success:`, res);
    } catch (err) {
      log(`trackAppsFlyerEvent → logEvent ${eventName} FAILED:`, describeError("logEvent", err));
    }
  } catch (err) {
    log(`trackAppsFlyerEvent(${eventName}) → outer catch:`, describeError("trackAppsFlyerEvent", err));
  }
}
