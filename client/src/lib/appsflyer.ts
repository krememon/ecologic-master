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

    // ── Native plugin availability diagnostics ────────────────────────────────
    // Log before every native call so Xcode/Logcat always shows bridge state.
    // Capacitor.isPluginAvailable(name) checks whether the native bridge has a
    // registered implementation for that plugin name.  If all three return
    // false after pod install + clean build, it means the -ObjC linker flag is
    // still missing (ObjC categories were stripped → CAPBridgedPlugin
    // conformance not loaded → Capacitor's registerPlugins() silently skipped).
    try {
      const avail_af   = Capacitor.isPluginAvailable("AppsFlyer");
      const avail_afp  = Capacitor.isPluginAvailable("AppsFlyerPlugin");
      const avail_pod  = Capacitor.isPluginAvailable("AppsflyerCapacitorPlugin");
      const pluginKeys = Object.keys((window as any).Capacitor?.Plugins || {});
      console.log(
        `[appsflyer] plugin availability — AppsFlyer=${avail_af} AppsFlyerPlugin=${avail_afp} AppsflyerCapacitorPlugin=${avail_pod}`
      );
      console.log(`[appsflyer] registered bridge plugins: ${pluginKeys.join(", ") || "(none)"}`);
      // Expected when working:  AppsFlyerPlugin=true (the registered name)
      // If AppsFlyerPlugin=false → ObjC category stripped → need -ObjC in
      // ios/App/Podfile post_install block, then pod install + clean + run.
    } catch (diagErr) {
      console.warn("[appsflyer] diagnostics failed (non-fatal):", diagErr);
    }

    // ── initSDK ───────────────────────────────────────────────────────────────
    // Phase 2 (Unified Deep Linking):
    //   • manualStart=true defers session-start until after the UDL listener
    //     is registered. Without this, AppsFlyer auto-starts inside initSDK
    //     and the cold-start UDL callback fires before our listener is attached
    //     — so deferred-deep-link data is lost on first launch after install.
    //   • registerOnDeepLink stays false because UDL supersedes the legacy
    //     onDeepLink callback (mixing the two double-fires the handler).
    try {
      console.log('[appsflyer] Capacitor Plugins =', Object.keys((window as any).Capacitor?.Plugins || {}));
      log("initAppsFlyer → BEFORE initSDK call");
      console.log("[appsflyer-attribution] init");
      const initRes = await AppsFlyer.initSDK({
        devKey: DEV_KEY,
        appID: IOS_APP_ID,        // ignored on Android
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
      if (code === "UNIMPLEMENTED") {
        // The JS facade is loaded (`appsflyer-capacitor-plugin` resolved) but
        // the native iOS/Android class isn't linked into this app binary.
        // Almost always means: pod install hasn't been re-run since the pod
        // was added, OR the user opened App.xcodeproj instead of
        // App.xcworkspace. Mark the plugin unavailable so subsequent
        // trackAppsFlyerEvent / startSDK calls early-return cleanly instead
        // of producing more unhandled rejections.
        _pluginUnavailable = true;
        console.warn("[appsflyer-attribution] native plugin unavailable", describeError("initSDK", err));
        return false;
      }
      warn("initAppsFlyer → initSDK FAILED:", describeError("initSDK", err));
      // Fatal — without initSDK nothing else will work.
      return false;
    }

    // ── Unified Deep Linking listener ────────────────────────────────────────
    // MUST be attached before startSDK() so the cold-start callback (carrying
    // the deferred-deep-link payload after install from a OneLink) lands in
    // our handler. The handler is best-effort: extracts deep_link_value /
    // deep_link_sub1-4 and forwards them to saveAppsflyerAttribution()
    // (first-touch-wins; never overwrites existing attribution).
    try {
      log("initAppsFlyer → BEFORE addListener(udl_callback)");
      // In Capacitor 6 `addListener` returns Promise<PluginListenerHandle>, not
      // a sync handle. If the native plugin is missing we'd get an unhandled
      // promise rejection here. Capture the return value and attach .catch
      // defensively regardless of whether the runtime returns sync or async.
      const handle = AppsFlyer.addListener("udl_callback", (event: any) => {
        try {
          const status = event?.status ?? "(unknown)";
          const dl = event?.deepLink ?? event?.deep_link ?? {};
          // AppsFlyer occasionally returns the payload as a JSON string on iOS.
          let parsed: Record<string, any> = {};
          if (typeof dl === "string") {
            try { parsed = JSON.parse(dl); } catch { parsed = {}; }
          } else if (dl && typeof dl === "object") {
            parsed = dl as Record<string, any>;
          }
          // Case-insensitive lookup — Android tends to use snake_case, iOS
          // sometimes camelCases the very same keys.
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

          // Safely import the attribution helper — keeping it lazy avoids
          // pulling attribution.ts into any code path that doesn't need it.
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
              warn("udl_callback → attribution import failed:", describeError("import attribution", err));
            });
        } catch (err) {
          warn("udl_callback → handler threw:", describeError("udl_callback handler", err));
        }
      });
      // Defensively swallow rejection if `handle` is a Promise (Capacitor 6+).
      if (handle && typeof (handle as any).catch === "function") {
        (handle as any).catch((err: unknown) => {
          warn("initAppsFlyer → addListener(udl_callback) async-rejected:", describeError("addListener", err));
        });
      }
      log("initAppsFlyer → AFTER addListener(udl_callback) registered");
    } catch (err) {
      warn("initAppsFlyer → addListener(udl_callback) FAILED:", describeError("addListener", err));
      // Non-fatal — startSDK still proceeds so events keep flowing even if
      // UDL never lands. We just won't capture deferred-deep-link attribution.
    }

    // ── startSDK ─────────────────────────────────────────────────────────────
    // Required because manualStart=true was passed to initSDK.
    try {
      log("initAppsFlyer → BEFORE startSDK call");
      const startRes = await AppsFlyer.startSDK();
      log("initAppsFlyer → AFTER startSDK success:", startRes);
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorCode;
      if (code === "UNIMPLEMENTED") {
        // Should be unreachable (initSDK would have caught this first and
        // returned early), but kept defensive so a partially-linked plugin
        // can never produce an unhandled rejection.
        _pluginUnavailable = true;
        console.warn("[appsflyer-attribution] native plugin unavailable", describeError("startSDK", err));
      } else {
        warn("initAppsFlyer → startSDK FAILED:", describeError("startSDK", err));
      }
      // Non-fatal for the boot path — the rest of the helpers will still
      // attempt to log events; AppsFlyer's native side queues until session
      // start succeeds on a subsequent call.
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
