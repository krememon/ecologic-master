/**
 * Branch.io HTTP client (Phase 1, staging-only)
 * ──────────────────────────────────────────────
 * Thin wrapper around Branch's public HTTP APIs that we use from the dashboard:
 *
 *   1. createBranchLink(...)       → POST https://api.branch.io/v1/url
 *   2. deleteBranchLink(branchId)  → DELETE https://api.branch.io/v1/url/<id>
 *   3. verifyWebhookSecret(req)    → shared-secret check used by the webhook
 *
 * All Branch network calls go through `fetch` and are wrapped in try/catch.
 * Failures are *never* allowed to break the surrounding request — the caller
 * just sees `{ ok: false, error: "..." }` and the dashboard surface displays
 * a friendly "Branch link failed" message.
 *
 * Env vars (all read at call time so secrets can be added without restart):
 *
 *   BRANCH_KEY                  e.g. "key_test_xxx"  (required for create/delete)
 *   BRANCH_SECRET               required for delete; optional for create
 *   BRANCH_LINK_DOMAIN          e.g. "go.ecologicc.com" (custom domain)
 *   BRANCH_IOS_FALLBACK_URL     App Store URL for users without the iOS app
 *   BRANCH_ANDROID_FALLBACK_URL Play Store URL for users without the Android app
 *   BRANCH_WEBHOOK_SECRET       shared secret for POST /api/webhooks/branch
 *   BRANCH_INTEGRATION_ENABLED  master switch — must be "true" to create links
 *
 * All logs use the `[branch]` prefix.
 */

import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const BRANCH_API_BASE = "https://api.branch.io";

// ── Configuration probes ───────────────────────────────────────────────────

/** True when the master switch is on AND a Branch key is present. */
export function isBranchConfigured(): boolean {
  if (!isBranchIntegrationEnabled()) return false;
  return Boolean((process.env.BRANCH_KEY || "").trim());
}

