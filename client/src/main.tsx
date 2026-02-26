import { createRoot } from "react-dom/client";
import App from "./App";
import PublicSignApp from "./public/PublicSignApp";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./index.css";

// Global error handlers to catch any crashes
window.addEventListener("error", (e) => {
  console.error("[GlobalError]", e.error || e.message, e);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[UnhandledRejection]", e.reason);
});

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

console.log("[main.tsx] Starting app initialization, pathname:", window.location.pathname);

initPushDebug();

// App version for cache-busting (update this when deploying significant changes)
const APP_VERSION = "2026.01.14.3";

// Version check and cache-bust mechanism
const checkAndClearCache = async () => {
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
    
    // Unregister old service workers and reload only if coming from a different version
    if (storedVersion && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
      console.log("[cache] Unregistered old service workers, reloading...");
      window.location.reload();
      return false; // Don't render, we're reloading
    }
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

initApp();
