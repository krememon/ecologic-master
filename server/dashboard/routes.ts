/**
 * Dashboard API routes
 * ────────────────────
 * All routes here are gated by [requireAuth, requireDashboardAdmin]. They
 * return data only to users whose email is in DASHBOARD_ADMIN_EMAILS.
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "../security/middleware";
import { requireDashboardAdmin } from "./access";
import {
  insertGrowthCampaignSchema,
  insertGrowthCreatorSchema,
  ACCOUNT_ADMIN_STATUSES,
  type AccountAdminStatus,
} from "@shared/schema";
import { GROWTH_SOURCE_TYPES } from "@shared/growthSources";
import {
  listGrowthSubscribersWithCampaign,
  listGrowthCampaignsWithMetrics,
  createGrowthCampaign,
  updateGrowthCampaign,
  listGrowthCreators,
  createGrowthCreator,
  updateGrowthCreator,
  getDashboardOverview,
  getSourceBreakdown,
  getPlatformBreakdown,
  normalizeReferralCode,
  findActiveCampaignByReferralCode,
  listAccounts,
  getAccountDetail,
  updateAccountAttribution,
  updateAccountStatus,
  updateAccountNotes,
  refreshAccountSubscription,
  previewAccountDeletion,
  isAccountDeletionEnabled,
  isSelfAccountDeleteAllowed,
  createOrRegenerateBranchLinkForCampaign,
  getMobileMetricsByCampaign,
  recordMobileEvent,
  findCampaignForBranchPayload,
  isBranchConfigured,
  isBranchIntegrationEnabled,
} from "./storage";
import {
  parseBranchWebhookPayload,
  verifyWebhookSecret,
  getBranchPublicConfigSummary,
} from "../branch";
import { getSmartLinkPublicConfig } from "../smartLinks";
import { db } from "../db";
import {
  growthCampaigns,
  companyMembers,
  adminAuditLogs,
} from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";

const gate = [requireAuth, requireDashboardAdmin] as const;

export function registerDashboardRoutes(app: Express): void {
  // ── Branch.io webhook (PUBLIC, secret-verified) ──────────────────────────
  //
  // Mounted before the gated routes so the `gate` array is NOT applied. We
  // require BRANCH_WEBHOOK_SECRET to match either the
  // `X-Branch-Webhook-Secret` header OR the `?token=` query param. If the env
  // var is unset, every request is rejected fail-closed — this is the same
  // behavior as the rest of the dashboard's "missing secret" path.
  //
  // Always returns 200 once auth passes — even on parse / persist errors —
  // so Branch doesn't aggressively retry and saturate the queue. Any error
  // is logged with the [branch-webhook] prefix and surfaced in the response
  // body for forensic purposes.
  app.post("/api/webhooks/branch", async (req: Request, res: Response) => {
    const auth = verifyWebhookSecret(req);
    if (!auth.ok) {
      console.warn(`[branch-webhook] rejected: ${auth.reason}`);
      // 401 so Branch knows the secret is wrong; they won't retry forever.
      res.status(401).json({ ok: false, reason: auth.reason });
      return;
    }
    try {
      const parsed = parseBranchWebhookPayload(req.body);
      const campaign = await findCampaignForBranchPayload(parsed);

      const result = await recordMobileEvent({
        campaignId: campaign?.id ?? null,
        referralCode: parsed.metadata.referralCode ?? campaign?.referralCode ?? null,
        sourceType: parsed.metadata.sourceType ?? campaign?.sourceType ?? null,
        sourceName: parsed.metadata.sourceName ?? campaign?.sourceName ?? null,
        branchLinkUrl: parsed.metadata.branchLinkUrl ?? campaign?.branchLinkUrl ?? null,
        eventType: parsed.eventType,
        platform: parsed.platform,
        branchEventId: parsed.branchEventId,
        branchIdentityId: parsed.branchIdentityId,
        deviceId: null,
        userId: null,
        companyId: null,
        rawPayload: parsed.sanitized,
      });

      console.log(
        `[branch-webhook] ${parsed.eventType}/${parsed.platform} campaignId=${campaign?.id ?? "null"} inserted=${result.inserted}`,
      );
      res.status(200).json({ ok: true, recorded: result.inserted, campaignId: campaign?.id ?? null });
    } catch (err: any) {
      console.error("[branch-webhook] processing error:", err?.message ?? err);
      // Still return 200 so Branch doesn't aggressively retry; we logged it.
      res.status(200).json({ ok: false, error: "internal processing error" });
    }
  });

  // ── Overview ─────────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard/overview", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard] loading overview");
      const data = await getDashboardOverview();
      res.json(data);
    } catch (err) {
      console.error("[dashboard] overview error:", err);
      res.status(500).json({ message: "Failed to load overview" });
    }
  });

  // ── Subscribers ──────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard/subscribers", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard] loading subscribers");
      const data = await listGrowthSubscribersWithCampaign();
      res.json(data);
    } catch (err) {
      console.error("[dashboard] subscribers error:", err);
      res.status(500).json({ message: "Failed to load subscribers" });
    }
  });

  // ── Sources ──────────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard/sources", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard] loading sources");
      const data = await getSourceBreakdown();
      res.json(data);
    } catch (err) {
      console.error("[dashboard] sources error:", err);
      res.status(500).json({ message: "Failed to load sources" });
    }
  });

  // ── Platforms ────────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard/platforms", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard] loading platforms");
      const data = await getPlatformBreakdown();
      res.json(data);
    } catch (err) {
      console.error("[dashboard] platforms error:", err);
      res.status(500).json({ message: "Failed to load platforms" });
    }
  });

  // ── Campaigns ────────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard/campaigns", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard-campaigns] listing campaigns");
      const data = await listGrowthCampaignsWithMetrics();
      res.json(data);
    } catch (err) {
      console.error("[dashboard-campaigns] list error:", err);
      res.status(500).json({ message: "Failed to load campaigns" });
    }
  });

  app.post("/api/admin/dashboard/campaigns", ...gate, async (req: Request, res: Response) => {
    try {
      console.log("[dashboard-campaigns] creating campaign");
      const parsed = insertGrowthCampaignSchema.parse(req.body);
      const code = normalizeReferralCode(parsed.referralCode as any);
      if (!code) {
        res.status(400).json({ message: "Referral code is required" });
        return;
      }

      // Pre-check uniqueness so we can return a friendly error.
      const [dup] = await db
        .select({ id: growthCampaigns.id })
        .from(growthCampaigns)
        .where(eq(growthCampaigns.referralCode, code))
        .limit(1);
      if (dup) {
        console.warn(`[dashboard-campaigns] duplicate referral code "${code}"`);
        res.status(409).json({
          code: "DUPLICATE_REFERRAL_CODE",
          message: `Referral code "${code}" is already in use`,
        });
        return;
      }

      const row = await createGrowthCampaign({ ...parsed, referralCode: code } as any);
      console.log(`[dashboard-campaigns] created id=${row.id} sourceType=${row.sourceType} code=${row.referralCode}`);
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.issues) {
        res.status(400).json({ message: "Validation failed", issues: err.issues });
        return;
      }
      // Postgres unique-violation safety net (in case of race).
      if (err?.code === "23505") {
        res.status(409).json({
          code: "DUPLICATE_REFERRAL_CODE",
          message: "Referral code is already in use",
        });
        return;
      }
      console.error("[dashboard-campaigns] create error:", err);
      res.status(500).json({ message: "Failed to create campaign" });
    }
  });

  app.patch("/api/admin/dashboard/campaigns/:id", ...gate, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ message: "Invalid id" });
        return;
      }
      const parsed = insertGrowthCampaignSchema.partial().parse(req.body);

      // If updating referralCode, ensure no other row already uses it.
      if ("referralCode" in parsed) {
        const code = normalizeReferralCode(parsed.referralCode as any);
        if (!code) {
          res.status(400).json({ message: "Referral code cannot be empty" });
          return;
        }
        const [dup] = await db
          .select({ id: growthCampaigns.id })
          .from(growthCampaigns)
          .where(and(eq(growthCampaigns.referralCode, code), ne(growthCampaigns.id, id)))
          .limit(1);
        if (dup) {
          console.warn(`[dashboard-campaigns] duplicate referral code "${code}" on patch id=${id}`);
          res.status(409).json({
            code: "DUPLICATE_REFERRAL_CODE",
            message: `Referral code "${code}" is already in use`,
          });
          return;
        }
        (parsed as any).referralCode = code;
      }

      const row = await updateGrowthCampaign(id, parsed);
      if (!row) {
        res.status(404).json({ message: "Campaign not found" });
        return;
      }
      console.log(`[dashboard-campaigns] updated campaign id=${row.id}`);
      res.json(row);
    } catch (err: any) {
      if (err?.issues) {
        res.status(400).json({ message: "Validation failed", issues: err.issues });
        return;
      }
      if (err?.code === "23505") {
        res.status(409).json({
          code: "DUPLICATE_REFERRAL_CODE",
          message: "Referral code is already in use",
        });
        return;
      }
      console.error("[dashboard-campaigns] update error:", err);
      res.status(500).json({ message: "Failed to update campaign" });
    }
  });

  // Read-only campaign lookup used by the customer-app onboarding submission to
  // verify a typed-in referral code (active campaigns only). Returns 404 when
  // no active campaign matches the code.
  // (Kept admin-only since it can enumerate campaigns; the customer onboarding
  //  submits the code to /api/companies and the server resolves it server-side.)
  app.get("/api/admin/dashboard/campaigns/lookup/:code", ...gate, async (req: Request, res: Response) => {
    try {
      const code = String(req.params.code || "");
      const row = await findActiveCampaignByReferralCode(code);
      if (!row) {
        res.status(404).json({ message: "Not found" });
        return;
      }
      res.json(row);
    } catch (err) {
      console.error("[dashboard-campaigns] lookup error:", err);
      res.status(500).json({ message: "Lookup failed" });
    }
  });

  // ── Branch.io: config probe (admin) ──────────────────────────────────────
  // Surface enough info for the dashboard to show "Branch not configured"
  // when env vars are missing, without leaking any secret values themselves.
  app.get("/api/admin/dashboard/branch/config", ...gate, async (_req: Request, res: Response) => {
    try {
      res.json(getBranchPublicConfigSummary());
    } catch (err) {
      console.error("[dashboard-branch] config probe error:", err);
      res.status(500).json({ message: "Failed to load Branch config" });
    }
  });

  // ── Smart-link redirector config probe (admin) ───────────────────────────
  // Lets the dashboard show the canonical smart link for each campaign and
  // warn if iOS/Android fallbacks are missing. Non-secret values only.
  app.get("/api/admin/dashboard/smart-link/config", ...gate, async (_req: Request, res: Response) => {
    try {
      res.json(getSmartLinkPublicConfig());
    } catch (err) {
      console.error("[dashboard-smart-link] config probe error:", err);
      res.status(500).json({ message: "Failed to load smart-link config" });
    }
  });

  // ── AppsFlyer OneLink config probe (admin) ───────────────────────────────
  // Surfaces the OneLink template + domain so the dashboard can derive a
  // OneLink URL per campaign client-side. Phase 1 is read-only — admins
  // either rely on the auto-derived URL or paste a custom branded URL into
  // the campaign's appsflyerOneLinkUrl field on save. No secrets returned.
  app.get("/api/admin/dashboard/appsflyer/config", ...gate, async (_req: Request, res: Response) => {
    try {
      const { getAppsflyerPublicConfigSummary } = await import("../appsflyer");
      res.json(getAppsflyerPublicConfigSummary());
    } catch (err) {
      console.error("[dashboard-appsflyer] config probe error:", err);
      res.status(500).json({ message: "Failed to load AppsFlyer config" });
    }
  });

  // ── Branch.io: generate (or regenerate) a deep link for a campaign ───────
  //
  // POST /api/admin/dashboard/campaigns/:id/branch-link
  //
  // Pre-conditions:
  //   • Admin-gated (same as the rest of /api/admin/dashboard/...)
  //   • BRANCH_INTEGRATION_ENABLED must be "true" — staging-only kill switch.
  //   • BRANCH_KEY must be set.
  //   • Campaign must exist and have a referral code.
  //
  // Idempotent: regenerate on an existing alias always passes overwrite=true
  // so Branch updates the link in place.
  app.post(
    "/api/admin/dashboard/campaigns/:id/branch-link",
    ...gate,
    async (req: Request, res: Response) => {
      try {
        if (!isBranchIntegrationEnabled()) {
          res.status(503).json({
            code: "BRANCH_DISABLED",
            message: "Branch integration is disabled on this server (BRANCH_INTEGRATION_ENABLED != true)",
          });
          return;
        }
        if (!isBranchConfigured()) {
          res.status(503).json({
            code: "BRANCH_NOT_CONFIGURED",
            message: "Branch is not configured (missing BRANCH_KEY)",
          });
          return;
        }

        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ message: "Invalid campaign id" });
          return;
        }

        // Web fallback URL: prefer an explicit body override, otherwise build
        // one from the request's host so links degrade gracefully on desktop.
        const bodyFallback = (typeof req.body?.webFallbackUrl === "string"
          ? String(req.body.webFallbackUrl)
          : ""
        ).trim();
        const proto = (req.header("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
        const host = req.header("x-forwarded-host") || req.get("host") || "";
        const inferredFallback = host ? `${proto}://${host}/` : "https://www.ecologicc.com/";
        const webFallbackUrl = bodyFallback || inferredFallback;

        console.log(`[dashboard-branch] generate link campaignId=${id} fallback=${webFallbackUrl}`);
        const result = await createOrRegenerateBranchLinkForCampaign(id, { webFallbackUrl });
        if (!result.ok) {
          console.warn(`[dashboard-branch] link gen failed campaignId=${id}: ${result.error}`);
          res.status(400).json({
            code: "BRANCH_LINK_FAILED",
            message: result.error || "Branch link generation failed",
          });
          return;
        }
        const metrics = await getMobileMetricsByCampaign(id);
        res.json({ campaign: result.campaign, metrics });
      } catch (err: any) {
        console.error("[dashboard-branch] route error:", err?.message ?? err);
        res.status(500).json({ message: "Branch link generation failed" });
      }
    },
  );

  // ── Creators ─────────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard/creators", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard] loading creators");
      const data = await listGrowthCreators();
      res.json(data);
    } catch (err) {
      console.error("[dashboard] creators error:", err);
      res.status(500).json({ message: "Failed to load creators" });
    }
  });

  app.post("/api/admin/dashboard/creators", ...gate, async (req: Request, res: Response) => {
    try {
      const parsed = insertGrowthCreatorSchema.parse(req.body);
      const row = await createGrowthCreator(parsed);
      console.log(`[dashboard] creator created id=${row.id}`);
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.issues) {
        res.status(400).json({ message: "Validation failed", issues: err.issues });
        return;
      }
      if (err?.code === "23505") {
        res.status(409).json({
          code: "DUPLICATE_REFERRAL_CODE",
          message: "Referral code is already in use",
        });
        return;
      }
      console.error("[dashboard] creator create error:", err);
      res.status(500).json({ message: "Failed to create creator" });
    }
  });

  app.patch("/api/admin/dashboard/creators/:id", ...gate, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ message: "Invalid id" });
        return;
      }
      const parsed = insertGrowthCreatorSchema.partial().parse(req.body);
      const row = await updateGrowthCreator(id, parsed);
      if (!row) {
        res.status(404).json({ message: "Creator not found" });
        return;
      }
      console.log(`[dashboard] creator updated id=${row.id}`);
      res.json(row);
    } catch (err: any) {
      if (err?.issues) {
        res.status(400).json({ message: "Validation failed", issues: err.issues });
        return;
      }
      if (err?.code === "23505") {
        res.status(409).json({
          code: "DUPLICATE_REFERRAL_CODE",
          message: "Referral code is already in use",
        });
        return;
      }
      console.error("[dashboard] creator update error:", err);
      res.status(500).json({ message: "Failed to update creator" });
    }
  });

  // ── Accounts ─────────────────────────────────────────────────────────────
  // List every customer company joined to owner / attribution / admin status.
  // Different from /subscribers, which only lists attributed companies.
  app.get("/api/admin/dashboard/accounts", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard-accounts] listing accounts");
      const data = await listAccounts();
      res.json(data);
    } catch (err) {
      console.error("[dashboard-accounts] list error:", err);
      res.status(500).json({ message: "Failed to load accounts" });
    }
  });

  app.get("/api/admin/dashboard/accounts/:companyId", ...gate, async (req: Request, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      console.log(`[dashboard-accounts] loading account detail — companyId=${companyId}`);
      const data = await getAccountDetail(companyId);
      if (!data) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      // Surface the env-var gate so the UI can show/hide the destructive button.
      res.json({ ...data, deletionEnabled: isAccountDeletionEnabled() });
    } catch (err) {
      console.error("[dashboard-accounts] detail error:", err);
      res.status(500).json({ message: "Failed to load account" });
    }
  });

  app.patch("/api/admin/dashboard/accounts/:companyId/attribution", ...gate, async (req: Request, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      const body = req.body ?? {};

      // ── sourceType: must be null OR a known GrowthSourceType
      let sourceType: string | null | undefined;
      if (body.sourceType === null) {
        sourceType = null;
      } else if (typeof body.sourceType === "string") {
        if (!(GROWTH_SOURCE_TYPES as readonly string[]).includes(body.sourceType)) {
          res.status(400).json({
            message: `sourceType must be one of: ${GROWTH_SOURCE_TYPES.join(", ")}`,
          });
          return;
        }
        sourceType = body.sourceType;
      } else {
        sourceType = undefined;
      }

      // ── campaignId: number, null, or absent. Reject NaN.
      let campaignId: number | null | undefined;
      if (body.campaignId === null) {
        campaignId = null;
      } else if (typeof body.campaignId === "number") {
        if (!Number.isFinite(body.campaignId)) {
          res.status(400).json({ message: "campaignId must be a finite number" });
          return;
        }
        campaignId = body.campaignId;
      } else if (typeof body.campaignId === "string" && body.campaignId.length) {
        const parsed = parseInt(body.campaignId, 10);
        if (!Number.isFinite(parsed)) {
          res.status(400).json({ message: "campaignId must be a finite number" });
          return;
        }
        campaignId = parsed;
      } else {
        campaignId = undefined;
      }

      const payload = {
        sourceType,
        sourceName: typeof body.sourceName === "string" || body.sourceName === null ? body.sourceName : undefined,
        campaignId,
        referralCode: typeof body.referralCode === "string" || body.referralCode === null ? body.referralCode : undefined,
      };
      const result = await updateAccountAttribution(companyId, payload);
      res.json(result);
    } catch (err) {
      console.error("[dashboard-accounts] attribution error:", err);
      res.status(500).json({ message: "Failed to update attribution" });
    }
  });

  app.patch("/api/admin/dashboard/accounts/:companyId/status", ...gate, async (req: Request, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      const status = req.body?.status as string | undefined;
      if (!status || !(ACCOUNT_ADMIN_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({
          message: `status must be one of: ${ACCOUNT_ADMIN_STATUSES.join(", ")}`,
        });
        return;
      }
      const row = await updateAccountStatus(companyId, status as AccountAdminStatus);
      res.json(row);
    } catch (err) {
      console.error("[dashboard-accounts] status error:", err);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  app.patch("/api/admin/dashboard/accounts/:companyId/notes", ...gate, async (req: Request, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      const raw = req.body?.notes;
      const notes = raw == null ? null : String(raw);
      const row = await updateAccountNotes(companyId, notes);
      res.json(row);
    } catch (err) {
      console.error("[dashboard-accounts] notes error:", err);
      res.status(500).json({ message: "Failed to update notes" });
    }
  });

  app.post("/api/admin/dashboard/accounts/:companyId/refresh-subscription", ...gate, async (req: Request, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      const result = await refreshAccountSubscription(companyId);
      res.json(result);
    } catch (err: any) {
      console.error("[dashboard-accounts] refresh error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to refresh subscription" });
    }
  });

  // ── Delete account (preview) ─────────────────────────────────────────────
  // Returns counts + warnings for the confirmation modal. Read-only.
  app.post(
    "/api/admin/dashboard/accounts/:companyId/delete-preview",
    ...gate,
    async (req: Request, res: Response) => {
      try {
        const companyId = parseInt(req.params.companyId, 10);
        if (!Number.isFinite(companyId)) {
          res.status(400).json({ message: "Invalid companyId" });
          return;
        }
        // Resolve actor email so the preview can mark the actor as kept (not
        // deleted) — mirrors the live skip-actor behavior in deleteCompanyDeep.
        let actorEmailForPreview: string | null = null;
        const actorUserId = req.userContext?.userId ?? null;
        if (actorUserId) {
          try {
            const { storage } = await import("../storage");
            const u = await storage.getUser(actorUserId);
            if (u?.email) actorEmailForPreview = u.email;
          } catch {
            /* non-fatal — preview will still render without actor email */
          }
        }
        const preview = await previewAccountDeletion(companyId, actorEmailForPreview);
        if (!preview.exists) {
          res.status(404).json({ message: "Account not found" });
          return;
        }

        // Layer in environment-level gates so the UI can reflect them directly.
        const enabled = isAccountDeletionEnabled();
        const protectionMessage = await (async () => {
          try {
            const { getProtectionReason } = await import("../adminDeleteService");
            return await getProtectionReason(companyId);
          } catch {
            return null;
          }
        })();

        res.json({
          ...preview,
          deletionEnabled: enabled,
          protected: !!protectionMessage,
          protectedReason: protectionMessage,
        });
      } catch (err) {
        console.error("[dashboard-accounts] delete-preview error:", err);
        res.status(500).json({ message: "Failed to load delete preview" });
      }
    },
  );

  // ── Delete account (irreversible) ────────────────────────────────────────
  // Hard-deletes the company and every per-company row across the system.
  // Gated on multiple layers:
  //   • requireAuth + requireDashboardAdmin (route gate)
  //   • ALLOW_DASHBOARD_ACCOUNT_DELETION env-var (default OFF; staging-only)
  //   • Confirmation payload { confirmText: "DELETE", understood: true }
  //   • Self-delete blocked unless ALLOW_SELF_ACCOUNT_DELETE=true
  //   • Hardcoded protected list in adminDeleteService
  // Stripe / Apple / Google subscriptions are NOT auto-canceled — local refs only.
  app.delete(
    "/api/admin/dashboard/accounts/:companyId",
    ...gate,
    async (req: Request, res: Response) => {
      // Resolve actor identity from req.userContext.userId (populated by
      // requireAuth) → DB. userContext does NOT carry the user email, so
      // a lookup is required for accurate audit attribution.
      const actorUserId = req.userContext?.userId ?? null;
      let actorEmail = "unknown";
      if (actorUserId) {
        try {
          const { storage } = await import("../storage");
          const u = await storage.getUser(actorUserId);
          if (u?.email) actorEmail = u.email;
        } catch (lookupErr: any) {
          console.error(
            `[dashboard-accounts] actor email lookup failed for userId=${actorUserId}:`,
            lookupErr?.message ?? lookupErr,
          );
        }
      }
      const companyId = parseInt(req.params.companyId, 10);

      console.log(
        `[dashboard-accounts] delete requested — companyId=${req.params.companyId} actor=${actorEmail} actorUserId=${actorUserId ?? "<none>"}`,
      );

      // Hard requirement: we must know who is performing the deletion.
      // If we can't resolve the email, refuse rather than write "unknown" to audit.
      if (actorEmail === "unknown") {
        console.error(
          `[dashboard-accounts] delete blocked by safety check — could not resolve actor email (userId=${actorUserId ?? "<none>"})`,
        );
        res.status(500).json({
          code: "ACTOR_UNRESOLVED",
          message:
            "Could not resolve the dashboard admin's email for audit logging. Refusing to proceed.",
        });
        return;
      }

      if (!Number.isFinite(companyId)) {
        console.warn(
          `[dashboard-accounts] delete blocked by safety check — invalid companyId actor=${actorEmail}`,
        );
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }

      // ── Env-var gate: must be explicitly enabled per environment.
      if (!isAccountDeletionEnabled()) {
        console.warn(
          `[dashboard-accounts] delete blocked by safety check — ALLOW_DASHBOARD_ACCOUNT_DELETION not set (companyId=${companyId} actor=${actorEmail})`,
        );
        res.status(403).json({
          code: "DELETION_DISABLED",
          message:
            "Account deletion is not enabled in this environment. Set ALLOW_DASHBOARD_ACCOUNT_DELETION=true to enable.",
        });
        return;
      }

      // ── Confirmation payload validation.
      const body = req.body ?? {};
      if (body.confirmText !== "DELETE" || body.understood !== true) {
        console.warn(
          `[dashboard-accounts] delete blocked by safety check — missing/invalid confirmation (companyId=${companyId} actor=${actorEmail})`,
        );
        res.status(400).json({
          code: "CONFIRMATION_REQUIRED",
          message:
            "Confirmation required: { confirmText: 'DELETE', understood: true }",
        });
        return;
      }
      console.log(
        `[dashboard-accounts] delete confirmation validated — companyId=${companyId} actor=${actorEmail}`,
      );

      try {
        // ── Self-delete guard.
        const userId = (req as any).userContext?.userId;
        if (userId) {
          const memberRow = await db
            .select({ id: companyMembers.id })
            .from(companyMembers)
            .where(
              and(
                eq(companyMembers.userId, userId),
                eq(companyMembers.companyId, companyId),
              ),
            )
            .limit(1);
          if (memberRow.length > 0 && !isSelfAccountDeleteAllowed()) {
            console.warn(
              `[dashboard-accounts] delete blocked by safety check — admin is a member of this company (companyId=${companyId} actor=${actorEmail})`,
            );
            res.status(403).json({
              code: "SELF_DELETE_BLOCKED",
              message:
                "You are a member of this company. Set ALLOW_SELF_ACCOUNT_DELETE=true to bypass this guard.",
            });
            return;
          }
        }

        const { deleteCompanyDeep, getProtectionReason } = await import(
          "../adminDeleteService"
        );

        const protectionReason = await getProtectionReason(companyId);
        if (protectionReason) {
          console.warn(
            `[dashboard-accounts] delete blocked by safety check — ${protectionReason} (companyId=${companyId} actor=${actorEmail})`,
          );
          res.status(403).json({
            code: "COMPANY_PROTECTED",
            message: protectionReason,
          });
          return;
        }

        // Snapshot a preview before deletion so the audit log captures counts.
        const preview = await previewAccountDeletion(companyId);

        console.log(
          `[dashboard-accounts] deleting company data — companyId=${companyId} actor=${actorEmail}`,
        );
        const result = await deleteCompanyDeep(companyId, actorEmail);

        // Best-effort audit log write — never fail the request if logging fails.
        try {
          await db.insert(adminAuditLogs).values({
            actorEmail,
            targetType: "company",
            targetId: String(companyId),
            targetName: result.companyName ?? preview.companyName ?? null,
            action: "delete_account",
            beforeValue: {
              ownerEmail: preview.ownerEmail,
              counts: preview.counts,
              subscription: preview.subscription,
              tablesAffected: result.tablesAffected,
              orphanedUsersDeleted: result.orphanedUsersDeleted,
              deletedUserEmails: result.deletedUserEmails,
              keptUsers: result.keptUsers,
              authIdentitiesDeleted: result.authIdentitiesDeleted,
              sessionsDeleted: result.sessionsDeleted,
            } as any,
            afterValue: null,
            note: preview.warnings.length
              ? preview.warnings.join(" | ")
              : null,
          });
          console.log(
            `[dashboard-accounts] deleted table records — tables=${result.tablesAffected.length} orphanedUsers=${result.orphanedUsersDeleted} keptUsers=${result.keptUsers.length} authRows=${result.authIdentitiesDeleted}`,
          );
        } catch (auditErr: any) {
          console.error(
            `[dashboard-accounts] audit log write failed (non-fatal): ${auditErr?.message ?? auditErr}`,
          );
        }

        console.log(
          `[dashboard-accounts] account deleted — companyId=${companyId} name="${result.companyName}" actor=${actorEmail} deletedUsers=${result.orphanedUsersDeleted} keptUsers=${result.keptUsers.length}`,
        );

        res.json({
          ok: true,
          companyId: result.companyId,
          companyName: result.companyName,
          tablesAffected: result.tablesAffected,
          orphanedUsersDeleted: result.orphanedUsersDeleted,
          deletedUserEmails: result.deletedUserEmails,
          keptUsers: result.keptUsers,
          authIdentitiesDeleted: result.authIdentitiesDeleted,
          sessionsDeleted: result.sessionsDeleted,
          warnings: preview.warnings,
        });
      } catch (err: any) {
        console.error(
          `[dashboard-accounts] delete failed — companyId=${companyId} actor=${actorEmail}:`,
          err,
        );
        res.status(500).json({
          ok: false,
          message: err?.message ?? "Failed to delete account",
        });
      }
    },
  );

  // ── Whoami: tells the client whether the current session is a dashboard
  // admin. This drives the client-side gate so the SPA can render Access
  // Denied without leaking any data.
  app.get("/api/admin/dashboard/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const { isDashboardAdminEmail } = await import("./access");
      const { storage } = await import("../storage");
      const userId = req.userContext?.userId;
      if (!userId) {
        res.status(401).json({ allowed: false, reason: "unauthenticated" });
        return;
      }
      const user = await storage.getUser(userId);
      const allowed = isDashboardAdminEmail(user?.email);
      res.json({ allowed, email: user?.email ?? null });
    } catch (err) {
      console.error("[dashboard] /me error:", err);
      res.status(500).json({ allowed: false, reason: "error" });
    }
  });
}
