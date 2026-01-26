import {
  users,
  sessions,
  companies,
  companyMembers,
  clients,
  customers,
  subcontractors,
  jobs,
  jobLineItems,
  jobAssignments,
  crewAssignments,
  invoices,
  payments,
  documents,
  messages,
  conversations,
  conversationParticipants,
  jobPhotos,
  scheduleItems,
  estimates,
  estimateItems,
  estimateAttachments,
  estimateDocuments,
  companyCounters,
  serviceCatalogItems,
  companyTaxes,
  leads,
  timeLogs,
  notifications,
  type User,
  type UpsertUser,
  type Company,
  type InsertCompany,
  type Client,
  type InsertClient,
  type Customer,
  type InsertCustomer,
  type Subcontractor,
  type InsertSubcontractor,
  type Job,
  type InsertJob,
  type Invoice,
  type InsertInvoice,
  type Document,
  type InsertDocument,
  type Message,
  type InsertMessage,
  type Conversation,
  type InsertConversation,
  type ConversationParticipant,
  type InsertConversationParticipant,
  type JobPhoto,
  type InsertJobPhoto,
  type ScheduleItem,
  type InsertScheduleItem,
  type UserRole,
  type Estimate,
  type EstimateItem,
  type EstimateWithItems,
  type EstimateAttachment,
  type InsertEstimateAttachment,
  type EstimateDocument,
  type InsertEstimateDocument,
  type CreateEstimatePayload,
  type UpdateEstimatePayload,
  type ServiceCatalogItem,
  type InsertServiceCatalogItem,
  type CompanyTax,
  type InsertCompanyTax,
  type Lead,
  type InsertLead,
  type TimeLog,
  type Notification,
  type InsertNotification,
  type NotificationType,
  approvalWorkflows,
  approvalSignatures,
  approvalHistory,
  signatureRequests,
  type ApprovalWorkflow,
  type InsertApprovalWorkflow,
  type ApprovalSignature,
  type InsertApprovalSignature,
  type ApprovalHistory,
  type InsertApprovalHistory,
  type SignatureRequest,
  type InsertSignatureRequest,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql, inArray, gte, lte, isNotNull } from "drizzle-orm";
import crypto from "crypto";

// Helper function to generate deterministic pairKey for 1:1 conversations
function generatePairKey(companyId: number, userId1: string, userId2: string): string {
  const sorted = [userId1, userId2].sort();
  const str = `${companyId}:${sorted[0]}:${sorted[1]}`;
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Interface for storage operations
export interface IStorage {
  // User operations (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Email authentication operations
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(userData: any): Promise<User>;
  updateUser(id: string, user: Partial<UpsertUser>): Promise<User>;
  
  // Authentication methods
  getLinkedAccountMethods(userId: string): Promise<any[]>;
  setResetPasswordToken(email: string, token: string, expires: Date): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<User | undefined>;
  
  // Role-based operations
  isBusinessOwner(userId: string, companyId: number): Promise<boolean>;
  getUserRole(userId: string, companyId: number): Promise<{ role: UserRole } | undefined>;
  createUserRole(data: { userId: string; companyId: number; role: UserRole }): Promise<void>;
  
  // Payment operations
  getPayments(companyId: number): Promise<any[]>;
  getPaymentByInvoiceId(invoiceId: number): Promise<any | null>;
  createPayment(payment: any): Promise<any>;
  updatePayment(id: number, payment: any): Promise<any>;
  
  // Company operations
  getCompany(id: number): Promise<Company | undefined>;
  getUserCompany(userId: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, company: Partial<InsertCompany>): Promise<Company>;
  getCompanyByInviteCode(inviteCode: string): Promise<Company | undefined>;
  rotateInviteCode(companyId: number, newCode: string): Promise<Company>;
  getCompanyMember(companyId: number, userId: string): Promise<{ userId: string; companyId: number; role: string } | undefined>;
  getCompanyMemberByUserId(userId: string): Promise<{ userId: string; companyId: number; role: string } | undefined>;
  
  // Crew assignment operations
  getJobCrewAssignments(jobId: number): Promise<any[]>;
  getUserJobAssignments(userId: string): Promise<{ jobId: number }[]>;
  addJobCrewAssignments(jobId: number, userIds: string[], companyId: number, assignedBy: string): Promise<{ added: number }>;
  removeJobCrewAssignment(jobId: number, userId: string): Promise<void>;
  removeJobCrewAssignments(jobId: number, userIds: string[]): Promise<{ removed: number }>;
  
  // Client operations
  getClients(companyId: number): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, client: Partial<InsertClient>): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  
  // Subcontractor operations
  getSubcontractors(companyId: number): Promise<Subcontractor[]>;
  getSubcontractor(id: number): Promise<Subcontractor | undefined>;
  createSubcontractor(subcontractor: InsertSubcontractor): Promise<Subcontractor>;
  updateSubcontractor(id: number, subcontractor: Partial<InsertSubcontractor>): Promise<Subcontractor>;
  deleteSubcontractor(id: number): Promise<void>;
  
  // Job operations
  getJobs(companyId: number): Promise<any[]>;
  getJob(id: number): Promise<any>;
  createJob(job: InsertJob): Promise<Job>;
  updateJob(id: number, job: Partial<InsertJob>): Promise<Job>;
  deleteJob(id: number): Promise<void>;
  
  // Invoice operations
  getInvoices(companyId: number): Promise<any[]>;
  getInvoice(id: number): Promise<any>;
  getInvoiceByJobId(jobId: number, companyId: number): Promise<any>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice>;
  deleteInvoice(id: number): Promise<void>;
  
  // Document operations
  getDocuments(companyId: number): Promise<any[]>;
  getDocument(id: number): Promise<Document | null>;
  getDocumentsByIds(ids: number[], companyId: number): Promise<Document[]>;
  getDocumentsByJob(jobId: number): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocumentStatus(id: number, status: string): Promise<Document>;
  deleteDocument(id: number): Promise<void>;
  deleteDocumentsBulk(ids: number[], companyId: number): Promise<number>;
  
  // Messaging operations
  // Conversations
  getUserConversations(userId: string, companyId: number): Promise<any[]>;
  getOrCreateConversation(userId1: string, userId2: string, companyId: number): Promise<Conversation>;
  getConversation(conversationId: number): Promise<any>;
  
  // Messages
  getConversationMessages(conversationId: number, limit?: number, cursor?: string): Promise<Message[]>;
  createConversationMessage(message: InsertMessage): Promise<Message>;
  
  // Participants
  markConversationAsRead(conversationId: number, userId: string): Promise<void>;
  getConversationParticipant(conversationId: number, userId: string): Promise<ConversationParticipant | undefined>;
  
  // Company users for messaging
  getCompanyUsersForMessaging(companyId: number, currentUserId: string): Promise<any[]>;
  
  // Dashboard statistics
  getDashboardStats(companyId: number): Promise<any>;
  
  // Job Photo operations
  getJobPhotos(jobId: number): Promise<JobPhoto[]>;
  createJobPhoto(photo: InsertJobPhoto): Promise<JobPhoto>;
  deleteJobPhoto(id: number): Promise<void>;
  
  // Schedule operations
  getScheduleItems(companyId: number): Promise<ScheduleItem[]>;
  getScheduleItem(id: number): Promise<ScheduleItem | undefined>;
  getScheduleItemsByJob(jobId: number): Promise<ScheduleItem[]>;
  createScheduleItem(scheduleItem: InsertScheduleItem): Promise<ScheduleItem>;
  updateScheduleItem(id: number, scheduleItem: Partial<InsertScheduleItem>): Promise<ScheduleItem>;
  deleteScheduleItem(id: number): Promise<void>;
  
  // Approval Workflow operations
  getApprovalWorkflows(companyId: number): Promise<ApprovalWorkflow[]>;
  getApprovalWorkflow(id: number): Promise<ApprovalWorkflow | undefined>;
  createApprovalWorkflow(workflow: InsertApprovalWorkflow): Promise<ApprovalWorkflow>;
  updateApprovalWorkflow(id: number, workflow: Partial<InsertApprovalWorkflow>): Promise<ApprovalWorkflow>;
  deleteApprovalWorkflow(id: number): Promise<void>;
  
  // Approval Signature operations
  getApprovalSignatures(workflowId: number): Promise<ApprovalSignature[]>;
  getApprovalSignature(id: number): Promise<ApprovalSignature | undefined>;
  getApprovalSignatureByToken(accessToken: string): Promise<ApprovalSignature | undefined>;
  createApprovalSignature(signature: InsertApprovalSignature): Promise<ApprovalSignature>;
  updateApprovalSignature(id: number, signature: Partial<InsertApprovalSignature>): Promise<ApprovalSignature>;
  deleteApprovalSignature(id: number): Promise<void>;
  
  // Approval History operations
  createApprovalHistory(history: InsertApprovalHistory): Promise<ApprovalHistory>;
  getApprovalHistory(workflowId: number): Promise<ApprovalHistory[]>;
  
  // Signature Request operations
  getSignatureRequests(companyId: number): Promise<SignatureRequest[]>;
  getSignatureRequest(id: number): Promise<SignatureRequest | undefined>;
  getSignatureRequestByToken(accessToken: string): Promise<SignatureRequest | undefined>;
  createSignatureRequest(request: InsertSignatureRequest): Promise<SignatureRequest>;
  updateSignatureRequest(id: number, request: Partial<InsertSignatureRequest>): Promise<SignatureRequest>;
  deleteSignatureRequest(id: number): Promise<void>;
  
  // Employee management operations
  getOrgUsers(companyId: number, params?: { search?: string; role?: UserRole; status?: string; limit?: number; offset?: number }): Promise<{ users: User[]; total: number }>;
  updateUserRole(userId: string, companyId: number, newRole: UserRole, currentUserRole: UserRole): Promise<User>;
  updateUserStatus(userId: string, companyId: number, status: 'ACTIVE' | 'INACTIVE', currentUserRole: UserRole): Promise<User>;
  getUserJobsSummary(userId: string, companyId: number): Promise<{ total: number; scheduled: number; inProgress: number; completed: number }>;
  
  // Estimate operations
  getEstimatesByJob(jobId: number): Promise<Estimate[]>;
  getEstimatesByCompany(companyId: number): Promise<Estimate[]>;
  getEstimate(id: number): Promise<EstimateWithItems | undefined>;
  createEstimate(payload: CreateEstimatePayload, companyId: number, userId: string): Promise<EstimateWithItems>;
  updateEstimate(id: number, payload: UpdateEstimatePayload): Promise<EstimateWithItems>;
  deleteEstimate(id: number): Promise<void>;
  getNextEstimateNumber(companyId: number): Promise<string>;
  
  // Customer operations
  getCustomers(companyId: number): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer & { companyId: number }): Promise<Customer>;
  updateCustomer(id: number, updates: Partial<InsertCustomer>): Promise<Customer>;
  deleteCustomer(id: number): Promise<void>;
  deleteCustomersBulk(ids: number[]): Promise<number>;
  
  // Service catalog operations
  getServiceCatalogItems(companyId: number): Promise<ServiceCatalogItem[]>;
  getServiceCatalogItem(id: number): Promise<ServiceCatalogItem | undefined>;
  createServiceCatalogItem(item: InsertServiceCatalogItem): Promise<ServiceCatalogItem>;
  updateServiceCatalogItem(id: number, item: Partial<InsertServiceCatalogItem>): Promise<ServiceCatalogItem>;
  deleteServiceCatalogItem(id: number): Promise<void>;
  
  // Estimate attachment operations
  getEstimateAttachments(estimateId: number): Promise<EstimateAttachment[]>;
  createEstimateAttachment(attachment: InsertEstimateAttachment): Promise<EstimateAttachment>;
  deleteEstimateAttachment(id: number): Promise<void>;
  
  // Estimate document operations
  getEstimateDocuments(estimateId: number, companyId: number): Promise<EstimateDocument[]>;
  getLatestEstimateDocument(estimateId: number, companyId: number): Promise<EstimateDocument | undefined>;
  createEstimateDocument(doc: InsertEstimateDocument): Promise<EstimateDocument>;
  deleteEstimateDocument(id: number): Promise<void>;
  
  // Estimate approval operations
  approveEstimate(id: number, userId: string, signatureDataUrl: string): Promise<Estimate>;
  
  // Company tax operations
  getCompanyTaxes(companyId: number): Promise<CompanyTax[]>;
  createCompanyTax(tax: InsertCompanyTax): Promise<CompanyTax>;
  deleteCompanyTax(id: number): Promise<void>;
  
  // Leads operations
  getLeads(companyId: number): Promise<(Lead & { customer?: Customer })[]>;
  getLead(id: number): Promise<(Lead & { customer?: Customer }) | undefined>;
  createLead(companyId: number, lead: InsertLead): Promise<Lead>;
  updateLead(id: number, lead: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: number): Promise<void>;
  
  // Time log operations
  getActiveTimeLog(userId: string, companyId: number): Promise<TimeLog | undefined>;
  getActiveTimeLogWithJob(userId: string, companyId: number): Promise<(TimeLog & { job?: { id: number; title: string | null } }) | undefined>;
  getUserTimeLogsToday(userId: string, companyId: number, date: string): Promise<TimeLog[]>;
  getCompanyTimeLogsToday(companyId: number, date: string): Promise<TimeLog[]>;
  clockIn(userId: string, companyId: number, jobId?: number, category?: string): Promise<TimeLog>;
  clockOut(userId: string, companyId: number): Promise<TimeLog | undefined>;
  switchJob(userId: string, companyId: number, jobId?: number, category?: string): Promise<{ ended: TimeLog; started: TimeLog }>;
  getJobLaborTotals(jobId: number): Promise<{ totalMinutes: number; laborByUser: { userId: string; minutes: number }[] }>;
  getTimeEntriesForUser(userId: string, companyId: number, startDate: string, endDate: string): Promise<(TimeLog & { job?: { id: number; title: string | null } | null })[]>;
  getTimeEntriesForCompany(companyId: number, startDate: string, endDate: string): Promise<(TimeLog & { job?: { id: number; title: string | null } | null; user?: { id: string; firstName: string | null; lastName: string | null } })[]>;
  autoCloseExpiredTimeEntries(userId: string, companyId: number): Promise<TimeLog | null>;
  autoCloseExpiredTimeEntriesForCompany(companyId: number): Promise<number>;
  updateCompanyAutoClockOutTime(companyId: number, time: string): Promise<void>;
  getTimeEntryById(id: number): Promise<TimeLog | null>;
  updateTimeEntry(id: number, data: { clockInAt: Date; clockOutAt: Date; editedByUserId: string; editReason: string }): Promise<TimeLog | null>;
}

