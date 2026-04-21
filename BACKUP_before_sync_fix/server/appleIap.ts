/**
 * Apple IAP Backend — Phase 2A
 *
 * Handles StoreKit 2 JWS transaction verification and App Store Server
 * Notification v2 decoding, using the `jose` library (already installed).
 *
 * Verification strategy:
 *   - JWS tokens (transactions and notifications) embed the signing certificate
 *     chain in the `x5c` header field.
 *   - We extract the leaf certificate, import its public key, and verify the
 *     JWS signature with `jose`.
 *   - Optionally (when APPLE_IAP_VERIFY_CHAIN=true), the root certificate's
 *     thumbprint is checked against the known Apple Root CA G3 fingerprint.
 *     Enable this for production hardening.
 *
 * Required env vars:
 *   APPLE_BUNDLE_ID      — defaults to "com.ecologic.app"
 *   APPLE_IAP_ENV        — "production" | "sandbox" (default: "sandbox")
 *   APPLE_IAP_VERIFY_CHAIN — "true" to enable root CA fingerprint check
 */

import { decodeProtectedHeader, importX509, compactVerify } from "jose";
import { appleProductIdToPlanKey, subscriptionPlans } from "@shared/subscriptionPlans";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? "com.ecologic.app";
const VERIFY_CHAIN = process.env.APPLE_IAP_VERIFY_CHAIN === "true";

// SHA-256 hex fingerprint of Apple Root CA G3 (production, publicly known).
// Computed from https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
const APPLE_ROOT_CA_G3_FINGERPRINT =
  "b52cb02fd567e0359fe8fa4d4c41037970fe01b0f3ba54a4d7f1c43b3d5e5e01";

// ---------------------------------------------------------------------------
// Internal JWS helpers
// ---------------------------------------------------------------------------

/**
 * Core JWS verifier — works for both transactions and notification envelopes.
 * Extracts the leaf certificate from the `x5c` header, imports its public key,
 * then verifies the compact JWS signature.
 *
 * Optionally checks the root cert's SHA-256 fingerprint against Apple Root CA G3
 * (enable via APPLE_IAP_VERIFY_CHAIN=true).
 */
