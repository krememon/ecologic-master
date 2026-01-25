import { storage } from "./storage";
import type { NotificationType, InsertNotification } from "@shared/schema";

type NotificationParams = {
  companyId: number;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: number;
  linkUrl?: string;
  meta?: Record<string, any>;
};

const MANAGER_ROLES = ["OWNER", "SUPERVISOR"];
const OFFICE_ROLES = ["OWNER", "SUPERVISOR", "DISPATCHER"];

export async function notifyUsers(
  recipientUserIds: string[],
  params: NotificationParams
): Promise<void> {
  if (recipientUserIds.length === 0) return;

  const uniqueRecipients = Array.from(new Set(recipientUserIds));
  const notificationsToCreate: InsertNotification[] = [];

  for (const userId of uniqueRecipients) {
    const existing = await storage.findRecentDuplicateNotification(
      userId,
      params.type,
      params.entityId ?? null,
      60
    );
    if (!existing) {
      notificationsToCreate.push({
        companyId: params.companyId,
        recipientUserId: userId,
        type: params.type,
        title: params.title,
        body: params.body,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        linkUrl: params.linkUrl || null,
        meta: params.meta || null,
      });
    }
  }

  if (notificationsToCreate.length > 0) {
    await storage.createNotifications(notificationsToCreate);
  }
}

export async function notifyJobCrew(
  jobId: number,
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  const crewAssignments = await storage.getJobCrewAssignments(jobId);
  const techUserIds = crewAssignments.map((c) => c.userId);
  if (techUserIds.length > 0) {
    await notifyUsers(techUserIds, { ...params, companyId });
  }
}

export async function notifyManagers(
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  const members = await storage.getCompanyMembers(companyId);
  const managerIds = members
    .filter((m) => MANAGER_ROLES.includes(m.role.toUpperCase()))
    .map((m) => m.userId);
  if (managerIds.length > 0) {
    await notifyUsers(managerIds, { ...params, companyId });
  }
}

export async function notifyOfficeStaff(
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  const members = await storage.getCompanyMembers(companyId);
  const officeIds = members
    .filter((m) => OFFICE_ROLES.includes(m.role.toUpperCase()))
    .map((m) => m.userId);
  if (officeIds.length > 0) {
    await notifyUsers(officeIds, { ...params, companyId });
  }
}

export async function notifyJobCrewAndOffice(
  jobId: number,
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  const crewAssignments = await storage.getJobCrewAssignments(jobId);
  const techUserIds = crewAssignments.map((c) => c.userId);
  
  const members = await storage.getCompanyMembers(companyId);
  const officeIds = members
    .filter((m) => OFFICE_ROLES.includes(m.role.toUpperCase()))
    .map((m) => m.userId);
  
  const allRecipients = [...techUserIds, ...officeIds];
  if (allRecipients.length > 0) {
    await notifyUsers(allRecipients, { ...params, companyId });
  }
}

export async function notifyJobCrewAndManagers(
  jobId: number,
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  const crewAssignments = await storage.getJobCrewAssignments(jobId);
  const techUserIds = crewAssignments.map((c) => c.userId);
  
  const members = await storage.getCompanyMembers(companyId);
  const managerIds = members
    .filter((m) => MANAGER_ROLES.includes(m.role.toUpperCase()))
    .map((m) => m.userId);
  
  const allRecipients = [...techUserIds, ...managerIds];
  if (allRecipients.length > 0) {
    await notifyUsers(allRecipients, { ...params, companyId });
  }
}

export async function notifySpecificUser(
  userId: string,
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  await notifyUsers([userId], { ...params, companyId });
}
