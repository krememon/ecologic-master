import { storage } from "./storage";
import type { NotificationType, InsertNotification } from "@shared/schema";
import { sendPushToUser } from "./pushService";

type NotificationParams = {
  companyId: number;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: number;
  linkUrl?: string;
  meta?: Record<string, any>;
  dedupMinutes?: number;
  excludeUserIds?: string[];
};

const MANAGER_ROLES = ["OWNER", "SUPERVISOR"];
const OFFICE_ROLES = ["OWNER", "SUPERVISOR"];
const TECHNICIAN_ROLE = "TECHNICIAN";

// Filter user IDs to only include technicians
async function filterTechnicians(userIds: string[], companyId: number): Promise<string[]> {
  if (userIds.length === 0) return [];
  const techIds: string[] = [];
  for (const userId of userIds) {
    const member = await storage.getCompanyMember(companyId, userId);
    if (member && member.role.toUpperCase() === TECHNICIAN_ROLE) {
      techIds.push(userId);
    }
  }
  return techIds;
}

export async function notifyUsers(
  recipientUserIds: string[],
  params: NotificationParams
): Promise<void> {
  if (recipientUserIds.length === 0) return;

  let uniqueRecipients = Array.from(new Set(recipientUserIds));
  if (params.excludeUserIds && params.excludeUserIds.length > 0) {
    const excludeSet = new Set(params.excludeUserIds);
    uniqueRecipients = uniqueRecipients.filter(id => !excludeSet.has(id));
  }
  if (uniqueRecipients.length === 0) return;
  const notificationsToCreate: InsertNotification[] = [];

  const dedupWindow = params.dedupMinutes ?? 60;
  for (const userId of uniqueRecipients) {
    const existing = await storage.findRecentDuplicateNotification(
      userId,
      params.type,
      params.entityId ?? null,
      dedupWindow
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
    } else if (params.type === "dm_message" || params.type === "invoice_paid") {
      console.log(`[notify] ${params.type} deduped — skipping push for recipientUserId=`, userId, "entityId=", params.entityId, "dedupWindow=", dedupWindow, "min");
    }
  }

  if (notificationsToCreate.length > 0) {
    await storage.createNotifications(notificationsToCreate);

    for (const notif of notificationsToCreate) {
      const isDm = notif.type === "dm_message";
      const isInvoicePaid = notif.type === "invoice_paid";
      const needsDetailLog = isDm || isInvoicePaid;
      const logTag = isDm ? "dm" : isInvoicePaid ? "invoice_paid" : notif.type;
      try {
        if (needsDetailLog) {
          const tokens = await storage.getUserPushTokens(notif.recipientUserId);
          console.log(`[notify] ${logTag} tokens`, { recipientUserId: notif.recipientUserId, tokenCount: tokens.length });
          if (tokens.length === 0) {
            console.warn(`[notify] ${logTag} NO TOKENS`, { recipientUserId: notif.recipientUserId, entityId: notif.entityId });
          }
        }

        console.log(`[notify] queued type=${notif.type} recipientUserId=${notif.recipientUserId} entityId=${notif.entityId}`);

        const pushResult = await sendPushToUser(notif.recipientUserId, {
          title: notif.title,
          body: notif.body,
          data: {
            type: notif.type || "",
            entityType: notif.entityType || "",
            entityId: String(notif.entityId || ""),
            linkUrl: notif.linkUrl || "",
          },
        });

        if (needsDetailLog) {
          console.log(`[notify] ${logTag} send result`, { recipientUserId: notif.recipientUserId, sent: pushResult.sent, failed: pushResult.failed });
        }
      } catch (err) {
        console.error("[push] Failed to send push for notification to user:", notif.recipientUserId, err);
      }
    }
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

export async function notifyOwners(
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  const members = await storage.getCompanyMembers(companyId);
  const ownerIds = members
    .filter((m) => m.role.toUpperCase() === "OWNER")
    .map((m) => m.userId);

  const isInvoicePaid = params.type === "invoice_paid";
  if (isInvoicePaid) {
    console.log("[notify] invoice_paid owners", { companyId, ownerIds, memberCount: members.length });
    if (ownerIds.length === 0) {
      console.warn("[notify] invoice_paid WARNING: no owners found for companyId", companyId);
    }
  }

  if (ownerIds.length > 0) {
    if (isInvoicePaid) {
      for (const ownerId of ownerIds) {
        const tokens = await storage.getUserPushTokens(ownerId);
        console.log("[notify] invoice_paid tokens", { recipientUserId: ownerId, tokenCount: tokens.length });
        if (tokens.length === 0) {
          console.warn("[notify] invoice_paid NO TOKENS", { recipientUserId: ownerId, entityId: params.entityId });
        }
      }
    }
    await notifyUsers(ownerIds, { ...params, companyId });
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

// Notify only technicians (filters out managers/office staff)
export async function notifyTechniciansOnly(
  userIds: string[],
  companyId: number,
  params: Omit<NotificationParams, "companyId">
): Promise<void> {
  const techIds = await filterTechnicians(userIds, companyId);
  if (techIds.length > 0) {
    await notifyUsers(techIds, { ...params, companyId });
  }
}

type PaymentNotificationEvent = {
  companyId: number;
  type: "payment_collected" | "payment_succeeded" | "invoice_paid" | "payment_failed" | "refund_issued" | "manual_payment_recorded";
  title: string;
  body: string;
  entityType?: string;
  entityId?: number;
  linkUrl?: string;
  jobId?: number | null;
  collectedByUserId?: string | null;
};

export async function createPaymentNotifications(event: PaymentNotificationEvent): Promise<void> {
  const { companyId, type, title, body, entityType, entityId, linkUrl, jobId, collectedByUserId } = event;

  const members = await storage.getCompanyMembers(companyId);
  const recipientIds: Set<string> = new Set();

  for (const m of members) {
    const role = m.role.toUpperCase();
    if (role === "OWNER" || role === "SUPERVISOR") {
      recipientIds.add(m.userId);
    }
  }

  if (collectedByUserId && jobId) {
    const collectorMember = await storage.getCompanyMember(companyId, collectedByUserId);
    if (collectorMember && collectorMember.role.toUpperCase() === TECHNICIAN_ROLE) {
      const crewAssignments = await storage.getJobCrewAssignments(jobId);
      const isAssigned = crewAssignments.some((c) => c.userId === collectedByUserId);
      if (isAssigned) {
        recipientIds.add(collectedByUserId);
      }
    }
  }

  const allRecipients = Array.from(recipientIds);
  if (allRecipients.length > 0) {
    await notifyUsers(allRecipients, {
      companyId,
      type,
      title,
      body,
      entityType: entityType || undefined,
      entityId: entityId || undefined,
      linkUrl: linkUrl || undefined,
    });
  }
}
