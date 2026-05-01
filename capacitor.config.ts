import type { CapacitorConfig } from '@capacitor/cli';

const HOSTED_APP_URL = process.env.VITE_CAP_HOSTED_URL || 'https://app.ecologicc.com';

// ── Local debug mode ─────────────────────────────────────────────────────────
// When CAP_LOCAL_DEBUG=1 is exported in the shell that runs `npx cap sync`,
// the WKWebView loads the locally-bundled JS from `webDir` (dist/public) instead
// of the remote production site.  This is the only way to see local JS changes
// (AppsFlyer logs, etc.) in Xcode before they're deployed to app.ecologicc.com.
//
// For production iOS / Android builds, do NOT set this flag — the default
// behaviour (loading from HOSTED_APP_URL) is preserved exactly as before.
const USE_LOCAL_BUNDLE =
  process.env.CAP_LOCAL_DEBUG === '1' ||
  process.env.CAP_LOCAL_DEBUG === 'true';

const config: CapacitorConfig = {
  appId: 'com.ecologic.app',
  appName: 'EcoLogic',
  webDir: 'dist/public',
  server: USE_LOCAL_BUNDLE
    ? {
        // No `url` → Capacitor loads the bundled JS from webDir
        androidScheme: 'https',
      }
    : {
        url: HOSTED_APP_URL,
        cleartext: false,
        androidScheme: 'https',
        allowNavigation: [
          'app.ecologicc.com',
          'staging.ecologicc.com',
          'dashboard.ecologicc.com',
          'staging-dashboard.ecologicc.com',
          'ecologicc.com',
          'accounts.google.com',
          'appleid.apple.com',
        ],
      },
  ios: {
    // Native UIWindow background. Without this, the area iOS reserves for the
    // status bar (when overlaysWebView=false) defaults to black, producing the
    // black strip across the top of the screen on iPhone.
    backgroundColor: '#FFFFFF',
    // Disable the WKWebView outer UIScrollView entirely. This is the only
    // reliable way to kill the rubber-band/bounce effect at the native layer
    // on iOS — `overscroll-behavior: none` in CSS is not respected by every
    // iOS version for the document root. With this flag, the WebView itself
    // never scrolls, never bounces, and the header (which lives outside the
    // app's inner scroll container) cannot be dragged. CSS `overflow-y: auto`
    // on inner panes still works because WebKit handles those scrolls
    // independently of the outer UIScrollView.
    scrollEnabled: false,
    // Tell WKWebView never to apply automatic safe-area content insets — the
    // app handles safe-area padding itself via env(safe-area-inset-*). This
    // also prevents iOS from injecting any phantom top/bottom inset that
    // could re-introduce a scrollable region above the header.
    contentInset: 'never',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',           // dark icons/text for our white status bar
      backgroundColor: '#FFFFFF', // Android only — iOS uses ios.backgroundColor above
    },
  },
};

export default config;
