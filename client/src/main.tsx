import { createRoot } from "react-dom/client";
import App from "./App";
import PublicSignApp from "./public/PublicSignApp";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { captureAttributionFromUrl } from "@/lib/attribution";
import "./index.css";

// ── Attribution capture (first-touch, runs before any React mount) ──────────
// Reads ?ref / ?source / ?campaign from the URL and persists them to
// localStorage + cookie for 90 days. First-touch wins. Skipped on dashboard
// hostnames. Wrapped in try/catch — must never block app boot.
try {
  captureAttributionFromUrl();
} catch (e) {
  console.warn("[attribution] boot-time capture failed (ignored):", e);
}

// Global error handlers to catch any crashes
window.addEventListener("error", (e) => {
  console.error("[GlobalError]", e.error || e.message, e);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[UnhandledRejection]", e.reason);
});

// Google Maps auth-failure handler — fires BEFORE "This page can't load Google Maps correctly"
// popup appears. The error code reveals the exact cause:
//   RefererNotAllowedMapError  → API key restricted to specific domains, current origin not allowed
//   InvalidKeyMapError         → API key is malformed or wrong
//   MissingKeyMapError         → No API key passed to the loader
//   ApiNotActivatedMapError    → Maps JavaScript API not enabled on the Cloud project
//   BillingNotEnabledMapError  → Billing not enabled on the Cloud project
(window as any).gm_authFailure = function () {
  console.error(
    "[GoogleMaps][gm_authFailure] API key authentication FAILED.",
    "| error code may be one of: RefererNotAllowedMapError, InvalidKeyMapError, MissingKeyMapError, ApiNotActivatedMapError, BillingNotEnabledMapError",
    "| current origin:", window.location.origin,
    "| host:", window.location.hostname,
    "| key suffix:", (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").slice(-6) || "(empty)",
    "| window.google present:", !!(window as any).google,
  );
};

// ── Maps API proactive preload ──────────────────────────────────────────────
// Inject the Maps JS API script immediately (before React mounts) so that
// gm_authFailure fires on every page load and we can capture the exact error
// code in browser logs.  Uses id='google-map-script' — the same id that
// @react-google-maps/api uses — so the library deduplicates and never injects
// a second script tag.
(function injectMapsPreload() {
  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!mapsKey) {
    console.error("[GoogleMaps][preload] VITE_GOOGLE_MAPS_API_KEY is EMPTY — Maps cannot load");
    return;
  }
  if (document.getElementById("google-map-script")) return; // already injected
  (window as any).__ecologicMapsInit = function () {
    const g = (window as any).google;
    console.log(
      "[GoogleMaps][preload] Maps API loaded OK",
      "| origin:", window.location.origin,
      "| key suffix:", mapsKey.slice(-6),
      "| google.maps:", !!g?.maps,
      "| google.maps.places:", !!g?.maps?.places,
    );
  };
  const s = document.createElement("script");
  s.id = "google-map-script";
  s.async = true;
  s.src = `https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places&callback=__ecologicMapsInit`;
  s.onerror = (e) => console.error("[GoogleMaps][preload] Script onerror — possible network block or bad URL", e);
  document.head.appendChild(s);
  console.log("[GoogleMaps][preload] Script tag injected",
    "| key suffix:", mapsKey.slice(-6),
    "| src (key redacted):", s.src.replace(mapsKey, "REDACTED"));
})();

// Returns true ONLY for Capacitor native (iOS/Android).
// Web always uses session cookies — Bearer is never needed on web.
// (The canvas/picard origin uses the same Express process as production, so
//  exchange-code via relative URL creates a same-domain session cookie.)
function shouldAttachBearer(): boolean {
  try {
    const cap = (window as any).Capacitor;
    return !!(cap?.getPlatform?.() && cap.getPlatform() !== "web");
  } catch {
    return false;
  }
}

// On web startup: immediately clear any stale nativeSessionId from prior attempts.
// Web auth uses session cookies exclusively; a leftover nativeSessionId would cause
// every fetch to hit MobileAuth with a dead token and return 401.
;(() => {
  try {
    if (!shouldAttachBearer()) {
      const stale = (typeof localStorage !== "undefined") && localStorage.getItem("nativeSessionId");
      if (stale) {
        console.log("[auth/user][client] source=main.tsx startup: clearing stale nativeSessionId on web — native=false origin=" + window.location.origin);
        localStorage.removeItem("nativeSessionId");
      }
    }
  } catch {}
})();

