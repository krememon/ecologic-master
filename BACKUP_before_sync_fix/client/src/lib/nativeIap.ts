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

/**
 * Result of a successful Apple purchase or restore.
 *
 * `actualProductId` is the productIdentifier of the CHOSEN live entitlement —
 * which may differ from the productId the user clicked (Apple subscription
 * group mechanics). Callers MUST derive expectedPlanKey from actualProductId,
 * NOT from the clicked button, so the backend validates the real entitlement.
 */
export interface ApplePurchaseResult {
  jwsTransaction: string;
  /** The Apple productIdentifier of the chosen entitlement (may ≠ clicked product). */
  actualProductId: string;
}

/** A store product (App Store or Google Play) mapped to an EcoLogic plan. */
export interface IapProduct {
  identifier: string;      // Store product ID, e.g. "ecologic_team_monthly"
  planKey: string;         // EcoLogic plan key, e.g. "team"
  /** Always the regular monthly price — never the trial phase $0.00 price. */
  priceString: string;     // Localised price, e.g. "$79.99"
  title: string;
  description: string;
  /** Android only — base plan ID required by Play Billing Library 5+, e.g. "monthly" */
  planIdentifier?: string;
  /** Android only — the offerToken for the selected offer (trial or base). Logged on purchase. */
  offerToken?: string;
  /** Android only — null for base plan offers, e.g. "free-trial" for promotional offers. */
  offerId?: string | null;
  /** Android only — true when the selected offer has a free trial pricing phase. */
  hasTrial?: boolean;
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
 * Returns `{ jwsTransaction, actualProductId }` where `actualProductId` is
 * the productIdentifier of the CHOSEN live entitlement — which may differ from
 * `productId` (the clicked button) when the user is in an Apple subscription
 * group and a different plan is currently active.
 *
 * Callers MUST use `actualProductId` to derive `expectedPlanKey` for the
 * backend — never send the clicked planKey when the actual entitlement is a
 * different product. The backend derives plan from the JWS productId; forcing a
 * different `expectedPlanKey` activates the deferred-downgrade path which may
 * write the wrong expiry to the DB.
 *
 * ── Entitlement selection (ranked) ───────────────────────────────────────────
 * When `purchaseProduct()` returns a different productId (group-level
 * deferred change), we call `getPurchases()` and rank all known EcoLogic
 * entitlements:
 *
 *   Rank A — non-expired + exact clicked product
 *   Rank B — non-expired + any group member + latest expiration date
 *   Rank C — directJws from purchaseProduct() (Apple's most-recent transaction)
 *
 * An expired exact-match entitlement is NEVER chosen over a live different
 * entitlement. The backend's `expiresDate` guard is a second safety net but
 * client-side selection is the first line of defense.
 *
 * Expiration detection uses `(tx as any).expirationDate` (StoreKit 2 field
 * exposed by @capgo/native-purchases). If the field is absent or zero, the
 * entitlement is treated as "unknown / possibly active" and sorted to the
 * front only if no other candidate has a known future expiry.
 */
export async function purchaseAppleSubscription(productId: string): Promise<ApplePurchaseResult> {
  console.log("[native-iap] Apple purchase started — productId:", productId);

  const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    productType: PURCHASE_TYPE.SUBS,
  });

  const txProductId = (transaction as any).productIdentifier ?? "";
  const directJws = transaction.jwsRepresentation ?? null;

  console.log(`[native-iap] Apple purchaseProduct() returned productId=${txProductId} clickedProductId=${productId} hasDirectJws=${!!directJws}`);

  // ── Fast path: transaction is already for the clicked product ─────────────
  if (txProductId === productId && directJws) {
    console.log(`[native-iap] Apple: fast path — exact product returned by StoreKit, using directJws`);
    return { jwsTransaction: directJws, actualProductId: txProductId };
  }