/** Master switch — defaults to OFF. Staging sets it to "true". */
export function isBranchIntegrationEnabled(): boolean {
  const v = (process.env.BRANCH_INTEGRATION_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Used by the dashboard to decide whether to surface "Branch not configured". */
export function getBranchPublicConfigSummary(): {
  enabled: boolean;
  hasKey: boolean;
  hasDomain: boolean;
  hasIosFallback: boolean;
  hasAndroidFallback: boolean;
  hasWebhookSecret: boolean;
} {
  return {
    enabled: isBranchIntegrationEnabled(),
    hasKey: Boolean((process.env.BRANCH_KEY || "").trim()),
    hasDomain: Boolean((process.env.BRANCH_LINK_DOMAIN || "").trim()),
    hasIosFallback: Boolean((process.env.BRANCH_IOS_FALLBACK_URL || "").trim()),
    hasAndroidFallback: Boolean((process.env.BRANCH_ANDROID_FALLBACK_URL || "").trim()),
    hasWebhookSecret: Boolean((process.env.BRANCH_WEBHOOK_SECRET || "").trim()),
  };
}

// ── createBranchLink ───────────────────────────────────────────────────────

export interface CreateBranchLinkInput {
  /** Required — used as Branch alias when possible. Lowercased before sending. */
  referralCode: string;
  /** Free-form, e.g. "instagram_creator". Stored as Branch `channel`. */
  sourceType: string;
  /** Optional friendly source name, e.g. "@joeplumbing". */
  sourceName?: string | null;
  /** Numeric campaign id, used for matching webhook events back to the row. */
  campaignId: number;
  /** Friendly campaign name shown to creators. */
  campaignName: string;
  /** Web fallback (used by Branch when neither app is installed and not on mobile). */
  webFallbackUrl: string;
  /** Optional override for the deep-link path (default: signup?source=…&ref=…). */
  deeplinkPath?: string;
  /** Optional. When true, Branch will overwrite an existing link with the same alias. */
  overwriteAlias?: boolean;
}

export interface CreateBranchLinkResult {
  ok: boolean;
  /** The shareable URL (e.g. "https://go.ecologicc.com/joeplumbing"). */
  url?: string;
  /** Branch's internal id for the link, surfaced in their `url` response field. */
  branchLinkId?: string;
  alias?: string;
  channel?: string;
  feature?: string;
  campaign?: string;
  error?: string;
}

/**
 * Create (or replace, when `overwriteAlias=true`) a Branch deep link.
 *
 * Implementation notes:
 *   • Branch's public Deep Linking API authenticates by including
 *     `branch_key` in the request body. The API returns `{ url: "..." }`.
 *   • To use a custom domain (e.g. `go.ecologicc.com/joeplumbing`) the user
 *     must have configured the custom domain inside the Branch dashboard
 *     beforehand. We don't probe — if the domain is misconfigured, Branch
 *     silently falls back to its default `*.app.link` host and that's what
 *     `result.url` will contain. We surface that as-is.
 *   • Optional `alias` makes the URL human-readable. Aliases are immutable
 *     unless `?overwrite=true` is passed (we expose this via `overwriteAlias`).
 */
export async function createBranchLink(
  input: CreateBranchLinkInput,
): Promise<CreateBranchLinkResult> {
  const branchKey = (process.env.BRANCH_KEY || "").trim();
  if (!branchKey) {
    console.warn("[branch] createBranchLink skipped — BRANCH_KEY not set");
    return { ok: false, error: "Branch not configured (missing BRANCH_KEY)" };
  }
  if (!isBranchIntegrationEnabled()) {
    return { ok: false, error: "Branch integration disabled (BRANCH_INTEGRATION_ENABLED != true)" };
  }

  const referralCode = (input.referralCode || "").trim().toLowerCase();
  if (!referralCode) {
    return { ok: false, error: "referralCode is required" };
  }

  const channel = input.sourceType || "unknown";
  const feature = "campaign";
  const campaignTag = input.campaignName || `campaign_${input.campaignId}`;
  const alias = referralCode;

  const iosFallback = (process.env.BRANCH_IOS_FALLBACK_URL || "").trim();
  const androidFallback = (process.env.BRANCH_ANDROID_FALLBACK_URL || "").trim();
  const desktopFallback = input.webFallbackUrl;
  const deeplinkPath =
    input.deeplinkPath ||
    `signup?source=${encodeURIComponent(input.sourceType)}&ref=${encodeURIComponent(referralCode)}`;

  const body: Record<string, unknown> = {
    branch_key: branchKey,
    channel,
    feature,
    campaign: campaignTag,
    alias,
    tags: [`source:${input.sourceType}`, `ref:${referralCode}`],
    data: {
      // Branch reserved keys (deep-link routing).
      $deeplink_path: deeplinkPath,
      $desktop_url: desktopFallback,
      // Only include OS-specific fallbacks when configured — otherwise Branch
      // uses the dashboard-level defaults from its iOS/Android settings.
      ...(iosFallback ? { $ios_url: iosFallback, $fallback_url: iosFallback } : {}),
      ...(androidFallback ? { $android_url: androidFallback } : {}),
      // Custom EcoLogic attribution — propagated to the mobile app's Branch
      // listener and into our webhook payload.
      referralCode,
      sourceType: input.sourceType,
      sourceName: input.sourceName ?? null,
      campaignId: input.campaignId,
      campaignName: input.campaignName,
      dashboardCampaignId: input.campaignId,
      webFallbackUrl: desktopFallback,
    },
  };

  const url = `${BRANCH_API_BASE}/v1/url${input.overwriteAlias ? "?overwrite=true" : ""}`;
  console.log(
    `[branch] createBranchLink campaignId=${input.campaignId} alias="${alias}" overwrite=${!!input.overwriteAlias}`,
  );

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error("[branch] createBranchLink network error:", err?.message ?? err);
    return { ok: false, error: `Branch network error: ${err?.message ?? "unknown"}` };
  }

  let json: any = null;
  try {
    json = await resp.json();
  } catch {
    /* ignore — non-JSON body */
  }

  if (!resp.ok) {
    // Branch returns 409 on alias collision when overwrite is false.
    const branchMsg = (json && (json.error?.message || json.message)) || `HTTP ${resp.status}`;
    console.warn(`[branch] createBranchLink failed: ${branchMsg}`);
    return { ok: false, error: branchMsg };
  }

  const generatedUrl: string = json?.url ?? "";
  if (!generatedUrl) {
    console.warn("[branch] createBranchLink returned 200 but no url field");
    return { ok: false, error: "Branch returned no link URL" };
  }

  // Branch's response doesn't always echo the link id — derive it from the
  // URL when the field is absent.
  const branchLinkId = json?.id ?? deriveLinkIdFromUrl(generatedUrl) ?? alias;

  console.log(`[branch] createBranchLink OK url=${generatedUrl}`);
  return {
    ok: true,
    url: generatedUrl,
    branchLinkId,
    alias,
    channel,
    feature,
    campaign: campaignTag,
  };
}

function deriveLinkIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last || null;
  } catch {
    return null;
  }
}

