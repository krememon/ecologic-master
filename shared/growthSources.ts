/**
 * Growth source-type catalog
 * ──────────────────────────
 * Single source of truth shared by:
 *   • the customer-app onboarding question ("How did you hear about EcoLogic?")
 *   • the dashboard Campaigns page (source-type select)
 *   • the client attribution capture utility (validating ?source= values)
 *
 * The string values MUST match the `growth_source_type` Postgres enum in
 * `shared/schema.ts` exactly.
 */

export const GROWTH_SOURCE_TYPES = [
  "instagram_creator",
  "tiktok_creator",
  "supply_house",
  "flyer",
  "customer_referral",
  "cold_call",
  "google",
  "app_store",
  "organic",
  "other",
] as const;

export type GrowthSourceType = (typeof GROWTH_SOURCE_TYPES)[number];

/** Human-friendly labels for the dashboard Campaigns select. */
export const GROWTH_SOURCE_LABELS: Record<GrowthSourceType, string> = {
  instagram_creator: "Instagram creator",
  tiktok_creator: "TikTok creator",
  supply_house: "Supply house",
  flyer: "Flyer / QR code",
  customer_referral: "Customer referral",
  cold_call: "Sales / cold call",
  google: "Google",
  app_store: "App Store",
  organic: "Organic",
  other: "Other",
};

/**
 * The shorter, simpler list shown to the user during onboarding.
 * Each option maps to one of the canonical source-type enum values above.
 */
export interface OnboardingSourceOption {
  value: GrowthSourceType;
  label: string;
}

export const ONBOARDING_SOURCE_OPTIONS: OnboardingSourceOption[] = [
  { value: "instagram_creator", label: "Instagram" },
  { value: "tiktok_creator", label: "TikTok" },
  { value: "customer_referral", label: "Friend / referral" },
  { value: "supply_house", label: "Supply house" },
  { value: "flyer", label: "Flyer / QR code" },
  { value: "google", label: "Google" },
  { value: "app_store", label: "App Store" },
  { value: "cold_call", label: "Sales call" },
  { value: "other", label: "Other" },
];

/** Returns true if the given string is a valid GrowthSourceType. */
export function isGrowthSourceType(v: unknown): v is GrowthSourceType {
  return typeof v === "string" && (GROWTH_SOURCE_TYPES as readonly string[]).includes(v);
}

/**
 * Best-effort coercion of an arbitrary string into a known source type.
 * Lowercases, trims, replaces hyphens/spaces with underscores.
 * Returns null if no match.
 */
export function coerceGrowthSourceType(v: unknown): GrowthSourceType | null {
  if (typeof v !== "string") return null;
  const norm = v.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if ((GROWTH_SOURCE_TYPES as readonly string[]).includes(norm)) {
    return norm as GrowthSourceType;
  }
  // common URL-friendly aliases
  const aliases: Record<string, GrowthSourceType> = {
    instagram: "instagram_creator",
    ig: "instagram_creator",
    tiktok: "tiktok_creator",
    tt: "tiktok_creator",
    referral: "customer_referral",
    friend: "customer_referral",
    supply: "supply_house",
    qr: "flyer",
    appstore: "app_store",
    "app-store": "app_store",
  };
  return aliases[norm] ?? null;
}
