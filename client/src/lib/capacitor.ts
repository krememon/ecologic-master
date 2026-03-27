import { Capacitor } from "@capacitor/core";
import { queryClient } from "@/lib/queryClient";

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getPlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
}

export function getApiBaseUrl(): string {
  if (isNativePlatform()) {
    // Always use the stable production URL for native apps so that the Google
    // OAuth nonce flow (start auth → browser → callback → poll → exchange) all
    // land on the same server process/in-memory store.  Without this, a dev
    // WebView on the preview domain would start OAuth there, the callback would
    // hit the published domain (a different process), the nonce code would be
    // stored in the published process's memory, and the poll from the preview
    // process would never find it.
    const configured = import.meta.env.VITE_APP_BASE_URL as string | undefined;
    const resolved = configured || window.location.origin;
    return resolved;
  }
  return "";
}

export function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

let activePollInterval: ReturnType<typeof setInterval> | null = null;
let activePollTimeout: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;

export function stopPolling(): void {
  if (activePollInterval) {
    clearInterval(activePollInterval);
    activePollInterval = null;
  }
  if (activePollTimeout) {
    clearTimeout(activePollTimeout);
    activePollTimeout = null;
  }
  pollInFlight = false;
}

function isInsideIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

async function openGoogleAuthPopup(): Promise<void> {
  const width = 500;
  const height = 700;
  const left = Math.max(0, Math.round((screen.width - width) / 2));
  const top = Math.max(0, Math.round((screen.height - height) / 2));
  const features = `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes`;

  console.log("[google-auth] Opening popup");
  const popup = window.open("/api/auth/google?platform=popup", "googleSignIn", features);

  if (!popup || popup.closed) {
    console.log("[google-auth] Popup blocked — falling back to redirect");
    window.location.href = "/api/auth/google";
    return;
  }

  return new Promise((resolve) => {
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(closedPoll);
    };

    // Accept messages from same origin OR any trusted Replit domain.
    // VITE_APP_BASE_URL may not be set in dev/preview environments (picard canvas), so we
    // cannot rely on it for origin filtering. Instead we accept messages from any *.replit.app
    // or *.replit.dev origin alongside same-origin — all are within the Replit trust boundary.
    // The message type check + code validation provide the real security gate.
    const prodOriginHint = ((import.meta.env.VITE_APP_BASE_URL as string) || "").replace(/\/$/, "");
    const onMessage = async (event: MessageEvent) => {
      const isSameOrigin = event.origin === window.location.origin;
      const isProdHint = prodOriginHint && event.origin === prodOriginHint;
      const isTrustedReplit =
        event.origin.endsWith(".replit.app") || event.origin.endsWith(".replit.dev");
      if (!isSameOrigin && !isProdHint && !isTrustedReplit) return;
      if (event.data?.type === "google-auth-success") {
        // ── NEW USER path ──────────────────────────────────────────────────────
        // The Google Strategy found no existing account. The profile has been
        // stored in the server's pendingGoogleRegistrations map. We route the
        // user to the signup wizard where they can review/confirm their info.
        if (event.data?.isNewUser === true) {
          settle();
          const { pendingCode, email, firstName, lastName, profileImageUrl } = event.data as {
            pendingCode: string; email: string; firstName: string; lastName: string; profileImageUrl: string;
          };
          // Persist the Google profile and the origin of the production server so
          // the signup wizard knows where to send the complete-registration request.
          const isCrossDomainNew = !isSameOrigin;
          sessionStorage.setItem("googlePendingProfile", JSON.stringify({
            pendingCode,
            email,
            firstName,
            lastName,
            profileImageUrl,
            // Only set senderOrigin if cross-domain so the wizard can call the production endpoint
            senderOrigin: isCrossDomainNew ? event.origin : null,
          }));
          console.log(`[auth/user][client] source=capacitor.ts isNewUser=true → navigating to /signup pendingCode=${pendingCode.substring(0, 8)}…`);
          // Navigate to the signup wizard on the current (picard or production) origin
          window.location.href = "/signup";
          resolve();
          return;
        }
        // ── EXISTING USER path ─────────────────────────────────────────────────
        settle();
        const code = event.data.webAuthCode as string | undefined;
        if (code) {
          // Web popup completion — two-step session handoff for cross-domain preview/canvas:
          //
          // The picard canvas and the production server are SEPARATE Node processes with
          // SEPARATE in-memory authCodeStores. The webAuthCode was stored in the PRODUCTION
          // server's authCodeStore, so exchange-code MUST be called on the production server.
          // After exchange, we adopt the resulting production session into the LOCAL (picard)
          // server via POST /api/auth/adopt-session — picard looks up the session from the
          // shared PostgreSQL table and runs req.login() to issue a picard-domain cookie.
          //
          // Same-domain: both steps collapse into one relative call (single process).
          // Native: handled separately by exchangeNativeAuthCode() — not this path.
          //
          // isCrossDomain is derived from the actual message origin, NOT from VITE_APP_BASE_URL,
          // so it works even when the env var is absent (picard canvas dev environment).
          const isCrossDomain = !isSameOrigin;
          const senderOrigin = event.origin; // actual production server origin
          console.log(`[auth/user][client] source=capacitor.ts native=false origin=${window.location.origin} isCrossDomain=${isCrossDomain} senderOrigin=${senderOrigin} attachBearer=false`);
          try {
            const exchangeUrl = isCrossDomain
              ? `${senderOrigin}/api/auth/exchange-code`
              : "/api/auth/exchange-code";
            const exchRes = await fetch(exchangeUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code }),
              credentials: "include",
            });
            if (exchRes.ok) {
              const data = await exchRes.json().catch(() => ({}));
              if (isCrossDomain && data.sessionId) {
                // Adopt the production session into the local picard server
                const adoptRes = await fetch("/api/auth/adopt-session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sessionId: data.sessionId }),
                  credentials: "include",
                });
                if (adoptRes.ok) {
                  console.log("[auth/user][client] source=capacitor.ts adopt-session OK — picard session cookie set, no Bearer stored");
                } else {
                  console.warn("[auth/user][client] source=capacitor.ts adopt-session failed:", adoptRes.status);
                }
              } else {
                console.log("[auth/user][client] source=capacitor.ts exchange-code OK — same-domain session cookie set");
              }
            } else {
              console.warn("[auth/user][client] source=capacitor.ts exchange-code failed:", exchRes.status);
            }
          } catch (e) {
            console.warn("[auth/user][client] source=capacitor.ts exchange error:", e);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        resolve();
      } else if (event.data?.type === "google-auth-error") {
        settle();
        resolve();
      }
    };

    window.addEventListener("message", onMessage);

    const closedPoll = setInterval(() => {
      try {
        if (popup.closed) {
          settle();
          // Safety net: attempt an auth refetch even when the popup closes without a
          // postMessage (e.g. cross-domain delivery failure or user-dismissed popup).
          // If auth actually succeeded the session/Bearer token is now available and
          // the refetch will pick it up. If the user cancelled it returns 401 — no change.
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          resolve();
        }
      } catch {}
    }, 800);
  });
}

