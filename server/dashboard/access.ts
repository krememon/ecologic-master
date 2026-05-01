/**
 * Dashboard Access Control
 * ────────────────────────
 * Gates the EcoLogic owner/admin dashboard at dashboard.ecologicc.com
 * (and staging-dashboard.ecologicc.com).
 *
 * Two layers:
 *   1. The user MUST be authenticated (via the existing requireAuth flow).
 *   2. Their email MUST appear in the DASHBOARD_ADMIN_EMAILS allow-list.
 *
 * IMPORTANT: customer-side `OWNER` role does NOT grant dashboard access.
 * That role just means they own a contractor company in the customer app —
 * they must NEVER see EcoLogic's revenue/subscriber data. Dashboard admin
 * is a fully separate concept gated by env-var allow-list only.
 */

import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

let cachedAllowList: Set<string> | null = null;
let cachedRaw: string | null = null;

/** Parse DASHBOARD_ADMIN_EMAILS into a normalized Set. Cached per process. */
export function getDashboardAdminEmails(): Set<string> {
  const raw = process.env.DASHBOARD_ADMIN_EMAILS || "";
  if (cachedAllowList && cachedRaw === raw) return cachedAllowList;
  cachedRaw = raw;
  cachedAllowList = new Set(
    raw
      .split(/[,\s;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  return cachedAllowList;
}

export function isDashboardAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getDashboardAdminEmails().has(email.trim().toLowerCase());
}

/**
 * Express middleware: chain after requireAuth. Loads the user's email,
 * checks the allow-list, and either calls next() or returns 403.
 */
export async function requireDashboardAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userContext?.userId) {
      console.log("[dashboard] access denied — no user context");
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const user = await storage.getUser(req.userContext.userId);
    const email = user?.email || null;

    if (!isDashboardAdminEmail(email)) {
      console.log(
        `[dashboard] access denied — userId=${req.userContext.userId} email=${email ?? "<none>"} (not in DASHBOARD_ADMIN_EMAILS)`
      );
      res.status(403).json({ code: "DASHBOARD_ACCESS_DENIED", message: "Access denied" });
      return;
    }

    console.log(`[dashboard] access granted — email=${email}`);
    next();
  } catch (err) {
    console.error("[dashboard] access check error:", err);
    res.status(500).json({ message: "Access check error" });
  }
}
