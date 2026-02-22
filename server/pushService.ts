import admin from "firebase-admin";
import { storage } from "./storage";

let firebaseApp: admin.app.App | null = null;

function getFirebaseApp(): admin.app.App | null {
  if (firebaseApp) return firebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.log("[push] Firebase not configured - missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY");
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    console.log("[push] Firebase Admin initialized for project:", projectId);
    return firebaseApp;
  } catch (err) {
    console.error("[push] Firebase Admin init failed:", err);
    return null;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const app = getFirebaseApp();
  if (!app) {
    console.log("[push] Firebase not configured, skipping push for user:", userId);
    return { sent: 0, failed: 0 };
  }

  const tokens = await storage.getUserPushTokens(userId);
  if (tokens.length === 0) {
    console.log("[push] No active push tokens for user:", userId);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const messaging = app.messaging();

  for (const tokenRecord of tokens) {
    try {
      await messaging.send({
        token: tokenRecord.token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        apns: {
          payload: {
            aps: {
              sound: "default",
              badge: 1,
            },
          },
        },
      });
      sent++;
      console.log("[push] Sent to device:", tokenRecord.deviceId, "platform:", tokenRecord.platform);
    } catch (err: any) {
      failed++;
      console.error("[push] Failed to send to device:", tokenRecord.deviceId, err?.code || err?.message);
      if (err?.code === "messaging/registration-token-not-registered" || err?.code === "messaging/invalid-registration-token") {
        await storage.deactivatePushToken(tokenRecord.token);
        console.log("[push] Deactivated stale token for device:", tokenRecord.deviceId);
      }
    }
  }

  return { sent, failed };
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<{ sent: number; failed: number }> {
  let totalSent = 0;
  let totalFailed = 0;
  for (const userId of userIds) {
    const result = await sendPushToUser(userId, payload);
    totalSent += result.sent;
    totalFailed += result.failed;
  }
  return { sent: totalSent, failed: totalFailed };
}