// ─── Native Google auth completion state ─────────────────────────────────────
//
// Two completion paths can fire for the same sign-in attempt:
//   A) ecologic:// deep link  → appUrlOpen → handleAuthCallbackUrl (App.tsx)
//   B) background poll        → interval → exchangeNativeAuthCode (here)
//
// Both ultimately call exchangeNativeAuthCode(code). We must ensure the code
// is exchanged EXACTLY ONCE. We use a per-code Set (not a boolean flag) so
// that even if both paths race past "am I already handling this?" at the same
// tick — whichever inserts into the Set first wins; the other returns immediately.
//
// localStorage key survives window.location.href reloads so that iOS's
// getLaunchUrl() — which permanently returns the original launch URL — cannot
// re-trigger an already-consumed one-time code.

const AUTH_CODE_CONSUMED_KEY = "nativeAuthCodeConsumed";
const _inFlightCodes = new Set<string>(); // per-code in-flight dedup
let _authHandled = false;                 // session-level flag (belt + suspenders)

export function resetAuthHandled(): void {
  _authHandled = false;
  // _inFlightCodes intentionally NOT cleared — a code in flight must stay locked
}

export async function exchangeNativeAuthCode(
  code: string,
  source: "deep-link" | "poll" | "cold-start" = "deep-link",
): Promise<void> {
  // ── Guard A: cross-reload dedup ────────────────────────────────────────────
  if (localStorage.getItem(AUTH_CODE_CONSUMED_KEY) === code) return;

  // ── Guard B: per-code concurrent dedup ─────────────────────────────────────
  if (_inFlightCodes.has(code)) return;
  _inFlightCodes.add(code);

  // ── Guard C: session-level flag (belt + suspenders) ─────────────────────────
  if (_authHandled) {
    _inFlightCodes.delete(code);
    return;
  }
  _authHandled = true;
  stopPolling();

  const exchangeBaseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${exchangeBaseUrl}/api/auth/exchange-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.sessionId) {
        localStorage.setItem("nativeSessionId", data.sessionId);
        console.log("[google-auth] nativeSessionId stored — user is authenticated");
      } else {
        console.warn("[google-auth] Exchange OK but no sessionId in response");
      }
      // Write BEFORE reloading so Guard A blocks any concurrent/post-reload re-attempt.
      localStorage.setItem(AUTH_CODE_CONSUMED_KEY, code);

      const { queryClient } = await import("@/lib/queryClient");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      console.log("[google-auth] Auth complete — navigating into app");
      const pendingLink = sessionStorage.getItem("pendingDeepLink");
      if (pendingLink) {
        sessionStorage.removeItem("pendingDeepLink");
        window.location.href = pendingLink;
      } else {
        window.location.href = "/";
      }
    } else {
      const body = await res.text().catch(() => "");
      console.error("[google-auth] Exchange failed:", res.status, body);
      _authHandled = false;
      _inFlightCodes.delete(code);

      // If nativeSessionId already exists the code was consumed by the other
      // completion path that raced us. The user IS authenticated — don't bounce
      // them to the login screen.
      const existingSession = localStorage.getItem("nativeSessionId");
      if (existingSession) {
        console.log("[google-auth] 401 but nativeSessionId exists — already authenticated, going to /");
        window.location.href = "/";
        return;
      }
      window.location.href = "/login?error=exchange_failed";
    }
  } catch (err) {
    console.error("[google-auth] Exchange fetch error:", err);
    _authHandled = false;
    _inFlightCodes.delete(code);
    const existingSession = localStorage.getItem("nativeSessionId");
    if (existingSession) {
      window.location.href = "/";
      return;
    }
    window.location.href = "/login?error=exchange_failed";
  }
}