// Global fetch interceptor — automatically attaches Bearer token to every
// same-origin API request so native sessions work without modifying each fetch call.
// Only fires when shouldAttachBearer() is true (native or cross-domain web preview).
// Also logs a stack trace whenever POST /api/logout is called so we can identify
// the exact caller when logout fires unexpectedly.
(function installFetchInterceptor() {
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
      const method = (init?.method || "GET").toUpperCase();

      // Diagnostic: capture stack trace for every logout call
      if (method === "POST" && (url === "/api/logout" || url.endsWith("/api/logout"))) {
        console.log("[logout][client] POST /api/logout intercepted — stack trace follows:");
        console.trace("[logout][client] logout call site");
      }

      const isSameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
      if (isSameOrigin && shouldAttachBearer()) {
        const sid = localStorage.getItem("nativeSessionId");
        if (sid) {
          const existingHeaders = (init?.headers || {}) as Record<string, string>;
          if (!existingHeaders["Authorization"]) {
            init = { ...init, headers: { ...existingHeaders, Authorization: `Bearer ${sid}` } };
          }
        }
      }
    } catch {
      // never break fetch
    }
    return _fetch(input, init);
  };
})();

import { initPushDebug } from "./utils/pushDebug";

(() => {
  try {
    const isCapacitor = !!(window as any).Capacitor;
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isCapacitor && isIOS) {
      document.documentElement.classList.add("native-ios");
      document.documentElement.setAttribute("data-native", "1");
      document.documentElement.style.setProperty("--native-safe-top", "56px");
    }
  } catch {}
})();

// ── Native StatusBar config ──────────────────────────────────────────────────
// Force a white status bar with dark icons/text on every native launch.
// Safe-no-op on web. Wrapped in its own catch so any plugin error can't ever
// block the app from rendering.
//   • setOverlaysWebView(false) — keep the WebView below the status bar
//   • setBackgroundColor('#FFFFFF') — Android only (iOS uses ios.backgroundColor
//     in capacitor.config to paint the area behind the status bar)
//   • setStyle(Style.Light) — "LIGHT" means dark text/icons for light bg
(async () => {
  try {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    try { await StatusBar.setOverlaysWebView({ overlay: false }); } catch (e) { console.warn("[statusBar] setOverlaysWebView failed:", e); }
    try { await StatusBar.setBackgroundColor({ color: "#FFFFFF" }); } catch (e) { console.warn("[statusBar] setBackgroundColor failed (expected no-op on iOS):", e); }
    try { await StatusBar.setStyle({ style: Style.Light }); } catch (e) { console.warn("[statusBar] setStyle failed:", e); }
    console.log("[statusBar] configured: overlay=false bg=#FFFFFF style=Light");
  } catch (e) {
    console.warn("[statusBar] init outer catch:", e);
  }
})();

console.log("[main.tsx] Starting app initialization, pathname:", window.location.pathname);

initPushDebug();

// App version for cache-busting (update this when deploying significant changes)
// 2026.04.29.1 — bumped to force cache clear after AppsFlyer Phase 2 diagnostic deploy
// 2026.04.29.2 — force-reload after appsflyer.ts availability-gate rewrite
const APP_VERSION = "2026.04.29.2";

// Returns true when running inside the Capacitor native shell (iOS or Android).
function isCapacitorNative(): boolean {
  try {
    const cap = (window as any).Capacitor;
    return !!(cap?.isNativePlatform?.() || (cap?.getPlatform?.() && cap.getPlatform() !== "web"));
  } catch {
    return false;
  }
}

// Version check and cache-bust mechanism
const checkAndClearCache = async () => {
  try {
    const storedVersion = localStorage.getItem("ecologic_app_version");

    if (storedVersion !== APP_VERSION) {
      console.log(`[cache] Version change detected: ${storedVersion} -> ${APP_VERSION}`);
      localStorage.setItem("ecologic_app_version", APP_VERSION);

      // Clear old caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log("[cache] Cleared browser caches");
      }

      if (isCapacitorNative()) {
        // On native (iOS/Android) the WKWebView / WebView loads from a remote
        // staging URL.  When a new bundle is deployed the WKWebView HTTP disk
        // cache may still serve the old index.html (and therefore old JS
        // hashes) regardless of max-age=0 headers.  The AppDelegate native
        // wipe clears the disk cache on first launch after a version bump, but
        // as a belt-and-suspenders measure we reload here too so the fresh
        // assets are guaranteed to load once the wipe has fired.
        //
        // This runs BEFORE ReactDOM.createRoot(), so there is no partially-
        // mounted React tree to worry about — reload is safe at this point.
        if (storedVersion) {
          // Only reload on upgrade (storedVersion != null) to avoid an
          // infinite reload loop on first install where storedVersion is null.
          console.log("[cache] Native version change — reloading WKWebView to fetch fresh bundle");
          window.location.reload();
          return false;
        }
      } else if (storedVersion && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
        console.log("[cache] Unregistered old service workers, reloading...");
        window.location.reload();
        return false; // Don't render, we're reloading
      }
    }
  } catch (e) {
    // Never let cache-busting block the app from rendering
    console.warn("[cache] checkAndClearCache error (ignored):", e);
  }
  return true;
};

