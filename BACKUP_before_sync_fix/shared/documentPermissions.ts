export const ADMIN_ROLES = ['OWNER', 'SUPERVISOR'] as const;
export const ALL_ROLES = ['OWNER', 'SUPERVISOR', 'TECHNICIAN'] as const;

export const WORKFLOW_CATEGORIES = ['Contracts', 'Estimates', 'Invoices', 'Permits'] as const;
export const REFERENCE_CATEGORIES = ['Photos', 'Manuals', 'Other'] as const;
export const ALL_CATEGORIES = [...WORKFLOW_CATEGORIES, ...REFERENCE_CATEGORIES] as const;

// Document visibility levels
export const DOCUMENT_VISIBILITIES = [
  'customer_internal',   // Visible to customers and all internal roles
  'assigned_crew_only',  // Only visible to assigned crew (Technicians, Supervisors)
  'office_only',         // Office staff only (not technicians in the field)
  'internal',            // All internal staff, not customer-facing
  'owner_only'           // Only Owner can see
] as const;

export type Role = typeof ALL_ROLES[number];
export type Category = typeof ALL_CATEGORIES[number];
export type WorkflowCategory = typeof WORKFLOW_CATEGORIES[number];
export type DocumentVisibility = typeof DOCUMENT_VISIBILITIES[number];

export type DocumentAction = 'view' | 'upload' | 'delete' | 'rename' | 'changeStatus' | 'assignToJob';

export type DocumentStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected';

// Visibility permissions per role
// Each role can see documents with these visibility levels
const VISIBILITY_BY_ROLE: Record<Role, DocumentVisibility[]> = {
  OWNER: ['customer_internal', 'assigned_crew_only', 'office_only', 'internal', 'owner_only'],
  SUPERVISOR: ['customer_internal', 'assigned_crew_only', 'internal', 'office_only'],
  TECHNICIAN: ['customer_internal', 'assigned_crew_only'],
};

// Get allowed visibilities for a role
export function getAllowedVisibilities(role: string | null | undefined): DocumentVisibility[] {
  const normalized = normalizeRole(role);
  if (!normalized) return [];
  return VISIBILITY_BY_ROLE[normalized] || [];
}

// Check if a role can see a document with given visibility
export function canSeeVisibility(role: string | null | undefined, visibility: DocumentVisibility): boolean {
  const allowed = getAllowedVisibilities(role);
  return allowed.includes(visibility);
}

// Roles that can access all jobs (not restricted by assignment)
export function canAccessAllJobs(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  // Technician is the only role restricted to assigned jobs
  // All other roles can see all jobs
  return normalized !== 'TECHNICIAN';
}

function normalizeRole(role: string | null | undefined): Role | null {
  if (!role) return null;
  const upper = role.toUpperCase();
  if ((ALL_ROLES as readonly string[]).includes(upper)) {
    return upper as Role;
  }
  return null;
}

export function isAdmin(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  return (ADMIN_ROLES as readonly string[]).includes(normalized);
}

export function isWorkflowCategory(category: string): boolean {
  return (WORKFLOW_CATEGORIES as readonly string[]).includes(category as WorkflowCategory);
}

export function canViewDocument(role: string | null | undefined, category: string, hasJobAccess: boolean = true): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  
  switch (normalized) {
    case 'OWNER':
    case 'SUPERVISOR':
      return true;
    case 'TECHNICIAN':
      return hasJobAccess;
    default:
      return false;
  }
}

export function canUploadCategory(role: string | null | undefined, category: string): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  
  switch (normalized) {
    case 'OWNER':
    case 'SUPERVISOR':
      return true;
    case 'TECHNICIAN':
      return category === 'Photos';
    default:
      return false;
  }
}

export function requireJobForUpload(role: string | null | undefined, category: string): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return true;
  
  if (isAdmin(role)) {
    return false;
  }
  return true;
}

export function canUploadCompanyWide(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function canDelete(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function canRename(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function canAssignToJob(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function canChangeStatus(role: string | null | undefined, category: string): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  
  if (!isWorkflowCategory(category)) {
    return false;
  }
  
  switch (normalized) {
    case 'OWNER':
    case 'SUPERVISOR':
      return true;
    default:
      return false;
  }
}

export function canApproveOrReject(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function getAllowedStatusTransitions(
  role: string | null | undefined, 
  category: string, 
  currentStatus: DocumentStatus
): DocumentStatus[] {
  const normalized = normalizeRole(role);
  if (!normalized) return [];
  
  if (!isWorkflowCategory(category)) {
    return [];
  }
  
  if (isAdmin(role)) {
    switch (currentStatus) {
      case 'Draft':
        return ['Pending Approval'];
      case 'Pending Approval':
        return ['Approved', 'Rejected', 'Draft'];
      case 'Approved':
        return ['Draft'];
      case 'Rejected':
        return ['Draft', 'Pending Approval'];
      default:
        return [];
    }
  }
  
  return [];
}

export function canTransitionStatus(
  role: string | null | undefined,
  category: string,
  fromStatus: DocumentStatus,
  toStatus: DocumentStatus
): boolean {
  const allowed = getAllowedStatusTransitions(role, category, fromStatus);
  return allowed.includes(toStatus);
}

export function getUploadableCategories(role: string | null | undefined): Category[] {
  const normalized = normalizeRole(role);
  if (!normalized) return [];
  
  switch (normalized) {
    case 'OWNER':
    case 'SUPERVISOR':
      return [...ALL_CATEGORIES];
    case 'TECHNICIAN':
      return ['Photos'];
    default:
      return [];
  }
}

export function canViewCompanyWideDocuments(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  
  switch (normalized) {
    case 'OWNER':
    case 'SUPERVISOR':
      return true;
    case 'TECHNICIAN':
      return false;
    default:
      return false;
  }
}

export function getPermissionErrorMessage(action: DocumentAction): string {
  switch (action) {
    case 'upload':
      return "You don't have permission to upload this type of document.";
    case 'delete':
      return "You don't have permission to delete documents.";
    case 'rename':
      return "You don't have permission to rename documents.";
    case 'changeStatus':
      return "You don't have permission to change document status.";
    case 'assignToJob':
      return "You don't have permission to assign documents to jobs.";
    case 'view':
      return "You don't have permission to view this document.";
    default:
      return "You don't have permission to perform this action.";
  }
}