export async function startGoogleAuthNative(): Promise<void> {
  if (!isNativePlatform()) {
    if (isInsideIframe()) {
      // Determine the production base URL for the OAuth request.
      // When the page is already served from the production domain (not Replit, not localhost),
      // use the current origin directly so auth always originates from the correct branded domain.
      // When embedded inside a Replit canvas/picard iframe, fall back to VITE_APP_BASE_URL to
      // bounce the request out to the production domain cross-origin.
      const currentOrigin = window.location.origin;
      const isProductionOrigin =
        !currentOrigin.includes("replit.") &&
        !currentOrigin.includes("localhost") &&
        !currentOrigin.includes("127.0.0.1");
      const configuredBase = ((import.meta.env.VITE_APP_BASE_URL as string) || "").replace(/\/$/, "");
      const appBaseUrl = isProductionOrigin ? currentOrigin : configuredBase;
      if (appBaseUrl) {
        const prodOrigin = appBaseUrl.replace(/\/$/, "");
        const returnTo = encodeURIComponent(window.location.origin);
        // Use platform=popup so the server sends a postMessage completion page (with webAuthCode)
        // rather than redirecting back to the picard/dev origin (which shows a blank page because
        // that URL requires Replit workspace context that the standalone popup window doesn't have).
        const target = `${appBaseUrl}/api/auth/google?platform=popup&returnTo=${returnTo}`;

        // Set up listener BEFORE opening the popup so no messages are missed.
        // The completion page (on the production domain) posts {type:"google-auth-success", webAuthCode}
        // with targetOrigin="*", so this listener receives it cross-origin.
        const onIframePopupMsg = async (event: MessageEvent) => {
          if (event.origin !== prodOrigin) return;
          if (event.data?.type !== "google-auth-success") return;
          window.removeEventListener("message", onIframePopupMsg);
          const code = event.data.webAuthCode as string | undefined;
          if (code) {
            try {
              const res = await fetch(`${prodOrigin}/api/auth/exchange-code`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
                credentials: "include",
              });
              if (res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.sessionId) localStorage.setItem("nativeSessionId", data.sessionId);
              }
            } catch { /* ignore */ }
          }
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        };

        try {
          window.top!.location.href = target;
          return;
        } catch (e) {
          // top-frame navigation blocked (cross-origin canvas) — fall through to popup
        }

        const popup = window.open(target, "ecologic_google_auth", "popup,width=500,height=650");
        if (popup) {
          window.addEventListener("message", onIframePopupMsg);
          return;
        }
        // Popup also blocked — clean up listener and fall back to full-page navigation
        window.removeEventListener("message", onIframePopupMsg);
      }
      window.location.href = "/api/auth/google";
      return;
    }
    // Web (non-iframe): use centered popup with postMessage handshake
    await openGoogleAuthPopup();
    return;
  }

  // ── Native iOS path ──────────────────────────────────────────────────────
  // SFSafariViewController (Capacitor Browser plugin) cannot auto-redirect
  // to custom URL schemes on iOS 13+ without showing an OS dialog. Instead
  // we use a server-side nonce: the app polls the backend every 2 s, and
  // when OAuth completes the server stores the auth code against the nonce.
  // The poll finds the code, closes the browser programmatically, then
  // exchanges the code for a session — no user interaction needed.
  //
  // The bridge page also attempts the ecologic:// deep link as a fast path
  // for iOS versions where it works silently. The appUrlOpen handler in
  // App.tsx calls stopPolling() + exchangeNativeAuthCode() so whichever
  // fires first wins without double-processing.
  resetAuthHandled();
  stopPolling(); // clear any leftover from a previous attempt

  const baseUrl = getApiBaseUrl();
  const nonce   = generateNonce();
  const authUrl = `${baseUrl}/api/auth/google?platform=ios&nonce=${nonce}`;

  console.log("[google-auth] Native: opening browser, nonce=", nonce.substring(0, 8) + "…");

  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: authUrl, presentationStyle: "popover" as any });

    // ── Background poll ──────────────────────────────────────────────────
    // WKWebView timers continue running while SFSafariViewController is
    // shown (it's presented over the app, not backgrounding the app).
    let pollAttempts = 0;
    const MAX_ATTEMPTS = 150; // 5 min at 2 s/poll

    activePollInterval = setInterval(async () => {
      if (_authHandled || pollInFlight) return;
      if (pollAttempts++ >= MAX_ATTEMPTS) {
        console.warn("[google-auth] Poll timeout — giving up");
        stopPolling();
        Browser.close().catch(() => {});
        return;
      }
      pollInFlight = true;
      try {
        const r = await fetch(`${baseUrl}/api/auth/poll-code?nonce=${nonce}`, {
          credentials: "include",
        });
        const d = await r.json().catch(() => ({}));
        if (d.status === "ready" && d.code) {
          // Re-check guards AFTER the async fetch — the deep-link path may have
          // already started exchanging during the await above.
          if (_authHandled || _inFlightCodes.has(d.code) || localStorage.getItem(AUTH_CODE_CONSUMED_KEY) === d.code) {
            stopPolling();
            return;
          }
          stopPolling();
          await Browser.close();
          await exchangeNativeAuthCode(d.code, "poll");
        }
      } catch {
        // network hiccup — ignore and retry
      } finally {
        pollInFlight = false;
      }
    }, 2000);

  } catch (err) {
    console.error("[google-auth] Browser.open failed:", err);
    stopPolling();
    throw err;
  }
}

