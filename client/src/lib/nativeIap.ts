/**
 * Native IAP helpers for Apple in-app purchases.
 *
 * Uses @capgo/native-purchases, which wraps StoreKit 2 on iOS 15+.
 * All functions here are safe to import on web — they short-circuit when
 * not running on native iOS so they never break the web flow.
 *
 * PUBLIC API
 *   isNativeIos()                      — true only when running in the iOS Capacitor wrapper
 *   loadAppleProducts()                — load products from the App Store with real pricing
 *   purchaseAppleSubscription(id)      — trigger native purchase sheet, returns JWS string
 *   restoreApplePurchases()            — restore most recent active subscription, returns JWS | null
 */

import { isNativePlatform, getPlatform } from "@/lib/capacitor";
import { subscriptionPlans, appleProductIdToPlanKey } from "@shared/subscriptionPlans";

// ─── Platform detection ───────────────────────────────────────────────────────

export function isNativeIos(): boolean {
  return isNativePlatform() && getPlatform() === "ios";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IapProduct {
  identifier: string;   // Apple product ID, e.g. "com.ecologic.app.team.monthly"
  planKey: string;      // EcoLogic plan key, e.g. "team"
  priceString: string;  // Localised, e.g. "$79.99"
  title: string;
  description: string;
}

// ─── Product loading ──────────────────────────────────────────────────────────

const ALL_APPLE_PRODUCT_IDS = Object.values(subscriptionPlans).map(p => p.appleProductId);

/**
 * Load available Apple subscription products for the current App Store locale.
 * Returns an empty array if the plugin is not available or products fail to load.
 */
export async function loadAppleProducts(): Promise<IapProduct[]> {
  if (!isNativeIos()) return [];

  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
    console.log("[native-iap] loading products:", ALL_APPLE_PRODUCT_IDS.join(", "));

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

    console.log(`[native-iap] ${mapped.length} product(s) loaded`);
    return mapped;
  } catch (err: any) {
    console.error("[native-iap] loadAppleProducts failed:", err.message);
    return [];
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

/**
 * Trigger the native Apple purchase sheet for the given product ID.
 *
 * Resolves with the StoreKit 2 JWS transaction string on success.
 * Throws if the purchase is cancelled, fails, or JWS is missing.
 */
export async function purchaseAppleSubscription(productId: string): Promise<string> {
  console.log("[native-iap] purchase started — productId:", productId);

  const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    productType: PURCHASE_TYPE.SUBS,
  });

  console.log("[native-iap] purchase succeeded — transactionId:", transaction.transactionId);

  const jws = transaction.jwsRepresentation;
  if (!jws) {
    throw new Error(
      "[native-iap] Purchase completed but jwsRepresentation is missing. " +
      "Ensure you are running iOS 15+ (StoreKit 2 requirement)."
    );
  }

  console.log("[native-iap] JWS obtained, length:", jws.length);
  return jws;
}

// ─── Restore ──────────────────────────────────────────────────────────────────

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
  console.log("[native-iap] restore started");

  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

    // getPurchases returns all current entitlements (already verified by StoreKit)
    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
    });

    console.log(`[native-iap] restore found ${purchases.length} purchase(s)`);

    // Find a purchase for one of our products that has a JWS token
    for (const tx of purchases) {
      const pid = (tx as any).productIdentifier ?? "";
      const isKnown = ALL_APPLE_PRODUCT_IDS.includes(pid);
      const hasJws = !!tx.jwsRepresentation;

      if (isKnown && hasJws) {
        console.log("[native-iap] restore — matched productId:", pid);
        return tx.jwsRepresentation!;
      }

      // Log why we skipped this purchase so it's easy to debug
      if (!isKnown) console.log("[native-iap] restore — skipping unknown productId:", pid);
      if (!hasJws) console.log("[native-iap] restore — skipping tx with no JWS, productId:", pid);
    }

    console.log("[native-iap] restore — no restorable EcoLogic subscription found");
    return null;
  } catch (err: any) {
    console.error("[native-iap] restore failed:", err.message);
    return null;
  }
}
