/**
 * Google Play IAP Backend — Phase (Android foundation)
 *
 * Handles Google Play subscription purchase token validation and
 * Real-time Developer Notifications (RTDN) via Pub/Sub.
 *
 * Verification strategy:
 *   1. The native Android app purchases via Billing Library and receives a
 *      `purchaseToken` string.
 *   2. The backend verifies the purchase by calling Google Play Developer API:
 *      GET .../purchases/subscriptions/{productId}/tokens/{purchaseToken}
 *   3. The API response includes `expiryTimeMillis`, `paymentState`, and
 *      `autoRenewing` which determine subscription validity.
 *
 * Required env var:
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_KEY — full JSON content of a Google service
 *   account key file that has "Financial data readers" permission on the app
 *   in the Google Play Console. Generate at:
 *   Cloud Console → IAM & Admin → Service Accounts → Create Key (JSON).
 *   Then grant it read access in Play Console → Users and permissions.
 *
 * Optional env var:
 *   GOOGLE_PLAY_PACKAGE_NAME — defaults to "com.ecologic.app"
 */

import jwtLib from "jsonwebtoken";
const jwtSign = jwtLib.sign.bind(jwtLib);
import { googlePlayProductIdToPlanKey, subscriptionPlans } from "@shared/subscriptionPlans";

export const GOOGLE_PLAY_PACKAGE_NAME =
  process.env.GOOGLE_PLAY_PACKAGE_NAME ?? "com.ecologic.app";

// ---------------------------------------------------------------------------
// Service account auth
// ---------------------------------------------------------------------------

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function getServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch {
    console.error("[google-play] Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_KEY as JSON");
    return null;
  }
}

/**
 * Obtain a short-lived Google OAuth2 access token for the Android Publisher API.
 * Uses the service account JWT bearer flow (RFC 7523).
 * Tokens are cached for ~50 minutes to avoid excessive token exchanges.
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt) return cachedAccessToken;

  const key = getServiceAccountKey();
  if (!key) {
    throw new Error(
      "[google-play] GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is not set — " +
      "cannot call Google Play Developer API"
    );
  }

  const nowSec = Math.floor(now / 1000);
  const assertion = jwtSign(
    {
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      exp: nowSec + 3600,
      iat: nowSec,
    },
    key.private_key,
    { algorithm: "RS256" }
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[google-play] Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in - 60) * 1000; // expire 60s early for safety
  return cachedAccessToken;
}

// ---------------------------------------------------------------------------
// Purchase verification
// ---------------------------------------------------------------------------

export interface GooglePlayTransactionInfo {
  purchaseToken: string;
  productId: string;
  planKey: string;
  userLimit: number;
  expiresDate: Date;
  autoRenewing: boolean;
  paymentState: number; // 0=pending, 1=received, 2=free trial, 3=pending deferred
  orderId: string;
}

/**
 * Verify a Google Play subscription purchase token via the Developer API.
 *
 * The native Android app must send:
 *   { platform: "google_play", purchaseToken: string, productId: string }
 *
 * `productId` must be one of the EcoLogic Google Play product IDs defined in
 * shared/subscriptionPlans.ts (e.g. "ecologic_team_monthly").
 *
 * Throws on any verification failure or unknown product ID.
 */
export async function verifyGooglePlayPurchase(
  purchaseToken: string,
  productId: string
): Promise<GooglePlayTransactionInfo> {
  const planKey = googlePlayProductIdToPlanKey[productId];
  if (!planKey) {
    throw new Error(
      `[google-play] Unknown product ID: "${productId}". ` +
      `Known IDs: ${Object.keys(googlePlayProductIdToPlanKey).join(", ")}`
    );
  }

  const plan = subscriptionPlans[planKey];
  const accessToken = await getAccessToken();

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptions/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[google-play] Developer API returned ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    expiryTimeMillis: string;
    autoRenewing: boolean;
    paymentState: number;
    orderId: string;
    purchaseType?: number;
    cancelReason?: number;
    userCancellationTimeMillis?: string;
    linkedPurchaseToken?: string;
  };

  const expiresMs = parseInt(data.expiryTimeMillis, 10);
  if (isNaN(expiresMs)) {
    throw new Error("[google-play] API response missing or invalid expiryTimeMillis");
  }

  return {
    purchaseToken,
    productId,
    planKey,
    userLimit: plan.userLimit,
    expiresDate: new Date(expiresMs),
    autoRenewing: data.autoRenewing ?? false,
    paymentState: data.paymentState ?? 0,
    orderId: data.orderId ?? "",
  };
}

// ---------------------------------------------------------------------------
// Real-time Developer Notifications (RTDN) helpers
// ---------------------------------------------------------------------------

// Google Play subscription notification types
// https://developer.android.com/google/play/billing/rtdn-reference
export const GOOGLE_PLAY_NOTIFICATION_TYPES: Record<number, string> = {
  1: "SUBSCRIPTION_RECOVERED",        // Recovered from account hold
  2: "SUBSCRIPTION_RENEWED",          // Renewed successfully
  3: "SUBSCRIPTION_CANCELED",         // Voluntarily canceled
  4: "SUBSCRIPTION_PURCHASED",        // New subscription purchased
  5: "SUBSCRIPTION_ON_HOLD",          // Entered account hold
  6: "SUBSCRIPTION_IN_GRACE_PERIOD",  // Entered grace period
  7: "SUBSCRIPTION_RESTARTED",        // Re-subscribed during grace / hold
  8: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
  9: "SUBSCRIPTION_DEFERRED",
  10: "SUBSCRIPTION_PAUSED",
  11: "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
  12: "SUBSCRIPTION_REVOKED",         // Revoked (refund or policy)
  13: "SUBSCRIPTION_EXPIRED",
};

export interface GooglePlayNotification {
  packageName: string;
  notificationType: number;
  notificationTypeName: string;
  purchaseToken: string;
  subscriptionId: string; // Google Play product ID
  eventTimeMillis: string;
}

/**
 * Decode a Google Cloud Pub/Sub push notification body from Google Play.
 *
 * Google sends:
 *   { "message": { "data": "<base64 JSON>", "messageId": "...", ... }, ... }
 *
 * The decoded data is a DeveloperNotification:
 *   https://developer.android.com/google/play/billing/rtdn-reference
 */
export function decodeGooglePlayNotification(body: unknown): GooglePlayNotification {
  const b = body as Record<string, unknown>;
  const message = b.message as Record<string, unknown> | undefined;
  if (!message?.data || typeof message.data !== "string") {
    throw new Error("[google-play-notify] Missing or invalid message.data in Pub/Sub payload");
  }

  let decoded: Record<string, unknown>;
  try {
    const json = Buffer.from(message.data, "base64").toString("utf8");
    decoded = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("[google-play-notify] Failed to decode Pub/Sub message.data as base64 JSON");
  }

  const sub = decoded.subscriptionNotification as Record<string, unknown> | undefined;
  if (!sub) {
    // Could be a test notification or one-time product notification — not a subscription event
    throw new Error(
      `[google-play-notify] Payload has no subscriptionNotification field ` +
      `(may be a test or non-subscription event)`
    );
  }

  const notificationType = sub.notificationType as number;
  return {
    packageName: (decoded.packageName as string) ?? "",
    notificationType,
    notificationTypeName: GOOGLE_PLAY_NOTIFICATION_TYPES[notificationType] ?? `TYPE_${notificationType}`,
    purchaseToken: (sub.purchaseToken as string) ?? "",
    subscriptionId: (sub.subscriptionId as string) ?? "",
    eventTimeMillis: (decoded.eventTimeMillis as string) ?? "",
  };
}