let pushListenersAdded = false;

export function resetPushRegistration(): void {
  pushListenersAdded = false;
}

let _resumeListenerAdded = false;
let _lastResumeRefreshAt = 0;
const RESUME_REFRESH_THROTTLE_MS = 20_000;

const RESUME_QUERY_KEYS = [
  "/api/jobs",
  "/api/time/my-assignments",
  "/api/estimates",
  "/api/leads",
  "/api/notifications",
  "/api/notifications/unread-count",
  "/api/time/today",
  "/api/time/entries",
  "/api/schedule",
  "/api/org/users",
  "/api/dashboard/stats",
  "/api/company",
];

export async function setupAppResumeRefresh(): Promise<void> {
  if (!isNativePlatform()) return;
  if (_resumeListenerAdded) return;
  _resumeListenerAdded = true;

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      const now = Date.now();
      if (now - _lastResumeRefreshAt < RESUME_REFRESH_THROTTLE_MS) return;
      _lastResumeRefreshAt = now;
      console.log("[app-resume] App foregrounded — refreshing data");
      RESUME_QUERY_KEYS.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: [key] });
      });
    });
    console.log("[app-resume] appStateChange listener registered");
  } catch (e) {
    console.error("[app-resume] Failed to register appStateChange listener:", e);
  }
}

