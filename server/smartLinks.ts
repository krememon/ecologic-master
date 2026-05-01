/**
 * Custom branded smart-link redirector
 * ─────────────────────────────────────
 * Replaces a paid Branch.io plan with our own redirect/attribution service
 * served from a dedicated marketing hostname:
 *
 *   prod    → https://go.ecologicc.com/:referralCode
 *   staging → https://staging-go.ecologicc.com/:referralCode
 *   dev     → http://<replit-preview>/go/:referralCode
 *
 * Behaviour
 * ─────────
 *  1. Match `:referralCode` (case-insensitive) against `growth_campaigns`.
 *  2. Insert a `click` row into `growth_mobile_events` for analytics.
 *  3. Detect the device from the User-Agent and redirect:
 *      • iOS / iPadOS         → APP_STORE_URL
 *      • Android              → PLAY_STORE_URL
 *      • Desktop / unknown    → web signup URL with `?source=…&ref=…`
 *  4. Inactive / unknown referral codes still redirect to the bare web
 *     signup page so a typo never dead-ends a real prospect.
 *
 * Safety
 * ──────
 *  • Smart-link hostnames *never* fall through to the React SPA. Any non-
 *    `/api/*` and non-asset path on those hosts is intercepted here so the
 *    full app cannot accidentally render at go.ecologicc.com.
 *  • No PII is logged or stored. We persist only the platform bucket
 *    (ios/android/web/unknown). Full IPs and User-Agent strings are NOT
 *    written to the DB.
 *  • All outbound redirects are 302s with `Cache-Control: no-store` so a
 *    misconfiguration is never cached at the edge.
 *
 * All logs use the `[smart-link]` prefix.
 */

import type { Express, Request, Response, NextFunction } from "express";
import {
  findActiveCampaignByReferralCode,
  recordMobileEvent,
} from "./dashboard/storage";

// ── Config ────────────────────────────────────────────────────────────────

/**
 * Defaults are intentionally aware of EcoLogic's known marketing hostnames
 * so the redirector works out of the box even without env vars set, as
 * long as DNS points at this Replit deployment.
 */
const DEFAULT_SMART_LINK_HOSTS = new Set<string>([
  "go.ecologicc.com",
  "staging-go.ecologicc.com",
]);

