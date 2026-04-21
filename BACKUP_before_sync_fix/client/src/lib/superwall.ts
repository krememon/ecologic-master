/**
 * Superwall integration for EcoLogic native mobile wrappers.
 *
 * Plugin: @capawesome/capacitor-superwall
 *   API surface used:
 *     - configure({ apiKey })
 *     - identify({ userId })
 *     - setUserAttributes({ attributes })
 *     - reset()
 *
 * Design goals (mirror appsflyer.ts):
 *   1. Native-only — never call into the plugin on web.
 *   2. Fail-safe — every native call is wrapped, errors are logged, never thrown.
 *   3. Single configure() guard.
 *   4. Dynamic import of the plugin package so the Capacitor JS-proxy bridge
 *      survives a remote-loaded server.url (same fix we used for AppsFlyer).
 */

import { isNativePlatform } from "@/lib/capacitor";

const SUPERWALL_API_KEY = "pk_ZsYppZbbo4Q4ZOEnuY-yz";

let _configureStarted = false;
let _configureDone = false;
let _pluginUnavailable = false;
let _identifiedUserId: string | null = null;

function log(...args: unknown[]): void {
  console.log("[superwall]", ...args);
}
function warn(...args: unknown[]): void {
  console.warn("[superwall]", ...args);
}

function describeError(method: string, err: unknown): string {
  const anyErr = err as any;
  const code = anyErr?.code ?? anyErr?.errorCode;
  const message = anyErr?.message ?? String(err);
  if (code === "UNIMPLEMENTED") {
    return (
      `${method} → UNIMPLEMENTED. The native Superwall iOS/Android class is not ` +
      `linked into this app build. Fix on Mac: ` +
      `(1) cd ios/App && pod install (must show "Installing CapawesomeCapacitorSuperwall"); ` +
      `(2) npx cap sync ios; ` +
      `(3) Xcode: Product → Clean Build Folder (⇧⌘K), then Run. ` +
      `Original error: ${message}`
    );
  }
  return `${method} → ${code ? `[${code}] ` : ""}${message}`;
}

async function loadPluginAsync(): Promise<any | null> {
  if (_pluginUnavailable) return null;
  try {
    const { Superwall } = await import("@capawesome/capacitor-superwall");
    log("loadPlugin → Superwall import resolved");
    return Superwall;
  } catch (err) {
    _pluginUnavailable = true;
    warn("loadPlugin → import failed:", describeError("import", err));
    return null;
  }
}

/**
 * Initialise the Superwall SDK. Safe to call multiple times.
 * Returns `true` when configured, `false` when skipped (web / plugin error).
 */
export async function initSuperwall(): Promise<boolean> {
  if (_configureDone) return true;
  if (_configureStarted) {
    log("initSuperwall → configure already in progress, skipping duplicate call");
    return false;
  }
  _configureStarted = true;

  try {
    if (!isNativePlatform()) {
      log("initSuperwall → skipping (not a native platform)");
      return false;
    }

    const Superwall = await loadPluginAsync();
    if (!Superwall) {
      warn("initSuperwall → plugin unavailable, aborting");
      return false;
    }

    try {
      log("initSuperwall → BEFORE configure");
      await Superwall.configure({ apiKey: SUPERWALL_API_KEY });
      _configureDone = true;
      log("initSuperwall → AFTER configure success — Superwall is initialized");
      return true;
    } catch (err) {
      warn("initSuperwall → configure FAILED:", describeError("configure", err));
      return false;
    }
  } catch (err) {
    warn("initSuperwall → outer catch:", describeError("initSuperwall", err));
    return false;
  }
}

/**
 * Identify the current EcoLogic user to Superwall.
 * Idempotent — repeated calls with the same userId no-op.
 * Lazy-configures Superwall if not yet configured.
 */
export async function identifySuperwallUser(
  userId: string | number,
  email?: string | null,
): Promise<void> {
  try {
    if (!isNativePlatform()) return;
    const uid = String(userId);
    if (!uid) {
      warn("identifySuperwallUser → empty userId, skipping");
      return;
    }
    if (_identifiedUserId === uid) {
      // Already identified as this user — no-op.
      return;
    }
    if (!_configureDone) {
      log(`identifySuperwallUser(${uid}) → SDK not ready, attempting lazy init`);
      const ok = await initSuperwall();
      if (!ok) {
        warn(`identifySuperwallUser(${uid}) → lazy init failed, dropping identify`);
        return;
      }
    }
    const Superwall = await loadPluginAsync();
    if (!Superwall) {
      warn(`identifySuperwallUser(${uid}) → plugin unavailable, dropping identify`);
      return;
    }

    try {
      log(`identifySuperwallUser → BEFORE identify userId=${uid}`);
      await Superwall.identify({ userId: uid });
      _identifiedUserId = uid;
      log(`identifySuperwallUser → AFTER identify success userId=${uid}`);
    } catch (err) {
      warn(`identifySuperwallUser(${uid}) → identify FAILED:`, describeError("identify", err));
      return;
    }

    if (email) {
      try {
        log(`identifySuperwallUser → BEFORE setUserAttributes email=${email}`);
        await Superwall.setUserAttributes({ attributes: { email } });
        log(`identifySuperwallUser → AFTER setUserAttributes success`);
      } catch (err) {
        warn(`identifySuperwallUser → setUserAttributes FAILED:`, describeError("setUserAttributes", err));
      }
    }
  } catch (err) {
    warn(`identifySuperwallUser → outer catch:`, describeError("identifySuperwallUser", err));
  }
}

/**
 * Clear Superwall identity on logout.
 */
export async function resetSuperwall(): Promise<void> {
  try {
    if (!isNativePlatform()) return;
    if (!_configureDone) {
      // Nothing to reset — SDK was never configured this session.
      _identifiedUserId = null;
      return;
    }
    const Superwall = await loadPluginAsync();
    if (!Superwall) {
      _identifiedUserId = null;
      return;
    }
    try {
      log("resetSuperwall → BEFORE reset");
      await Superwall.reset();
      _identifiedUserId = null;
      log("resetSuperwall → AFTER reset success");
    } catch (err) {
      warn("resetSuperwall → reset FAILED:", describeError("reset", err));
    }
  } catch (err) {
    warn("resetSuperwall → outer catch:", describeError("resetSuperwall", err));
  }
}