  // ── Product mismatch — Apple is signalling a different group entitlement ──
  // This happens when:
  //   - The user has a higher-tier subscription (e.g. scale) and tries to buy
  //     a lower tier (e.g. team) — Apple defers the switch and returns the
  //     current active subscription (scale) as the live transaction.
  //   - The user tries to buy the same plan they already have (NOP).
  //
  // Strategy: call getPurchases() to enumerate all current entitlements.
  // Pick the one that is:
  //   A) non-expired + exact clicked product
  //   B) non-expired + any known EcoLogic product + latest expiry
  //   C) directJws from purchaseProduct() (Apple's explicit answer)
  //
  // NEVER pick an expired exact match over a live different entitlement.
  console.warn(
    `[native-iap] Apple: purchaseProduct returned ${txProductId} ≠ clicked ${productId}` +
    ` — ranking entitlements from getPurchases()`
  );

  interface RankedEntitlement {
    pid: string;
    jws: string;
    expiresAtMs: number;   // 0 = unknown
    isExact: boolean;
    isExpired: boolean;
  }

  const now = Date.now();
  let rankedEntitlements: RankedEntitlement[] = [];

  try {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS });
    console.log(`[native-iap] Apple getPurchases() returned ${purchases.length} entitlement(s):`);

    for (let i = 0; i < purchases.length; i++) {
      const tx = purchases[i] as any;
      const pid: string = tx.productIdentifier ?? "";
      const jws: string | null = tx.jwsRepresentation ?? null;

      // Normalise the expirationDate — StoreKit 2 can return a Date object,
      // a numeric ms timestamp, or an ISO-8601 string. Treat absent as 0 (unknown).
      let expiresAtMs = 0;
      const rawExpiry = tx.expirationDate ?? tx.expiresDate ?? tx.expiration_date ?? null;
      if (rawExpiry) {
        const parsed = typeof rawExpiry === "number" ? rawExpiry : new Date(rawExpiry).getTime();
        if (!isNaN(parsed)) expiresAtMs = parsed;
      }

      const isExpired = expiresAtMs > 0 && expiresAtMs < now;
      const isKnown = ALL_APPLE_PRODUCT_IDS.includes(pid);
      const isExact = pid === productId;

      console.log(
        `[native-iap]   [${i}] productId=${pid} hasJws=${!!jws}` +
        ` expiresAt=${expiresAtMs > 0 ? new Date(expiresAtMs).toISOString() : "(unknown)"}` +
        ` expired=${isExpired} exact=${isExact} known=${isKnown}`
      );

      if (!jws || !isKnown) continue;
      rankedEntitlements.push({ pid, jws, expiresAtMs, isExact, isExpired });
    }
  } catch (err: any) {
    console.warn("[native-iap] Apple getPurchases() failed:", err.message);
    rankedEntitlements = [];
  }

  // ── Rank A: non-expired + exact clicked product ───────────────────────────
  const exactActive = rankedEntitlements.find(e => e.isExact && !e.isExpired);
  if (exactActive) {
    console.log(
      `[native-iap] Apple: chosen entitlement=${exactActive.pid}` +
      ` expiresAt=${exactActive.expiresAtMs > 0 ? new Date(exactActive.expiresAtMs).toISOString() : "(unknown)"}` +
      ` reason=exact-clicked-product-active`
    );
    return { jwsTransaction: exactActive.jws, actualProductId: exactActive.pid };
  }

  // ── Rank B: non-expired + any group member, pick latest expiry ────────────
  const activeEntitlements = rankedEntitlements
    .filter(e => !e.isExpired)
    .sort((a, b) => b.expiresAtMs - a.expiresAtMs);   // latest expiry first

  if (activeEntitlements.length > 0) {
    const best = activeEntitlements[0];
    const skippedExact = rankedEntitlements.some(e => e.isExact && e.isExpired);
    console.log(
      `[native-iap] Apple: chosen entitlement=${best.pid}` +
      ` expiresAt=${best.expiresAtMs > 0 ? new Date(best.expiresAtMs).toISOString() : "(unknown)"}` +
      ` reason=group-active-latest-expiry` +
      (skippedExact ? ` (exact clicked ${productId} was expired — skipped)` : "")
    );
    return { jwsTransaction: best.jws, actualProductId: best.pid };
  }

  // ── Rank C: directJws — Apple's explicit answer from purchaseProduct() ────
  // All getPurchases() entitlements are expired (or getPurchases failed).
  // directJws is what Apple returned when we called purchaseProduct() —
  // it represents the most recently processed StoreKit transaction.
  // Let the server's expiry guard make the final call.
  if (directJws && txProductId) {
    console.log(
      `[native-iap] Apple: chosen entitlement=${txProductId}` +
      ` reason=directJws-all-getpurchases-entitlements-expired-or-unavailable`
    );
    return { jwsTransaction: directJws, actualProductId: txProductId };
  }

  throw new Error(
    "[native-iap] Purchase completed but no valid JWS could be found. " +
    "All known entitlements are expired and no direct transaction JWS is available. " +
    "Please restore your subscription from App Store Settings."
  );
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