export class DatabaseStorage implements IStorage {
  // User operations (IMPORTANT) these user operations are mandatory for Replit Auth.

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Email authentication operations
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(userData: any): Promise<User> {
    // Generate a unique ID for email-based users
    const userId = `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const [user] = await db
      .insert(users)
      .values({
        id: userId,
        ...userData,
      })
      .returning();
    return user;
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company || undefined;
  }

  async getUserCompany(userId: string): Promise<Company | undefined> {
    const [membership] = await db
      .select({ company: companies })
      .from(companyMembers)
      .innerJoin(companies, eq(companyMembers.companyId, companies.id))
      .where(eq(companyMembers.userId, userId))
      .limit(1);
    
    return membership?.company;
  }
  
  async updateUser(id: string, userData: Partial<UpsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...userData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }
  
  async getLinkedAccountMethods(userId: string): Promise<any[]> {
    // Simple implementation - return array indicating linked methods
    const user = await this.getUser(userId);
    if (!user) return [];
    
    const methods = [];
    if (user.password) {
      methods.push({ provider: 'email', email: user.email });
    }
    if (user.googleLinked) {
      methods.push({ provider: 'google', email: user.email });
    }
    return methods;
  }
  
  async setResetPasswordToken(email: string, token: string, expires: Date): Promise<void> {
    await db
      .update(users)
      .set({ 
        resetPasswordToken: token, 
        resetPasswordExpires: expires,
        updatedAt: new Date()
      })
      .where(eq(users.email, email));
  }
  
  async resetPassword(token: string, newPassword: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(
        eq(users.resetPasswordToken, token),
        sql`${users.resetPasswordExpires} > NOW()`
      ));
    
    if (!user) return undefined;
    
    const [updatedUser] = await db
      .update(users)
      .set({ 
        password: newPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id))
      .returning();
    
    return updatedUser;
  }
  
  async isBusinessOwner(userId: string, companyId: number): Promise<boolean> {
    const [membership] = await db
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.userId, userId),
        eq(companyMembers.companyId, companyId)
      ));
    
    return membership?.role === 'OWNER' || membership?.role === 'SUPERVISOR';
  }

  async getUserRole(userId: string, companyId: number): Promise<{ role: UserRole } | undefined> {
    const [membership] = await db
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.userId, userId),
        eq(companyMembers.companyId, companyId)
      ));
    
    return membership ? { role: membership.role } : undefined;
  }

  async createUserRole(data: { userId: string; companyId: number; role: UserRole }): Promise<void> {
    await db.insert(companyMembers).values({
      userId: data.userId,
      companyId: data.companyId,
      role: data.role,
      permissions: { canCreateJobs: true, canManageInvoices: true, canViewSchedule: true }
    });
  }
  
  async getPayments(companyId: number): Promise<any[]> {
    const result = await db
      .select({
        id: payments.id,
        companyId: payments.companyId,
        jobId: payments.jobId,
        invoiceId: payments.invoiceId,
        customerId: payments.customerId,
        amount: payments.amount,
        amountCents: payments.amountCents,
        paymentMethod: payments.paymentMethod,
        status: payments.status,
        collectedByUserId: payments.collectedByUserId,
        collectedByRole: payments.collectedByRole,
        stripePaymentIntentId: payments.stripePaymentIntentId,
        stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
        checkNumber: payments.checkNumber,
        paidDate: payments.paidDate,
        notes: payments.notes,
        meta: payments.meta,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
        jobTitle: jobs.title,
        clientFirstName: customers.firstName,
        clientLastName: customers.lastName,
      })
      .from(payments)
      .leftJoin(jobs, eq(payments.jobId, jobs.id))
      .leftJoin(customers, eq(payments.customerId, customers.id))
      .where(eq(payments.companyId, companyId))
      .orderBy(desc(payments.paidDate), desc(payments.createdAt));
    
    return result.map(p => ({
      ...p,
      clientName: p.clientFirstName && p.clientLastName 
        ? `${p.clientFirstName} ${p.clientLastName}`.trim() 
        : p.clientFirstName || p.clientLastName || null,
    }));
  }
  
  async getPaymentByInvoiceId(invoiceId: number): Promise<any | null> {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId));
    return payment || null;
  }
  
  async createPayment(payment: any): Promise<any> {
    const [created] = await db.insert(payments).values(payment).returning();
    return created;
  }
  
  async updatePayment(id: number, payment: any): Promise<any> {
    const [updated] = await db
      .update(payments)
      .set({ ...payment, updatedAt: new Date() })
      .where(eq(payments.id, id))
      .returning();
    return updated;
  }

  async createCompany(companyData: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(companyData).returning();
    
    // Create company membership for the owner with OWNER role
    await db.insert(companyMembers).values({
      companyId: company.id,
      userId: companyData.ownerId,
      role: "OWNER",
      permissions: { canCreateJobs: true, canManageInvoices: true, canViewSchedule: true }
    });
    
    return company;
  }

  async updateCompany(id: number, companyData: Partial<InsertCompany>): Promise<Company> {
    const [company] = await db
      .update(companies)
      .set({ ...companyData, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return company;
  }

  async getCompanyByInviteCode(inviteCode: string): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.inviteCode, inviteCode));
    return company;
  }

  async rotateInviteCode(companyId: number, newCode: string): Promise<Company> {
    const [company] = await db
      .update(companies)
      .set({ 
        inviteCode: newCode, 
        inviteCodeVersion: sql`${companies.inviteCodeVersion} + 1`,
        inviteCodeRotatedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(companies.id, companyId))
      .returning();
    return company;
  }

  async getCompanyMember(companyId: number, userId: string): Promise<{ userId: string; companyId: number; role: string } | undefined> {
    const [member] = await db
      .select({
        userId: companyMembers.userId,
        companyId: companyMembers.companyId,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId)
        )
      )
      .limit(1);
    return member;
  }

  async getCompanyMemberByUserId(userId: string): Promise<{ userId: string; companyId: number; role: string } | undefined> {
    const [member] = await db
      .select({
        userId: companyMembers.userId,
        companyId: companyMembers.companyId,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .where(eq(companyMembers.userId, userId))
      .limit(1);
    return member;
  }

  async getCompanyMembers(companyId: number): Promise<Array<{ userId: string; companyId: number; role: string }>> {
    return db
      .select({
        userId: companyMembers.userId,
        companyId: companyMembers.companyId,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .where(eq(companyMembers.companyId, companyId));
  }

  async getJobCrewAssignments(jobId: number): Promise<any[]> {
    const assignments = await db
      .select({
        id: crewAssignments.id,
        jobId: crewAssignments.jobId,
        userId: crewAssignments.userId,
        companyId: crewAssignments.companyId,
        assignedAt: crewAssignments.assignedAt,
        assignedBy: crewAssignments.assignedBy,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          profileImageUrl: users.profileImageUrl,
        },
      })
      .from(crewAssignments)
      .innerJoin(users, eq(crewAssignments.userId, users.id))
      .where(eq(crewAssignments.jobId, jobId))
      .orderBy(desc(crewAssignments.assignedAt));
    return assignments;
  }

  async getUserJobAssignments(userId: string): Promise<{ jobId: number }[]> {
    const assignments = await db
      .select({ jobId: crewAssignments.jobId })
      .from(crewAssignments)
      .where(eq(crewAssignments.userId, userId));
    return assignments;
  }

  async addJobCrewAssignments(jobId: number, userIds: string[], companyId: number, assignedBy: string): Promise<{ added: number }> {
    if (userIds.length === 0) return { added: 0 };
    
    const values = userIds.map(userId => ({
      jobId,
      userId,
      companyId,
      assignedBy,
    }));
    
    // Use ON CONFLICT DO NOTHING for idempotent bulk insert
    const result = await db
      .insert(crewAssignments)
      .values(values)
      .onConflictDoNothing({ target: [crewAssignments.jobId, crewAssignments.userId] })
      .returning();
    
    return { added: result.length };
  }

  async removeJobCrewAssignment(jobId: number, userId: string): Promise<void> {
    await db
      .delete(crewAssignments)
      .where(
        and(
          eq(crewAssignments.jobId, jobId),
          eq(crewAssignments.userId, userId)
        )
      );
  }

  async removeJobCrewAssignments(jobId: number, userIds: string[]): Promise<{ removed: number }> {
    if (userIds.length === 0) return { removed: 0 };
    
    let removed = 0;
    for (const userId of userIds) {
      const result = await db
        .delete(crewAssignments)
        .where(
          and(
            eq(crewAssignments.jobId, jobId),
            eq(crewAssignments.userId, userId)
          )
        )
        .returning();
      removed += result.length;
    }
    
    return { removed };
  }

  async getClients(companyId: number): Promise<Client[]> {
    return await db.select().from(clients).where(eq(clients.companyId, companyId));
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async createClient(clientData: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(clientData).returning();
    return client;
  }

  async updateClient(id: number, clientData: Partial<InsertClient>): Promise<Client> {
    const [client] = await db
      .update(clients)
      .set({ ...clientData, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return client;
  }

  async deleteClient(id: number): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }

  async getSubcontractors(companyId: number): Promise<Subcontractor[]> {
    return await db.select().from(subcontractors).where(eq(subcontractors.companyId, companyId));
  }

  async getSubcontractor(id: number): Promise<Subcontractor | undefined> {
    const [subcontractor] = await db.select().from(subcontractors).where(eq(subcontractors.id, id));
    return subcontractor;
  }

  async createSubcontractor(subcontractorData: InsertSubcontractor): Promise<Subcontractor> {
    const [subcontractor] = await db.insert(subcontractors).values(subcontractorData).returning();
    return subcontractor;
  }

  async updateSubcontractor(id: number, subcontractorData: Partial<InsertSubcontractor>): Promise<Subcontractor> {
    const [subcontractor] = await db
      .update(subcontractors)
      .set({ ...subcontractorData, updatedAt: new Date() })
      .where(eq(subcontractors.id, id))
      .returning();
    return subcontractor;
  }

  async deleteSubcontractor(id: number): Promise<void> {
    await db.delete(subcontractors).where(eq(subcontractors.id, id));
  }

  async getJobs(companyId: number): Promise<any[]> {
    // First get jobs with clients (no invoice join to avoid duplicates)
    const jobsList = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        paymentStatus: jobs.paymentStatus,
        priority: jobs.priority,
        startDate: jobs.startDate,
        scheduledTime: jobs.scheduledTime,
        scheduledEndTime: jobs.scheduledEndTime,
        endDate: jobs.endDate,
        location: jobs.location,
        city: jobs.city,
        postalCode: jobs.postalCode,
        locationLat: jobs.locationLat,
        locationLng: jobs.locationLng,
        locationPlaceId: jobs.locationPlaceId,
        description: jobs.description,
        notes: jobs.notes,
        clientId: jobs.clientId,
        clientName: jobs.clientName,
        customerId: jobs.customerId,
        jobType: jobs.jobType,
        companyId: jobs.companyId,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        client: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
          phone: clients.phone,
        },
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(eq(jobs.companyId, companyId))
      .orderBy(desc(jobs.createdAt));
    
    const jobIds = jobsList.map(j => j.id);
    if (jobIds.length === 0) return jobsList.map(job => ({
      ...job,
      isPaid: false,
      primaryLineItem: null,
    }));
    
    // Fetch invoice status for all jobs in one query (avoid duplicates by grouping)
    const invoiceStatuses = await db
      .select({
        jobId: invoices.jobId,
        status: invoices.status,
      })
      .from(invoices)
      .where(inArray(invoices.jobId, jobIds));
    
    // Build map of job -> isPaid (true if any invoice is paid)
    const paidStatusByJob: Record<number, boolean> = {};
    for (const inv of invoiceStatuses) {
      if (inv.jobId && inv.status?.toLowerCase() === 'paid') {
        paidStatusByJob[inv.jobId] = true;
      }
    }
    
    // Fetch first line item for each job
    const allLineItems = await db
      .select()
      .from(jobLineItems)
      .where(inArray(jobLineItems.jobId, jobIds))
      .orderBy(jobLineItems.sortOrder);
    
    // Group by job and get first item
    const firstLineItemByJob: Record<number, string> = {};
    for (const item of allLineItems) {
      if (!firstLineItemByJob[item.jobId]) {
        firstLineItemByJob[item.jobId] = item.name;
      }
    }
    
    // Fetch crew assignments for all jobs
    const allCrewAssignments = await db
      .select({
        jobId: crewAssignments.jobId,
        userId: crewAssignments.userId,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
        userProfileImageUrl: users.profileImageUrl,
      })
      .from(crewAssignments)
      .leftJoin(users, eq(crewAssignments.userId, users.id))
      .where(inArray(crewAssignments.jobId, jobIds));
    
    // Group crew assignments by job
    const crewByJob: Record<number, Array<{
      userId: string;
      user: {
        firstName: string | null;
        lastName: string | null;
        email: string;
        profileImageUrl: string | null;
      };
    }>> = {};
    for (const crew of allCrewAssignments) {
      if (!crewByJob[crew.jobId]) {
        crewByJob[crew.jobId] = [];
      }
      crewByJob[crew.jobId].push({
        userId: crew.userId,
        user: {
          firstName: crew.userFirstName,
          lastName: crew.userLastName,
          email: crew.userEmail || '',
          profileImageUrl: crew.userProfileImageUrl,
        },
      });
    }
    
    // Fetch customers for jobs that have customerId (for address/lat/lng fallback)
    const customerIds = jobsList.map(j => j.customerId).filter((id): id is number => id !== null);
    const customerMap: Record<number, { id: number; firstName: string | null; lastName: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; latitude: number | null; longitude: number | null }> = {};
    if (customerIds.length > 0) {
      const customerData = await db
        .select({
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
          address: customers.address,
          city: customers.city,
          state: customers.state,
          zip: customers.zip,
          latitude: customers.latitude,
          longitude: customers.longitude,
        })
        .from(customers)
        .where(inArray(customers.id, customerIds));
      
      for (const cust of customerData) {
        customerMap[cust.id] = cust;
      }
    }
    
    // Merge primary line item, isPaid, crew assignments, and customer into jobs
    return jobsList.map(job => ({
      ...job,
      primaryLineItem: firstLineItemByJob[job.id] || null,
      isPaid: paidStatusByJob[job.id] || false,
      crewAssignments: crewByJob[job.id] || [],
      customer: job.customerId ? customerMap[job.customerId] || null : null,
    }));
  }

  async getJob(id: number): Promise<any> {
    const [job] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        priority: jobs.priority,
        startDate: jobs.startDate,
        scheduledTime: jobs.scheduledTime,
        scheduledEndTime: jobs.scheduledEndTime,
        endDate: jobs.endDate,
        location: jobs.location,
        city: jobs.city,
        postalCode: jobs.postalCode,
        locationLat: jobs.locationLat,
        locationLng: jobs.locationLng,
        locationPlaceId: jobs.locationPlaceId,
        description: jobs.description,
        notes: jobs.notes,
        clientId: jobs.clientId,
        clientName: jobs.clientName,
        customerId: jobs.customerId,
        jobType: jobs.jobType,
        companyId: jobs.companyId,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        client: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
          phone: clients.phone,
        },
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(eq(jobs.id, id));
    return job;
  }

  async createJob(jobData: InsertJob): Promise<Job> {
    // Convert lat/lng to strings for database decimal fields
    const dbJobData = {
      ...jobData,
      locationLat: jobData.locationLat !== null && jobData.locationLat !== undefined 
        ? String(jobData.locationLat) 
        : jobData.locationLat,
      locationLng: jobData.locationLng !== null && jobData.locationLng !== undefined 
        ? String(jobData.locationLng) 
        : jobData.locationLng,
    };
    const [job] = await db.insert(jobs).values(dbJobData).returning();
    return job;
  }

  async updateJob(id: number, jobData: Partial<InsertJob>): Promise<Job> {
    // Convert lat/lng to strings for database decimal fields
    const dbJobData = {
      ...jobData,
      locationLat: jobData.locationLat !== null && jobData.locationLat !== undefined 
        ? String(jobData.locationLat) 
        : jobData.locationLat,
      locationLng: jobData.locationLng !== null && jobData.locationLng !== undefined 
        ? String(jobData.locationLng) 
        : jobData.locationLng,
      updatedAt: new Date()
    };
    const [job] = await db
      .update(jobs)
      .set(dbJobData)
      .where(eq(jobs.id, id))
      .returning();
    return job;
  }

  async deleteJob(id: number): Promise<void> {
    // Use a transaction to safely unlink related records before deleting the job
    await db.transaction(async (tx) => {
      // 1. Set job_id to NULL on time_logs (preserves payroll data)
      await tx.update(timeLogs)
        .set({ jobId: null })
        .where(eq(timeLogs.jobId, id));
      
      // 2. Set job_id to NULL on leads (converted_to_job_id)
      await tx.update(leads)
        .set({ convertedToJobId: null })
        .where(eq(leads.convertedToJobId, id));
      
      // 3. Now delete the job - CASCADE will handle other related records
      // (schedule_items, job_photos, job_line_items, documents, invoices, estimates, etc.)
      await tx.delete(jobs).where(eq(jobs.id, id));
    });
  }

  async getInvoices(companyId: number): Promise<any[]> {
    return await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        amount: invoices.amount,
        subtotalCents: invoices.subtotalCents,
        taxCents: invoices.taxCents,
        totalCents: invoices.totalCents,
        status: invoices.status,
        dueDate: invoices.dueDate,
        issueDate: invoices.issueDate,
        pdfUrl: invoices.pdfUrl,
        clientId: invoices.clientId,
        customerId: invoices.customerId,
        jobId: invoices.jobId,
        estimateId: invoices.estimateId,
        companyId: invoices.companyId,
        scheduledAt: invoices.scheduledAt,
        tags: invoices.tags,
        createdAt: invoices.createdAt,
        updatedAt: invoices.updatedAt,
        client: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
        },
        job: {
          id: jobs.id,
          title: jobs.title,
        },
        customer: {
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
          email: customers.email,
        },
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(jobs, eq(invoices.jobId, jobs.id))
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: number): Promise<any> {
    const [invoice] = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        amount: invoices.amount,
        subtotalCents: invoices.subtotalCents,
        taxCents: invoices.taxCents,
        totalCents: invoices.totalCents,
        status: invoices.status,
        dueDate: invoices.dueDate,
        issueDate: invoices.issueDate,
        paidDate: invoices.paidDate,
        pdfUrl: invoices.pdfUrl,
        clientId: invoices.clientId,
        customerId: invoices.customerId,
        jobId: invoices.jobId,
        estimateId: invoices.estimateId,
        companyId: invoices.companyId,
        scheduledAt: invoices.scheduledAt,
        tags: invoices.tags,
        notes: invoices.notes,
        lineItems: invoices.lineItems,
        stripeCheckoutSessionId: invoices.stripeCheckoutSessionId,
        stripePaymentIntentId: invoices.stripePaymentIntentId,
        paidAt: invoices.paidAt,
        createdAt: invoices.createdAt,
        updatedAt: invoices.updatedAt,
        client: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
        },
        job: {
          id: jobs.id,
          title: jobs.title,
        },
        customer: {
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
          email: customers.email,
        },
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(jobs, eq(invoices.jobId, jobs.id))
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.id, id));
    return invoice;
  }

  async getInvoiceByJobId(jobId: number, companyId: number): Promise<any> {
    const [invoice] = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        amount: invoices.amount,
        subtotalCents: invoices.subtotalCents,
        taxCents: invoices.taxCents,
        totalCents: invoices.totalCents,
        status: invoices.status,
        dueDate: invoices.dueDate,
        issueDate: invoices.issueDate,
        pdfUrl: invoices.pdfUrl,
        clientId: invoices.clientId,
        jobId: invoices.jobId,
        estimateId: invoices.estimateId,
        companyId: invoices.companyId,
        stripeCheckoutSessionId: invoices.stripeCheckoutSessionId,
        stripePaymentIntentId: invoices.stripePaymentIntentId,
        paidAt: invoices.paidAt,
        createdAt: invoices.createdAt,
        updatedAt: invoices.updatedAt,
      })
      .from(invoices)
      .where(and(eq(invoices.jobId, jobId), eq(invoices.companyId, companyId)));
    return invoice || null;
  }

  async createInvoice(invoiceData: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db.insert(invoices).values(invoiceData).returning();
    return invoice;
  }

  async updateInvoice(id: number, invoiceData: Partial<InsertInvoice>): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set({ ...invoiceData, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    return invoice;
  }

  async deleteInvoice(id: number): Promise<void> {
    await db.delete(invoices).where(eq(invoices.id, id));
  }

  async getDocuments(companyId: number): Promise<any[]> {
    const result = await db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        jobId: documents.jobId,
        name: documents.name,
        type: documents.type,
        category: documents.category,
        status: documents.status,
        visibility: documents.visibility,
        fileUrl: documents.fileUrl,
        fileSize: documents.fileSize,
        uploadedBy: documents.uploadedBy,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        jobTitle: jobs.title,
        jobClientName: jobs.clientName,
      })
      .from(documents)
      .leftJoin(jobs, eq(documents.jobId, jobs.id))
      .where(eq(documents.companyId, companyId));
    
    return result.map(doc => ({
      id: doc.id,
      companyId: doc.companyId,
      jobId: doc.jobId,
      name: doc.name,
      type: doc.type,
      category: doc.category,
      status: doc.status,
      visibility: doc.visibility,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
      uploadedBy: doc.uploadedBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      job: doc.jobId ? { id: doc.jobId, title: doc.jobTitle, clientName: doc.jobClientName } : null,
    }));
  }

  async getDocument(id: number): Promise<Document | null> {
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id));
    return document || null;
  }

  async getDocumentsByIds(ids: number[], companyId: number): Promise<Document[]> {
    if (ids.length === 0) return [];
    const result = await db
      .select()
      .from(documents)
      .where(
        and(
          inArray(documents.id, ids),
          eq(documents.companyId, companyId)
        )
      );
    return result;
  }

  async getDocumentsByJob(jobId: number): Promise<Document[]> {
    const result = await db
      .select()
      .from(documents)
      .where(eq(documents.jobId, jobId))
      .orderBy(desc(documents.createdAt));
    return result;
  }

  async createDocument(documentData: InsertDocument): Promise<Document> {
    const [document] = await db.insert(documents).values(documentData).returning();
    return document;
  }

  async updateDocumentStatus(id: number, status: string): Promise<Document> {
    const [document] = await db
      .update(documents)
      .set({ status, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();
    return document;
  }

  async updateDocumentVisibility(id: number, visibility: string): Promise<Document> {
    const [document] = await db
      .update(documents)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();
    return document;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  async deleteDocumentsBulk(ids: number[], companyId: number): Promise<number> {
    if (ids.length === 0) return 0;
    // Delete only documents that belong to this company
    const result = await db
      .delete(documents)
      .where(
        and(
          inArray(documents.id, ids),
          eq(documents.companyId, companyId)
        )
      );
    return ids.length; // Return count of requested deletions
  }

  // Messaging operations
  async getUserConversations(userId: string, companyId: number): Promise<any[]> {
    const convs = await db
      .select({
        id: conversations.id,
        isGroup: conversations.isGroup,
        createdById: conversations.createdById,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        participant: conversationParticipants,
      })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
      .where(
        and(
          eq(conversationParticipants.userId, userId),
          eq(conversations.companyId, companyId)
        )
      )
      .orderBy(desc(conversations.updatedAt));
    
    return convs;
  }

  async getOrCreateConversation(userId1: string, userId2: string, companyId: number): Promise<Conversation> {
    const pairKey = generatePairKey(companyId, userId1, userId2);
    
    // Try to insert new conversation with pairKey
    // If it already exists (ON CONFLICT), do nothing and return the existing one
    const result = await db
      .insert(conversations)
      .values({
        companyId,
        isGroup: false,
        pairKey,
        createdById: userId1,
      })
      .onConflictDoNothing({ target: conversations.pairKey })
      .returning();
    
    // If insert succeeded, add participants
    if (result.length > 0) {
      await db.insert(conversationParticipants).values([
        { conversationId: result[0].id, userId: userId1 },
        { conversationId: result[0].id, userId: userId2 },
      ]);
      return result[0];
    }
    
    // If insert conflicted, fetch the existing conversation
    const [existing] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.pairKey, pairKey))
      .limit(1);
    
    // Ensure both users are participants (defensive fix for data corruption)
    // First, check existing participant count for 1:1 conversations
    const existingParticipants = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, existing.id));
    
    // For 1:1 conversations, enforce exactly 2 participants
    if (!existing.isGroup && existingParticipants.length > 2) {
      throw new Error(`Data corruption: 1:1 conversation ${existing.id} has ${existingParticipants.length} participants`);
    }
    
    // Add missing participants if needed (but never exceed 2 for 1:1)
    const missingUsers = [userId1, userId2].filter(
      uid => !existingParticipants.some(p => p.userId === uid)
    );
    
    if (missingUsers.length > 0) {
      // Verify this won't exceed 2 participants for 1:1 conversations
      if (!existing.isGroup && existingParticipants.length + missingUsers.length > 2) {
        throw new Error(
          `Cannot add ${missingUsers.length} participants to 1:1 conversation ${existing.id}: ` +
          `would exceed 2-participant limit (currently has ${existingParticipants.length})`
        );
      }
      
      await db
        .insert(conversationParticipants)
        .values(missingUsers.map(uid => ({
          conversationId: existing.id,
          userId: uid,
        })))
        .onConflictDoNothing({ target: [conversationParticipants.conversationId, conversationParticipants.userId] });
    }
    
    return existing;
  }

  async getConversation(conversationId: number): Promise<any> {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    
    return conv;
  }

  async getConversationMessages(conversationId: number, limit: number = 50, cursor?: string): Promise<Message[]> {
    let query = db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          sql`${messages.deletedAt} IS NULL`
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    if (cursor) {
      query = query.where(sql`${messages.createdAt} < ${cursor}`);
    }

    return await query;
  }

  async createConversationMessage(messageData: InsertMessage): Promise<Message> {
    // Atomic transaction: create message + update conversation.updatedAt for guaranteed delivery
    return await db.transaction(async (tx) => {
      const [message] = await tx.insert(messages).values(messageData).returning();
      
      // Update conversation's updatedAt in same transaction (drives inbox sort)
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, messageData.conversationId));
      
      return message;
    });
  }

  async markConversationAsRead(conversationId: number, userId: string): Promise<void> {
    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId)
        )
      );
  }

  async getConversationParticipant(conversationId: number, userId: string): Promise<ConversationParticipant | undefined> {
    const [participant] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId)
        )
      )
      .limit(1);
    
    return participant;
  }

  async getCompanyUsersForMessaging(companyId: number, currentUserId: string): Promise<any[]> {
    const companyUsers = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        profileImageUrl: users.profileImageUrl,
        status: users.status,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .innerJoin(users, eq(companyMembers.userId, users.id))
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          sql`${users.id} != ${currentUserId}`,
          sql`UPPER(${users.status}) = 'ACTIVE'`
        )
      )
      .orderBy(users.firstName);
    
    // For each user, find their existing 1:1 conversation with current user
    const usersWithConversations = await Promise.all(
      companyUsers.map(async (user) => {
        // Find conversation where both users are participants and it's not a group
        const existingConversation = await db
          .select({ id: conversations.id })
          .from(conversations)
          .innerJoin(
            conversationParticipants,
            eq(conversationParticipants.conversationId, conversations.id)
          )
          .where(
            and(
              eq(conversations.companyId, companyId),
              eq(conversations.isGroup, false),
              sql`EXISTS (
                SELECT 1 FROM ${conversationParticipants} cp1
                WHERE cp1.conversation_id = ${conversations.id}
                AND cp1.user_id = ${currentUserId}
              )`,
              sql`EXISTS (
                SELECT 1 FROM ${conversationParticipants} cp2
                WHERE cp2.conversation_id = ${conversations.id}
                AND cp2.user_id = ${user.id}
              )`
            )
          )
          .limit(1);
        
        return {
          ...user,
          conversationId: existingConversation[0]?.id || null,
        };
      })
    );
    
    return usersWithConversations;
  }

  async getDashboardStats(companyId: number): Promise<any> {
    const activeJobsCount = await db
      .select({ count: sql`count(*)` })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId), eq(jobs.status, "active")));

    const outstandingInvoicesCount = await db
      .select({ count: sql`count(*)` })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "pending")));

    const availableSubcontractorsCount = await db
      .select({ count: sql`count(*)` })
      .from(subcontractors)
      .where(eq(subcontractors.companyId, companyId));

    const monthlyRevenueResult = await db
      .select({ total: sql`sum(amount)` })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.status, "paid"),
          sql`DATE_TRUNC('month', issue_date) = DATE_TRUNC('month', CURRENT_DATE)`
        )
      );

    return {
      activeJobs: Number(activeJobsCount[0].count) || 0,
      outstandingInvoices: Number(outstandingInvoicesCount[0].count) || 0,
      availableSubcontractors: Number(availableSubcontractorsCount[0].count) || 0,
      monthlyRevenue: Number(monthlyRevenueResult[0].total) || 0,
    };
  }

  // Job Photo operations
  async getJobPhotos(jobId: number): Promise<JobPhoto[]> {
    return await db
      .select()
      .from(jobPhotos)
      .where(eq(jobPhotos.jobId, jobId))
      .orderBy(desc(jobPhotos.createdAt));
  }

  async createJobPhoto(photoData: InsertJobPhoto): Promise<JobPhoto> {
    const [photo] = await db.insert(jobPhotos).values(photoData).returning();
    return photo;
  }

  async deleteJobPhoto(id: number): Promise<void> {
    await db.delete(jobPhotos).where(eq(jobPhotos.id, id));
  }

  // Schedule operations
  async getScheduleItems(companyId: number): Promise<ScheduleItem[]> {
    return await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.companyId, companyId))
      .orderBy(desc(scheduleItems.startDateTime));
  }

  async getScheduleItem(id: number): Promise<ScheduleItem | undefined> {
    const [scheduleItem] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, id));
    return scheduleItem;
  }

  async getScheduleItemsByJob(jobId: number): Promise<ScheduleItem[]> {
    return await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.jobId, jobId))
      .orderBy(desc(scheduleItems.startDateTime));
  }

  async createScheduleItem(scheduleItemData: InsertScheduleItem): Promise<ScheduleItem> {
    const [scheduleItem] = await db
      .insert(scheduleItems)
      .values(scheduleItemData)
      .returning();
    return scheduleItem;
  }

  async updateScheduleItem(id: number, scheduleItemData: Partial<InsertScheduleItem>): Promise<ScheduleItem> {
    const [scheduleItem] = await db
      .update(scheduleItems)
      .set({ ...scheduleItemData, updatedAt: new Date() })
      .where(eq(scheduleItems.id, id))
      .returning();
    return scheduleItem;
  }

  async deleteScheduleItem(id: number): Promise<void> {
    await db.delete(scheduleItems).where(eq(scheduleItems.id, id));
  }

  // Approval Workflow operations
  async getApprovalWorkflows(companyId: number): Promise<ApprovalWorkflow[]> {
    return await db
      .select()
      .from(approvalWorkflows)
      .where(eq(approvalWorkflows.companyId, companyId))
      .orderBy(desc(approvalWorkflows.createdAt));
  }

  async getApprovalWorkflow(id: number): Promise<ApprovalWorkflow | undefined> {
    const [workflow] = await db
      .select()
      .from(approvalWorkflows)
      .where(eq(approvalWorkflows.id, id));
    return workflow;
  }

  async createApprovalWorkflow(workflowData: InsertApprovalWorkflow): Promise<ApprovalWorkflow> {
    const [workflow] = await db
      .insert(approvalWorkflows)
      .values(workflowData)
      .returning();
    return workflow;
  }

  async updateApprovalWorkflow(id: number, workflowData: Partial<InsertApprovalWorkflow>): Promise<ApprovalWorkflow> {
    const [workflow] = await db
      .update(approvalWorkflows)
      .set({ ...workflowData, updatedAt: new Date() })
      .where(eq(approvalWorkflows.id, id))
      .returning();
    return workflow;
  }

  async deleteApprovalWorkflow(id: number): Promise<void> {
    await db.delete(approvalWorkflows).where(eq(approvalWorkflows.id, id));
  }

  // Approval Signature operations
  async getApprovalSignatures(workflowId: number): Promise<ApprovalSignature[]> {
    return await db
      .select()
      .from(approvalSignatures)
      .where(eq(approvalSignatures.workflowId, workflowId))
      .orderBy(desc(approvalSignatures.createdAt));
  }

  async getApprovalSignature(id: number): Promise<ApprovalSignature | undefined> {
    const [signature] = await db
      .select()
      .from(approvalSignatures)
      .where(eq(approvalSignatures.id, id));
    return signature;
  }

  async getApprovalSignatureByToken(accessToken: string): Promise<ApprovalSignature | undefined> {
    const [signature] = await db
      .select()
      .from(approvalSignatures)
      .where(eq(approvalSignatures.accessToken, accessToken));
    return signature;
  }

  async createApprovalSignature(signatureData: InsertApprovalSignature): Promise<ApprovalSignature> {
    const [signature] = await db
      .insert(approvalSignatures)
      .values(signatureData)
      .returning();
    return signature;
  }

  async updateApprovalSignature(id: number, signatureData: Partial<InsertApprovalSignature>): Promise<ApprovalSignature> {
    const [signature] = await db
      .update(approvalSignatures)
      .set(signatureData)
      .where(eq(approvalSignatures.id, id))
      .returning();
    return signature;
  }

  async deleteApprovalSignature(id: number): Promise<void> {
    await db.delete(approvalSignatures).where(eq(approvalSignatures.id, id));
  }

  // Approval History operations
  async createApprovalHistory(historyData: InsertApprovalHistory): Promise<ApprovalHistory> {
    const [history] = await db
      .insert(approvalHistory)
      .values(historyData)
      .returning();
    return history;
  }

  async getApprovalHistory(workflowId: number): Promise<ApprovalHistory[]> {
    return await db
      .select()
      .from(approvalHistory)
      .where(eq(approvalHistory.workflowId, workflowId))
      .orderBy(desc(approvalHistory.timestamp));
  }

  // Signature Request operations
  async getSignatureRequests(companyId: number): Promise<SignatureRequest[]> {
    return await db
      .select()
      .from(signatureRequests)
      .where(eq(signatureRequests.companyId, companyId))
      .orderBy(desc(signatureRequests.createdAt));
  }

  async getSignatureRequest(id: number): Promise<SignatureRequest | undefined> {
    const [request] = await db
      .select()
      .from(signatureRequests)
      .where(eq(signatureRequests.id, id));
    return request || undefined;
  }

  async getSignatureRequestByToken(accessToken: string): Promise<SignatureRequest | undefined> {
    const [request] = await db
      .select()
      .from(signatureRequests)
      .where(eq(signatureRequests.accessToken, accessToken));
    return request || undefined;
  }

  async createSignatureRequest(requestData: InsertSignatureRequest): Promise<SignatureRequest> {
    const [request] = await db
      .insert(signatureRequests)
      .values(requestData)
      .returning();
    return request;
  }

  async updateSignatureRequest(id: number, requestData: Partial<InsertSignatureRequest>): Promise<SignatureRequest> {
    const [request] = await db
      .update(signatureRequests)
      .set({ ...requestData, updatedAt: new Date() })
      .where(eq(signatureRequests.id, id))
      .returning();
    return request;
  }

  async deleteSignatureRequest(id: number): Promise<void> {
    await db.delete(signatureRequests).where(eq(signatureRequests.id, id));
  }

  // Employee management operations
  async getOrgUsers(
    companyId: number,
    params?: { search?: string; role?: UserRole; status?: string; limit?: number; offset?: number }
  ): Promise<{ users: User[]; total: number }> {
    const { search, role, status, limit = 50, offset = 0 } = params || {};

    // Build query conditions
    const conditions = [eq(companyMembers.companyId, companyId)];

    if (role) {
      conditions.push(eq(companyMembers.role, role));
    }

    if (status) {
      // Normalize status to uppercase for case-insensitive matching
      conditions.push(sql`UPPER(${users.status}) = ${status.toUpperCase()}`);
    }

    // Get users with their roles in the company
    let query = db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        phone: users.phone,
        addressLine1: users.addressLine1,
        addressLine2: users.addressLine2,
        city: users.city,
        state: users.state,
        postalCode: users.postalCode,
        country: users.country,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        role: companyMembers.role,
      })
      .from(users)
      .innerJoin(companyMembers, eq(users.id, companyMembers.userId))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt));

    // Apply search filter if provided
    if (search) {
      const searchPattern = `%${search.toLowerCase()}%`;
      query = query.where(
        sql`LOWER(${users.firstName}) LIKE ${searchPattern} OR LOWER(${users.lastName}) LIKE ${searchPattern} OR LOWER(${users.email}) LIKE ${searchPattern}`
      );
    }

    // Get total count
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .innerJoin(companyMembers, eq(users.id, companyMembers.userId))
      .where(and(...conditions));

    const [{ count: total }] = await countQuery;

    // Get paginated results
    const userResults = await query.limit(limit).offset(offset);

    return {
      users: userResults as any,
      total: Number(total),
    };
  }

  async updateUserRole(
    userId: string,
    companyId: number,
    newRole: UserRole,
    currentUserRole: UserRole
  ): Promise<User> {
    // Get target user's current role
    const [membership] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)));

    if (!membership) {
      throw new Error("User not found in this organization");
    }

    // Safety: Supervisor cannot modify Owner roles
    if (currentUserRole === "SUPERVISOR" && membership.role === "OWNER") {
      throw new Error("Supervisors cannot modify Owner roles");
    }

    // Safety: If demoting an Owner, ensure at least one Owner remains
    if (membership.role === "OWNER" && newRole !== "OWNER") {
      if (currentUserRole !== "OWNER") {
        throw new Error("Only Owners can change other Owners' roles");
      }

      const [{ count: ownerCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(companyMembers)
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.role, "OWNER")));

      if (Number(ownerCount) <= 1) {
        throw new Error("Cannot remove the last Owner from the organization");
      }
    }

    // Update the role
    await db
      .update(companyMembers)
      .set({ role: newRole, updatedAt: new Date() })
      .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)));

    // Return updated user
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return user;
  }

  async updateUserStatus(
    userId: string,
    companyId: number,
    status: 'ACTIVE' | 'INACTIVE',
    currentUserRole: UserRole
  ): Promise<User> {
    // Get target user's current role
    const [membership] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)));

    if (!membership) {
      throw new Error("User not found in this organization");
    }

    // Safety: Supervisor cannot deactivate Owners
    if (currentUserRole === "SUPERVISOR" && membership.role === "OWNER") {
      throw new Error("Supervisors cannot deactivate Owners");
    }

    // Safety: Cannot deactivate the last Owner
    if (membership.role === "OWNER" && status === "INACTIVE") {
      const [{ count: activeOwnerCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(companyMembers)
        .innerJoin(users, eq(companyMembers.userId, users.id))
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.role, "OWNER"),
            eq(users.status, "ACTIVE")
          )
        );

      if (Number(activeOwnerCount) <= 1) {
        throw new Error("Cannot deactivate the last active Owner");
      }
    }

    // If deactivating, increment tokenVersion and delete all sessions
    const updateData: any = { status, updatedAt: new Date() };
    if (status === "INACTIVE") {
      // Get current user to increment tokenVersion
      const [currentUser] = await db.select().from(users).where(eq(users.id, userId));
      updateData.tokenVersion = (currentUser?.tokenVersion || 0) + 1;
      
      // Delete all sessions for this user
      await db.delete(sessions).where(sql`sess->>'userId' = ${userId}`);
    }

    // Update the status (and tokenVersion if deactivating)
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();

    return user;
  }

  async getUserJobsSummary(
    userId: string,
    companyId: number
  ): Promise<{ total: number; scheduled: number; inProgress: number; completed: number }> {
    // Get all jobs assigned to this user in the company
    const userJobs = await db
      .select({
        status: jobs.status,
      })
      .from(jobs)
      .where(and(eq(jobs.assignedTo, userId), eq(jobs.companyId, companyId)));

    // Count jobs by status
    const summary = {
      total: userJobs.length,
      scheduled: userJobs.filter(j => j.status === 'scheduled').length,
      inProgress: userJobs.filter(j => j.status === 'in-progress').length,
      completed: userJobs.filter(j => j.status === 'completed').length,
    };

    return summary;
  }

  // Estimate operations
  async getEstimatesByJob(jobId: number): Promise<Estimate[]> {
    // Return estimates with their own schedule only (no fallback to job schedule)
    const results = await db
      .select()
      .from(estimates)
      .where(eq(estimates.jobId, jobId))
      .orderBy(desc(estimates.createdAt));
    
    console.log(`[Estimates] getByJob jobId=${jobId} count=${results.length}`);
    if (results.length > 0) {
      console.log(`[Estimates] first estimate schedule:`, {
        id: results[0].id,
        status: results[0].status,
        scheduledDate: results[0].scheduledDate,
        scheduledTime: results[0].scheduledTime,
      });
    }
    
    return results;
  }

  async getEstimatesByCompany(companyId: number): Promise<Estimate[]> {
    // Return estimates with their own schedule only (no fallback to job schedule)
    const results = await db
      .select()
      .from(estimates)
      .where(eq(estimates.companyId, companyId))
      .orderBy(desc(estimates.updatedAt));
    
    console.log(`[Estimates] getByCompany companyId=${companyId} count=${results.length}`);
    if (results.length > 0) {
      console.log(`[Estimates] first estimate schedule:`, {
        id: results[0].id,
        status: results[0].status,
        scheduledDate: results[0].scheduledDate,
        scheduledTime: results[0].scheduledTime,
      });
    }
    
    return results;
  }

  async getEstimate(id: number): Promise<EstimateWithItems | undefined> {
    const [estimate] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.id, id));
    
    if (!estimate) return undefined;

    const items = await db
      .select()
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, id))
      .orderBy(estimateItems.sortOrder);

    // Get attachments
    const attachments = await db
      .select()
      .from(estimateAttachments)
      .where(eq(estimateAttachments.estimateId, id))
      .orderBy(desc(estimateAttachments.createdAt));

    // Get creator info
    const [creator] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, estimate.createdByUserId));

    return {
      ...estimate,
      items,
      attachments,
      createdBy: creator || null,
    };
  }

  async getNextEstimateNumber(companyId: number): Promise<string> {
    // Use atomic increment with upsert
    const result = await db
      .insert(companyCounters)
      .values({ companyId, estimateCounter: 1 })
      .onConflictDoUpdate({
        target: companyCounters.companyId,
        set: { estimateCounter: sql`${companyCounters.estimateCounter} + 1` },
      })
      .returning({ counter: companyCounters.estimateCounter });

    const counter = result[0]?.counter || 1;
    return `EST-${String(counter).padStart(6, '0')}`;
  }

  async createEstimate(
    payload: CreateEstimatePayload,
    companyId: number,
    userId: string
  ): Promise<EstimateWithItems> {
    // Calculate totals from items (server-side calculation for accuracy)
    let subtotalCents = 0;
    let totalTaxCents = 0;
    const itemsWithTotals = payload.items.map((item, index) => {
      const quantity = parseFloat(item.quantity);
      const lineTotalCents = Math.round(quantity * item.unitPriceCents);
      subtotalCents += lineTotalCents;
      
      // Use provided taxCents or calculate from rate snapshot
      let itemTaxCents = item.taxCents ?? 0;
      if (itemTaxCents === 0 && item.taxable && item.taxRatePercentSnapshot) {
        const taxRate = parseFloat(item.taxRatePercentSnapshot) || 0;
        itemTaxCents = Math.round(lineTotalCents * taxRate / 100);
      }
      totalTaxCents += itemTaxCents;
      
      return {
        ...item,
        quantity: item.quantity,
        lineTotalCents,
        itemTaxCents,
        sortOrder: item.sortOrder ?? index,
      };
    });

    // Get next estimate number
    const estimateNumber = await this.getNextEstimateNumber(companyId);

    // Server-side calculated totals (not trusting payload.taxCents)
    const taxCents = totalTaxCents;
    const totalCents = subtotalCents + taxCents;

    // Process schedule data - use scheduledDate and scheduledTime directly (no timezone conversion)
    // scheduledDate is a YYYY-MM-DD string, scheduledTime is an HH:mm string
    let processedScheduledDate: Date | null = null;
    let processedScheduledTime: string | null = null;
    let processedScheduledEndTime: string | null = null;
    
    if (payload.scheduledDate) {
      // Convert YYYY-MM-DD string to Date (stored as timestamp, but we only care about the date portion)
      const dateStr = typeof payload.scheduledDate === 'string' 
        ? payload.scheduledDate.split('T')[0] // Handle both "2026-01-17" and "2026-01-17T..."
        : payload.scheduledDate.toISOString().split('T')[0];
      // Create date at noon UTC to avoid any timezone edge cases
      processedScheduledDate = new Date(`${dateStr}T12:00:00.000Z`);
    }
    
    if (payload.scheduledTime) {
      // scheduledTime is already "HH:mm" - use directly
      processedScheduledTime = payload.scheduledTime;
    }
    
    if (payload.scheduledEndTime) {
      // scheduledEndTime is already "HH:mm" - use directly
      processedScheduledEndTime = payload.scheduledEndTime;
    }
    
    // Create estimate
    const [estimate] = await db
      .insert(estimates)
      .values({
        companyId,
        jobId: payload.jobId || null, // Nullable for standalone estimates
        customerId: payload.customerId || null,
        estimateNumber,
        title: payload.title,
        customerName: payload.customerName || null,
        customerEmail: payload.customerEmail || null,
        customerPhone: payload.customerPhone || null,
        customerAddress: payload.customerAddress || null,
        jobAddressLine1: payload.jobAddressLine1 || null,
        jobCity: payload.jobCity || null,
        jobState: payload.jobState || null,
        jobZip: payload.jobZip || null,
        notes: payload.notes || null,
        jobType: payload.jobType || null,
        status: "draft",
        subtotalCents,
        taxCents,
        totalCents,
        assignedEmployeeIds: payload.assignedEmployeeIds || [],
        scheduledDate: processedScheduledDate,
        scheduledTime: processedScheduledTime,
        scheduledEndTime: processedScheduledEndTime,
        createdByUserId: userId,
      })
      .returning();
    
    // Create line items
    const createdItems: EstimateItem[] = [];
    for (const item of itemsWithTotals) {
      const [createdItem] = await db
        .insert(estimateItems)
        .values({
          estimateId: estimate.id,
          name: item.name,
          description: item.description || null,
          taskCode: item.taskCode || null,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          unit: item.unit || 'each',
          taxable: item.taxable ?? false,
          taxId: item.taxId || null,
          taxRatePercentSnapshot: item.taxRatePercentSnapshot || null,
          taxNameSnapshot: item.taxNameSnapshot || null,
          taxCents: item.itemTaxCents,
          lineTotalCents: item.lineTotalCents,
          totalCents: item.lineTotalCents + item.itemTaxCents,
          sortOrder: item.sortOrder,
        })
        .returning();
      createdItems.push(createdItem);
    }

    // Get creator info
    const [creator] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, userId));

    return {
      ...estimate,
      items: createdItems,
      createdBy: creator || null,
    };
  }

  async updateEstimate(id: number, payload: UpdateEstimatePayload): Promise<EstimateWithItems> {
    const updateData: any = { updatedAt: new Date() };
    
    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.notes !== undefined) updateData.notes = payload.notes;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.assignedEmployeeIds !== undefined) updateData.assignedEmployeeIds = payload.assignedEmployeeIds;

    // If items are provided, recalculate totals
    if (payload.items) {
      let subtotalCents = 0;
      let totalTaxCents = 0;
      const itemsWithTotals = payload.items.map((item, index) => {
        const quantity = parseFloat(item.quantity);
        const lineTotalCents = Math.round(quantity * item.unitPriceCents);
        subtotalCents += lineTotalCents;
        
        // Use provided taxCents or calculate from rate snapshot
        let itemTaxCents = item.taxCents ?? 0;
        if (itemTaxCents === 0 && item.taxable && item.taxRatePercentSnapshot) {
          const taxRate = parseFloat(item.taxRatePercentSnapshot) || 0;
          itemTaxCents = Math.round(lineTotalCents * taxRate / 100);
        }
        totalTaxCents += itemTaxCents;
        
        return {
          ...item,
          quantity: item.quantity,
          lineTotalCents,
          itemTaxCents,
          sortOrder: item.sortOrder ?? index,
        };
      });

      updateData.subtotalCents = subtotalCents;
      updateData.taxCents = totalTaxCents;
      updateData.totalCents = subtotalCents + totalTaxCents;

      // Delete existing items and create new ones
      await db.delete(estimateItems).where(eq(estimateItems.estimateId, id));

      for (const item of itemsWithTotals) {
        await db.insert(estimateItems).values({
          estimateId: id,
          name: item.name,
          description: item.description || null,
          taskCode: item.taskCode || null,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          unit: item.unit || 'each',
          taxable: item.taxable ?? false,
          taxId: item.taxId || null,
          taxRatePercentSnapshot: item.taxRatePercentSnapshot || null,
          taxNameSnapshot: item.taxNameSnapshot || null,
          taxCents: item.itemTaxCents,
          lineTotalCents: item.lineTotalCents,
          totalCents: item.lineTotalCents + item.itemTaxCents,
          sortOrder: item.sortOrder,
        });
      }
    }

    // Update estimate
    await db.update(estimates).set(updateData).where(eq(estimates.id, id));

    // Return updated estimate with items
    const result = await this.getEstimate(id);
    if (!result) throw new Error("Estimate not found after update");
    return result;
  }

  async deleteEstimate(id: number): Promise<void> {
    // Items are deleted via cascade
    await db.delete(estimates).where(eq(estimates.id, id));
  }

  // Customer operations
  async getCustomers(companyId: number): Promise<Customer[]> {
    return db
      .select()
      .from(customers)
      .where(eq(customers.companyId, companyId))
      .orderBy(customers.firstName, customers.lastName);
  }

  async getCustomer(id: number): Promise<Customer | undefined> {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id));
    return customer || undefined;
  }

  async createCustomer(customer: InsertCustomer & { companyId: number }): Promise<Customer> {
    const [created] = await db
      .insert(customers)
      .values(customer)
      .returning();
    return created;
  }

  async updateCustomer(id: number, updates: Partial<InsertCustomer>): Promise<Customer> {
    const [updated] = await db
      .update(customers)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    return updated;
  }

  async deleteCustomer(id: number): Promise<void> {
    await db.delete(customers).where(eq(customers.id, id));
  }

  async deleteCustomersBulk(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.delete(customers).where(inArray(customers.id, ids));
    return result.rowCount ?? ids.length;
  }

  // Service catalog operations
  async getServiceCatalogItems(companyId: number): Promise<ServiceCatalogItem[]> {
    return db
      .select()
      .from(serviceCatalogItems)
      .where(eq(serviceCatalogItems.companyId, companyId))
      .orderBy(serviceCatalogItems.name);
  }

  async getServiceCatalogItem(id: number): Promise<ServiceCatalogItem | undefined> {
    const [item] = await db
      .select()
      .from(serviceCatalogItems)
      .where(eq(serviceCatalogItems.id, id));
    return item || undefined;
  }

  async createServiceCatalogItem(item: InsertServiceCatalogItem): Promise<ServiceCatalogItem> {
    const [created] = await db
      .insert(serviceCatalogItems)
      .values(item)
      .returning();
    return created;
  }

  async updateServiceCatalogItem(id: number, item: Partial<InsertServiceCatalogItem>): Promise<ServiceCatalogItem> {
    const [updated] = await db
      .update(serviceCatalogItems)
      .set({ ...item, updatedAt: new Date() })
      .where(eq(serviceCatalogItems.id, id))
      .returning();
    return updated;
  }

  async deleteServiceCatalogItem(id: number): Promise<void> {
    await db.delete(serviceCatalogItems).where(eq(serviceCatalogItems.id, id));
  }

  // Estimate attachment operations
  async getEstimateAttachments(estimateId: number): Promise<EstimateAttachment[]> {
    return await db
      .select()
      .from(estimateAttachments)
      .where(eq(estimateAttachments.estimateId, estimateId))
      .orderBy(desc(estimateAttachments.createdAt));
  }

  async createEstimateAttachment(attachment: InsertEstimateAttachment): Promise<EstimateAttachment> {
    const [created] = await db
      .insert(estimateAttachments)
      .values(attachment)
      .returning();
    return created;
  }

  async deleteEstimateAttachment(id: number): Promise<void> {
    await db.delete(estimateAttachments).where(eq(estimateAttachments.id, id));
  }

  // Estimate document operations
  async getEstimateDocuments(estimateId: number, companyId: number): Promise<EstimateDocument[]> {
    return await db
      .select()
      .from(estimateDocuments)
      .where(and(
        eq(estimateDocuments.estimateId, estimateId),
        eq(estimateDocuments.companyId, companyId)
      ))
      .orderBy(desc(estimateDocuments.createdAt));
  }

  async getLatestEstimateDocument(estimateId: number, companyId: number): Promise<EstimateDocument | undefined> {
    const [doc] = await db
      .select()
      .from(estimateDocuments)
      .where(and(
        eq(estimateDocuments.estimateId, estimateId),
        eq(estimateDocuments.companyId, companyId)
      ))
      .orderBy(desc(estimateDocuments.createdAt))
      .limit(1);
    return doc;
  }

  async createEstimateDocument(doc: InsertEstimateDocument): Promise<EstimateDocument> {
    const [created] = await db
      .insert(estimateDocuments)
      .values(doc)
      .returning();
    return created;
  }

  async deleteEstimateDocument(id: number): Promise<void> {
    await db.delete(estimateDocuments).where(eq(estimateDocuments.id, id));
  }

  // Estimate approval operations
  async approveEstimate(id: number, userId: string, signatureDataUrl: string): Promise<Estimate> {
    const [updated] = await db
      .update(estimates)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedByUserId: userId,
        signatureDataUrl,
        updatedAt: new Date(),
      })
      .where(eq(estimates.id, id))
      .returning();
    return updated;
  }

  // Company tax operations
  async getCompanyTaxes(companyId: number): Promise<CompanyTax[]> {
    return await db
      .select()
      .from(companyTaxes)
      .where(eq(companyTaxes.companyId, companyId))
      .orderBy(companyTaxes.name);
  }

  async createCompanyTax(tax: InsertCompanyTax): Promise<CompanyTax> {
    const [created] = await db
      .insert(companyTaxes)
      .values(tax)
      .returning();
    return created;
  }

  async deleteCompanyTax(id: number): Promise<void> {
    await db.delete(companyTaxes).where(eq(companyTaxes.id, id));
  }

  // Leads operations
  async getLeads(companyId: number): Promise<(Lead & { customer?: Customer })[]> {
    const results = await db
      .select({
        lead: leads,
        customer: customers,
      })
      .from(leads)
      .leftJoin(customers, eq(leads.customerId, customers.id))
      .where(eq(leads.companyId, companyId))
      .orderBy(desc(leads.createdAt));
    
    return results.map(r => ({
      ...r.lead,
      customer: r.customer || undefined,
    }));
  }

  async getLead(id: number): Promise<(Lead & { customer?: Customer }) | undefined> {
    const results = await db
      .select({
        lead: leads,
        customer: customers,
      })
      .from(leads)
      .leftJoin(customers, eq(leads.customerId, customers.id))
      .where(eq(leads.id, id));
    
    if (results.length === 0) return undefined;
    return {
      ...results[0].lead,
      customer: results[0].customer || undefined,
    };
  }

  async createLead(companyId: number, lead: InsertLead): Promise<Lead> {
    const [created] = await db
      .insert(leads)
      .values({ ...lead, companyId })
      .returning();
    return created;
  }

  async updateLead(id: number, lead: Partial<InsertLead>): Promise<Lead | undefined> {
    const [updated] = await db
      .update(leads)
      .set({ ...lead, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    return updated;
  }

  async deleteLead(id: number): Promise<void> {
    await db.delete(leads).where(eq(leads.id, id));
  }
  
  // Time log operations
  async getActiveTimeLog(userId: string, companyId: number): Promise<TimeLog | undefined> {
    const [log] = await db
      .select()
      .from(timeLogs)
      .where(
        and(
          eq(timeLogs.userId, userId),
          eq(timeLogs.companyId, companyId),
          sql`${timeLogs.clockOutAt} IS NULL`
        )
      )
      .orderBy(desc(timeLogs.clockInAt))
      .limit(1);
    return log;
  }
  
  async getActiveTimeLogWithJob(userId: string, companyId: number): Promise<(TimeLog & { job?: { id: number; title: string | null } }) | undefined> {
    const results = await db
      .select({
        timeLog: timeLogs,
        job: {
          id: jobs.id,
          title: jobs.title,
        },
      })
      .from(timeLogs)
      .leftJoin(jobs, eq(timeLogs.jobId, jobs.id))
      .where(
        and(
          eq(timeLogs.userId, userId),
          eq(timeLogs.companyId, companyId),
          sql`${timeLogs.clockOutAt} IS NULL`
        )
      )
      .orderBy(desc(timeLogs.clockInAt))
      .limit(1);
    
    if (!results[0]) return undefined;
    return {
      ...results[0].timeLog,
      job: results[0].job?.id ? results[0].job : undefined,
    };
  }
  
  async getUserTimeLogsToday(userId: string, companyId: number, date: string): Promise<TimeLog[]> {
    return await db
      .select()
      .from(timeLogs)
      .where(
        and(
          eq(timeLogs.userId, userId),
          eq(timeLogs.companyId, companyId),
          eq(timeLogs.date, date)
        )
      )
      .orderBy(desc(timeLogs.clockInAt));
  }
  
  async getCompanyTimeLogsToday(companyId: number, date: string): Promise<TimeLog[]> {
    return await db
      .select()
      .from(timeLogs)
      .where(
        and(
          eq(timeLogs.companyId, companyId),
          eq(timeLogs.date, date)
        )
      )
      .orderBy(desc(timeLogs.clockInAt));
  }
  
  async clockIn(userId: string, companyId: number, jobId?: number, category?: string): Promise<TimeLog> {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    
    const [log] = await db
      .insert(timeLogs)
      .values({
        userId,
        companyId,
        jobId: jobId || null,
        category: (category as any) || (jobId ? 'job' : null),
        clockInAt: now,
        date: dateStr,
      })
      .returning();
    return log;
  }
  
  async clockOut(userId: string, companyId: number): Promise<TimeLog | undefined> {
    const activeLog = await this.getActiveTimeLog(userId, companyId);
    if (!activeLog) return undefined;
    
    const [log] = await db
      .update(timeLogs)
      .set({ clockOutAt: new Date() })
      .where(eq(timeLogs.id, activeLog.id))
      .returning();
    return log;
  }
  
  async switchJob(userId: string, companyId: number, jobId?: number, category?: string): Promise<{ ended: TimeLog; started: TimeLog }> {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    
    const activeLog = await this.getActiveTimeLog(userId, companyId);
    if (!activeLog) {
      throw new Error('No active time entry to switch from');
    }
    
    const [ended] = await db
      .update(timeLogs)
      .set({ clockOutAt: now })
      .where(eq(timeLogs.id, activeLog.id))
      .returning();
    
    const [started] = await db
      .insert(timeLogs)
      .values({
        userId,
        companyId,
        jobId: jobId || null,
        category: (category as any) || (jobId ? 'job' : null),
        clockInAt: now,
        date: dateStr,
      })
      .returning();
    
    return { ended, started };
  }
  
  async getJobLaborTotals(jobId: number): Promise<{ totalMinutes: number; laborByUser: { userId: string; minutes: number }[] }> {
    const logs = await db
      .select()
      .from(timeLogs)
      .where(eq(timeLogs.jobId, jobId));
    
    const userMinutes: Record<string, number> = {};
    let totalMinutes = 0;
    
    for (const log of logs) {
      if (!log.clockInAt) continue;
      const start = new Date(log.clockInAt).getTime();
      const end = log.clockOutAt ? new Date(log.clockOutAt).getTime() : Date.now();
      const minutes = Math.max(0, Math.round((end - start) / 60000));
      
      totalMinutes += minutes;
      userMinutes[log.userId] = (userMinutes[log.userId] || 0) + minutes;
    }
    
    const laborByUser = Object.entries(userMinutes).map(([userId, minutes]) => ({ userId, minutes }));
    
    return { totalMinutes, laborByUser };
  }

  async getTimeEntriesForUser(userId: string, companyId: number, startDate: string, endDate: string): Promise<(TimeLog & { job?: { id: number; title: string | null } | null })[]> {
    const logs = await db
      .select({
        id: timeLogs.id,
        companyId: timeLogs.companyId,
        userId: timeLogs.userId,
        jobId: timeLogs.jobId,
        category: timeLogs.category,
        clockInAt: timeLogs.clockInAt,
        clockOutAt: timeLogs.clockOutAt,
        date: timeLogs.date,
        notes: timeLogs.notes,
        autoClosed: timeLogs.autoClosed,
        autoClosedReason: timeLogs.autoClosedReason,
        createdAt: timeLogs.createdAt,
        job: {
          id: jobs.id,
          title: jobs.title,
        },
      })
      .from(timeLogs)
      .leftJoin(jobs, eq(timeLogs.jobId, jobs.id))
      .where(
        and(
          eq(timeLogs.userId, userId),
          eq(timeLogs.companyId, companyId),
          gte(timeLogs.date, startDate),
          lte(timeLogs.date, endDate),
          isNotNull(timeLogs.clockOutAt)
        )
      )
      .orderBy(desc(timeLogs.clockInAt));

    return logs.map(log => ({
      ...log,
      job: log.job?.id ? log.job : null,
    }));
  }

  async getTimeEntriesForCompany(companyId: number, startDate: string, endDate: string): Promise<(TimeLog & { job?: { id: number; title: string | null } | null; user?: { id: string; firstName: string | null; lastName: string | null } })[]> {
    const logs = await db
      .select({
        id: timeLogs.id,
        companyId: timeLogs.companyId,
        userId: timeLogs.userId,
        jobId: timeLogs.jobId,
        category: timeLogs.category,
        clockInAt: timeLogs.clockInAt,
        clockOutAt: timeLogs.clockOutAt,
        date: timeLogs.date,
        notes: timeLogs.notes,
        autoClosed: timeLogs.autoClosed,
        autoClosedReason: timeLogs.autoClosedReason,
        createdAt: timeLogs.createdAt,
        job: {
          id: jobs.id,
          title: jobs.title,
        },
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(timeLogs)
      .leftJoin(jobs, eq(timeLogs.jobId, jobs.id))
      .innerJoin(users, eq(timeLogs.userId, users.id))
      .where(
        and(
          eq(timeLogs.companyId, companyId),
          gte(timeLogs.date, startDate),
          lte(timeLogs.date, endDate),
          isNotNull(timeLogs.clockOutAt)
        )
      )
      .orderBy(desc(timeLogs.clockInAt));

    return logs.map(log => ({
      ...log,
      job: log.job?.id ? log.job : null,
    }));
  }

  async autoCloseExpiredTimeEntries(userId: string, companyId: number): Promise<TimeLog | null> {
    try {
      const activeLog = await this.getActiveTimeLog(userId, companyId);
      if (!activeLog) return null;

      const company = await this.getCompany(companyId);
      const autoClockOutTime = company?.autoClockOutTime || "18:00";

      const now = new Date();
      const entryDate = activeLog.date;
      const [hours, minutes] = autoClockOutTime.split(":").map(Number);

      const autoCloseTime = new Date(entryDate + "T00:00:00");
      autoCloseTime.setHours(hours, minutes, 0, 0);

      const clockInTime = new Date(activeLog.clockInAt);
      const clockInDateStr = clockInTime.toISOString().split('T')[0];

      if (clockInDateStr !== entryDate) {
        return null;
      }

      if (now > autoCloseTime && clockInTime < autoCloseTime) {
        const [updated] = await db
          .update(timeLogs)
          .set({
            clockOutAt: autoCloseTime,
            autoClosed: true,
            autoClosedReason: "auto_clock_out_time",
          })
          .where(eq(timeLogs.id, activeLog.id))
          .returning();
        return updated;
      }

      return null;
    } catch (error) {
      console.error("[auto-close] Error auto-closing time entry:", error);
      return null;
    }
  }

  async autoCloseExpiredTimeEntriesForCompany(companyId: number): Promise<number> {
    try {
      const company = await this.getCompany(companyId);
      const autoClockOutTime = company?.autoClockOutTime || "18:00";
      const [hours, minutes] = autoClockOutTime.split(":").map(Number);
      const now = new Date();

      const activeLogs = await db
        .select()
        .from(timeLogs)
        .where(
          and(
            eq(timeLogs.companyId, companyId),
            sql`${timeLogs.clockOutAt} IS NULL`
          )
        );

      let closedCount = 0;

      for (const log of activeLogs) {
        const entryDate = log.date;
        const autoCloseTime = new Date(entryDate + "T00:00:00");
        autoCloseTime.setHours(hours, minutes, 0, 0);

        const clockInTime = new Date(log.clockInAt);
        const clockInDateStr = clockInTime.toISOString().split('T')[0];

        if (clockInDateStr !== entryDate) {
          continue;
        }

        if (now > autoCloseTime && clockInTime < autoCloseTime) {
          await db
            .update(timeLogs)
            .set({
              clockOutAt: autoCloseTime,
              autoClosed: true,
              autoClosedReason: "auto_clock_out_time",
            })
            .where(eq(timeLogs.id, log.id));
          closedCount++;
        }
      }

      return closedCount;
    } catch (error) {
      console.error("[auto-close] Error auto-closing company time entries:", error);
      return 0;
    }
  }

  async updateCompanyAutoClockOutTime(companyId: number, time: string): Promise<void> {
    await db
      .update(companies)
      .set({ autoClockOutTime: time })
      .where(eq(companies.id, companyId));
  }

  async getTimeEntryById(id: number): Promise<TimeLog | null> {
    const [entry] = await db
      .select()
      .from(timeLogs)
      .where(eq(timeLogs.id, id));
    return entry || null;
  }

  async updateTimeEntry(
    id: number,
    data: { clockInAt: Date; clockOutAt: Date; editedByUserId: string; editReason: string }
  ): Promise<TimeLog | null> {
    const entry = await this.getTimeEntryById(id);
    if (!entry) return null;

    const updateData: any = {
      clockInAt: data.clockInAt,
      clockOutAt: data.clockOutAt,
      editedAt: new Date(),
      editedByUserId: data.editedByUserId,
      editReason: data.editReason,
    };

    if (!entry.originalClockInAt) {
      updateData.originalClockInAt = entry.clockInAt;
    }
    if (!entry.originalClockOutAt && entry.clockOutAt) {
      updateData.originalClockOutAt = entry.clockOutAt;
    }

    const [updated] = await db
      .update(timeLogs)
      .set(updateData)
      .where(eq(timeLogs.id, id))
      .returning();

    return updated || null;
  }

  // ============ NOTIFICATIONS ============

  async createNotification(data: InsertNotification): Promise<Notification> {
    const [notification] = await db
      .insert(notifications)
      .values(data)
      .returning();
    return notification;
  }

  async createNotifications(data: InsertNotification[]): Promise<Notification[]> {
    if (data.length === 0) return [];
    const result = await db
      .insert(notifications)
      .values(data)
      .returning();
    return result;
  }

  async getNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.recipientUserId, userId),
        sql`${notifications.readAt} IS NULL`
      ));
    return result[0]?.count || 0;
  }

  async markNotificationRead(id: number, userId: string): Promise<Notification | null> {
    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.id, id),
        eq(notifications.recipientUserId, userId)
      ))
      .returning();
    return updated || null;
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.recipientUserId, userId),
        sql`${notifications.readAt} IS NULL`
      ));
  }

  async deleteAllNotifications(userId: string): Promise<void> {
    await db
      .delete(notifications)
      .where(eq(notifications.recipientUserId, userId));
  }

  async findRecentDuplicateNotification(
    recipientUserId: string,
    type: NotificationType,
    entityId: number | null,
    withinSeconds: number = 60
  ): Promise<Notification | null> {
    const cutoff = new Date(Date.now() - withinSeconds * 1000);
    const conditions = [
      eq(notifications.recipientUserId, recipientUserId),
      eq(notifications.type, type),
      gte(notifications.createdAt, cutoff)
    ];
    if (entityId !== null) {
      conditions.push(eq(notifications.entityId, entityId));
    }
    const [existing] = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .limit(1);
    return existing || null;
  }
}

export const storage = new DatabaseStorage();