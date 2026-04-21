import { sendPushToUser as apnsSendToUser, sendPushToUsers as apnsSendToUsers, isApnsConfigured } from "./apns";
import type { ApnsPushPayload } from "./apns";

export type PushPayload = ApnsPushPayload;

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!isApnsConfigured()) {
    console.log("[push] APNs not configured, skipping push for user:", userId);
    return { sent: 0, failed: 0 };
  }
  return apnsSendToUser(userId, payload);
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!isApnsConfigured()) {
    console.log("[push] APNs not configured, skipping push for users:", userIds.length);
    return { sent: 0, failed: 0 };
  }
  return apnsSendToUsers(userIds, payload);
}

export { isApnsConfigured };
