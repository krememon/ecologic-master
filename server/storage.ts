import {
  users,
  companies,
  companyMembers,
  clients,
  subcontractors,
  jobs,
  jobAssignments,
  invoices,
  documents,
  messages,
  jobPhotos,
  scheduleItems,
  type User,
  type UpsertUser,
  type Company,
  type InsertCompany,
  type Client,
  type InsertClient,
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
  type JobPhoto,
  type InsertJobPhoto,
  type ScheduleItem,
  type InsertScheduleItem,
  approvalWorkflows,
  approvalSignatures,
  approvalHistory,
  type ApprovalWorkflow,
  type InsertApprovalWorkflow,
  type ApprovalSignature,
  type InsertApprovalSignature,
  type ApprovalHistory,
  type InsertApprovalHistory,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

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
  
  // Payment operations
  getPayments(companyId: number): Promise<any[]>;
  createPayment(payment: any): Promise<any>;
  updatePayment(id: number, payment: any): Promise<any>;
  
  // Company operations
  getUserCompany(userId: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, company: Partial<InsertCompany>): Promise<Company>;
  
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
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice>;
  deleteInvoice(id: number): Promise<void>;
  
  // Document operations
  getDocuments(companyId: number): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  deleteDocument(id: number): Promise<void>;
  
  // Message operations
  getMessages(companyId: number): Promise<any[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  markMessageAsRead(id: number): Promise<void>;
  
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
  
  async getPayments(companyId: number): Promise<any[]> {
    // Implementation placeholder - return empty array for now
    return [];
  }
  
  async createPayment(payment: any): Promise<any> {
    // Implementation placeholder
    return payment;
  }
  
  async updatePayment(id: number, payment: any): Promise<any> {
    // Implementation placeholder
    return payment;
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
    return await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        priority: jobs.priority,
        startDate: jobs.startDate,
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
  }

  async getJob(id: number): Promise<any> {
    const [job] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        priority: jobs.priority,
        startDate: jobs.startDate,
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
    await db.delete(jobs).where(eq(jobs.id, id));
  }

  async getInvoices(companyId: number): Promise<any[]> {
    return await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        amount: invoices.amount,
        status: invoices.status,
        dueDate: invoices.dueDate,
        issueDate: invoices.issueDate,
        clientId: invoices.clientId,
        jobId: invoices.jobId,
        companyId: invoices.companyId,
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
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: number): Promise<any> {
    const [invoice] = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        amount: invoices.amount,
        status: invoices.status,
        dueDate: invoices.dueDate,
        issueDate: invoices.issueDate,
        clientId: invoices.clientId,
        jobId: invoices.jobId,
        companyId: invoices.companyId,
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
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(eq(invoices.id, id));
    return invoice;
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

  async getDocuments(companyId: number): Promise<Document[]> {
    return await db.select().from(documents).where(eq(documents.companyId, companyId));
  }

  async createDocument(documentData: InsertDocument): Promise<Document> {
    const [document] = await db.insert(documents).values(documentData).returning();
    return document;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  async getMessages(companyId: number): Promise<any[]> {
    return await db
      .select({
        id: messages.id,
        subject: messages.subject,
        content: messages.content,
        isRead: messages.isRead,
        senderId: messages.senderId,
        companyId: messages.companyId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.companyId, companyId))
      .orderBy(desc(messages.createdAt));
  }

  async createMessage(messageData: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(messageData).returning();
    return message;
  }

  async markMessageAsRead(id: number): Promise<void> {
    await db
      .update(messages)
      .set({ isRead: true })
      .where(eq(messages.id, id));
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
}

export const storage = new DatabaseStorage();