function isUnimplemented(err: any): boolean {
  return err && (err.code === "UNIMPLEMENTED" || (typeof err.message === "string" && err.message.includes("UNIMPLEMENTED")));
}

export type PushResult = {
  success: boolean;
  error?: "unimplemented" | "denied" | "failed";
};

export async function openAppSettings(): Promise<void> {
  try {
    const { App } = await import("@capacitor/app");
    // On iOS, this opens the app's settings page in the Settings app
    // where the user can toggle notification permissions
    await (App as any).openUrl({ url: "app-settings:" });
  } catch (err) {
    console.error("[capacitor] openAppSettings failed:", err);
  }
}

export async function registerPushNotifications(): Promise<PushResult> {
  console.log("[notif] platform", Capacitor.getPlatform(), "native?", isNativePlatform());
  if (!isNativePlatform()) return { success: false, error: "failed" };
  if (Capacitor.getPlatform() === "android") {
    console.log("[push] Android push temporarily skipped until Firebase is configured");
    return { success: false, error: "unimplemented" };
  }

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const { Device } = await import("@capacitor/device");

    console.log("[notif] has PushNotifications", !!PushNotifications);
    console.log("[notif] has LocalNotifications", !!LocalNotifications);

    console.log("[push] Requesting local permissions first...");
    const localPerm = await LocalNotifications.requestPermissions();
    console.log("[push] Local permission result:", localPerm.display);

    console.log("[push] Requesting push permissions...");
    const permResult = await PushNotifications.requestPermissions();
    console.log("[push] Permission result:", permResult.receive);

    if (permResult.receive !== "granted") {
      console.log("[push] Permission denied, skipping registration");
      return { success: false, error: "denied" };
    }

    if (!pushListenersAdded) {
      PushNotifications.addListener("registration", async (token) => {
        console.log("[push] Got APNs token:", token.value.substring(0, 20) + "...");
        const deviceInfo = await Device.getId();
        const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";

        const lastToken = localStorage.getItem("pushToken");
        if (lastToken === token.value) {
          console.log("[push] Token unchanged, skipping re-register");
          return;
        }

        try {
          const nativeSid = localStorage.getItem("nativeSessionId");
          const bearerHeaders: Record<string, string> = nativeSid
            ? { Authorization: `Bearer ${nativeSid}` }
            : {};
          const res = await fetch("/api/push/register", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...bearerHeaders },
            credentials: "include",
            body: JSON.stringify({
              token: token.value,
              platform,
              deviceId: deviceInfo.identifier,
            }),
          });
          const data = await res.json();
          console.log("[push] Token registered with backend:", data);
          localStorage.setItem("pushToken", token.value);
        } catch (err) {
          console.error("[push] Failed to register token with backend:", err);
        }
      });

      PushNotifications.addListener("registrationError", (error) => {
        console.error("[push] Registration error:", error);
      });

      PushNotifications.addListener("pushNotificationReceived", async (notification) => {
        console.log("[push] Notification received in foreground:", notification);
        try {
          const { LocalNotifications } = await import("@capacitor/local-notifications");
          await LocalNotifications.schedule({
            notifications: [
              {
                title: notification.title || "EcoLogic",
                body: notification.body || "",
                id: Date.now() % 2147483647,
                extra: notification.data,
              },
            ],
          });
        } catch (err) {
          console.error("[push] Failed to show local notification for foreground push:", err);
        }
      });

      PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        console.log("[push] Notification tapped:", action);
        _lastResumeRefreshAt = Date.now();
        RESUME_QUERY_KEYS.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
        const data = action.notification.data;
        if (data?.linkUrl) {
          window.location.href = data.linkUrl;
        }
      });

      pushListenersAdded = true;
    }

    await PushNotifications.register();
    console.log("[push] Registration requested");
    return { success: true };
  } catch (err: any) {
    console.error("[push] Push setup failed:", err);
    if (isUnimplemented(err)) {
      return { success: false, error: "unimplemented" };
    }
    return { success: false, error: "failed" };
  }
}

