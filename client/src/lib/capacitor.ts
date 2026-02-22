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
    const origin = window.location.origin;
    console.log("[capacitor] getApiBaseUrl native, origin:", origin);
    return origin;
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

export async function startGoogleAuthNative(): Promise<void> {
  if (!isNativePlatform()) {
    window.location.href = "/api/auth/google";
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
            console.log("[capacitor] Auth exchange successful, refreshing auth state...");
            await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
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

let pushRegistered = false;

export function resetPushRegistration(): void {
  pushRegistered = false;
}

export async function registerPushNotifications(): Promise<void> {
  if (!isNativePlatform() || pushRegistered) return;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { Device } = await import("@capacitor/device");

    const permResult = await PushNotifications.requestPermissions();
    console.log("[push] Permission result:", permResult.receive);

    if (permResult.receive !== "granted") {
      console.log("[push] Permission denied, skipping registration");
      return;
    }

    PushNotifications.addListener("registration", async (token) => {
      console.log("[push] Got FCM/APNs token:", token.value.substring(0, 20) + "...");
      const deviceInfo = await Device.getId();
      const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";

      try {
        const res = await fetch("/api/push/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            token: token.value,
            platform,
            deviceId: deviceInfo.identifier,
          }),
        });
        const data = await res.json();
        console.log("[push] Token registered with backend:", data);
        pushRegistered = true;
      } catch (err) {
        console.error("[push] Failed to register token with backend:", err);
      }
    });

    PushNotifications.addListener("registrationError", (error) => {
      console.error("[push] Registration error:", error);
    });

    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      console.log("[push] Notification received in foreground:", notification);
    });

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      console.log("[push] Notification tapped:", action);
      const data = action.notification.data;
      if (data?.linkUrl) {
        window.location.href = data.linkUrl;
      }
    });

    await PushNotifications.register();
    console.log("[push] Registration requested");
  } catch (err) {
    console.error("[push] Push setup failed:", err);
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
