/**
 * Native IAP helpers for Apple (iOS) and Google Play (Android) in-app purchases.
 *
 * Uses @capgo/native-purchases, which wraps:
 *   - StoreKit 2 on iOS 15+
 *   - Google Play Billing Library on Android
 *
 * All functions are safe to import on web — they short-circuit when not running
 * in a native Capacitor context so they never break the web Stripe flow.
 *
 * ── APPLE (iOS) ──────────────────────────────────────────────────────────────
 *   isNativeIos()                           — true only in the iOS Capacitor wrapper
 *   loadAppleProducts()                     — load App Store products with real pricing
 *   purchaseAppleSubscription(productId)    — trigger purchase sheet → JWS string
 *   restoreApplePurchases()                 — restore entitlements → JWS | null
 *
 * ── GOOGLE PLAY (Android) ────────────────────────────────────────────────────
 *   isNativeAndroid()                       — true only in the Android Capacitor wrapper
 *   loadGooglePlayProducts()                — load Play Store products with real pricing
 *   purchaseGooglePlaySubscription(id)      — trigger purchase → { purchaseToken, productId }
 *   restoreGooglePlayPurchases()            — restore purchases → { purchaseToken, productId } | null
 */

import { isNativePlatform, getPlatform } from "@/lib/capacitor";
import {
  subscriptionPlans,
  appleProductIdToPlanKey,
  googlePlayProductIdToPlanKey,
} from "@shared/subscriptionPlans";

// ─── Platform detection ───────────────────────────────────────────────────────

export function isNativeIos(): boolean {
  return isNativePlatform() && getPlatform() === "ios";
}

export function isNativeAndroid(): boolean {
  return isNativePlatform() && getPlatform() === "android";
}

// ─── Shared types ─────────────────────────────────────────────────────────────

/** A store product (App Store or Google Play) mapped to an EcoLogic plan. */
export interface IapProduct {
  identifier: string;      // Store product ID, e.g. "ecologic_team_monthly"
  planKey: string;         // EcoLogic plan key, e.g. "team"
  priceString: string;     // Localised price, e.g. "$79.99"
  title: string;
  description: string;
  /** Android only — base plan ID required by Play Billing Library 5+, e.g. "monthly" */
  planIdentifier?: string;
}

/** Result of a Google Play purchase — both fields are needed for backend validation. */
export interface GooglePlayPurchaseResult {
  purchaseToken: string;
  productId: string;
}

// ─── Product ID lists ─────────────────────────────────────────────────────────

const ALL_APPLE_PRODUCT_IDS = Object.values(subscriptionPlans).map(p => p.appleProductId);
const ALL_GOOGLE_PLAY_PRODUCT_IDS = Object.values(subscriptionPlans).map(p => p.googlePlayProductId);

// ─── APPLE — Product loading ──────────────────────────────────────────────────

/**
 * Load available Apple subscription products for the current App Store locale.
 * Returns an empty array if the plugin is not available or products fail to load.
 */
export async function loadAppleProducts(): Promise<IapProduct[]> {
  if (!isNativeIos()) return [];

  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
    console.log("[native-iap] loading Apple products:", ALL_APPLE_PRODUCT_IDS.join(", "));

    const { products } = await NativePurchases.getProducts({
      productIdentifiers: ALL_APPLE_PRODUCT_IDS,
      productType: PURCHASE_TYPE.SUBS,
    });

    const mapped: IapProduct[] = products
      .filter(p => !!appleProductIdToPlanKey[p.identifier])
      .map(p => ({
        identifier: p.identifier,
        planKey: appleProductIdToPlanKey[p.identifier],
        priceString: p.priceString,
        title: p.title,
        description: p.description,
      }));

    console.log(`[native-iap] Apple: ${mapped.length} product(s) loaded`);
    return mapped;
  } catch (err: any) {
    console.error("[native-iap] loadAppleProducts failed:", err.message);
    return [];
  }
}

// ─── APPLE — Purchase ─────────────────────────────────────────────────────────