export interface SmartLinkConfig {
  /** Hostnames where a bare `/:referralCode` should be treated as a smart link. */
  smartLinkHosts: Set<string>;
  /** The canonical smart-link host advertised to the dashboard UI. */
  smartLinkDomain: string | null;
  /** Web signup base URL (no trailing slash). e.g. https://staging.ecologicc.com */
  webBaseUrl: string;
  /** App Store fallback URL for iOS devices. */
  appStoreUrl: string | null;
  /** Google Play fallback URL for Android devices. */
  playStoreUrl: string | null;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function isHttpUrl(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//i.test(s);
}

export function getSmartLinkConfig(): SmartLinkConfig {
  const hosts = new Set<string>(DEFAULT_SMART_LINK_HOSTS);
  const envHost = (process.env.SMART_LINK_DOMAIN || "").trim().toLowerCase();
  if (envHost) hosts.add(envHost);

  // Web base URL: env wins, else infer staging vs prod from the configured
  // smart-link host, else fall back to the staging customer app since this
  // feature is staging-only for now.
  const envWeb = (process.env.SMART_LINK_WEB_BASE_URL || "").trim();
  let webBaseUrl: string;
  if (isHttpUrl(envWeb)) {
    webBaseUrl = trimSlash(envWeb);
  } else if (envHost === "go.ecologicc.com") {
    webBaseUrl = "https://app.ecologicc.com";
  } else {
    webBaseUrl = "https://staging.ecologicc.com";
  }

  const appStoreUrl = (process.env.APP_STORE_URL || "").trim() || null;
  const playStoreUrl = (process.env.PLAY_STORE_URL || "").trim() || null;

  return {
    smartLinkHosts: hosts,
    smartLinkDomain: envHost || null,
    webBaseUrl,
    appStoreUrl: isHttpUrl(appStoreUrl) ? appStoreUrl : null,
    playStoreUrl: isHttpUrl(playStoreUrl) ? playStoreUrl : null,
  };
}

/**
 * Public-facing config probe for the dashboard. Surfaces *what* is set,
 * never the raw values (well, the URLs are non-secret, but we keep the
 * shape consistent with the Branch probe).
 */
export function getSmartLinkPublicConfig() {
  const cfg = getSmartLinkConfig();
  return {
    smartLinkDomain: cfg.smartLinkDomain,
    webBaseUrl: cfg.webBaseUrl,
    hasAppStoreUrl: !!cfg.appStoreUrl,
    hasPlayStoreUrl: !!cfg.playStoreUrl,
    knownHosts: Array.from(cfg.smartLinkHosts),
  };
}

// ── Hostname / path classification ────────────────────────────────────────

function hostnameOf(req: Request): string {
  // req.hostname strips the port and respects `trust proxy`, which is set
  // in server/index.ts so we get the public-facing host.
  return (req.hostname || "").toLowerCase();
}

export function isSmartLinkHostname(host: string, cfg = getSmartLinkConfig()): boolean {
  return cfg.smartLinkHosts.has(host.toLowerCase());
}

/**
 * Things that must never be intercepted by the smart-link handler even on
 * the smart-link hostname: API calls, uploads, well-known paths, the
 * Replit workspace iframe shim, and anything that obviously looks like a
 * static asset (extension in the last path segment).
 */
function looksLikeNonSmartLinkPath(p: string): boolean {
  if (!p || p === "/") return false; // root is handled — bare visit to go.ecologicc.com
  if (p.startsWith("/api/")) return true;
  if (p.startsWith("/uploads/")) return true;
  if (p.startsWith("/public/")) return true;
  if (p.startsWith("/.well-known/")) return true;
  if (p.startsWith("/__replco/")) return true;
  if (p === "/favicon.ico" || p === "/robots.txt" || p === "/sitemap.xml") return true;
  // Anything with a file-ish extension in the last segment.
  const last = p.split("/").pop() || "";
  if (/\.[a-z0-9]{1,8}$/i.test(last)) return true;
  return false;
}

// ── Device detection ──────────────────────────────────────────────────────

export type SmartLinkPlatform = "ios" | "android" | "web" | "unknown";

/**
 * Conservative UA sniffing — we only need to bucket into 4 values, not
 * full device fingerprinting. Order matters: iPad on iPadOS 13+ reports
 * a Mac UA so we check the explicit iPad/iPhone/iPod tokens first.
 */
export function detectPlatform(userAgent: string | undefined | null): SmartLinkPlatform {
  const ua = String(userAgent || "");
  if (!ua) return "unknown";
  if (/iPhone|iPod|iPad/i.test(ua)) return "ios";
  // Some iPadOS versions report as "Macintosh" with touch — heuristic.
  if (/Macintosh/i.test(ua) && /Mobile|Touch/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Mozilla|Chrome|Safari|Edg|Firefox|Opera/i.test(ua)) return "web";
  return "unknown";
}

// ── Click recording ───────────────────────────────────────────────────────

async function recordClick(opts: {
  campaignId: number | null;
  referralCode: string;
  sourceType: string | null;
  sourceName: string | null;
  platform: SmartLinkPlatform;
}): Promise<void> {
  // Only attribute clicks that resolved to a real campaign — keeps the
  // events table free of junk from random scans / typos.
  if (opts.campaignId == null) return;
  try {
    await recordMobileEvent({
      campaignId: opts.campaignId,
      referralCode: opts.referralCode,
      sourceType: opts.sourceType,
      sourceName: opts.sourceName,
      eventType: "click",
      platform: opts.platform,
      // No external event id — smart link is our own redirector, no upstream.
      // Leaving branchEventId null also bypasses the unique-on-branchEventId
      // dedupe path inside recordMobileEvent, which is what we want for first-
      // party clicks (every click is a real event).
      branchEventId: null,
      branchIdentityId: null,
      deviceId: null,
      branchLinkUrl: null,
      rawPayload: null,
    });
  } catch (err: any) {
    // Never block the redirect on an analytics write — log and move on.
    console.warn(`[smart-link] click record failed code=${opts.referralCode}:`, err?.message ?? err);
  }
}

// ── Redirect URL builder ──────────────────────────────────────────────────

function buildWebSignupUrl(opts: {
  cfg: SmartLinkConfig;
  sourceType: string | null;
  referralCode: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts.sourceType) params.set("source", opts.sourceType);
  if (opts.referralCode) params.set("ref", opts.referralCode);
  const qs = params.toString();
  return qs ? `${opts.cfg.webBaseUrl}/signup?${qs}` : `${opts.cfg.webBaseUrl}/signup`;
}

function pickRedirectTarget(opts: {
  cfg: SmartLinkConfig;
  platform: SmartLinkPlatform;
  sourceType: string | null;
  referralCode: string | null;
}): string {
  const { cfg, platform } = opts;
  // Always have a desktop fallback ready in case env vars are missing.
  const webUrl = buildWebSignupUrl(opts);
  if (platform === "ios" && cfg.appStoreUrl) return cfg.appStoreUrl;
  if (platform === "android" && cfg.playStoreUrl) return cfg.playStoreUrl;
  return webUrl;
}

// ── Request handler ───────────────────────────────────────────────────────

function normalizeReferralCodeFromPath(raw: string | undefined): string | null {
  if (!raw) return null;
  // Strip leading/trailing slashes; first segment only; lowercase.
  const seg = raw.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
  // Allow letters, digits, dash, underscore. Anything else → reject.
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seg)) return null;
  return seg.toLowerCase();
}

