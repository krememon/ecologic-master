/**
 * Centralized Security Middleware for EcoLogic
 * 
 * This module provides standardized authentication middleware that:
 * 1. Validates user session
 * 2. Attaches user context (userId, companyId, role) to request
 * 3. Provides consistent error responses
 * 
 * USAGE:
 * import { requireAuth, requireCompany } from './security/middleware';
 * 
 * app.get('/api/protected', requireAuth, (req, res) => {
 *   const { userId, companyId, role } = req.userContext;
 * });
 */

import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { UserContext, hasPermission, logSecurityEvent } from "./permissions";
import { Permission } from "@shared/permissions";
import { UserRole } from "@shared/schema";

// Extend Express Request to include user context
declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

/**
 * Extract user ID from various auth providers (Replit, Passport, etc.)
 */
export function extractUserId(user: any): string | null {
  if (!user) return null;
  
  // Replit Auth format
  if (user.claims?.sub) {
    return user.claims.sub;
  }
  
  // Standard format
  if (user.id) {
    return String(user.id);
  }
  
  if (user.sub) {
    return user.sub;
  }
  
  return null;
}

/**
 * Core authentication middleware
 * Validates session and attaches user context
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Check if request is authenticated
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const userId = extractUserId(req.user);
    if (!userId) {
      logSecurityEvent("unauthorized", { entityType: "user", reason: "Invalid user session" });
      res.status(401).json({ message: "Invalid session" });
      return;
    }

    // Get user's company
    const company = await storage.getUserCompany(userId);
    if (!company) {
      // User exists but has no company - this is valid for new users
      req.userContext = {
        userId,
        companyId: 0, // No company
        role: "technician" as UserRole, // Default role
      };
      next();
      return;
    }

    // Get user's role in the company
    const membership = await storage.getUserRole(userId, company.id);
    if (!membership) {
      logSecurityEvent("unauthorized", { 
        userId, 
        companyId: company.id, 
        entityType: "membership", 
        reason: "No role assigned" 
      });
      res.status(403).json({ code: "NO_ROLE", message: "No role assigned" });
      return;
    }

    // Attach user context to request
    req.userContext = {
      userId,
      companyId: company.id,
      role: membership.role as UserRole,
      membershipId: membership.id,
    };

    next();
  } catch (error) {
    console.error("[Auth] Middleware error:", error);
    res.status(500).json({ message: "Authentication error" });
  }
}

/**
 * Require user to have a company
 * Use after requireAuth for routes that need company context
 */
export async function requireCompany(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userContext) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (!req.userContext.companyId || req.userContext.companyId === 0) {
    res.status(403).json({ code: "NO_COMPANY", message: "No company access" });
    return;
  }

  next();
}

/**
 * Require specific permission(s)
 * Use after requireAuth
 */
export function requirePermission(permission: Permission | Permission[]) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.userContext) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (!req.userContext.companyId || req.userContext.companyId === 0) {
      res.status(403).json({ code: "NO_COMPANY", message: "No company access" });
      return;
    }

    const permissions = Array.isArray(permission) ? permission : [permission];
    const allowed = permissions.some(p => hasPermission(req.userContext!, p));

    if (!allowed) {
      logSecurityEvent("access_denied", {
        userId: req.userContext.userId,
        companyId: req.userContext.companyId,
        entityType: "permission",
        reason: `Missing permission: ${permissions.join(", ")}`,
      });
      res.status(403).json({ message: "Insufficient permissions" });
      return;
    }

    next();
  };
}

/**
 * Validate entity belongs to user's company
 * Returns 404 if not found or belongs to different company (prevents IDOR)
 */
export function validateEntityOwnership<T extends { companyId: number }>(
  entity: T | null | undefined,
  ctx: UserContext
): T | null {
  if (!entity) return null;
  if (entity.companyId !== ctx.companyId) return null;
  return entity;
}

/**
 * Standard 404 response for missing/unauthorized resources
 * Uses 404 instead of 403 to prevent information leakage
 */
export function notFound(res: Response, entityType: string = "Resource"): void {
  res.status(404).json({ message: `${entityType} not found` });
}
