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
  project_id?: string;
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Parse GOOGLE_PLAY_SERVICE_ACCOUNT_KEY from env.
 *
 * Accepts two formats:
 *   1. Raw JSON string  — paste the whole service-account JSON as-is.
 *   2. Base64-encoded JSON — useful when the key contains newlines that
 *      break some secret managers. Encode with:
 *        base64 -i service-account.json | tr -d '\n'
 *      and paste the resulting string into the secret.
 *
 * Returns null (and logs an actionable error) if the env var is missing or
 * cannot be parsed in either format.
 */
function getServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    console.error(
      "[ECOLOGIC-GPLAY] GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is not set. " +
      "Set it to the raw JSON (or base64-encoded JSON) of your Google service account key file."
    );
    return null;
  }

  // ── Attempt 1: raw JSON ────────────────────────────────────────────────────
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as ServiceAccountKey;
      console.log(
        `[ECOLOGIC-GPLAY] Service account key parsed (raw JSON) — client_email: ${parsed.client_email}`
      );
      return parsed;
    } catch (e: any) {
      console.error("[ECOLOGIC-GPLAY] GOOGLE_PLAY_SERVICE_ACCOUNT_KEY looks like JSON but failed to parse:", e.message);
      return null;
    }
  }

  // ── Attempt 2: base64-encoded JSON ────────────────────────────────────────
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as ServiceAccountKey;
    console.log(
      `[ECOLOGIC-GPLAY] Service account key parsed (base64-encoded JSON) — client_email: ${parsed.client_email}`
    );
    return parsed;
  } catch {
    console.error(
      "[ECOLOGIC-GPLAY] GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is set but could not be parsed as " +
      "raw JSON or base64-encoded JSON. " +
      "Paste the raw service-account JSON, or its base64 encoding, into Replit Secrets."
    );
    return null;
  }
}

/**
 * Called once at server startup to log whether Google Play verification is
 * available. Does NOT throw — startup must succeed regardless.
 */
export function logGooglePlayVerificationStatus(): void {
  const key = getServiceAccountKey();
  if (key) {
    console.log(
      `[ECOLOGIC-GPLAY] Google Play verification configured: yes` +
      ` (account=${key.client_email} package=${GOOGLE_PLAY_PACKAGE_NAME})`
    );
  } else {
    console.log(
      "[ECOLOGIC-GPLAY] Google Play verification configured: no" +
      " — Android subscription validation will return 422 until GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is set."
    );
  }
}

/**
 * Obtain a short-lived Google OAuth2 access token for the Android Publisher API.
 * Uses the service account JWT bearer flow (RFC 7523).
 * Tokens are cached for ~50 minutes to avoid excessive token exchanges.
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt) {
    console.log("[ECOLOGIC-GPLAY] Using cached access token (expires in ~" +
      Math.round((tokenExpiresAt - now) / 1000) + "s)");
    return cachedAccessToken;
  }

  const key = getServiceAccountKey();
  if (!key) {
    throw new Error(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is not set or could not be parsed — " +
      "set it in Replit Secrets (raw JSON or base64-encoded JSON of your service account key file)"
    );
  }

  console.log(`[ECOLOGIC-GPLAY] Requesting new access token for ${key.client_email} …`);

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
    throw new Error(
      `[ECOLOGIC-GPLAY] Token exchange failed: HTTP ${res.status} — ${text}. ` +
      "Ensure the service account has 'Financial data readers' role in Play Console → Users and permissions."
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in - 60) * 1000; // expire 60s early for safety
  console.log(`[ECOLOGIC-GPLAY] Access token obtained — expires in ${data.expires_in}s`);
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
  console.log(
    `[ECOLOGIC-GPLAY] verifyGooglePlayPurchase START — productId="${productId}"` +
    ` package="${GOOGLE_PLAY_PACKAGE_NAME}"` +
    ` purchaseToken present=${!!purchaseToken} length=${purchaseToken?.length ?? 0}`
  );

  const planKey = googlePlayProductIdToPlanKey[productId];
  if (!planKey) {
    const knownIds = Object.keys(googlePlayProductIdToPlanKey).join(", ");
    console.error(
      `[ECOLOGIC-GPLAY] Unknown productId="${productId}". Known IDs: ${knownIds}`
    );
    throw new Error(
      `Unknown Google Play product ID: "${productId}". ` +
      `Known IDs: ${knownIds}`
    );
  }

  console.log(`[ECOLOGIC-GPLAY] Product ID matched → planKey="${planKey}"`);

  const plan = subscriptionPlans[planKey];
  const accessToken = await getAccessToken();

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptions/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  console.log(`[ECOLOGIC-GPLAY] Calling Google Play Developer API: GET ${url.replace(purchaseToken, purchaseToken.slice(0, 12) + "…")}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[ECOLOGIC-GPLAY] Developer API returned HTTP ${res.status}: ${text}`);
    throw new Error(
      `Google Play Developer API returned ${res.status}: ${text}. ` +
      "Ensure the service account has 'Financial data readers' role in Play Console → Users and permissions → Add users."
    );
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

  console.log(
    `[ECOLOGIC-GPLAY] API response — paymentState=${data.paymentState}` +
    ` autoRenewing=${data.autoRenewing}` +
    ` orderId="${data.orderId}"` +
    ` expiryTimeMillis=${data.expiryTimeMillis}`
  );

  const expiresMs = parseInt(data.expiryTimeMillis, 10);
  if (isNaN(expiresMs)) {
    console.error("[ECOLOGIC-GPLAY] expiryTimeMillis missing or invalid in API response");
    throw new Error("Google Play API response missing or invalid expiryTimeMillis");
  }

  console.log(`[ECOLOGIC-GPLAY] Verification SUCCESS — plan="${planKey}" expires=${new Date(expiresMs).toISOString()}`);

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
