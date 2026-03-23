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
    console.log("[capacitor] getApiBaseUrl native, resolved:", resolved, "(configured:", configured, ")");
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

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "google-auth-success") {
        console.log("[google-auth] Received auth success from popup — refreshing user");
        settle();
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        resolve();
      } else if (event.data?.type === "google-auth-error") {
        console.log("[google-auth] Received auth error from popup:", event.data.error);
        settle();
        resolve();
      }
    };

    window.addEventListener("message", onMessage);

    const closedPoll = setInterval(() => {
      try {
        if (popup.closed) {
          console.log("[google-auth] Popup closed by user");
          settle();
          resolve();
        }
      } catch {}
    }, 800);
  });
}

export async function startGoogleAuthNative(): Promise<void> {
  if (!isNativePlatform()) {
    if (isInsideIframe()) {
      const appBaseUrl = (import.meta.env.VITE_APP_BASE_URL as string) || "";
      if (appBaseUrl) {
        const returnTo = encodeURIComponent(window.location.origin);
        const target = `${appBaseUrl}/api/auth/google?platform=web&returnTo=${returnTo}`;
        console.log("[auth] In iframe — navigating top frame to production:", target);
        try {
          window.top!.location.href = target;
          return;
        } catch (e) {
          console.log("[auth] Top navigation blocked, trying popup");
        }
        const popup = window.open(target, "ecologic_google_auth", "popup,width=500,height=650");
        if (popup) {
          console.log("[auth] Popup opened successfully");
          return;
        }
        console.log("[auth] Popup also blocked — navigating iframe to server trampoline");
      }
      window.location.href = "/api/auth/google";
      return;
    }
    // Web (non-iframe): use centered popup with postMessage handshake
    await openGoogleAuthPopup();
    return;
  }

  const nonce = generateNonce();
  const baseUrl = getApiBaseUrl();
  const authUrl = `${baseUrl}/api/auth/google?platform=ios&nonce=${nonce}`;
  console.log("[capacitor] Starting native Google auth, nonce:", nonce.substring(0, 8) + "...");

  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: authUrl, presentationStyle: "popover" as any });

    stopPolling();
    activePollInterval = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const res = await fetch(`${baseUrl}/api/auth/poll-code?nonce=${nonce}`, { credentials: "include" });
        const data = await res.json();
        console.log("[capacitor] Poll result:", data.status);

        if (data.status === "ready" && data.code) {
          stopPolling();
          try { await Browser.close(); } catch {}
          console.log("[capacitor] Got auth code, exchanging...");

          const exchangeRes = await fetch(`${baseUrl}/api/auth/exchange-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: data.code }),
            credentials: "include",
          });

          if (exchangeRes.ok) {
            const exchangeData = await exchangeRes.json().catch(() => ({}));
            if (exchangeData.sessionId) {
              // Store the sessionId so the native API client can attach it as a
              // Bearer token. The preview dev server (WebView's domain) will then
              // look up this session from the shared DB and authenticate the user
              // without needing a same-domain cookie.
              localStorage.setItem("nativeSessionId", exchangeData.sessionId);
              console.log("[capacitor] Stored nativeSessionId in localStorage");
            }
            console.log("[capacitor] Auth exchange successful, returning to app...");
            // Navigate relative — keeps the WebView on its current domain so
            // Capacitor does NOT open Safari. Auth is handled via Bearer token.
            window.location.href = "/";
          } else {
            console.error("[capacitor] Auth exchange failed:", exchangeRes.status);
            window.location.href = "/login?error=exchange_failed";
          }
        }
      } catch (err) {
        console.error("[capacitor] Poll error:", err);
      } finally {
        pollInFlight = false;
      }
    }, 2000);

    activePollTimeout = setTimeout(async () => {
      stopPolling();
      console.error("[capacitor] Auth polling timed out after 5 minutes");
      try { await Browser.close(); } catch {}
      window.location.href = "/login?error=timeout";
    }, 5 * 60 * 1000);

  } catch (err) {
    console.error("[capacitor] Browser.open failed:", err);
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
  } catch (err) {
    console.error("[capacitor] Browser.close failed:", err);
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