export type LocalNotifResult = {
  success: boolean;
  error?: "unimplemented" | "denied" | "failed";
};

export async function scheduleLocalTestNotification(): Promise<LocalNotifResult> {
  console.log("[notif] testLocal platform", Capacitor.getPlatform(), "native?", isNativePlatform());
  if (!isNativePlatform()) return { success: false, error: "failed" };

  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    console.log("[notif] LocalNotifications plugin loaded");

    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") {
      console.log("[push] Local notification permission denied");
      return { success: false, error: "denied" };
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          title: "EcoLogic",
          body: "Notifications are working.",
          id: Date.now() % 2147483647,
          schedule: { at: new Date(Date.now() + 2000) },
        },
      ],
    });
    console.log("[push] Local test notification scheduled");
    return { success: true };
  } catch (err: any) {
    console.error("[push] Local notification failed:", err);
    if (isUnimplemented(err)) {
      return { success: false, error: "unimplemented" };
    }
    return { success: false, error: "failed" };
  }
}

/**
 * Fetch the PDF and present the native iOS share/save sheet (Files, AirDrop, Notes…)
 * entirely inside the app — never opens Safari or any external link on native.
 *
 * Strategy (in order):
 *  1. On native: fetch via the dedicated authenticated API endpoint (Bearer token),
 *     then try Web Share API (works in iOS WKWebView without plugin sync),
 *     then fall back to Capacitor Filesystem + Share plugins.
 *  2. On web: programmatic anchor-click download (unchanged).
 *
 * @param url            Web URL for the anchor-click download path (non-native).
 * @param filename       Suggested filename for the downloaded/shared PDF.
 * @param nativeEndpoint Optional relative API endpoint (e.g. "/api/jobs/3/invoice/pdf/download")
 *                       used exclusively on native iOS/Android. This endpoint is auth-gated,
 *                       returns the PDF bytes, and is called with the Bearer token so the
 *                       native Capacitor WebView can authenticate the request correctly.
 *                       If omitted, the raw `url` is used as a fallback for native too.
 */
