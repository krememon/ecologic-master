import * as http2 from "http2";
import * as crypto from "crypto";
import { storage } from "./storage";

const APNS_HOST_PRODUCTION = "api.push.apple.com";
const APNS_HOST_SANDBOX = "api.sandbox.push.apple.com";

let cachedJwt: { token: string; issuedAt: number } | null = null;

function getApnsConfig() {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const authKeyP8 = process.env.APNS_AUTH_KEY_P8;
  const useSandbox = process.env.APNS_USE_SANDBOX === "true";

  if (!teamId || !keyId || !bundleId || !authKeyP8) {
    return null;
  }

  const key = authKeyP8.includes("BEGIN PRIVATE KEY")
    ? authKeyP8
    : Buffer.from(authKeyP8, "base64").toString("utf-8");

  return { teamId, keyId, bundleId, key, useSandbox };
}

function createJwt(teamId: string, keyId: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);

  if (cachedJwt && now - cachedJwt.issuedAt < 3000) {
    return cachedJwt.token;
  }

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url");
  const signingInput = `${header}.${claims}`;

  const sign = crypto.createSign("SHA256");
  sign.update(signingInput);
  const derSig = sign.sign(key);

  const ecSig = derToJoseES256(derSig);
  const signature = ecSig.toString("base64url");

  const token = `${signingInput}.${signature}`;
  cachedJwt = { token, issuedAt: now };
  return token;
}

function derToJoseES256(derSig: Buffer): Buffer {
  const jose = Buffer.alloc(64);

  let pos = 2;
  let rLen = derSig[pos + 1];
  let rStart = pos + 2;
  if (rLen === 33 && derSig[rStart] === 0x00) {
    rStart++;
    rLen = 32;
  }
  derSig.copy(jose, 32 - Math.min(rLen, 32), rStart, rStart + Math.min(rLen, 32));

  pos = rStart + rLen;
  pos++;
  let sLen = derSig[pos];
  let sStart = pos + 1;
  if (sLen === 33 && derSig[sStart] === 0x00) {
    sStart++;
    sLen = 32;
  }
  derSig.copy(jose, 64 - Math.min(sLen, 32), sStart, sStart + Math.min(sLen, 32));

  return jose;
}

export interface ApnsPushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

function sendSinglePush(
  host: string,
  token: string,
  bundleId: string,
  jwt: string,
  payload: any
): Promise<{ success: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    client.on("error", (err) => {
      console.error("[push/apns] HTTP/2 connection error:", err.message);
      resolve({ success: false, status: 0, body: err.message });
    });

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "authorization": `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "0",
    };

    const req = client.request(headers);
    let data = "";
    let statusCode = 0;

    req.on("response", (h) => {
      statusCode = h[":status"] as number;
    });

    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });

    req.on("end", () => {
      client.close();
      resolve({ success: statusCode === 200, status: statusCode, body: data });
    });

    req.on("error", (err) => {
      client.close();
      resolve({ success: false, status: 0, body: err.message });
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

export async function sendApnsPushToTokens(
  tokens: string[],
  payload: ApnsPushPayload
): Promise<{ sent: number; failed: number }> {
  const config = getApnsConfig();
  if (!config) {
    console.log("[push/apns] APNs not configured - missing APNS_TEAM_ID, APNS_KEY_ID, APNS_BUNDLE_ID, or APNS_AUTH_KEY_P8");
    return { sent: 0, failed: 0 };
  }

  const host = config.useSandbox ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION;
  const jwt = createJwt(config.teamId, config.keyId, config.key);

  const apnsPayload: Record<string, any> = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: payload.sound || "default",
      badge: payload.badge ?? 1,
      "mutable-content": 1,
    },
  };

  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      apnsPayload[k] = v;
    }
  }

  let sent = 0;
  let failed = 0;

  for (const deviceToken of tokens) {
    const result = await sendSinglePush(host, deviceToken, config.bundleId, jwt, apnsPayload);
    if (result.success) {
      sent++;
      console.log("[push/apns] Sent successfully to token:", deviceToken.substring(0, 12) + "...");
    } else {
      failed++;
      console.error("[push/apns] Failed for token:", deviceToken.substring(0, 12) + "...", "status:", result.status, result.body);

      if (result.status === 410 || (result.body && result.body.includes("Unregistered"))) {
        await storage.deactivatePushToken(deviceToken);
        console.log("[push/apns] Deactivated unregistered token:", deviceToken.substring(0, 12) + "...");
      }
    }
  }

  return { sent, failed };
}

export async function sendPushToUser(
  userId: string,
  payload: ApnsPushPayload
): Promise<{ sent: number; failed: number }> {
  const tokenRecords = await storage.getUserPushTokens(userId);
  if (tokenRecords.length === 0) {
    console.log("[push/apns] No active tokens for user:", userId);
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
  return getApnsConfig() !== null;
}