/**
 * Trigger the native Apple purchase sheet for the given product ID.
 *
 * Resolves with the StoreKit 2 JWS transaction string on success.
 * Throws if the purchase is cancelled, fails, or JWS is missing.
 *
 * ── Upgrade safety ─────────────────────────────────────────────────────────
 * When upgrading within the same Apple subscription group (e.g. starter →
 * team), the `transaction.jwsRepresentation` returned directly by
 * `purchaseProduct` may contain the OLD subscription's JWS — because Apple
 * processes the group upgrade server-side and the callback can reflect the
 * original entitlement.
 *
 * Fix: after purchase, call getPurchases() and look for the current
 * entitlement with productIdentifier === targetProductId. Use THAT JWS so
 * the backend validates the new plan, not the old one. The direct
 * transaction JWS is kept as a fallback.
 */
export async function purchaseAppleSubscription(productId: string): Promise<string> {
  console.log("[native-iap] Apple purchase started — productId:", productId);

  const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    productType: PURCHASE_TYPE.SUBS,
  });

  const txProductId = (transaction as any).productIdentifier ?? "";
  const directJws = transaction.jwsRepresentation ?? null;

  // ── Fast path: transaction is already for the purchased product ───────────
  if (txProductId === productId && directJws) {
    return directJws;
  }

  // Product mismatch — Apple may be treating this as a deferred change.
  // (App Store Connect group levels must be Scale=1 > Pro=2 > Team=3 > Starter=4
  // for upgrades to take effect immediately.)
  console.warn(`[native-iap] Apple: transaction productIdentifier=${txProductId} does not match purchased=${productId} — searching entitlements.`);

  // ── Entitlement lookup with retry ─────────────────────────────────────────
  // For subscription group upgrades Apple propagates the entitlement change
  // server-side, which can take 1–5 seconds. Retry getPurchases() up to 3
  // times (with 1.5 s delay) to give Apple time to surface the new product.
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 1500;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

    try {
      const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS });

      for (const tx of purchases) {
        const pid = (tx as any).productIdentifier ?? "";
        if (pid === productId && tx.jwsRepresentation) {
          return tx.jwsRepresentation;
        }
      }
    } catch (err: any) {
      console.warn("[native-iap] Apple getPurchases failed:", err.message);
      break;
    }
  }

  // ── Last resort: direct transaction JWS ──────────────────────────────────
  // Neither the fast path nor getPurchases() found a clean JWS for the target
  // product. Use whatever the purchase callback gave us. The backend will
  // verify it and log what productId it actually contains.
  if (!directJws) {
    throw new Error(
      "[native-iap] Purchase completed but no JWS available (directJws missing and entitlement not found). " +
      "Ensure you are running iOS 15+ (StoreKit 2 requirement)."
    );
  }

  return directJws;
}

// ─── APPLE — Restore ──────────────────────────────────────────────────────────

/**
 * Restore Apple purchases and return the JWS of the most recent valid subscription.
 *
 * Strategy:
 *   1. Call getPurchases() to get all current entitlements from StoreKit 2.
 *   2. Filter to our known Apple product IDs.
 *   3. Return the first available JWS for backend validation.
 *
 * Returns null if no active/restorable subscription is found.
 */
export async function restoreApplePurchases(): Promise<string | null> {
  console.log("[native-iap] Apple restore started");

  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
    });

    console.log(`[native-iap] Apple restore found ${purchases.length} purchase(s)`);

    for (const tx of purchases) {
      const pid = (tx as any).productIdentifier ?? "";
      const isKnown = ALL_APPLE_PRODUCT_IDS.includes(pid);
      const hasJws = !!tx.jwsRepresentation;

      if (isKnown && hasJws) {
        console.log("[native-iap] Apple restore — matched productId:", pid);
        return tx.jwsRepresentation!;
      }

      if (!isKnown) console.log("[native-iap] Apple restore — skipping unknown productId:", pid);
      if (!hasJws) console.log("[native-iap] Apple restore — skipping tx with no JWS, productId:", pid);
    }

    console.log("[native-iap] Apple restore — no restorable EcoLogic subscription found");
    return null;
  } catch (err: any) {
    console.error("[native-iap] Apple restore failed:", err.message);
    return null;
  }
}

// ─── GOOGLE PLAY — Product loading ────────────────────────────────────────────

