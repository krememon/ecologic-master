import { UserRole } from "./schema";

export type Permission =
  | "org.view"              // view company info and invite code
  | "org.manage"            // company settings, billing, users, rotate code
  | "users.view"            // view employees roster
  | "users.manage"          // manage employee roles and status
  | "schedule.view"
  | "schedule.manage"       // create/edit/delete calendar items, assign
  | "jobs.view.all"
  | "jobs.view.assigned"
  | "jobs.create"
  | "jobs.edit"
  | "jobs.delete"
  | "jobs.status.update"
  | "jobs.photos.upload"
  | "jobs.tasks.complete"
  | "routes.manage"
  | "estimates.create"
  | "estimates.send"
  | "leads.view"            // view leads list
  | "leads.manage"          // create/edit/delete leads
  | "leads.convert"         // convert lead to job/customer
  | "clients.manage"
  | "invoicing.manage"
  | "documents.view"
  | "documents.manage"
  | "customize.manage";     // manage service catalog, templates

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    "org.view",
    "org.manage",
    "users.view",
    "users.manage",
    "schedule.view",
    "schedule.manage",
    "jobs.view.all",
    "jobs.create",
    "jobs.edit",
    "jobs.delete",
    "jobs.status.update",
    "jobs.photos.upload",
    "jobs.tasks.complete",
    "routes.manage",
    "estimates.create",
    "estimates.send",
    "leads.view",
    "leads.manage",
    "leads.convert",
    "clients.manage",
    "invoicing.manage",
    "documents.view",
    "documents.manage",
    "customize.manage",
  ],
  SUPERVISOR: [
    "org.view",
    "users.view",
    "users.manage",
    "schedule.view",
    "schedule.manage",
    "jobs.view.all",
    "jobs.create",
    "jobs.edit",
    "jobs.delete",
    "jobs.status.update",
    "jobs.photos.upload",
    "jobs.tasks.complete",
    "routes.manage",
    "estimates.create",
    "estimates.send",
    "leads.view",
    "leads.manage",
    "leads.convert",
    "clients.manage",
    "invoicing.manage",
    "documents.view",
    "documents.manage",
  ],
  TECHNICIAN: [
    "jobs.view.assigned",
    "jobs.status.update",
    "jobs.photos.upload",
    "jobs.tasks.complete",
    "schedule.view",
    "documents.view",
  ],
  DISPATCHER: [
    "schedule.view",
    "schedule.manage",
    "routes.manage",
    "jobs.view.all",
    "jobs.edit",
    "jobs.delete",
    "jobs.create",
    "leads.view",
    "leads.manage",
    "leads.convert",
    "documents.view",
  ],
  ESTIMATOR: [
    "estimates.create",
    "estimates.send",
    "leads.view",
    "leads.manage",
    "leads.convert",
    "clients.manage",
    "jobs.view.all",
    "schedule.view",
    "documents.view",
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