async function handleSmartLink(req: Request, res: Response, rawCode: string | undefined): Promise<void> {
  const cfg = getSmartLinkConfig();
  const code = normalizeReferralCodeFromPath(rawCode);
  const ua = req.get("user-agent");
  const platform = detectPlatform(ua);

  // No code at all → naked smart-link domain visit. Send to web signup.
  if (!code) {
    const target = buildWebSignupUrl({ cfg, sourceType: null, referralCode: null });
    console.log(`[smart-link] naked-visit host=${req.hostname} platform=${platform} → ${target}`);
    res.set("Cache-Control", "no-store");
    res.redirect(302, target);
    return;
  }

  // Look up campaign — active only.
  let campaign = null as Awaited<ReturnType<typeof findActiveCampaignByReferralCode>>;
  try {
    campaign = await findActiveCampaignByReferralCode(code);
  } catch (err: any) {
    console.error(`[smart-link] lookup error code=${code}:`, err?.message ?? err);
    // Fall through to no-campaign path below — never error the user.
  }

  if (!campaign) {
    const target = buildWebSignupUrl({ cfg, sourceType: null, referralCode: code });
    console.log(
      `[smart-link] unknown-code code=${code} platform=${platform} → ${target} (web signup with ref preserved)`,
    );
    res.set("Cache-Control", "no-store");
    res.redirect(302, target);
    return;
  }

  // Record click (best-effort; never blocks the redirect).
  recordClick({
    campaignId: campaign.id,
    referralCode: code,
    sourceType: campaign.sourceType ?? null,
    sourceName: campaign.sourceName ?? null,
    platform,
  }).catch((err) =>
    console.warn(`[smart-link] async click record failed code=${code}:`, err?.message ?? err),
  );

  const target = pickRedirectTarget({
    cfg,
    platform,
    sourceType: (campaign.sourceType as string | null) ?? null,
    referralCode: code,
  });
  console.log(
    `[smart-link] redirect code=${code} campaignId=${campaign.id} platform=${platform} → ${target}`,
  );
  res.set("Cache-Control", "no-store");
  res.redirect(302, target);
}

// ── Mount ─────────────────────────────────────────────────────────────────

/**
 * Wires the smart-link handlers into the Express app. Must be called BEFORE
 * any catch-all (Vite dev server / SPA index.html) is registered, so smart-
 * link hostnames cannot accidentally render the React app.
 */
export function mountSmartLinkRoutes(app: Express): void {
  // 1) Universal `/go/:referralCode` — works on ANY hostname. Useful for
  //    Replit preview testing where DNS for go.ecologicc.com isn't set up.
  app.get("/go/:referralCode", async (req: Request, res: Response) => {
    await handleSmartLink(req, res, req.params.referralCode);
  });
  // Bare `/go` and `/go/` — naked visits go to web signup.
  app.get(["/go", "/go/"], async (req: Request, res: Response) => {
    await handleSmartLink(req, res, undefined);
  });

  // 2) Smart-link hostname middleware: on go.ecologicc.com /
  //    staging-go.ecologicc.com (or whatever SMART_LINK_DOMAIN is set to),
  //    intercept all GETs that aren't API/asset/etc and treat the first
  //    path segment as the referral code. Non-GET methods 405.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const host = hostnameOf(req);
    if (!isSmartLinkHostname(host)) return next();

    // Allow these to fall through to existing handlers.
    if (looksLikeNonSmartLinkPath(req.path)) {
      // On the smart-link host we still expose `/api/...` for diagnostics
      // (e.g. `/api/healthz`) and static files served by express.static
      // already mounted in server/index.ts. Anything else under the API
      // namespace also passes through.
      return next();
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      res.status(405).json({ message: "Smart-link domain only accepts GET" });
      return;
    }

    // Strip a leading `/go/` if someone hit, e.g.,
    // staging-go.ecologicc.com/go/joeplumbing — treat it the same as
    // /joeplumbing rather than looking up a code called "go".
    const path = req.path === "/go" ? "/" : req.path.replace(/^\/go\//, "/");
    const firstSeg = path.replace(/^\/+/, "").split("/")[0] || "";

    await handleSmartLink(req, res, firstSeg || undefined);
  });

  console.log(
    `[smart-link] routes mounted (hosts: ${Array.from(getSmartLinkConfig().smartLinkHosts).join(", ")})`,
  );
}
