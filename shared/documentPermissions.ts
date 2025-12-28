export const ADMIN_ROLES = ['Owner', 'Supervisor'] as const;

export const OFFICIAL_CATEGORIES = ['Contracts', 'Estimates', 'Invoices', 'Permits', 'Manuals'] as const;
export const FIELD_UPLOADABLE_CATEGORIES = ['Photos'] as const;

export type AdminRole = typeof ADMIN_ROLES[number];

export function isAdmin(role: string | null | undefined): boolean {
  if (!role) return false;
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export function canUploadCategory(role: string | null | undefined, category: string): boolean {
  if (isAdmin(role)) {
    return true;
  }
  return (FIELD_UPLOADABLE_CATEGORIES as readonly string[]).includes(category);
}

export function requireJobForUpload(role: string | null | undefined, category: string): boolean {
  if (isAdmin(role)) {
    return false;
  }
  return true;
}

export function canDelete(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function canChangeStatus(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function getUploadableCategories(role: string | null | undefined): string[] {
  if (isAdmin(role)) {
    return ['Contracts', 'Estimates', 'Invoices', 'Permits', 'Photos', 'Manuals', 'Other'];
  }
  return ['Photos'];
}
