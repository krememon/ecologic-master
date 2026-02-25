import { Capacitor } from "@capacitor/core";

let listenersAttached = false;

export async function initPushDebug() {
  if (!Capacitor.isNativePlatform()) {
    console.log("[push-debug] Not native platform, skipping");
    return;
  }
  if (listenersAttached) return;
  listenersAttached = true;

  console.log("[push-debug] Attaching listeners...");

  const { PushNotifications } = await import("@capacitor/push-notifications");

  PushNotifications.addListener("registration", (token) => {
    console.log("[push-debug] APNS TOKEN:", token.value);
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
  console.log("[push-debug] Manual register() pressed");
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.register();
  console.log("[push-debug] Manual register() complete");
}