/** Diagnostic result returned alongside products — Android only. */
export interface GooglePlayLoadResult {
  products: IapProduct[];
  error: string | null;
  rawCount: number;
}

export async function loadGooglePlayProducts(): Promise<IapProduct[]> {
  const { products } = await loadGooglePlayProductsDiag();
  return products;
}

/**
 * Same as loadGooglePlayProducts but returns a diagnostic result object so the
 * calling component can surface the error and raw count in the debug UI.
 */
export async function loadGooglePlayProductsDiag(): Promise<GooglePlayLoadResult> {
  if (!isNativeAndroid()) return { products: [], error: null, rawCount: 0 };

  console.log("[ECOLOGIC-IAP] ══ Google Play product load START ══");
  console.log("[ECOLOGIC-IAP] Platform:", getPlatform());
  console.log("[ECOLOGIC-IAP] Requested product IDs:", JSON.stringify(ALL_GOOGLE_PLAY_PRODUCT_IDS));

  try {
    let NativePurchases: any;
    let PURCHASE_TYPE: any;
    try {
      const mod = await import("@capgo/native-purchases");
      NativePurchases = mod.NativePurchases;
      PURCHASE_TYPE = mod.PURCHASE_TYPE;
      console.log("[ECOLOGIC-IAP] Plugin import OK — NativePurchases:", !!NativePurchases);
    } catch (importErr: any) {
      const msg = `Plugin import failed: ${importErr?.message ?? String(importErr)}`;
      console.error("[ECOLOGIC-IAP] FATAL —", msg);
      return { products: [], error: msg, rawCount: 0 };
    }

    console.log("[ECOLOGIC-IAP] Calling NativePurchases.getProducts with PURCHASE_TYPE.SUBS …");
    const { products: rawProducts } = await NativePurchases.getProducts({
      productIdentifiers: ALL_GOOGLE_PLAY_PRODUCT_IDS,
      productType: PURCHASE_TYPE.SUBS,
    });

    console.log(`[ECOLOGIC-IAP] Raw response: ${rawProducts.length} product(s) returned by Google Play`);

    if (rawProducts.length === 0) {
      const warn =
        "[ECOLOGIC-IAP] 0 products returned. Diagnose:\n" +
        "  1) Do these IDs exist in Play Console → Monetize → Subscriptions?\n" +
        `     ${ALL_GOOGLE_PLAY_PRODUCT_IDS.join(", ")}\n` +
        "  2) Are subscriptions ACTIVE (not draft) in Play Console?\n" +
        "  3) Is the app published to Internal Testing track?\n" +
        "  4) Is the Samsung's Google account added as a tester + accepted opt-in link?\n" +
        "  5) Is this APK release-signed with the SAME key registered in Play Console?";
      console.warn(warn);
      return { products: [], error: "0 products returned from Google Play. See [ECOLOGIC-IAP] logcat for diagnosis.", rawCount: 0 };
    }

    // Log every raw product the store returned
    rawProducts.forEach((p: any, i: number) => {
      const raw = p as any;
      const offerDetails = raw.subscriptionOfferDetails;
      console.log(
        `[ECOLOGIC-IAP] Raw[${i}]:`,
        `id="${p.identifier}"`,
        `price="${p.priceString}"`,
        `title="${p.title}"`,
        `basePlanId="${raw.subscriptionOfferDetails?.[0]?.basePlanId ?? raw.basePlanId ?? "(none)"}"`,
        `offerDetails=${offerDetails ? JSON.stringify(offerDetails).slice(0, 200) : "(none)"}`
      );
    });

    const mapped: IapProduct[] = rawProducts
      .filter((p: any) => !!googlePlayProductIdToPlanKey[p.identifier])
      .map((p: any) => {
        const planKey = googlePlayProductIdToPlanKey[p.identifier];
        const raw = p as any;
        const planIdentifier: string =
          raw.subscriptionOfferDetails?.[0]?.basePlanId ||
          raw.basePlanId ||
          subscriptionPlans[planKey]?.googlePlayPlanIdentifier ||
          "monthly";

        console.log(`[ECOLOGIC-IAP] Mapped: id="${p.identifier}" → planKey="${planKey}" planIdentifier="${planIdentifier}" price="${p.priceString}"`);
        return {
          identifier: p.identifier,
          planKey,
          priceString: p.priceString,
          title: p.title,
          description: p.description,
          planIdentifier,
        };
      });

    const unmapped = rawProducts.filter((p: any) => !googlePlayProductIdToPlanKey[p.identifier]);
    if (unmapped.length > 0) {
      console.warn(
        `[ECOLOGIC-IAP] ${unmapped.length} product(s) from Play Store did NOT match any known plan ID:`,
        unmapped.map((p: any) => p.identifier).join(", ")
      );
    }

    console.log(`[ECOLOGIC-IAP] ══ Google Play product load DONE: ${mapped.length}/${rawProducts.length} mapped ══`);
    return { products: mapped, error: null, rawCount: rawProducts.length };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const stack = err?.stack ?? "(no stack)";
    console.error("[ECOLOGIC-IAP] loadGooglePlayProducts THREW:", msg);
    console.error("[ECOLOGIC-IAP] Full error object:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    console.error("[ECOLOGIC-IAP] Stack:", stack);
    return { products: [], error: msg, rawCount: 0 };
  }
}

// ─── GOOGLE PLAY — Purchase ───────────────────────────────────────────────────

/**
 * Trigger the native Google Play purchase flow for the given product ID.
 *
 * Resolves with { purchaseToken, productId } on success — both are required
 * by the backend's POST /api/subscriptions/validate endpoint.
 *
 * Throws if the purchase is cancelled, fails, or purchaseToken is missing.
 */
export async function purchaseGooglePlaySubscription(
  productId: string,
  planIdentifier?: string
): Promise<GooglePlayPurchaseResult> {
  const resolvedPlanId = planIdentifier || "monthly";
  console.log(
    "[native-iap] Google Play purchase — productId:", productId,
    "planIdentifier:", resolvedPlanId
  );

  const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    planIdentifier: resolvedPlanId,
    productType: PURCHASE_TYPE.SUBS,
  });

  console.log("[native-iap] Google Play purchase succeeded — transactionId:", transaction.transactionId);

  // On Android, @capgo/native-purchases exposes purchaseToken on the transaction object
  const purchaseToken = (transaction as any).purchaseToken as string | undefined;

  if (!purchaseToken) {
    throw new Error(
      "[native-iap] Google Play purchase completed but purchaseToken is missing. " +
      "Check that @capgo/native-purchases is up to date and running on Android."
    );
  }

  console.log("[native-iap] Google Play purchaseToken obtained, length:", purchaseToken.length);
  return { purchaseToken, productId };
}

