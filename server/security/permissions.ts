/**
 * Centralized Security Module for EcoLogic
 * 
 * This module provides:
 * 1. User context type definition
 * 2. Access control helpers for all entity types
 * 3. Company-scoped query helpers
 * 
 * SECURITY PRINCIPLE: All access checks must verify company ownership
 * to prevent cross-tenant data access (IDOR vulnerabilities).
 */

import { UserRole } from "@shared/schema";
import { can, Permission } from "@shared/permissions";
import { 
  canAccessAllJobs, 
  canViewCompanyWideDocuments,
  type DocumentVisibility 
} from "@shared/documentPermissions";

/**
 * User context attached to authenticated requests
 * This is the single source of truth for auth context
 */
export interface UserContext {
  userId: string;
  companyId: number;
  role: UserRole;
  membershipId?: number;
}

/**
 * Job access result
 */
export interface JobAccessResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if user can access a specific job
 * 
 * Access rules:
 * - Owner, Supervisor, Dispatcher: can access all jobs in company
 * - Technician: can only access jobs they are assigned to
 * - All users: job must belong to their company
 */
export function canAccessJob(
  ctx: UserContext,
  job: { id: number; companyId: number },
  userAssignedJobIds?: number[]
): JobAccessResult {
  // CRITICAL: Always check company ownership first
  if (job.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Job belongs to different company" };
  }

  // Managers can access all jobs in their company
  if (canAccessAllJobs(ctx.role)) {
    return { allowed: true };
  }

  // Technicians can only access assigned jobs
  if (userAssignedJobIds && userAssignedJobIds.includes(job.id)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "Not assigned to this job" };
}

/**
 * Check if user can access a specific document
 * 
 * Access rules based on visibility levels:
 * - customer_internal: All team + customers
 * - assigned_crew_only: Only crew assigned to related job
 * - office_only: Dispatchers, Supervisors, Owners
 * - internal: All internal team members
 * - owner_only: Only owners
 */
export function canAccessDocument(
  ctx: UserContext,
  document: { 
    id: number; 
    companyId: number; 
    visibility?: DocumentVisibility | null;
    jobId?: number | null;
  },
  userAssignedJobIds?: number[]
): JobAccessResult {
  // CRITICAL: Always check company ownership first
  if (document.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Document belongs to different company" };
  }

  const visibility = document.visibility || "internal";

  // Owner can access everything
  if (ctx.role === "owner") {
    return { allowed: true };
  }

  // Check visibility-based access
  switch (visibility) {
    case "owner_only":
      return { allowed: false, reason: "Document is owner-only" };
    
    case "office_only":
      if (["supervisor", "dispatcher"].includes(ctx.role)) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Document is office-only" };
    
    case "assigned_crew_only":
      // Must be assigned to the related job
      if (document.jobId && userAssignedJobIds?.includes(document.jobId)) {
        return { allowed: true };
      }
      // Office staff can also access
      if (["supervisor", "dispatcher"].includes(ctx.role)) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Not assigned to job" };
    
    case "internal":
    case "customer_internal":
      // All internal team members can access
      return { allowed: true };
    
    default:
      return { allowed: true };
  }
}

/**
 * Check if user can access a specific client
 */
export function canAccessClient(
  ctx: UserContext,
  client: { id: number; companyId: number }
): JobAccessResult {
  if (client.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Client belongs to different company" };
  }
  return { allowed: true };
}

/**
 * Check if user can access a specific customer
 */
export function canAccessCustomer(
  ctx: UserContext,
  customer: { id: number; companyId: number }
): JobAccessResult {
  if (customer.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Customer belongs to different company" };
  }
  return { allowed: true };
}

/**
 * Check if user can access a specific invoice
 */
export function canAccessInvoice(
  ctx: UserContext,
  invoice: { id: number; companyId: number; jobId?: number | null },
  userAssignedJobIds?: number[]
): JobAccessResult {
  if (invoice.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Invoice belongs to different company" };
  }

  // Managers can access all invoices
  if (canAccessAllJobs(ctx.role)) {
    return { allowed: true };
  }

  // Technicians can only access invoices for jobs they're assigned to
  if (invoice.jobId && userAssignedJobIds?.includes(invoice.jobId)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "Not authorized to access this invoice" };
}

/**
 * Check if user can access a specific estimate
 */
export function canAccessEstimate(
  ctx: UserContext,
  estimate: { id: number; companyId: number; jobId?: number | null },
  userAssignedJobIds?: number[]
): JobAccessResult {
  if (estimate.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Estimate belongs to different company" };
  }

  // Managers can access all estimates
  if (canAccessAllJobs(ctx.role)) {
    return { allowed: true };
  }

  // Technicians can only access estimates for jobs they're assigned to
  if (estimate.jobId && userAssignedJobIds?.includes(estimate.jobId)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "Not authorized to access this estimate" };
}

/**
 * Check if user can access a specific subcontractor
 */
export function canAccessSubcontractor(
  ctx: UserContext,
  subcontractor: { id: number; companyId: number }
): JobAccessResult {
  if (subcontractor.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Subcontractor belongs to different company" };
  }
  return { allowed: true };
}

/**
 * Check if user can access a specific lead
 */
export function canAccessLead(
  ctx: UserContext,
  lead: { id: number; companyId: number }
): JobAccessResult {
  if (lead.companyId !== ctx.companyId) {
    return { allowed: false, reason: "Lead belongs to different company" };
  }
  
  // Leads are manager-only
  if (!canAccessAllJobs(ctx.role)) {
    return { allowed: false, reason: "Not authorized to access leads" };
  }
  
  return { allowed: true };
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(ctx: UserContext, permission: Permission): boolean {
  return can(ctx.role, permission);
}

/**
 * Validate that an entity belongs to the user's company
 * Returns null if invalid, entity if valid
 */
export function validateCompanyOwnership<T extends { companyId: number }>(
  ctx: UserContext,
  entity: T | null | undefined
): T | null {
  if (!entity) return null;
  if (entity.companyId !== ctx.companyId) return null;
  return entity;
}

/**
 * Security log helper - logs access attempts without sensitive data
 */
export function logSecurityEvent(
  event: "access_denied" | "unauthorized" | "invalid_company",
  details: {
    userId?: string;
    companyId?: number;
    entityType: string;
    entityId?: number;
    reason?: string;
  }
): void {
  // Log security events without sensitive data
  console.log(`[SECURITY] ${event}:`, {
    entityType: details.entityType,
    entityId: details.entityId,
    reason: details.reason,
    timestamp: new Date().toISOString(),
  });
}