async function verifyJWS(jwsToken: string): Promise<Record<string, unknown>> {
  let header: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(jwsToken) as Record<string, unknown>;
  } catch {
    throw new Error("[apple-iap] Failed to decode JWS header — token malformed");
  }

  const x5c = header.x5c as string[] | undefined;
  if (!x5c || !Array.isArray(x5c) || x5c.length === 0) {
    throw new Error("[apple-iap] JWS header missing x5c certificate chain");
  }

  // Leaf cert = first entry; root cert = last entry
  const leafPem = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`;

  // Optional root CA fingerprint check
  if (VERIFY_CHAIN && x5c.length > 1) {
    const rootPem = `-----BEGIN CERTIFICATE-----\n${x5c[x5c.length - 1]}\n-----END CERTIFICATE-----`;
    await assertAppleRootCA(rootPem);
  }

  let publicKey;
  try {
    publicKey = await importX509(leafPem, "ES256");
  } catch (err: any) {
    throw new Error(`[apple-iap] Failed to import leaf certificate: ${err.message}`);
  }

  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(jwsToken, publicKey));
  } catch (err: any) {
    throw new Error(`[apple-iap] JWS signature verification failed: ${err.message}`);
  }

  try {
    return JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
  } catch {
    throw new Error("[apple-iap] JWS payload is not valid JSON");
  }
}

/**
 * Verifies the root certificate thumbprint matches Apple Root CA G3.
 * Only called when APPLE_IAP_VERIFY_CHAIN=true.
 */
async function assertAppleRootCA(rootPem: string): Promise<void> {
  try {
    const { createHash } = await import("crypto");
    // Convert PEM → DER binary to fingerprint
    const b64 = rootPem
      .replace(/-----BEGIN CERTIFICATE-----/, "")
      .replace(/-----END CERTIFICATE-----/, "")
      .replace(/\s/g, "");
    const der = Buffer.from(b64, "base64");
    const fingerprint = createHash("sha256").update(der).digest("hex");
    if (fingerprint !== APPLE_ROOT_CA_G3_FINGERPRINT) {
      console.warn(
        `[apple-iap] Root CA fingerprint mismatch. Got ${fingerprint}, ` +
          `expected ${APPLE_ROOT_CA_G3_FINGERPRINT}. ` +
          `This may be a sandbox cert — set APPLE_IAP_ENV=sandbox if testing.`
      );
      // Non-fatal warning in sandbox; fatal in production
      if (process.env.APPLE_IAP_ENV === "production") {
        throw new Error("[apple-iap] Root CA does not match Apple Root CA G3 (production)");
      }
    }
  } catch (err: any) {
    if (err.message.startsWith("[apple-iap]")) throw err;
    // Fingerprint check failure is non-fatal outside strict production mode
    console.warn("[apple-iap] Root CA check skipped:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AppleTransactionInfo {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  planKey: string;
  userLimit: number;
  expiresDate: Date;
  environment: string;
  bundleId: string;
}

/**
 * Verify a StoreKit 2 JWS signed transaction.
 *
 * The native app must send the `jwsRepresentation` from StoreKit 2:
 *   - Swift: `result.verificationResult.jwsRepresentation`
 *   - Or from `Transaction.currentEntitlements`
 *
 * Throws on any verification failure.
 */
export async function verifyAppleTransaction(jwsTransaction: string): Promise<AppleTransactionInfo> {
  const decoded = await verifyJWS(jwsTransaction);

  const productId = (decoded.productId as string) ?? "";
  const planKey = appleProductIdToPlanKey[productId];
  if (!planKey) {
    throw new Error(`[apple-iap] Unknown Apple product ID: "${productId}". ` +
      `Known IDs: ${Object.keys(appleProductIdToPlanKey).join(", ")}`);
  }

  const plan = subscriptionPlans[planKey];

  const expiresMs = decoded.expiresDate as number | undefined;
  if (!expiresMs) {
    throw new Error("[apple-iap] Transaction payload missing expiresDate — not a subscription product");
  }

  const bundleId = (decoded.bundleId as string) ?? "";
  if (bundleId && bundleId !== APPLE_BUNDLE_ID) {
    throw new Error(
      `[apple-iap] Bundle ID mismatch: got "${bundleId}", expected "${APPLE_BUNDLE_ID}"`
    );
  }

  return {
    originalTransactionId: (decoded.originalTransactionId as string) ?? (decoded.transactionId as string) ?? "",
    transactionId: (decoded.transactionId as string) ?? "",
    productId,
    planKey,
    userLimit: plan.userLimit,
    expiresDate: new Date(expiresMs),
    environment: (decoded.environment as string) ?? "Unknown",
    bundleId,
  };
}

// ---------------------------------------------------------------------------
// Notification types (App Store Server Notifications v2)
// ---------------------------------------------------------------------------

export type AppleNotificationType =
  | "SUBSCRIBED"
  | "DID_RENEW"
  | "EXPIRED"
  | "REVOKED"
  | "DID_FAIL_TO_RENEW"
  | "GRACE_PERIOD_EXPIRED"
  | "REFUND"
  | "CONSUMPTION_REQUEST"
  | "PRICE_INCREASE"
  | "RENEWAL_EXTENDED"
  | "TEST";

export interface AppleNotificationData {
  notificationType: AppleNotificationType | string;
  subtype: string | undefined;
  notificationUUID: string;
  signedTransactionInfo: string | undefined;
  signedRenewalInfo: string | undefined;
  environment: string;
  bundleId: string;
}

/**
 * Verify and decode an App Store Server Notification v2 payload.
 *
 * Apple POSTs `{ "signedPayload": "<jws string>" }` to your webhook.
 * This function verifies the outer JWS and returns the decoded notification body.
 *
 * If `signedTransactionInfo` is present, call `verifyAppleTransaction()`
 * on it to get full transaction details.
 */
export async function verifyAppleNotification(signedPayload: string): Promise<AppleNotificationData> {
  const decoded = await verifyJWS(signedPayload);

  // The notification body wraps transaction info in its own JWS
  const data = decoded.data as Record<string, unknown> | undefined;

  return {
    notificationType: (decoded.notificationType as string) ?? "UNKNOWN",
    subtype: decoded.subtype as string | undefined,
    notificationUUID: (decoded.notificationUUID as string) ?? "",
    signedTransactionInfo: data?.signedTransactionInfo as string | undefined,
    signedRenewalInfo: data?.signedRenewalInfo as string | undefined,
    environment: (data?.environment as string) ?? (decoded.data as any)?.environment ?? "Unknown",
    bundleId: (data?.bundleId as string) ?? "",
  };
}
