import { Capacitor } from "@capacitor/core";

let listenersAttached = false;

export async function initPushDebug() {
  if (!Capacitor.isNativePlatform()) {
    console.log("[push-debug] Not native platform, skipping");
    return;
  }
  if (Capacitor.getPlatform() === "android") {
    console.log("[push] Android push temporarily skipped until Firebase is configured");
    return;
  }
  if (listenersAttached) return;
  listenersAttached = true;

  console.log("[push-debug] Attaching listeners...");

  const { PushNotifications } = await import("@capacitor/push-notifications");

  PushNotifications.addListener("registration", async (token) => {
    console.log("[push-debug] APNS TOKEN:", token.value);

    try {
      const { Device } = await import("@capacitor/device");
      const id = await Device.getId();
      const res = await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.value, platform: "ios", deviceId: id.identifier }),
        credentials: "include",
      });
      const data = await res.json();
      console.log("[push-debug] Token saved to backend:", data);
    } catch (e) {
      console.error("[push-debug] Failed saving token:", e);
    }
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.error("[push-debug] REG ERROR:", JSON.stringify(err));
  });

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    console.log("[push-debug] PUSH RECEIVED:", JSON.stringify(notification));
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    console.log("[push-debug] PUSH ACTION:", JSON.stringify(action));
  });

  const perm = await PushNotifications.requestPermissions();
  console.log("[push-debug] Permission result:", perm);

  if (perm.receive === "granted") {
    console.log("[push-debug] Calling register()...");
    await PushNotifications.register();
    console.log("[push-debug] register() called");
  } else {
    console.log("[push-debug] Permission NOT granted");
  }
}

export async function manualRegister() {
  if (!Capacitor.isNativePlatform()) {
    console.log("[push-debug] Not native platform");
    return;
  }
  if (Capacitor.getPlatform() === "android") {
    console.log("[push] Android push temporarily skipped until Firebase is configured");
    return;
  }
  console.log("[push-debug] Manual register() pressed");
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.register();
  console.log("[push-debug] Manual register() complete");
}
