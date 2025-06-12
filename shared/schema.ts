import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  serial,
  integer,
  decimal,
  boolean,
  date,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  password: varchar("password"), // For email-based authentication
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: varchar("email_verification_token"),
  resetPasswordToken: varchar("reset_password_token"),
  resetPasswordExpires: timestamp("reset_password_expires"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Companies table for multi-tenant support
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  logo: varchar("logo"),
  primaryColor: varchar("primary_color").default("#2563EB"),
  secondaryColor: varchar("secondary_color").default("#059669"),
  ownerId: varchar("owner_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Company members table - defines who works for which business
export const companyMembers = pgTable("company_members", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: varchar("role").notNull().default("worker"), // owner, worker
  permissions: jsonb("permissions").default('{"canCreateJobs": false, "canManageInvoices": false, "canViewSchedule": true}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Clients table
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Subcontractors table
export const subcontractors = pgTable("subcontractors", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  skills: text("skills").array(),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  isAvailable: boolean("is_available").default(true),
  hourlyRate: decimal("hourly_rate", { precision: 8, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Jobs table
export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  clientId: integer("client_id").references(() => clients.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status").notNull().default("pending"), // pending, active, completed, cancelled
  priority: varchar("priority").default("medium"), // low, medium, high, urgent
  startDate: date("start_date"),
  endDate: date("end_date"),
  estimatedCost: decimal("estimated_cost", { precision: 10, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 10, scale: 2 }),
  location: text("location"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Job assignments table (many-to-many relationship between jobs and subcontractors)
export const jobAssignments = pgTable("job_assignments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractors.id),
  assignedAt: timestamp("assigned_at").defaultNow(),
});

// Invoices table
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").references(() => jobs.id),
  clientId: integer("client_id").references(() => clients.id),
  invoiceNumber: varchar("invoice_number").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status").notNull().default("pending"), // pending, paid, overdue, cancelled
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Documents table
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").references(() => jobs.id),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type"), // contract, permit, blueprint, receipt, photo
  fileUrl: varchar("file_url").notNull(),
  fileSize: integer("file_size"),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Messages table
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").references(() => jobs.id),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  recipientId: varchar("recipient_id").references(() => users.id),
  subject: varchar("subject"),
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Job Photos table for real-time progress tracking
export const jobPhotos = pgTable("job_photos", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id),
  title: varchar("title", { length: 255 }),
  description: text("description"),
  photoUrl: varchar("photo_url").notNull(),
  location: text("location"), // GPS coordinates or description
  phase: varchar("phase"), // foundation, framing, roofing, electrical, etc.
  weather: varchar("weather"), // sunny, rainy, cloudy, etc.
  isPublic: boolean("is_public").default(true), // visible to clients
  createdAt: timestamp("created_at").defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  jobId: integer("job_id").references(() => jobs.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method").notNull(), // cash, check, credit_card, bank_transfer, other
  status: varchar("status").notNull().default("pending"), // pending, completed, failed, refunded
  paidDate: timestamp("paid_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  ownedCompanies: many(companies),
  companyMemberships: many(companyMembers),
  sentMessages: many(messages, { relationName: "sender" }),
  receivedMessages: many(messages, { relationName: "recipient" }),
}));

export const companiesRelations = relations(companies, ({ one, many }) => ({
  owner: one(users, {
    fields: [companies.ownerId],
    references: [users.id],
  }),
  members: many(companyMembers),
  clients: many(clients),
  subcontractors: many(subcontractors),
  jobs: many(jobs),
  invoices: many(invoices),
  documents: many(documents),
  messages: many(messages),
}));

export const companyMembersRelations = relations(companyMembers, ({ one }) => ({
  company: one(companies, {
    fields: [companyMembers.companyId],
    references: [companies.id],
  }),
  user: one(users, {
    fields: [companyMembers.userId],
    references: [users.id],
  }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  company: one(companies, {
    fields: [clients.companyId],
    references: [companies.id],
  }),
  jobs: many(jobs),
  invoices: many(invoices),
}));

export const subcontractorsRelations = relations(subcontractors, ({ one, many }) => ({
  company: one(companies, {
    fields: [subcontractors.companyId],
    references: [companies.id],
  }),
  jobAssignments: many(jobAssignments),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  company: one(companies, {
    fields: [jobs.companyId],
    references: [companies.id],
  }),
  client: one(clients, {
    fields: [jobs.clientId],
    references: [clients.id],
  }),
  assignments: many(jobAssignments),
  invoices: many(invoices),
  documents: many(documents),
  messages: many(messages),
  photos: many(jobPhotos),
}));

export const jobAssignmentsRelations = relations(jobAssignments, ({ one }) => ({
  job: one(jobs, {
    fields: [jobAssignments.jobId],
    references: [jobs.id],
  }),
  subcontractor: one(subcontractors, {
    fields: [jobAssignments.subcontractorId],
    references: [subcontractors.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  company: one(companies, {
    fields: [invoices.companyId],
    references: [companies.id],
  }),
  job: one(jobs, {
    fields: [invoices.jobId],
    references: [jobs.id],
  }),
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  company: one(companies, {
    fields: [documents.companyId],
    references: [companies.id],
  }),
  job: one(jobs, {
    fields: [documents.jobId],
    references: [jobs.id],
  }),
  uploader: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  company: one(companies, {
    fields: [messages.companyId],
    references: [companies.id],
  }),
  job: one(jobs, {
    fields: [messages.jobId],
    references: [jobs.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: "sender",
  }),
  recipient: one(users, {
    fields: [messages.recipientId],
    references: [users.id],
    relationName: "recipient",
  }),
}));

export const jobPhotosRelations = relations(jobPhotos, ({ one }) => ({
  job: one(jobs, {
    fields: [jobPhotos.jobId],
    references: [jobs.id],
  }),
  uploader: one(users, {
    fields: [jobPhotos.uploadedBy],
    references: [users.id],
  }),
}));

// Approval workflows table
export const approvalWorkflows = pgTable("approval_workflows", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull(), // 'quote', 'design', 'scope_change', 'contract', 'custom'
  status: varchar("status", { length: 50 }).notNull().default("draft"), // 'draft', 'pending', 'approved', 'rejected', 'expired'
  documentUrl: varchar("document_url", { length: 500 }),
  documentType: varchar("document_type", { length: 100 }), // 'pdf', 'image', 'link'
  relatedJobId: integer("related_job_id").references(() => jobs.id, { onDelete: "set null" }),
  relatedClientId: integer("related_client_id").references(() => clients.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
});

// Approval signatures table
export const approvalSignatures = pgTable("approval_signatures", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull().references(() => approvalWorkflows.id, { onDelete: "cascade" }),
  signerName: varchar("signer_name", { length: 255 }).notNull(),
  signerEmail: varchar("signer_email", { length: 255 }).notNull(),
  signerType: varchar("signer_type", { length: 50 }).notNull(), // 'client', 'subcontractor', 'company_rep'
  signatureData: text("signature_data"), // Base64 encoded signature image
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  signedAt: timestamp("signed_at"),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // 'pending', 'signed', 'declined'
  comments: text("comments"),
  notificationSentAt: timestamp("notification_sent_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
  accessToken: varchar("access_token", { length: 255 }).unique(), // For secure access without login
  createdAt: timestamp("created_at").defaultNow(),
});

// Approval workflow history/audit trail
export const approvalHistory = pgTable("approval_history", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull().references(() => approvalWorkflows.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 100 }).notNull(), // 'created', 'sent', 'viewed', 'signed', 'declined', 'expired', 'reminded'
  description: text("description"),
  performedBy: varchar("performed_by").references(() => users.id),
  performedByEmail: varchar("performed_by_email", { length: 255 }),
  metadata: jsonb("metadata"), // Additional data like IP, user agent, etc.
  timestamp: timestamp("timestamp").defaultNow(),
});

export const approvalWorkflowsRelations = relations(approvalWorkflows, ({ one, many }) => ({
  company: one(companies, {
    fields: [approvalWorkflows.companyId],
    references: [companies.id],
  }),
  job: one(jobs, {
    fields: [approvalWorkflows.relatedJobId],
    references: [jobs.id],
  }),
  client: one(clients, {
    fields: [approvalWorkflows.relatedClientId],
    references: [clients.id],
  }),
  creator: one(users, {
    fields: [approvalWorkflows.createdBy],
    references: [users.id],
  }),
  signatures: many(approvalSignatures),
  history: many(approvalHistory),
}));

export const approvalSignaturesRelations = relations(approvalSignatures, ({ one }) => ({
  workflow: one(approvalWorkflows, {
    fields: [approvalSignatures.workflowId],
    references: [approvalWorkflows.id],
  }),
}));

export const approvalHistoryRelations = relations(approvalHistory, ({ one }) => ({
  workflow: one(approvalWorkflows, {
    fields: [approvalHistory.workflowId],
    references: [approvalWorkflows.id],
  }),
  performedByUser: one(users, {
    fields: [approvalHistory.performedBy],
    references: [users.id],
  }),
}));

// Insert schemas
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompanyMemberSchema = createInsertSchema(companyMembers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Type definitions for role-based system
export type UserRole = 'owner' | 'worker';

export interface UserPermissions {
  canCreateJobs: boolean;
  canManageInvoices: boolean;
  canViewSchedule: boolean;
  canManageClients: boolean;
  canManageSubcontractors: boolean;
  canViewReports: boolean;
}

export const defaultOwnerPermissions: UserPermissions = {
  canCreateJobs: true,
  canManageInvoices: true,
  canViewSchedule: true,
  canManageClients: true,
  canManageSubcontractors: true,
  canViewReports: true,
};

export const defaultWorkerPermissions: UserPermissions = {
  canCreateJobs: false,
  canManageInvoices: false,
  canViewSchedule: true,
  canManageClients: false,
  canManageSubcontractors: false,
  canViewReports: false,
};

export const insertSubcontractorSchema = createInsertSchema(subcontractors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertJobPhotoSchema = createInsertSchema(jobPhotos).omit({
  id: true,
  createdAt: true,
});

export const insertApprovalWorkflowSchema = createInsertSchema(approvalWorkflows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertApprovalSignatureSchema = createInsertSchema(approvalSignatures).omit({
  id: true,
  createdAt: true,
  signedAt: true,
});

export const insertApprovalHistorySchema = createInsertSchema(approvalHistory).omit({
  id: true,
  timestamp: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Subcontractor = typeof subcontractors.$inferSelect;
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type JobPhoto = typeof jobPhotos.$inferSelect;
export type InsertJobPhoto = z.infer<typeof insertJobPhotoSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;
export type ApprovalWorkflow = typeof approvalWorkflows.$inferSelect;
export type InsertApprovalWorkflow = z.infer<typeof insertApprovalWorkflowSchema>;
export type ApprovalSignature = typeof approvalSignatures.$inferSelect;
export type InsertApprovalSignature = z.infer<typeof insertApprovalSignatureSchema>;
export type ApprovalHistory = typeof approvalHistory.$inferSelect;
export type InsertApprovalHistory = z.infer<typeof insertApprovalHistorySchema>;