/**
 * Title-to-plan-key fallback for Android.
 *
 * Google Play Billing Library 5+ can return the base plan ID ("monthly") as the
 * product identifier instead of the subscription product ID. When that happens,
 * we use the product title to identify which plan the product corresponds to.
 *
 * Titles come from Play Console and are expected to be exactly:
 *   "Starter", "Team", "Pro", "Scale"
 * but we match case-insensitively and check for containment to be safe.
 */
function titleToPlanKey(title: string): string | null {
  const t = title.trim().toLowerCase();
  if (t === "starter" || t.includes("starter")) return "starter";
  if (t === "team"    || t.includes("team"))    return "team";
  if (t === "pro"     || t.includes("pro"))     return "pro";
  if (t === "scale"   || t.includes("scale"))   return "scale";
  return null;
}

export async function loadGooglePlayProducts(): Promise<IapProduct[]> {
  const { products } = await loadGooglePlayProductsDiag();
  return products;
}

/**
 * Same as loadGooglePlayProducts but returns a diagnostic result object so the
 * calling component can surface the error and raw count in the debug UI.
 *
 * Mapping strategy (Android):
 *   1. Exact ID match:  googlePlayProductIdToPlanKey[p.identifier]
 *   2. Title fallback:  titleToPlanKey(p.title)
 *
 * When the title fallback is used (i.e. the plugin returned "monthly" as the
 * identifier), `identifier` in the returned IapProduct is set to the real
 * subscription product ID from our config (e.g. "ecologic_starter_monthly")
 * and `planIdentifier` is set to the raw identifier from the plugin ("monthly").
 * This ensures `purchaseGooglePlaySubscription` calls the plugin with the
 * correct subscription product ID + base plan ID pair.
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

    // Log every raw product the store returned before mapping.
    // Note: getProducts() returns ONE Product per offer — a subscription with a
    // base plan offer AND a 7-day trial offer will appear as TWO products in this
    // list, both with identifier = "monthly" (the base plan ID) but different
    // offerTokens and offerIds (null = base plan, non-null = promotional/trial).
    rawProducts.forEach((p: any, i: number) => {
      console.log(
        `[ECOLOGIC-IAP] Raw[${i}]:`,
        `id="${p.identifier}"`,
        `planIdentifier="${p.planIdentifier ?? "(none)"}"`,
        `price=${p.price}`,
        `priceString="${p.priceString}"`,
        `offerId=${JSON.stringify(p.offerId ?? null)}`,
        `offerToken="${String(p.offerToken ?? "").slice(0, 30)}..."`,
        `title="${p.title}"`
      );
    });

    // ── Phase 1: map every raw product to a typed offer record ────────────────
    // The plugin returns one product per offer, so we collect them all before
    // selecting the best offer per plan.

    interface RawOffer {
      planKey: string;
      resolvedProductId: string;  // subscription product ID for purchaseProduct()
      planIdentifier: string;     // base plan ID for purchaseProduct()
      matchMethod: string;
      rawPrice: number;
      rawPriceString: string;
      offerToken: string;
      offerId: string | null;
      title: string;
      description: string;
    }

    const planOffers: Record<string, RawOffer[]> = {};

    for (const p of rawProducts as any[]) {
      const rawIdentifier: string = p.identifier ?? "";
      const rawTitle: string     = p.title       ?? "";
      // On Android, p.identifier = basePlanId ("monthly") and
      // p.planIdentifier = subscription product ID ("ecologic_starter_monthly").
      // The basePlanId becomes our planIdentifier for the purchase call.
      const basePlanId: string   = rawIdentifier || "monthly";
      const subProductId: string = p.planIdentifier ?? "";  // subscription product ID
      const rawPrice: number     = typeof p.price === "number" ? p.price : parseFloat(String(p.price ?? "0")) || 0;
      const rawPriceString: string = p.priceString ?? "";
      const offerToken: string   = p.offerToken ?? "";
      const offerId: string | null = p.offerId ?? null;

      // ── Plan-key resolution (same two-pass logic as before) ─────────────────
      // Pass 1: try exact match on the subscription product ID from the plugin
      let planKey: string | null = null;
      let resolvedProductId      = "";
      let matchMethod            = "";

      if (subProductId) {
        planKey = googlePlayProductIdToPlanKey[subProductId] ?? null;
        if (planKey) {
          resolvedProductId = subProductId;
          matchMethod       = "exact-subProductId";
        }
      }
      // Pass 1b: try exact match on the raw identifier (in case it's the product ID)
      if (!planKey && rawIdentifier) {
        planKey = googlePlayProductIdToPlanKey[rawIdentifier] ?? null;
        if (planKey) {
          resolvedProductId = rawIdentifier;
          matchMethod       = "exact-rawId";
        }
      }
      // Pass 2: title-based fallback
      if (!planKey) {
        planKey = titleToPlanKey(rawTitle);
        if (planKey) {
          resolvedProductId = subProductId || subscriptionPlans[planKey]?.googlePlayProductId || rawIdentifier;
          matchMethod       = "title-fallback";
          console.log(`[ECOLOGIC-IAP] Title fallback: "${rawTitle}" → planKey="${planKey}" productId="${resolvedProductId}"`);
        }
      }

      if (!planKey) {
        console.warn(`[ECOLOGIC-IAP] Could not map: id="${rawIdentifier}" subId="${subProductId}" title="${rawTitle}" — skipping`);
        continue;
      }

      if (!planOffers[planKey]) planOffers[planKey] = [];
      planOffers[planKey].push({
        planKey,
        resolvedProductId,
        planIdentifier: basePlanId,
        matchMethod,
        rawPrice,
        rawPriceString,
        offerToken,
        offerId,
        title: rawTitle,
        description: p.description ?? "",
      });
    }

    // ── Phase 2: select the best offer per plan ───────────────────────────────
    // A free-trial offer has offerId !== null (e.g. "free-trial") AND rawPrice === 0
    // (the first pricing phase of a trial is always $0).
    // We prefer the trial offer when available; the regular monthly price is taken
    // from the base plan offer (offerId === null) so priceString is always correct.

    const mapped: IapProduct[] = [];

    for (const [planKey, offers] of Object.entries(planOffers)) {
      // Identify trial and base offers
      const trialOffer = offers.find(o => o.offerId !== null && o.rawPrice === 0);
      const baseOffer  = offers.find(o => o.offerId === null);
      const selected   = trialOffer ?? baseOffer ?? offers[0];
      const hasTrial   = !!trialOffer;

      // priceString must always show the regular monthly price, even for trial products.
      // If a trial offer was selected, pull the regular price from the base plan offer.
      const regularPriceString = hasTrial
        ? (baseOffer?.rawPriceString || `$${subscriptionPlans[planKey]?.price ?? "?"}`)
        : selected.rawPriceString;

      console.log(
        `[ECOLOGIC-IAP] ✓ Selected offer for planKey="${planKey}":`,
        `method=${selected.matchMethod}`,
        `hasTrial=${hasTrial}`,
        `offerId=${JSON.stringify(selected.offerId)}`,
        `offerToken="${selected.offerToken.slice(0, 30)}..."`,
        `priceString="${regularPriceString}"`,
        `totalOffers=${offers.length}`
      );

      mapped.push({
        identifier: selected.resolvedProductId,
        planKey,
        priceString: regularPriceString,
        title: selected.title,
        description: selected.description,
        planIdentifier: selected.planIdentifier,
        offerToken: selected.offerToken || undefined,
        offerId: selected.offerId,
        hasTrial,
      });
    }

    console.log(`[ECOLOGIC-IAP] ══ Google Play product load DONE: ${mapped.length} plan(s) from ${rawProducts.length} raw offer(s) ══`);
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
  planIdentifier?: string,
  expectedOfferToken?: string
): Promise<GooglePlayPurchaseResult> {
  const resolvedPlanId = planIdentifier || "monthly";
  console.log(
    "[ECOLOGIC-IAP] Google Play purchase START —",
    `productIdentifier="${productId}"`,
    `planIdentifier="${resolvedPlanId}"`,
    `expectedOfferToken="${expectedOfferToken ? expectedOfferToken.slice(0, 30) + "..." : "(none — base plan)"}"`
  );
  if (expectedOfferToken) {
    console.log(
      "[ECOLOGIC-IAP] NOTE: A trial offerToken was detected. The plugin will select the first",
      `offer with basePlanId="${resolvedPlanId}" from Google Play's SubscriptionOfferDetails list.`,
      "If the trial offer comes first in that list, the trial will be applied; otherwise the base",
      "plan will be used. Check Play Console → Subscription → offer ordering if trial is not shown."
    );
  }

  const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

  console.log("[ECOLOGIC-IAP] Calling purchaseProduct with:", JSON.stringify({
    productIdentifier: productId,
    planIdentifier: resolvedPlanId,
    productType: "SUBS",
  }));

  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    planIdentifier: resolvedPlanId,
    productType: PURCHASE_TYPE.SUBS,
  });

  console.log("[ECOLOGIC-IAP] Google Play purchase succeeded — transactionId:", transaction.transactionId);

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
  console.log("[ECOLOGIC-GPLAY-RESTORE] restore started");

  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
    });

    console.log(`[ECOLOGIC-GPLAY-RESTORE] available purchases count=${purchases.length}`);

    for (const tx of purchases) {
      const pid: string        = (tx as any).productIdentifier ?? "";
      const title: string      = (tx as any).title ?? "";
      const token              = (tx as any).purchaseToken as string | undefined;
      const orderId: string    = (tx as any).transactionId ?? (tx as any).orderId ?? "";
      // Android does not expose expirationDate on the Transaction type, but log it
      // defensively in case a future plugin version adds it.
      const expiry: string     = (tx as any).expirationDate ?? (tx as any).expireDate ?? "(not exposed)";
      const hasToken           = !!token;
      const tokenSuffix        = token ? `…${token.slice(-8)}` : "(none)";

      console.log(
        `[ECOLOGIC-GPLAY-RESTORE] tx: productId="${pid}" orderId="${orderId}"` +
        ` tokenSuffix=${tokenSuffix} title="${title}" expiry=${expiry}`
      );

      if (!hasToken) {
        console.log(`[ECOLOGIC-GPLAY-RESTORE] stale purchase ignored — productId="${pid}" no purchaseToken`);
        continue;
      }

      // ── Pass 1: exact product-ID match ──────────────────────────────────────
      if (ALL_GOOGLE_PLAY_PRODUCT_IDS.includes(pid)) {
        console.log(
          `[ECOLOGIC-GPLAY-RESTORE] restored productId=${pid} orderId="${orderId}" token suffix=${tokenSuffix}`
        );
        console.log("[ECOLOGIC-GPLAY-RESTORE] sending validate for restored purchase");
        return { purchaseToken: token!, productId: pid };
      }

      // ── Pass 2: title-based fallback (Play Billing 5+ returns "monthly") ────
      // When the plugin returns "monthly" as productIdentifier, resolve via title.
      const planKey = titleToPlanKey(title);
      if (planKey) {
        const resolvedProductId = subscriptionPlans[planKey]?.googlePlayProductId ?? pid;
        console.log(
          `[ECOLOGIC-GPLAY-RESTORE] restored productId=${resolvedProductId} (via title="${title}"` +
          ` planKey="${planKey}") orderId="${orderId}" token suffix=${tokenSuffix}`
        );
        console.log("[ECOLOGIC-GPLAY-RESTORE] sending validate for restored purchase");
        return { purchaseToken: token!, productId: resolvedProductId };
      }

      console.log(
        `[ECOLOGIC-GPLAY-RESTORE] stale purchase ignored — id="${pid}" title="${title}" could not map to EcoLogic plan`
      );
    }

    console.log("[ECOLOGIC-GPLAY-RESTORE] no active restorable purchase found");
    return null;
  } catch (err: any) {
    console.error("[ECOLOGIC-GPLAY-RESTORE] restore failed:", err.message);
    return null;
  }
}