// ─── GOOGLE PLAY — Restore ────────────────────────────────────────────────────

/**
 * Restore Google Play purchases and return the token + productId of the most
 * recent valid EcoLogic subscription.
 *
 * Strategy:
 *   1. Call getPurchases() to get all active / acknowledged purchases.
 *   2. Filter to our known Google Play product IDs.
 *   3. Return { purchaseToken, productId } of the first match.
 *
 * Returns null if no active/restorable subscription is found.
 */
export async function restoreGooglePlayPurchases(): Promise<GooglePlayPurchaseResult | null> {
  console.log("[native-iap] Google Play restore started");

  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
    });

    console.log(`[native-iap] Google Play restore found ${purchases.length} purchase(s)`);

    for (const tx of purchases) {
      const pid = (tx as any).productIdentifier ?? "";
      const token = (tx as any).purchaseToken as string | undefined;
      const isKnown = ALL_GOOGLE_PLAY_PRODUCT_IDS.includes(pid);
      const hasToken = !!token;

      if (isKnown && hasToken) {
        console.log("[native-iap] Google Play restore — matched productId:", pid);
        return { purchaseToken: token!, productId: pid };
      }

      if (!isKnown) console.log("[native-iap] Google Play restore — skipping unknown productId:", pid);
      if (!hasToken) console.log("[native-iap] Google Play restore — skipping tx with no purchaseToken, productId:", pid);
    }

    console.log("[native-iap] Google Play restore — no restorable EcoLogic subscription found");
    return null;
  } catch (err: any) {
    console.error("[native-iap] Google Play restore failed:", err.message);
    return null;
  }
}