// Check if this is a public signing route - render standalone component
const isPublicSignRoute = window.location.pathname.startsWith('/sign/');
// Check if this is a public unsubscribe route - render standalone component
const isPublicUnsubscribeRoute = window.location.pathname.startsWith('/unsubscribe/') || window.location.pathname === '/unsubscribe';
// Check if this is a public email preferences route - render standalone component
const isPublicPreferencesRoute = window.location.pathname.startsWith('/email-preferences');
// Check if this is a password reset route - render standalone component
const isPasswordResetRoute = window.location.pathname.startsWith('/reset-password');
// Check if this is a two-factor verification route - render standalone component
const isTwoFactorRoute = window.location.pathname === '/two-factor';
// Check if this is a Stripe return route or public route - skip cache-busting to avoid reload loops
const isPayoutSetupRoute = window.location.pathname.startsWith('/payout-setup/');
const isPublicRoute = window.location.pathname.startsWith('/stripe/') || 
                      window.location.pathname.startsWith('/pay/') ||
                      window.location.pathname.startsWith('/unsubscribe') ||
                      window.location.pathname.startsWith('/email-preferences') ||
                      window.location.pathname.startsWith('/reset-password') ||
                      window.location.pathname.startsWith('/payout-setup/') ||
                      window.location.pathname === '/two-factor';

// Initialize app with cache check
const initApp = async () => {
  // Skip cache-busting for payment/public routes to prevent reload loops
  if (!isPublicRoute) {
    const shouldRender = await checkAndClearCache();
    if (!shouldRender) return; // Page is reloading
  } else {
    console.log("[main.tsx] Public route detected, skipping cache check");
  }
  
  const rootEl = document.getElementById("root");
  console.log("[main.tsx] Root element:", rootEl);
  
  if (!rootEl) {
    document.body.innerHTML = '<div style="padding:40px;font-family:system-ui;color:red;">FATAL: No #root element found</div>';
    return;
  }
  
  const root = createRoot(rootEl);
  
  if (isPublicSignRoute) {
    console.log("[main.tsx] Public sign route detected, rendering PublicSignApp");
    root.render(<ErrorBoundary><PublicSignApp /></ErrorBoundary>);
  } else if (isPublicUnsubscribeRoute) {
    console.log("[main.tsx] Public unsubscribe route detected, rendering PublicUnsubscribe");
    const PublicUnsubscribe = (await import("./pages/PublicUnsubscribe")).default;
    root.render(<ErrorBoundary><PublicUnsubscribe /></ErrorBoundary>);
  } else if (isPublicPreferencesRoute) {
    console.log("[main.tsx] Public preferences route detected, rendering PublicEmailPreferences");
    const PublicEmailPreferences = (await import("./pages/PublicEmailPreferences")).default;
    root.render(<ErrorBoundary><PublicEmailPreferences /></ErrorBoundary>);
  } else if (isPasswordResetRoute) {
    console.log("[main.tsx] Password reset route detected, rendering ResetPassword directly");
    const ResetPassword = (await import("./pages/ResetPassword")).default;
    root.render(<ErrorBoundary><ResetPassword /></ErrorBoundary>);
  } else if (isTwoFactorRoute) {
    console.log("[main.tsx] Two-factor route detected, rendering TwoFactor directly");
    const TwoFactor = (await import("./pages/TwoFactor")).default;
    root.render(<ErrorBoundary><TwoFactor /></ErrorBoundary>);
  } else if (isPayoutSetupRoute) {
    console.log("[main.tsx] Payout setup route detected, rendering PayoutSetup directly");
    const PayoutSetup = (await import("./pages/PayoutSetup")).default;
    const setupToken = window.location.pathname.split('/payout-setup/')[1]?.split('?')[0] || '';
    root.render(<ErrorBoundary><PayoutSetup token={setupToken} /></ErrorBoundary>);
  } else {
    console.log("[main.tsx] Rendering main App");
    root.render(<ErrorBoundary><App /></ErrorBoundary>);
  }
};

initApp().catch((err) => {
  console.error("[main.tsx] initApp fatal error:", err);
  // Last-resort fallback: if initApp throws before React mounts, show an error
  // instead of leaving the screen blank.
  const rootEl = document.getElementById("root");
  if (rootEl && !rootEl.hasChildNodes()) {
    rootEl.innerHTML = '<div style="padding:40px;font-family:system-ui;color:#cc0000;font-size:14px;">EcoLogic failed to start. Please close and reopen the app.</div>';
  }
});
