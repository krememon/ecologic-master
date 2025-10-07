import { UserRole } from "./schema";

export type Permission =
  | "org.manage"            // company settings, billing, users
  | "schedule.view"
  | "schedule.manage"       // create/edit/delete calendar items, assign
  | "jobs.view.all"
  | "jobs.view.assigned"
  | "jobs.create"
  | "jobs.edit"
  | "jobs.status.update"
  | "jobs.photos.upload"
  | "jobs.tasks.complete"
  | "routes.manage"
  | "estimates.create"
  | "estimates.send"
  | "leads.convert"
  | "clients.manage"
  | "invoicing.manage"
  | "documents.manage";

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    "org.manage",
    "schedule.view",
    "schedule.manage",
    "jobs.view.all",
    "jobs.create",
    "jobs.edit",
    "jobs.status.update",
    "jobs.photos.upload",
    "jobs.tasks.complete",
    "routes.manage",
    "estimates.create",
    "estimates.send",
    "leads.convert",
    "clients.manage",
    "invoicing.manage",
    "documents.manage",
  ],
  SUPERVISOR: [
    "org.manage",
    "schedule.view",
    "schedule.manage",
    "jobs.view.all",
    "jobs.create",
    "jobs.edit",
    "jobs.status.update",
    "jobs.photos.upload",
    "jobs.tasks.complete",
    "routes.manage",
    "estimates.create",
    "estimates.send",
    "leads.convert",
    "clients.manage",
    "invoicing.manage",
    "documents.manage",
  ],
  TECHNICIAN: [
    "jobs.view.assigned",
    "jobs.status.update",
    "jobs.photos.upload",
    "jobs.tasks.complete",
    "schedule.view",
  ],
  DISPATCHER: [
    "schedule.view",
    "schedule.manage",
    "routes.manage",
    "jobs.view.all",
    "jobs.edit",
    "jobs.create",
  ],
  ESTIMATOR: [
    "estimates.create",
    "estimates.send",
    "leads.convert",
    "clients.manage",
    "jobs.view.all",
    "schedule.view",
  ],
};

export function can(userRole: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[userRole]?.includes(permission) ?? false;
}

export function canAny(userRole: UserRole, permissions: Permission[]): boolean {
  return permissions.some(perm => can(userRole, perm));
}

export function canAll(userRole: UserRole, permissions: Permission[]): boolean {
  return permissions.every(perm => can(userRole, perm));
}
