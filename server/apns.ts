import apn from "apn";
import * as fs from "fs";
import * as crypto from "crypto";
import { storage } from "./storage";

const TEAM_ID = process.env.APNS_TEAM_ID;
const KEY_ID = process.env.APNS_KEY_ID;
const TOPIC = process.env.APNS_TOPIC || "com.ecologic.app";
const KEY_PATH = "/tmp/apns_key.p8";

let keyValid = false;
let keyError = "";

{
  const missing: string[] = [];
  if (!TEAM_ID) missing.push("APNS_TEAM_ID");
  if (!KEY_ID) missing.push("APNS_KEY_ID");
  if (!process.env.APNS_PRIVATE_KEY) missing.push("APNS_PRIVATE_KEY");
  if (missing.length > 0) {
    console.warn(`[apns] Missing env vars: ${missing.join(", ")}. Push will not work.`);
  } else {
    const raw = process.env.APNS_PRIVATE_KEY || "";
    let cleaned = raw.trim()
      .replace(/^"|"$/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n");

    const hasBegin = cleaned.includes("-----BEGIN PRIVATE KEY-----");
    let newlineCount = (cleaned.match(/\n/g) || []).length;

    if (hasBegin && newlineCount < 3) {
      const body = cleaned
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/\s+/g, "");
      const lines: string[] = [];
      for (let i = 0; i < body.length; i += 64) {
        lines.push(body.substring(i, i + 64));
      }
      cleaned = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
      newlineCount = (cleaned.match(/\n/g) || []).length;
      console.log("[apns] Reformatted PEM: bodyLen=", body.length, "lines=", lines.length);
    }

    try {
      crypto.createPrivateKey(cleaned);
      keyValid = true;
    } catch (e: any) {
      keyValid = false;
      keyError = e.message || String(e);
    }

    console.log(`[apns] keySanitized hasBegin=${hasBegin} newlineCount=${newlineCount} keyValid=${keyValid}`);
    if (!keyValid) {
      console.error(`[apns] Key validation failed: ${keyError}`);
    }

    fs.writeFileSync(KEY_PATH, cleaned, { encoding: "utf8" });
    console.log(`[apns] usingKeyPath=${KEY_PATH}`);
  }
}

let provider: apn.Provider | null = null;

export function getApnsProvider(): apn.Provider | null {
  if (!TEAM_ID || !KEY_ID || !keyValid) return null;
  if (provider) return provider;

  provider = new apn.Provider({
    token: {
      key: KEY_PATH,
      keyId: KEY_ID!,
      teamId: TEAM_ID!,
    },
    production: process.env.NODE_ENV === "production",
  });

  console.log("[apns] Provider initialized. production=", process.env.NODE_ENV === "production", "topic=", TOPIC);
  return provider;
}

export function getKeyError(): string {
  return keyError;
}

export function isKeyValid(): boolean {
  return keyValid;
}

export interface ApnsPushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

export async function sendApnsPush(params: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}): Promise<{ sent: number; failed: number; failures: Array<{ status: string; response: any; device: string }> }> {
  if (!keyValid) {
    return { sent: 0, failed: 0, failures: [{ status: "key_invalid", response: keyError, device: "" }] };
  }
  const p = getApnsProvider();
  if (!p) {
    console.log("[apns] Provider not available (missing env vars)");
    return { sent: 0, failed: 0, failures: [{ status: "no_provider", response: "Missing APNS env vars", device: "" }] };
  }

  const note = new apn.Notification();
  note.topic = TOPIC;
  note.alert = { title: params.title, body: params.body };
  note.payload = params.data || {};
  note.sound = "default";
  note.badge = 1;

  console.log("[apns] Sending push to token (len):", params.token?.length);

  const result = await p.send(note, params.token);

  const failures = (result.failed || []).map((f: any) => ({
    status: f.status || "unknown",
    response: f.response || null,
    device: f.device ? `${String(f.device).slice(0, 8)}...` : "",
  }));

  console.log("[apns] Result:", {
    sent: result.sent?.length || 0,
    failed: result.failed?.length || 0,
    failures,
  });

  return {
    sent: result.sent?.length || 0,
    failed: result.failed?.length || 0,
    failures,
  };
}

export async function sendApnsPushToTokens(
  tokens: string[],
  payload: ApnsPushPayload
): Promise<{ sent: number; failed: number; failures: Array<{ status: string; response: any; device: string }> }> {
  let totalSent = 0;
  let totalFailed = 0;
  const allFailures: Array<{ status: string; response: any; device: string }> = [];

  for (const token of tokens) {
    const result = await sendApnsPush({
      token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });
    totalSent += result.sent;
    totalFailed += result.failed;
    allFailures.push(...result.failures);

    if (result.failures.some((f: any) => {
      const reason = f.response?.reason;
      return reason === "Unregistered" || reason === "BadDeviceToken";
    })) {
      await storage.deactivatePushToken(token);
      console.log("[apns] Deactivated bad/unregistered token:", token.substring(0, 12) + "...");
    }
  }

  return { sent: totalSent, failed: totalFailed, failures: allFailures };
}

export async function sendPushToUser(
  userId: string,
  payload: ApnsPushPayload
): Promise<{ sent: number; failed: number }> {
  const tokenRecords = await storage.getUserPushTokens(userId);
  if (tokenRecords.length === 0) {
    console.log("[apns] No active tokens for user:", userId);
    return { sent: 0, failed: 0 };
  }

  const tokens = tokenRecords.map((t) => t.token);
  return sendApnsPushToTokens(tokens, payload);
}

export async function sendPushToUsers(
  userIds: string[],
  payload: ApnsPushPayload
): Promise<{ sent: number; failed: number }> {
  let totalSent = 0;
  let totalFailed = 0;
  for (const userId of userIds) {
    const result = await sendPushToUser(userId, payload);
    totalSent += result.sent;
    totalFailed += result.failed;
  }
  return { sent: totalSent, failed: totalFailed };
}

export function isApnsConfigured(): boolean {
  return !!(TEAM_ID && KEY_ID && keyValid);
}