// ── deleteBranchLink ───────────────────────────────────────────────────────
//
// Branch's docs require `branch_key` and `branch_secret` for delete operations.
// We expose this so the regenerate flow can clean up before re-creating, but
// the route currently uses `overwriteAlias=true` instead, which is simpler
// and doesn't need the secret. Kept for future use.

export async function deleteBranchLink(linkUrl: string): Promise<{ ok: boolean; error?: string }> {
  const branchKey = (process.env.BRANCH_KEY || "").trim();
  const branchSecret = (process.env.BRANCH_SECRET || "").trim();
  if (!branchKey || !branchSecret) {
    return { ok: false, error: "Branch delete requires BRANCH_KEY and BRANCH_SECRET" };
  }
  try {
    const resp = await fetch(`${BRANCH_API_BASE}/v1/url?url=${encodeURIComponent(linkUrl)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_key: branchKey, branch_secret: branchSecret }),
    });
    if (!resp.ok) {
      return { ok: false, error: `Branch delete returned HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "delete failed" };
  }
}

// ── Webhook secret verification ────────────────────────────────────────────
//
// Branch does NOT sign webhook payloads on their lower-tier plans. The user
// requested fail-closed protection: we require a shared secret to be passed
// either as a `?token=` query parameter OR in an `X-Branch-Webhook-Secret`
// header. The secret itself lives in the BRANCH_WEBHOOK_SECRET env var.
//
// Comparison uses a constant-time check so an attacker cannot timing-attack
// the secret.

export function verifyWebhookSecret(req: Request): { ok: boolean; reason?: string } {
  const expected = (process.env.BRANCH_WEBHOOK_SECRET || "").trim();
  if (!expected) {
    return { ok: false, reason: "BRANCH_WEBHOOK_SECRET not configured" };
  }
  const headerVal = String(req.header("x-branch-webhook-secret") || "").trim();
  const queryVal = String((req.query.token as string) || "").trim();
  const provided = headerVal || queryVal;
  if (!provided) {
    return { ok: false, reason: "missing webhook secret" };
  }
  if (!constantTimeEqual(provided, expected)) {
    return { ok: false, reason: "webhook secret mismatch" };
  }
  return { ok: true };
}

/**
 * Constant-time string comparison that does NOT leak input length.
 *
 * Naive `a.length !== b.length → return false` exits early and lets a remote
 * attacker time-probe the secret's length. We sidestep that entirely by HMAC-
 * hashing both strings with a per-process random key and comparing the
 * fixed-length 32-byte digests via `crypto.timingSafeEqual`. The HMAC key is
 * generated once at module load and never persisted — its only purpose is to
 * make the comparison length-independent.
 */
const COMPARE_HMAC_KEY = createHmac("sha256", `branch-cmp-${Date.now()}-${Math.random()}`)
  .update("init")
  .digest();

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", COMPARE_HMAC_KEY).update(String(a)).digest();
  const hb = createHmac("sha256", COMPARE_HMAC_KEY).update(String(b)).digest();
  // ha and hb are always 32 bytes, so timingSafeEqual is safe to call.
  return timingSafeEqual(ha, hb);
}

// ── Webhook payload normalization ──────────────────────────────────────────

