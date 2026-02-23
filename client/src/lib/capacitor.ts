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

let pushListenersAdded = false;

export function resetPushRegistration(): void {
  pushListenersAdded = false;
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
    const { Device } = await import("@capacitor/device");

    console.log("[push] Requesting permissions...");
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

export async function closeSystemBrowser(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch (err) {
    console.error("[capacitor] Browser.close failed:", err);
  }
}
