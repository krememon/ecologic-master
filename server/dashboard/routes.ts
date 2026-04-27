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
} from "@shared/schema";
import {
  listGrowthSubscribers,
  listGrowthCampaigns,
  createGrowthCampaign,
  updateGrowthCampaign,
  listGrowthCreators,
  createGrowthCreator,
  updateGrowthCreator,
  getDashboardOverview,
  getSourceBreakdown,
} from "./storage";

const gate = [requireAuth, requireDashboardAdmin] as const;

export function registerDashboardRoutes(app: Express): void {
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
      const data = await listGrowthSubscribers();
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

  // ── Campaigns ────────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard/campaigns", ...gate, async (_req: Request, res: Response) => {
    try {
      console.log("[dashboard] loading campaigns");
      const data = await listGrowthCampaigns();
      res.json(data);
    } catch (err) {
      console.error("[dashboard] campaigns error:", err);
      res.status(500).json({ message: "Failed to load campaigns" });
    }
  });

  app.post("/api/admin/dashboard/campaigns", ...gate, async (req: Request, res: Response) => {
    try {
      const parsed = insertGrowthCampaignSchema.parse(req.body);
      const row = await createGrowthCampaign(parsed);
      console.log(`[dashboard] campaign created id=${row.id} sourceType=${row.sourceType}`);
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.issues) {
        res.status(400).json({ message: "Validation failed", issues: err.issues });
        return;
      }
      console.error("[dashboard] campaign create error:", err);
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
      const row = await updateGrowthCampaign(id, parsed);
      if (!row) {
        res.status(404).json({ message: "Campaign not found" });
        return;
      }
      console.log(`[dashboard] campaign updated id=${row.id}`);
      res.json(row);
    } catch (err: any) {
      if (err?.issues) {
        res.status(400).json({ message: "Validation failed", issues: err.issues });
        return;
      }
      console.error("[dashboard] campaign update error:", err);
      res.status(500).json({ message: "Failed to update campaign" });
    }
  });

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
      console.error("[dashboard] creator update error:", err);
      res.status(500).json({ message: "Failed to update creator" });
    }
  });

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
