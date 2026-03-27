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

// ---------------------------------------------------------------------------
// Key diagnosis types (exported for the dev endpoint)
// ---------------------------------------------------------------------------

export interface ServiceAccountKeyDiagnosis {
  present: boolean;
  length: number;
  detectedFormat: "json" | "base64" | "unknown" | "missing";
  parsed: boolean;
  clientEmail?: string;
  error?: string;
}

/**
 * Try every reasonable parsing strategy for the service account key env var.
 *
 * Strategies tried in order:
 *   1. Trimmed raw JSON             — value starts with "{"
 *   2. Raw JSON + unescape \\n→\n   — handles keys copy-pasted with escaped newlines
 *   3. Base64 → UTF-8 → JSON        — base64-encoded JSON (no newline issues)
 *   4. Base64 → UTF-8 + unescape \\n→\n
 *
 * Never logs the private key or the full secret.
 */
function tryParseServiceAccountJSON(text: string): ServiceAccountKey {
  // Strategy 1 & 2: raw JSON (with/without escaped newlines)
  if (text.startsWith("{")) {
    // Strategy 1 — direct parse
    try { return JSON.parse(text) as ServiceAccountKey; } catch (_) {}
    // Strategy 2 — unescape literal \n sequences then parse
    try { return JSON.parse(text.replace(/\\n/g, "\n")) as ServiceAccountKey; } catch (_) {}
    // Neither worked — throw with the direct-parse error message
    return JSON.parse(text) as ServiceAccountKey; // will throw
  }

  // Strategy 3 & 4: base64 → UTF-8
  const decoded = Buffer.from(text, "base64").toString("utf8").trim();
  // Strategy 3 — direct parse of decoded
  try { return JSON.parse(decoded) as ServiceAccountKey; } catch (_) {}
  // Strategy 4 — unescape then parse
  return JSON.parse(decoded.replace(/\\n/g, "\n")) as ServiceAccountKey; // will throw if all fail
}

/**
 * Full diagnostic read of GOOGLE_PLAY_SERVICE_ACCOUNT_KEY.
 * Exported so the dev endpoint can return structured info.
 */
export function diagnoseServiceAccountKey(): ServiceAccountKeyDiagnosis {
  // Try both access patterns — they resolve identically in Node but being
  // explicit surfaces any env-injection oddities in edge environments.
  const raw =
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY ??
    process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_KEY"];

  if (!raw || raw.trim().length === 0) {
    return {
      present: false,
      length: 0,
      detectedFormat: "missing",
      parsed: false,
      error: "GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is not set or is empty",
    };
  }

  const trimmed = raw.trim();
  const detectedFormat: ServiceAccountKeyDiagnosis["detectedFormat"] =
    trimmed.startsWith("{") ? "json" :
    /^[A-Za-z0-9+/=]+$/.test(trimmed.replace(/\s/g, "")) ? "base64" :
    "unknown";

  try {
    const key = tryParseServiceAccountJSON(trimmed);

    if (!key.client_email || !key.private_key) {
      return {
        present: true,
        length: trimmed.length,
        detectedFormat,
        parsed: false,
        error: `Parsed JSON is missing required fields. Has client_email=${!!key.client_email} private_key=${!!key.private_key}`,
      };
    }

    return {
      present: true,
      length: trimmed.length,
      detectedFormat,
      parsed: true,
      clientEmail: key.client_email,
    };
  } catch (e: any) {
    return {
      present: true,
      length: trimmed.length,
      detectedFormat,
      parsed: false,
      error: `Parse failed after all strategies: ${e?.message ?? String(e)}`,
    };
  }
}

/**
 * Internal — returns the parsed key or null. Emits detailed [ECOLOGIC-GPLAY] logs.
 */
function getServiceAccountKey(): ServiceAccountKey | null {
  const raw =
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY ??
    process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_KEY"];

  const present = !!raw && raw.trim().length > 0;
  const trimmed = raw?.trim() ?? "";

  console.log(
    `[ECOLOGIC-GPLAY] env check — present=${present} length=${trimmed.length}` +
    ` looksLikeJson=${trimmed.startsWith("{")} looksLikeBase64=${/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && !trimmed.startsWith("{")}`
  );

  if (!present) {
    console.error(
      "[ECOLOGIC-GPLAY] GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is not set or is empty.\n" +
      "  In Replit Secrets, add:\n" +
      "    Key:   GOOGLE_PLAY_SERVICE_ACCOUNT_KEY\n" +
      "    Value: paste the raw contents of your service-account JSON file\n" +
      "           OR the base64 encoding of that file"
    );
    return null;
  }

  // Try all parsing strategies with individual attempt logs
  const strategies: Array<{ name: string; fn: () => ServiceAccountKey }> = [
    { name: "raw-json",              fn: () => JSON.parse(trimmed) },
    { name: "raw-json-unescape-\\n", fn: () => JSON.parse(trimmed.replace(/\\n/g, "\n")) },
    {
      name: "base64-json",
      fn: () => {
        const d = Buffer.from(trimmed, "base64").toString("utf8").trim();
        return JSON.parse(d);
      },
    },
    {
      name: "base64-json-unescape-\\n",
      fn: () => {
        const d = Buffer.from(trimmed, "base64").toString("utf8").trim();
        return JSON.parse(d.replace(/\\n/g, "\n"));
      },
    },
  ];

  for (const strategy of strategies) {
    try {
      const key = strategy.fn();
      if (key?.client_email && key?.private_key) {
        console.log(
          `[ECOLOGIC-GPLAY] Key parsed successfully via strategy "${strategy.name}" — client_email: ${key.client_email}`
        );
        return key;
      }
      console.warn(
        `[ECOLOGIC-GPLAY] Strategy "${strategy.name}" parsed JSON but missing client_email/private_key fields`
      );
    } catch (e: any) {
      console.log(`[ECOLOGIC-GPLAY] Strategy "${strategy.name}" failed: ${e?.message ?? e}`);
    }
  }

  console.error(
    "[ECOLOGIC-GPLAY] All parsing strategies failed. Ensure the secret contains:\n" +
    "  • The raw JSON from your service-account .json file, OR\n" +
    "  • Its base64 encoding (run: base64 -i service-account.json | tr -d '\\n')\n" +
    `  Raw value starts with: "${trimmed.slice(0, 40)}…" (length=${trimmed.length})`
  );
  return null;
}

/**
 * Called once at server startup to log whether Google Play verification is
 * available. Does NOT throw — startup must succeed regardless.
 */
export function logGooglePlayVerificationStatus(): void {
  console.log("[ECOLOGIC-GPLAY] ── Service account key startup check ──");
  const diag = diagnoseServiceAccountKey();
  console.log(
    `[ECOLOGIC-GPLAY] present=${diag.present} length=${diag.length}` +
    ` detectedFormat=${diag.detectedFormat} parsed=${diag.parsed}` +
    (diag.clientEmail ? ` clientEmail=${diag.clientEmail}` : "") +
    (diag.error ? ` error="${diag.error}"` : "")
  );
  if (diag.parsed) {
    console.log(
      `[ECOLOGIC-GPLAY] Google Play verification configured: yes` +
      ` (account=${diag.clientEmail} package=${GOOGLE_PLAY_PACKAGE_NAME})`
    );
  } else {
    console.log(
      "[ECOLOGIC-GPLAY] Google Play verification configured: no" +
      " — Android subscription validation will return 422 until GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is set correctly."
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
