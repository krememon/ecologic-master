import { createRoot } from "react-dom/client";
import App from "./App";
import PublicSignApp from "./public/PublicSignApp";
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
// Check if this is a Stripe return route - skip cache-busting to avoid reload loops
const isStripeReturnRoute = window.location.pathname.startsWith('/stripe/') || 
                           window.location.pathname.startsWith('/pay/');

// Initialize app with cache check
const initApp = async () => {
  // Skip cache-busting for payment return routes to prevent reload loops
  if (!isStripeReturnRoute) {
    const shouldRender = await checkAndClearCache();
    if (!shouldRender) return; // Page is reloading
  } else {
    console.log("[main.tsx] Payment return route detected, skipping cache check");
  }
  
  if (isPublicSignRoute) {
    console.log("[main.tsx] Public sign route detected, rendering PublicSignApp");
    createRoot(document.getElementById("root")!).render(<PublicSignApp />);
  } else {
    createRoot(document.getElementById("root")!).render(<App />);
  }
};

initApp();
