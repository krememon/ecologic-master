/**
 * AppsFlyer OneLink helper (Phase 1, staging only)
 * ─────────────────────────────────────────────────
 * Server-side configuration probe + URL builder for AppsFlyer OneLinks.
 *
 *   1. getAppsflyerPublicConfigSummary()  → safe, non-secret config probe
 *      consumed by the dashboard so it can decide whether to surface the
 *      "AppsFlyer not configured" hint.
 *   2. buildOneLinkUrl(campaign)          → constructs a OneLink URL with
 *      deferred-deep-link metadata mapped from the campaign:
 *
 *          deep_link_value = referralCode
 *          deep_link_sub1  = sourceType
 *          deep_link_sub2  = campaignId  (string)
 *          deep_link_sub3  = campaignName
 *          deep_link_sub4  = sourceName  (when present)
 *          pid             = sourceType   (AppsFlyer media source)
 *          c               = referralCode (AppsFlyer campaign name)
 *          af_xp           = "custom"     (custom OneLink experience)
 *
 *      Returns null when either APPSFLYER_ONELINK_TEMPLATE_ID or
 *      APPSFLYER_ONELINK_DOMAIN is missing — callers fall back to the
 *      campaign's own appsflyerOneLinkUrl override (manual paste).
 *
 * Phase 1 is intentionally read-only: no Branch-style POST endpoint exists
 * yet because the AppsFlyer OneLink Custom Links API requires the customer
 * to opt in to a paid tier. When APPSFLYER_API_TOKEN is wired up we can
 * add createOneLinkViaApi() here and a POST route in dashboard/routes.ts.
 *
 * All logs use the `[appsflyer]` prefix. No throws — every helper returns
 * a friendly "not configured" shape on error.
 */

// ── Configuration probes ───────────────────────────────────────────────────

function envTrim(name: string): string {
  return (process.env[name] || "").trim();
}

/** True when both the OneLink template + domain are present. */
export function isAppsflyerOneLinkConfigured(): boolean {
  return Boolean(envTrim("APPSFLYER_ONELINK_TEMPLATE_ID") && envTrim("APPSFLYER_ONELINK_DOMAIN"));
}

/** True when the OneLink Custom Links API is usable (template + domain + token). */
export function isAppsflyerApiConfigured(): boolean {
  return isAppsflyerOneLinkConfigured() && Boolean(envTrim("APPSFLYER_API_TOKEN"));
}

export type AppsflyerPublicConfigSummary = {
  /** Whether the dashboard should display AppsFlyer features at all. */
  oneLinkConfigured: boolean;
  /** Whether the backend can call the OneLink Custom Links API to mint URLs. */
  apiConfigured: boolean;
  /** Public values safe to send to the browser (no tokens, no dev keys). */
  oneLinkDomain: string | null;
  oneLinkTemplateId: string | null;
  /** Presence flags for the secret-bearing env vars (don't expose values). */
  hasDevKey: boolean;
  hasIosAppId: boolean;
  hasAndroidAppId: boolean;
};

/**
 * Used by the dashboard to decide whether to surface "AppsFlyer not
 * configured" hints. Returns *only* non-secret values + presence flags.
 */
export function getAppsflyerPublicConfigSummary(): AppsflyerPublicConfigSummary {
  const domain = envTrim("APPSFLYER_ONELINK_DOMAIN") || null;
  const templateId = envTrim("APPSFLYER_ONELINK_TEMPLATE_ID") || null;
  const hasIosLegacy = Boolean(envTrim("APPSFLYER_IOS_APP_ID"));
  const hasIosNew = Boolean(envTrim("APPSFLYER_APP_ID_IOS"));
  return {
    oneLinkConfigured: isAppsflyerOneLinkConfigured(),
    apiConfigured: isAppsflyerApiConfigured(),
    oneLinkDomain: domain,
    oneLinkTemplateId: templateId,
    hasDevKey: Boolean(envTrim("APPSFLYER_DEV_KEY")),
    hasIosAppId: hasIosNew || hasIosLegacy,
    hasAndroidAppId: Boolean(envTrim("APPSFLYER_APP_ID_ANDROID")),
  };
}

// ── OneLink URL builder ────────────────────────────────────────────────────

export type OneLinkCampaignInput = {
  id: number | string;
  name: string;
  sourceType: string;
  sourceName?: string | null;
  referralCode?: string | null;
};

/**
 * Build a OneLink URL for the given campaign. Returns null when either the
 * template or domain isn't configured, or when the campaign has no referral
 * code (we need it for the deep_link_value).
 *
 * The URL is *deterministic* given (config + campaign fields) — no network
 * calls are made. Callers can safely re-derive the URL on every request.
 */
export function buildOneLinkUrl(campaign: OneLinkCampaignInput): string | null {
  const domain = envTrim("APPSFLYER_ONELINK_DOMAIN");
  const templateId = envTrim("APPSFLYER_ONELINK_TEMPLATE_ID");
  if (!domain || !templateId) return null;

  const referralCode = (campaign.referralCode || "").trim().toLowerCase();
  if (!referralCode) return null;

  // Strip any accidental scheme/path the operator might have pasted into
  // APPSFLYER_ONELINK_DOMAIN — we want a bare host.
  const host = domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
  const template = templateId.replace(/^\/+|\/+$/g, "").trim();

  const params = new URLSearchParams();
  params.set("af_xp", "custom");
  params.set("pid", campaign.sourceType);
  params.set("c", referralCode);
  params.set("deep_link_value", referralCode);
  params.set("deep_link_sub1", campaign.sourceType);
  params.set("deep_link_sub2", String(campaign.id));
  params.set("deep_link_sub3", campaign.name);
  if (campaign.sourceName) {
    params.set("deep_link_sub4", campaign.sourceName);
  }

  return `https://${host}/${template}?${params.toString()}`;
}
