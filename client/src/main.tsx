import { createRoot } from "react-dom/client";
import App from "./App";
import PublicSignApp from "./public/PublicSignApp";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./index.css";
import "./i18n/config";

// Global error handlers to catch any crashes
window.addEventListener("error", (e) => {
  console.error("[GlobalError]", e.error || e.message, e);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[UnhandledRejection]", e.reason);
});

console.log("[main.tsx] Starting app initialization, pathname:", window.location.pathname);

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
// Check if this is a Stripe return route or public route - skip cache-busting to avoid reload loops
const isPublicRoute = window.location.pathname.startsWith('/stripe/') || 
                      window.location.pathname.startsWith('/pay/') ||
                      window.location.pathname.startsWith('/unsubscribe') ||
                      window.location.pathname.startsWith('/email-preferences');

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
  
  // CANARY: Always render a visible banner first to confirm React works
  const CanaryBanner = () => (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:99999,background:"#000",color:"#0f0",padding:"8px 12px",fontFamily:"monospace",fontSize:"12px"}}>
      React Mounted ✅ | Path: {window.location.pathname}
    </div>
  );
  
  if (isPublicSignRoute) {
    console.log("[main.tsx] Public sign route detected, rendering PublicSignApp");
    root.render(<ErrorBoundary><CanaryBanner /><PublicSignApp /></ErrorBoundary>);
  } else if (isPublicUnsubscribeRoute) {
    console.log("[main.tsx] Public unsubscribe route detected, rendering PublicUnsubscribe");
    const PublicUnsubscribe = (await import("./pages/PublicUnsubscribe")).default;
    root.render(<ErrorBoundary><CanaryBanner /><PublicUnsubscribe /></ErrorBoundary>);
  } else if (isPublicPreferencesRoute) {
    console.log("[main.tsx] Public preferences route detected, rendering PublicEmailPreferences");
    const PublicEmailPreferences = (await import("./pages/PublicEmailPreferences")).default;
    root.render(<ErrorBoundary><CanaryBanner /><PublicEmailPreferences /></ErrorBoundary>);
  } else {
    console.log("[main.tsx] Rendering main App");
    root.render(<ErrorBoundary><CanaryBanner /><App /></ErrorBoundary>);
  }
};

initApp();
