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
  type User,
  type InsertUser,
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
  type UserRole,
  type UserPermissions,
  defaultOwnerPermissions,
  defaultWorkerPermissions,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations for email/password and social authentication
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByProvider(provider: string, providerId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User>;
  verifyEmail(token: string): Promise<User | undefined>;
  setResetPasswordToken(email: string, token: string, expires: Date): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<User | undefined>;
  
  // Company operations
  getUserCompany(userId: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, company: Partial<InsertCompany>): Promise<Company>;
  
  // Role-based operations for business owners and workers
  getUserRole(userId: string, companyId: number): Promise<{ role: UserRole; permissions: UserPermissions } | undefined>;
  addWorkerToCompany(companyId: number, userEmail: string, role: UserRole): Promise<void>;
  getCompanyWorkers(companyId: number): Promise<Array<{ user: User; role: UserRole; permissions: UserPermissions }>>;
  removeWorkerFromCompany(companyId: number, userId: string): Promise<void>;
  updateWorkerPermissions(companyId: number, userId: string, permissions: UserPermissions): Promise<void>;
  isBusinessOwner(userId: string, companyId: number): Promise<boolean>;
  
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
}

export class DatabaseStorage implements IStorage {
  // User operations for email/password and social authentication

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByProvider(provider: string, providerId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      and(eq(users.provider, provider), eq(users.providerId, providerId))
    );
    return user || undefined;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...userData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async verifyEmail(token: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ 
        emailVerified: true, 
        emailVerificationToken: null,
        updatedAt: new Date()
      })
      .where(eq(users.emailVerificationToken, token))
      .returning();
    return user || undefined;
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
      .update(users)
      .set({ 
        password: newPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(users.resetPasswordToken, token),
          sql`reset_password_expires > NOW()`
        )
      )
      .returning();
    return user || undefined;
  }

  async getUserCompany(userId: number): Promise<Company | undefined> {
    const [membership] = await db
      .select({ company: companies })
      .from(companyMembers)
      .innerJoin(companies, eq(companyMembers.companyId, companies.id))
      .where(eq(companyMembers.userId, userId))
      .limit(1);
    
    return membership?.company;
  }

  async createCompany(companyData: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(companyData).returning();
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
        budget: jobs.budget,
        location: jobs.location,
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
        budget: jobs.budget,
        location: jobs.location,
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
    const [job] = await db.insert(jobs).values(jobData).returning();
    return job;
  }

  async updateJob(id: number, jobData: Partial<InsertJob>): Promise<Job> {
    const [job] = await db
      .update(jobs)
      .set({ ...jobData, updatedAt: new Date() })
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
        issuedDate: invoices.issuedDate,
        description: invoices.description,
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
        issuedDate: invoices.issuedDate,
        description: invoices.description,
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
        fromEmail: messages.fromEmail,
        fromName: messages.fromName,
        toEmail: messages.toEmail,
        toName: messages.toName,
        companyId: messages.companyId,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,
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
      .set({ isRead: true, updatedAt: new Date() })
      .where(eq(messages.id, id));
  }

  async getDashboardStats(companyId: number): Promise<any> {
    try {
      const activeJobsCount = await db
        .select({ count: sql`count(*)` })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), eq(jobs.status, "active")));

      // Get all invoices and calculate total manually
      const allInvoices = await this.getInvoices(companyId);
      const totalInvoiceAmount = allInvoices.reduce((sum, invoice) => {
        return sum + parseFloat(invoice.amount || '0');
      }, 0);
      
      console.log("Manual calculation - Invoice amounts:", allInvoices.map(inv => inv.amount));
      console.log("Manual calculation - Total:", totalInvoiceAmount);

      const availableSubcontractorsCount = await db
        .select({ count: sql`count(*)` })
        .from(subcontractors)
        .where(eq(subcontractors.companyId, companyId));

      // Skip monthly revenue calculation for now
      const result = {
        activeJobs: Number(activeJobsCount[0].count) || 0,
        outstandingInvoices: totalInvoiceAmount,
        availableSubcontractors: Number(availableSubcontractorsCount[0].count) || 0,
        monthlyRevenue: 0,
      };
      
      console.log("Final dashboard result:", result);
      return result;
    } catch (error) {
      console.error("Error in getDashboardStats:", error);
      return {
        activeJobs: 0,
        outstandingInvoices: 0,
        availableSubcontractors: 0,
        monthlyRevenue: 0,
      };
    }
  }

  // Role-based operations for business owners and workers
  async getUserRole(userId: string, companyId: number): Promise<{ role: UserRole; permissions: UserPermissions } | undefined> {
    const [member] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)));

    if (!member) return undefined;

    return {
      role: member.role as UserRole,
      permissions: member.permissions as UserPermissions
    };
  }

  async addWorkerToCompany(companyId: number, userEmail: string, role: UserRole): Promise<void> {
    // Find user by email
    const [user] = await db.select().from(users).where(eq(users.email, userEmail));
    if (!user) {
      throw new Error("User not found with that email address");
    }

    // Check if user is already a member
    const existingMember = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, user.id), eq(companyMembers.companyId, companyId)));

    if (existingMember.length > 0) {
      throw new Error("User is already a member of this company");
    }

    // Add user as company member
    const permissions = role === 'owner' ? defaultOwnerPermissions : defaultWorkerPermissions;
    await db.insert(companyMembers).values({
      companyId,
      userId: user.id,
      role,
      permissions
    });
  }

  async getCompanyWorkers(companyId: number): Promise<Array<{ user: User; role: UserRole; permissions: UserPermissions }>> {
    const workers = await db
      .select({
        user: users,
        role: companyMembers.role,
        permissions: companyMembers.permissions
      })
      .from(companyMembers)
      .innerJoin(users, eq(companyMembers.userId, users.id))
      .where(eq(companyMembers.companyId, companyId));

    return workers.map(worker => ({
      user: worker.user,
      role: worker.role as UserRole,
      permissions: worker.permissions as UserPermissions
    }));
  }

  async removeWorkerFromCompany(companyId: number, userId: string): Promise<void> {
    await db
      .delete(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  }

  async updateWorkerPermissions(companyId: number, userId: string, permissions: UserPermissions): Promise<void> {
    await db
      .update(companyMembers)
      .set({ permissions, updatedAt: new Date() })
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  }

  async isBusinessOwner(userId: string, companyId: number): Promise<boolean> {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) return false;
    
    // Check if user is the company owner
    if (company.ownerId === userId) return true;
    
    // Check if user has owner role in company members
    const [member] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)));
    
    return member?.role === 'owner';
  }
}

export const storage = new DatabaseStorage();