export type ParsedBranchEvent = {
  branchEventId: string | null;
  branchIdentityId: string | null;
  eventType: "click" | "install" | "open" | "signup" | "subscribe" | "unknown";
  platform: "ios" | "android" | "web" | "unknown";
  /** Any deep-link metadata we put into `data` at link-create time. */
  metadata: {
    referralCode?: string | null;
    sourceType?: string | null;
    sourceName?: string | null;
    campaignId?: number | null;
    branchLinkUrl?: string | null;
  };
  /** Sanitized echo of the raw payload (with PII stripped). */
  sanitized: Record<string, unknown>;
};

/**
 * Normalize a Branch webhook payload into a uniform shape.
 *
 * Branch's webhook bodies vary by plan and event type. We support both the
 * "v2 event" format and the older click/install events. Anything we don't
 * recognize maps to `eventType: "unknown"` and is still recorded so we have
 * a forensic trail.
 */
export function parseBranchWebhookPayload(payload: any): ParsedBranchEvent {
  const evt = payload?.event ?? payload?.name ?? payload?.event_type ?? "";
  const eventType = mapEventName(String(evt));

  const platformRaw = String(
    payload?.os ??
      payload?.last_attributed_touch_data?.["~os"] ??
      payload?.metadata?.os ??
      "",
  ).toLowerCase();
  const platform: ParsedBranchEvent["platform"] =
    platformRaw === "ios"
      ? "ios"
      : platformRaw === "android"
        ? "android"
        : platformRaw === "web" || platformRaw === "desktop"
          ? "web"
          : "unknown";

  // Custom data was sent in `data` at link create — Branch echoes it back
  // under several possible keys depending on event type.
  const customData =
    payload?.custom_data ??
    payload?.data ??
    payload?.last_attributed_touch_data?.custom_data ??
    payload?.last_attributed_touch_data ??
    {};

  const referralCode =
    safeStr(customData?.referralCode) ??
    safeStr(customData?.["~referring_link_alias"]) ??
    safeStr(payload?.alias) ??
    null;
  const sourceType = safeStr(customData?.sourceType) ?? safeStr(customData?.["~channel"]) ?? null;
  const sourceName = safeStr(customData?.sourceName) ?? null;
  const campaignIdRaw =
    customData?.campaignId ?? customData?.dashboardCampaignId ?? null;
  const campaignId =
    typeof campaignIdRaw === "number"
      ? campaignIdRaw
      : Number.isFinite(Number(campaignIdRaw))
        ? Number(campaignIdRaw)
        : null;
  const branchLinkUrl = safeStr(customData?.branchLinkUrl) ?? safeStr(payload?.["~referring_link"]);

  // Strip PII from raw payload before storing.
  const sanitized = sanitizePayload(payload);

  return {
    branchEventId: safeStr(payload?.id) ?? safeStr(payload?.event_id) ?? null,
    branchIdentityId: safeStr(payload?.identity_id) ?? safeStr(payload?.user_data?.developer_identity) ?? null,
    eventType,
    platform,
    metadata: {
      referralCode,
      sourceType,
      sourceName,
      campaignId,
      branchLinkUrl,
    },
    sanitized,
  };
}

function safeStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function mapEventName(raw: string): ParsedBranchEvent["eventType"] {
  const e = raw.toLowerCase();
  if (e.includes("install")) return "install";
  if (e === "open" || e.includes("reopen") || e.includes("session_start")) return "open";
  if (e === "click" || e.includes("click")) return "click";
  if (e.includes("signup") || e.includes("complete_registration")) return "signup";
  if (e.includes("subscribe") || e.includes("purchase")) return "subscribe";
  return "unknown";
}

/** Drop fields we don't want to persist (PII, oversized blobs). */
function sanitizePayload(payload: any): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const REDACTED = "[redacted]";
  const PII_KEYS = new Set([
    "user_agent",
    "ip",
    "ip_address",
    "email",
    "phone",
    "advertising_ids",
    "idfa",
    "gaid",
    "android_id",
    "mac_address",
  ]);
  const seen = new WeakSet();
  function visit(node: any): any {
    if (node === null || node === undefined) return node;
    if (typeof node !== "object") return node;
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (Array.isArray(node)) return node.map(visit).filter((v) => v !== undefined);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (PII_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = visit(v);
      }
    }
    return out;
  }
  return visit(payload) as Record<string, unknown>;
}