export async function nativePdfShare(
  url: string,
  filename: string,
  nativeEndpoint?: string,
): Promise<boolean> {
  // Sanitise filename — preserve dots and dashes, replace everything else.
  const safeFilename = (filename || "document.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.pdf$/i, "") + ".pdf";

  // ── Non-native web path ──────────────────────────────────────────────────
  // Simple anchor-click download. window.open is acceptable here because the
  // user is already in a regular browser tab.
  if (!isNativePlatform()) {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = safeFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("[pdf-share] Web anchor download failed:", err);
      window.open(url, "_blank");
    }
    return false;
  }

  // ── Native path (iOS / Android) ──────────────────────────────────────────
  // Use the dedicated authenticated API endpoint if provided.
  // Fall back to the raw URL only if no endpoint was specified.
  const baseUrl = getApiBaseUrl();

  // Build the absolute URL to fetch from
  const rawTarget = nativeEndpoint ?? url;
  const fullUrl = rawTarget.startsWith("http") ? rawTarget : `${baseUrl}${rawTarget}`;

  // Include Bearer token so the native WebView's Capacitor fetch authenticates properly.
  // The native app stores its session as "nativeSessionId" in localStorage — standard
  // across all authenticated native API calls (see queryClient.ts getNativeAuthHeaders).
  const nativeSid = (() => {
    try { return localStorage.getItem("nativeSessionId"); } catch { return null; }
  })();
  const authHeaders: Record<string, string> = nativeSid
    ? { Authorization: `Bearer ${nativeSid}` }
    : {};

  console.log(
    `[pdf-share] native path — endpoint: ${fullUrl}`,
    `| bearerPresent: ${!!nativeSid}`,
    `| usingDedicated: ${!!nativeEndpoint}`,
  );

  let pdfBlob: Blob;
  try {
    const response = await fetch(fullUrl, {
      credentials: "include",
      headers: authHeaders,
    });

    console.log(
      `[pdf-share] fetch response: status=${response.status}`,
      `contentType=${response.headers.get("content-type")}`,
      `contentLength=${response.headers.get("content-length")}`,
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "(unreadable)");
      console.error(`[pdf-share] Fetch HTTP error ${response.status}:`, bodyText);
      throw new Error(`PDF fetch failed: ${response.status}`);
    }

    const arrayBuf = await response.arrayBuffer();
    console.log(`[pdf-share] Received ${arrayBuf.byteLength} bytes`);
    pdfBlob = new Blob([arrayBuf], { type: "application/pdf" });
    console.log("[pdf-share] Blob created, size:", pdfBlob.size);
  } catch (fetchErr) {
    // Fetch itself failed — log and bail. Do NOT open any external link.
    console.error("[pdf-share] Fetch failed:", fetchErr);
    return false;
  }

  // ── Path A: Web Share API with files ────────────────────────────────────
  // navigator.share({ files }) works inside iOS WKWebView (Safari engine)
  // without requiring Capacitor plugin registration or cap sync.
  // This is the primary native path.
  const shareFile = new File([pdfBlob], safeFilename, { type: "application/pdf" });
  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [shareFile] })
  ) {
    try {
      await navigator.share({ files: [shareFile], title: safeFilename });
      console.log("[pdf-share] Web Share API succeeded");
      return true;
    } catch (shareErr: any) {
      // AbortError = user dismissed the sheet — that is fine, not a failure.
      if (shareErr?.name === "AbortError") {
        console.log("[pdf-share] Share sheet dismissed by user");
        return true;
      }
      // Any other error: fall through to Capacitor plugin path below.
      console.warn("[pdf-share] Web Share API error, trying Capacitor:", shareErr);
    }
  }

  // ── Path B: Capacitor Filesystem + Share plugins ─────────────────────────
  // Used when Web Share API isn't available (some Android versions).
  // IMPORTANT: If these plugins throw (not yet synced to native project),
  // we log the error and return false — we do NOT call window.open.
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");

    // Convert blob → base64
    const base64Data: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(pdfBlob);
    });

    const writeResult = await Filesystem.writeFile({
      path: safeFilename,
      data: base64Data,
      directory: Directory.Cache,
    });
    console.log("[pdf-share] Wrote to cache:", writeResult.uri);

    await Share.share({
      title: safeFilename,
      files: [writeResult.uri],
      dialogTitle: "Save or Share PDF",
    });

    console.log("[pdf-share] Capacitor share sheet opened");
    return true;
  } catch (capErr: any) {
    const isCancelled =
      capErr?.name === "AbortError" ||
      capErr?.message?.includes("canceled") ||
      capErr?.message?.includes("cancelled") ||
      capErr?.errorMessage?.includes("canceled");

    if (isCancelled) {
      console.log("[pdf-share] Share sheet dismissed by user");
      return true;
    }

    // Plugins not available (needs cap sync) or other error.
    // DO NOT fall back to window.open — that would open Safari externally.
    console.error("[pdf-share] Capacitor share failed (plugins may need cap sync):", capErr);
    return false;
  }
}

export async function closeSystemBrowser(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    // Browser may already be closed (e.g. auth completed via deep link) — ignore
  }
}

export async function openInAppBrowser(url: string, onClose?: () => void): Promise<void> {
  if (!isNativePlatform()) {
    window.location.href = url;
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    let closed = false;

    const handleClose = () => {
      if (closed) return;
      closed = true;
      console.log("[capacitor] Browser closed (browserFinished)");
      if (finishedListener) { try { finishedListener.remove(); } catch {} }
      if (onClose) onClose();
    };

    const finishedListener = await Browser.addListener("browserFinished", handleClose);
    console.log("[capacitor] Opening in-app browser:", url);
    await Browser.open({ url, presentationStyle: "fullscreen" });
  } catch (err) {
    console.error("[capacitor] Browser.open failed, falling back:", err);
    window.location.href = url;
  }
}

