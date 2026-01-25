import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  unique,
  serial,
  integer,
  decimal,
  boolean,
  date,
  pgEnum,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Role enum for RBAC
export const roleEnum = pgEnum("role", ["OWNER", "SUPERVISOR", "TECHNICIAN", "DISPATCHER", "ESTIMATOR"]);

// Document visibility enum
export const documentVisibilityEnum = pgEnum("document_visibility", [
  "customer_internal",   // Visible to customers and all internal roles
  "assigned_crew_only",  // Only visible to assigned crew (Technicians, Supervisors)
  "office_only",         // Office staff only (not technicians in the field)
  "internal",            // All internal staff, not customer-facing
  "owner_only"           // Only Owner can see
]);

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
// Note: Email uniqueness is enforced by case-insensitive index users_email_lower_unique
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  password: varchar("password"), // For email-based authentication
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: varchar("email_verification_token"),
  resetPasswordToken: varchar("reset_password_token"),
  resetPasswordExpires: timestamp("reset_password_expires"),
  googleLinked: boolean("google_linked").default(false), // Track Google account linking
  stripeCustomerId: varchar("stripe_customer_id"),
  phone: varchar("phone"),
  addressLine1: varchar("address_line_1"),
  addressLine2: varchar("address_line_2"),
  city: varchar("city"),
  state: varchar("state"),
  postalCode: varchar("postal_code"),
  country: varchar("country").default("US"),
  status: varchar("status").default("ACTIVE").notNull(), // 'ACTIVE' | 'INACTIVE'
  tokenVersion: integer("token_version").default(0).notNull(), // For session invalidation
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Companies table for multi-tenant support
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  addressLine1: varchar("address_line_1"),
  addressLine2: varchar("address_line_2"),
  city: varchar("city"),
  state: varchar("state"),
  postalCode: varchar("postal_code"),
  country: varchar("country").default("US"),
  inviteCode: varchar("invite_code", { length: 20 }).notNull().unique(),
  inviteCodeVersion: integer("invite_code_version").default(0).notNull(),
  inviteCodeRotatedAt: timestamp("invite_code_rotated_at").defaultNow(),
  logo: varchar("logo"),
  logoFitMode: varchar("logo_fit_mode").default("contain"), // contain, cover, stretch
  licenseNumber: varchar("license_number"),
  defaultFooterText: text("default_footer_text"),
  industry: varchar("industry", { length: 100 }),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  primaryColor: varchar("primary_color").default("#2563EB"),
  secondaryColor: varchar("secondary_color").default("#059669"),
  autoClockOutTime: varchar("auto_clock_out_time", { length: 5 }).default("18:00"),
  ownerId: varchar("owner_id").notNull().references(() => users.id),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status").default("inactive"), // active, past_due, canceled, incomplete, trialing, inactive
  subscriptionPlan: varchar("subscription_plan"), // starter, professional, enterprise
  maxUsers: integer("max_users").default(1),
  trialEndsAt: timestamp("trial_ends_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Company members table - defines who works for which business
export const companyMembers = pgTable("company_members", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: roleEnum("role").notNull().default("TECHNICIAN"),
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

// Customers table - for estimate recipients
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"), // Street address line
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  companyName: varchar("company_name", { length: 255 }),
  companyNumber: varchar("company_number", { length: 100 }),
  jobTitle: varchar("job_title", { length: 100 }),
  notes: text("notes"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  geocodePrecision: varchar("geocode_precision", { length: 20 }), // 'exact' or 'approximate'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  companyIdx: index("customers_company_idx").on(table.companyId),
}));

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
  customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
  clientName: varchar("client_name", { length: 255 }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status").notNull().default("pending"), // pending, active, completed, cancelled
  paymentStatus: varchar("payment_status").notNull().default("unpaid"), // unpaid, partial, paid
  priority: varchar("priority").default("medium"), // low, medium, high, urgent
  startDate: date("start_date"),
  endDate: date("end_date"),
  estimatedCost: decimal("estimated_cost", { precision: 10, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 10, scale: 2 }),
  location: text("location"), // formatted address
  city: varchar("city"),
  postalCode: varchar("postal_code"),
  locationLat: decimal("location_lat", { precision: 10, scale: 8 }),
  locationLng: decimal("location_lng", { precision: 11, scale: 8 }),
  locationPlaceId: varchar("location_place_id"),
  notes: text("notes"),
  jobType: varchar("job_type", { length: 100 }), // Same job types as estimates
  assignedTo: varchar("assigned_to").references(() => users.id), // Assigned user/technician
  scheduledTime: varchar("scheduled_time", { length: 10 }), // HH:mm format, stored separately to avoid timezone issues
  scheduledEndTime: varchar("scheduled_end_time", { length: 10 }), // HH:mm format for end time
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Job line items table (mirrors estimate_items structure)
export const jobLineItems = pgTable("job_line_items", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  taskCode: varchar("task_code", { length: 50 }),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  unit: varchar("unit", { length: 50 }).notNull().default("each"),
  taxable: boolean("taxable").notNull().default(false),
  taxId: integer("tax_id").references(() => companyTaxes.id, { onDelete: "set null" }),
  taxRatePercentSnapshot: decimal("tax_rate_percent_snapshot", { precision: 5, scale: 3 }),
  taxNameSnapshot: varchar("tax_name_snapshot", { length: 40 }),
  lineTotalCents: integer("line_total_cents").notNull().default(0), // Subtotal (qty × price)
  taxCents: integer("tax_cents").notNull().default(0), // Calculated tax amount
  totalCents: integer("total_cents").notNull().default(0), // lineTotalCents + taxCents
  sortOrder: integer("sort_order").notNull().default(0),
});

// Job line items relations
export const jobLineItemsRelations = relations(jobLineItems, ({ one }) => ({
  job: one(jobs, {
    fields: [jobLineItems.jobId],
    references: [jobs.id],
  }),
}));

// Job assignments table (many-to-many relationship between jobs and subcontractors)
export const jobAssignments = pgTable("job_assignments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  subcontractorId: integer("subcontractor_id").notNull().references(() => subcontractors.id),
  assignedAt: timestamp("assigned_at").defaultNow(),
});

// Crew assignments table (many-to-many relationship between jobs and users/employees)
export const crewAssignments = pgTable("crew_assignments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  assignedAt: timestamp("assigned_at").defaultNow(),
  assignedBy: varchar("assigned_by").references(() => users.id),
}, (table) => ({
  uniqueJobUser: unique().on(table.jobId, table.userId),
}));

// Invoices table
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").references(() => customers.id),
  clientId: integer("client_id").references(() => clients.id),
  invoiceNumber: varchar("invoice_number").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  status: varchar("status").notNull().default("draft"), // draft, pending, sent, paid, overdue, cancelled
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  scheduledAt: timestamp("scheduled_at"),
  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>().default([]),
  lineItems: jsonb("line_items").$type<{
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    unit?: string;
    taxId?: number;
    taxRatePercentSnapshot?: number;
    taxNameSnapshot?: string;
  }[]>().default([]),
  pdfUrl: varchar("pdf_url"),
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Document categories
export const DOCUMENT_CATEGORIES = ['Contracts', 'Estimates', 'Invoices', 'Permits', 'Photos', 'Manuals', 'Other'] as const;
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number];

// Workflow categories (require status tracking)
export const WORKFLOW_CATEGORIES = ['Contracts', 'Estimates', 'Invoices', 'Permits'] as const;
export type WorkflowCategory = typeof WORKFLOW_CATEGORIES[number];

// Document statuses (only for workflow categories)
export const DOCUMENT_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected'] as const;
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];

// Documents table
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type"), // contract, permit, blueprint, receipt, photo
  category: varchar("category", { length: 50 }).notNull().default("Other"), // Contracts, Estimates, Invoices, Permits, Photos, Manuals, Other
  status: varchar("status", { length: 50 }).notNull().default("Draft"), // Draft, Pending Approval, Approved, Rejected
  visibility: documentVisibilityEnum("visibility").notNull().default("internal"), // Role-based visibility level
  fileUrl: varchar("file_url").notNull(),
  fileSize: integer("file_size"),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Conversations table for direct messages and group chats
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  isGroup: boolean("is_group").default(false).notNull(),
  pairKey: varchar("pair_key").notNull().unique(), // Deterministic key for 1:1 DMs (SHA-256 hash)
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdx: index("conversations_company_idx").on(table.companyId),
  pairKeyIdx: uniqueIndex("conversations_pair_key_idx").on(table.pairKey),
  updatedAtIdx: index("conversations_updated_at_idx").on(table.updatedAt.desc()),
}));

// Conversation participants table  
export const conversationParticipants = pgTable("conversation_participants", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at"),
  muted: boolean("muted").default(false).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (table) => ({
  conversationUserIdx: uniqueIndex("conversation_participants_conv_user_uniq").on(table.conversationId, table.userId),
  userIdx: index("conversation_participants_user_idx").on(table.userId),
}));

// Messages table for chat messages
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  body: text("body"),
  attachments: jsonb("attachments"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  conversationIdx: index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  senderIdx: index("messages_sender_idx").on(table.senderId),
}));

// Job Photos table for real-time progress tracking
export const jobPhotos = pgTable("job_photos", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
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
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method"), // cash, check, credit_card, bank_transfer, stripe, other
  status: varchar("status").notNull().default("pending"), // pending, completed, failed, refunded
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id"),
  paidDate: timestamp("paid_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Schedule items table for job scheduling
export const scheduleItems = pgTable("schedule_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  subcontractorId: integer("subcontractor_id").references(() => subcontractors.id),
  startDateTime: timestamp("start_date_time").notNull(),
  endDateTime: timestamp("end_date_time").notNull(),
  status: varchar("status").notNull().default("scheduled"), // scheduled, in-progress, completed, cancelled
  location: text("location"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  ownedCompanies: many(companies),
  companyMemberships: many(companyMembers),
  sentMessages: many(messages),
  conversationParticipants: many(conversationParticipants),
  createdConversations: many(conversations),
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
  conversations: many(conversations),
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
  crewAssignments: many(crewAssignments),
  invoices: many(invoices),
  documents: many(documents),
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

export const crewAssignmentsRelations = relations(crewAssignments, ({ one }) => ({
  job: one(jobs, {
    fields: [crewAssignments.jobId],
    references: [jobs.id],
  }),
  user: one(users, {
    fields: [crewAssignments.userId],
    references: [users.id],
  }),
  company: one(companies, {
    fields: [crewAssignments.companyId],
    references: [companies.id],
  }),
  assignedByUser: one(users, {
    fields: [crewAssignments.assignedBy],
    references: [users.id],
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
  estimate: one(estimates, {
    fields: [invoices.estimateId],
    references: [estimates.id],
  }),
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
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

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  company: one(companies, {
    fields: [conversations.companyId],
    references: [companies.id],
  }),
  creator: one(users, {
    fields: [conversations.createdById],
    references: [users.id],
  }),
  participants: many(conversationParticipants),
  messages: many(messages),
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationParticipants.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [conversationParticipants.userId],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
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

export const scheduleItemsRelations = relations(scheduleItems, ({ one }) => ({
  company: one(companies, {
    fields: [scheduleItems.companyId],
    references: [companies.id],
  }),
  job: one(jobs, {
    fields: [scheduleItems.jobId],
    references: [jobs.id],
  }),
  subcontractor: one(subcontractors, {
    fields: [scheduleItems.subcontractorId],
    references: [subcontractors.id],
  }),
}));

// Approval workflows table
export const approvalWorkflows = pgTable("approval_workflows", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull(), // 'estimate', 'change_order', 'authorization', 'other'
  status: varchar("status", { length: 50 }).notNull().default("draft"), // 'draft', 'sent', 'approved', 'declined'
  documentUrl: varchar("document_url", { length: 500 }), // Legacy - kept for backwards compatibility
  documentType: varchar("document_type", { length: 100 }), // 'pdf', 'image', 'link'
  relatedJobId: integer("related_job_id").references(() => jobs.id, { onDelete: "set null" }),
  relatedDocumentId: integer("related_document_id").references(() => documents.id, { onDelete: "set null" }),
  relatedClientId: integer("related_client_id").references(() => clients.id, { onDelete: "set null" }),
  customerName: varchar("customer_name", { length: 255 }),
  customerEmail: varchar("customer_email", { length: 255 }),
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
  document: one(documents, {
    fields: [approvalWorkflows.relatedDocumentId],
    references: [documents.id],
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

// Signature Requests table - Phase 1 of new e-signature system
export const signatureRequests = pgTable("signature_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }), // Derived from document's jobId
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }).notNull(),
  message: text("message"), // Optional message to include with signature request
  status: varchar("status", { length: 50 }).notNull().default("draft"), // draft, sent, viewed, signed, declined, expired, canceled
  provider: varchar("provider", { length: 50 }), // For future: docusign, hellosign, etc.
  providerRequestId: varchar("provider_request_id", { length: 255 }), // External provider's request ID
  signUrl: varchar("sign_url", { length: 500 }), // URL for customer to sign
  signedDocumentUrl: varchar("signed_document_url", { length: 500 }), // URL of signed document copy
  accessToken: varchar("access_token", { length: 255 }).unique(), // For secure access without login
  viewedAt: timestamp("viewed_at"),
  signedAt: timestamp("signed_at"),
  sentAt: timestamp("sent_at"), // When the request was marked as sent
  sentByUserId: varchar("sent_by_user_id").references(() => users.id), // Who sent the request
  deliveryStatus: varchar("delivery_status", { length: 50 }), // sent, failed
  deliveryError: text("delivery_error"), // Error message if delivery failed
  expiresAt: timestamp("expires_at"),
  signatureUrl: varchar("signature_url", { length: 500 }), // URL of stored signature image
  signedName: varchar("signed_name", { length: 255 }), // Name used when signing
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const signatureRequestsRelations = relations(signatureRequests, ({ one }) => ({
  company: one(companies, {
    fields: [signatureRequests.companyId],
    references: [companies.id],
  }),
  document: one(documents, {
    fields: [signatureRequests.documentId],
    references: [documents.id],
  }),
  job: one(jobs, {
    fields: [signatureRequests.jobId],
    references: [jobs.id],
  }),
  createdBy: one(users, {
    fields: [signatureRequests.createdByUserId],
    references: [users.id],
  }),
  sentBy: one(users, {
    fields: [signatureRequests.sentByUserId],
    references: [users.id],
  }),
}));

// Estimate status enum
export const estimateStatusEnum = pgEnum("estimate_status", ["draft", "sent", "accepted", "rejected", "approved"]);

// Estimates table - job-scoped estimates with line items (job_id optional for standalone estimates)
export const estimates = pgTable("estimates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }), // Nullable for standalone estimates
  customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
  estimateNumber: varchar("estimate_number", { length: 50 }).notNull(), // EST-000001, unique per company
  title: varchar("title", { length: 255 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }), // Snapshot field for history
  customerEmail: varchar("customer_email", { length: 255 }), // Snapshot field for history
  customerPhone: varchar("customer_phone", { length: 50 }), // Snapshot field for history
  customerAddress: text("customer_address"), // Snapshot field for history
  // Job location fields - snapshot of address for the estimate (independent of customer)
  jobAddressLine1: varchar("job_address_line1", { length: 255 }),
  jobCity: varchar("job_city", { length: 100 }),
  jobState: varchar("job_state", { length: 50 }),
  jobZip: varchar("job_zip", { length: 20 }),
  notes: text("notes"),
  jobType: varchar("job_type", { length: 100 }),
  status: estimateStatusEnum("status").notNull().default("draft"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  assignedEmployeeIds: jsonb("assigned_employee_ids").default([]),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Approval fields
  approvedAt: timestamp("approved_at"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  signatureDataUrl: text("signature_data_url"),
  scheduledDate: timestamp("scheduled_date"),
  scheduledTime: varchar("scheduled_time", { length: 10 }),
  scheduledEndTime: varchar("scheduled_end_time", { length: 10 }), // HH:mm format for end time
  // Unified field for requested schedule (ISO timestamp) - this is the source of truth
  requestedStartAt: timestamp("requested_start_at"),
  // Job conversion (idempotency - one estimate can only create one job)
  convertedJobId: integer("converted_job_id").references(() => jobs.id, { onDelete: "set null" }),
}, (table) => ({
  companyEstimateNumberIdx: uniqueIndex("estimates_company_number_uniq").on(table.companyId, table.estimateNumber),
  jobIdx: index("estimates_job_idx").on(table.jobId),
}));

// Estimate line items table
export const estimateItems = pgTable("estimate_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  taskCode: varchar("task_code", { length: 50 }),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  unit: varchar("unit", { length: 50 }).notNull().default("each"),
  taxable: boolean("taxable").notNull().default(false),
  taxId: integer("tax_id").references(() => companyTaxes.id, { onDelete: "set null" }),
  taxRatePercentSnapshot: decimal("tax_rate_percent_snapshot", { precision: 5, scale: 3 }),
  taxNameSnapshot: varchar("tax_name_snapshot", { length: 40 }),
  lineTotalCents: integer("line_total_cents").notNull().default(0), // Subtotal (qty × price)
  taxCents: integer("tax_cents").notNull().default(0), // Calculated tax amount
  totalCents: integer("total_cents").notNull().default(0), // lineTotalCents + taxCents
  sortOrder: integer("sort_order").notNull().default(0),
});

// Estimate relations
export const estimatesRelations = relations(estimates, ({ one, many }) => ({
  company: one(companies, {
    fields: [estimates.companyId],
    references: [companies.id],
  }),
  job: one(jobs, {
    fields: [estimates.jobId],
    references: [jobs.id],
  }),
  customer: one(customers, {
    fields: [estimates.customerId],
    references: [customers.id],
  }),
  createdBy: one(users, {
    fields: [estimates.createdByUserId],
    references: [users.id],
  }),
  approvedBy: one(users, {
    fields: [estimates.approvedByUserId],
    references: [users.id],
  }),
  items: many(estimateItems),
  attachments: many(estimateAttachments),
}));

// Customer relations
export const customersRelations = relations(customers, ({ one, many }) => ({
  company: one(companies, {
    fields: [customers.companyId],
    references: [companies.id],
  }),
  estimates: many(estimates),
}));

export const estimateItemsRelations = relations(estimateItems, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateItems.estimateId],
    references: [estimates.id],
  }),
}));

// Estimate attachments table
export const estimateAttachments = pgTable("estimate_attachments", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  uploadedByUserId: varchar("uploaded_by_user_id").notNull().references(() => users.id),
  fileUrl: text("file_url").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_attachments_estimate_idx").on(table.estimateId),
}));

export const estimateAttachmentsRelations = relations(estimateAttachments, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateAttachments.estimateId],
    references: [estimates.id],
  }),
  company: one(companies, {
    fields: [estimateAttachments.companyId],
    references: [companies.id],
  }),
  uploadedBy: one(users, {
    fields: [estimateAttachments.uploadedByUserId],
    references: [users.id],
  }),
}));

export const estimateDocuments = pgTable("estimate_documents", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull().default("pdf"),
  fileUrl: text("file_url").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_documents_estimate_idx").on(table.estimateId),
}));

export const estimateDocumentsRelations = relations(estimateDocuments, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateDocuments.estimateId],
    references: [estimates.id],
  }),
  company: one(companies, {
    fields: [estimateDocuments.companyId],
    references: [companies.id],
  }),
  createdBy: one(users, {
    fields: [estimateDocuments.createdByUserId],
    references: [users.id],
  }),
}));

// Company counters table for atomic counter increments
export const companyCounters = pgTable("company_counters", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }).unique(),
  estimateCounter: integer("estimate_counter").notNull().default(0),
  invoiceCounter: integer("invoice_counter").notNull().default(0),
});

// Service catalog items - reusable line item templates for estimates
export const serviceCatalogItems = pgTable("service_catalog_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  defaultPriceCents: integer("default_price_cents").notNull().default(0),
  unit: varchar("unit", { length: 50 }).notNull().default("each"), // each, hour, ft, sq_ft, job, day
  category: varchar("category", { length: 100 }),
  taskCode: varchar("task_code", { length: 50 }),
  taxable: boolean("taxable").notNull().default(false),
  isPreset: boolean("is_preset").default(false),
  presetIndustry: varchar("preset_industry", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  companyIdx: index("service_catalog_company_idx").on(table.companyId),
}));

// Service catalog relations
export const serviceCatalogItemsRelations = relations(serviceCatalogItems, ({ one }) => ({
  company: one(companies, {
    fields: [serviceCatalogItems.companyId],
    references: [companies.id],
  }),
}));

// Subscriptions table for tracking detailed subscription data
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  stripeSubscriptionId: varchar("stripe_subscription_id").unique().notNull(),
  stripePriceId: varchar("stripe_price_id").notNull(),
  status: varchar("status").notNull(), // active, past_due, canceled, incomplete, trialing
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  planName: varchar("plan_name").notNull(), // starter, professional, enterprise
  maxUsers: integer("max_users").notNull(),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }).notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  trialStart: timestamp("trial_start"),
  trialEnd: timestamp("trial_end"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompanyMemberSchema = createInsertSchema(companyMembers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Type definitions for role-based system
export type UserRole = "OWNER" | "SUPERVISOR" | "TECHNICIAN" | "DISPATCHER" | "ESTIMATOR";

export interface UserPermissions {
  canCreateJobs: boolean;
  canManageInvoices: boolean;
  canViewSchedule: boolean;
  canManageClients: boolean;
  canManageSubcontractors: boolean;
  canViewReports: boolean;
}

export const insertSubcontractorSchema = createInsertSchema(subcontractors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  companyId: true, // Backend adds this automatically from authenticated user
  createdAt: true,
  updatedAt: true,
}).extend({
  // Enhanced validation for required fields
  title: z.string().min(1, "Job title is required"),
  clientName: z.string().min(1, "Client name is required"),
  description: z.string().optional().transform(val => val || ""), // Ensure description is always a string
  // Location validation rules
  location: z.string().min(1, "Location is required"),
  city: z.string().optional().transform(val => val || ""),
  postalCode: z.string().optional().transform(val => val || ""),
  // Handle lat/lng as both numbers and strings (DB returns strings)
  locationLat: z.union([z.number(), z.string().transform(val => val ? parseFloat(val) : null)]).nullable().optional(),
  locationLng: z.union([z.number(), z.string().transform(val => val ? parseFloat(val) : null)]).nullable().optional(),
  locationPlaceId: z.string().optional().transform(val => val || ""),
  status: z.enum(["pending", "active", "completed", "cancelled"]).default("pending"),
  paymentStatus: z.enum(["unpaid", "partial", "paid"]).default("unpaid"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertConversationParticipantSchema = createInsertSchema(conversationParticipants).omit({
  id: true,
  joinedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
});

export const insertJobPhotoSchema = createInsertSchema(jobPhotos).omit({
  id: true,
  createdAt: true,
});

// Crew assignment insert schema
export const insertCrewAssignmentSchema = createInsertSchema(crewAssignments).omit({
  id: true,
  assignedAt: true,
});
export type InsertCrewAssignment = z.infer<typeof insertCrewAssignmentSchema>;
export type CrewAssignment = typeof crewAssignments.$inferSelect;

export const insertScheduleItemSchema = createInsertSchema(scheduleItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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

export const insertSignatureRequestSchema = createInsertSchema(signatureRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  viewedAt: true,
  signedAt: true,
  sentAt: true,
  sentByUserId: true,
});

// Estimate insert schemas
export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  companyId: true,
  estimateNumber: true,
  subtotalCents: true,
  taxCents: true,
  totalCents: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEstimateItemSchema = createInsertSchema(estimateItems).omit({
  id: true,
  estimateId: true,
  lineTotalCents: true,
  taxCents: true,
  totalCents: true,
});

// Create estimate with items schema (for API) - jobId is optional for standalone estimates
export const createEstimateSchema = z.object({
  jobId: z.number().positive().optional().nullable(),
  title: z.string().min(1, "Title is required"),
  customerId: z.number().positive().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerPhone: z.string().optional(),
  customerAddress: z.string().optional(),
  jobAddressLine1: z.string().optional(),
  jobCity: z.string().optional(),
  jobState: z.string().optional(),
  jobZip: z.string().optional(),
  notes: z.string().optional(),
  jobType: z.string().optional(),
  taxCents: z.number().int().min(0).optional().default(0),
  assignedEmployeeIds: z.array(z.string()).optional().default([]),
  // requestedStartAt is the single source of truth for estimate schedule (ISO string or Date)
  requestedStartAt: z.union([z.date(), z.string(), z.null()]).optional().nullable(),
  // Keep for backward compatibility but prefer requestedStartAt
  scheduledDate: z.union([z.date(), z.string(), z.null()]).optional().nullable(),
  scheduledTime: z.string().optional().nullable(),
  scheduledEndTime: z.string().optional().nullable(),
  items: z.array(z.object({
    name: z.string().min(1, "Item name is required"),
    description: z.string().nullable().optional(),
    taskCode: z.string().nullable().optional(),
    quantity: z.union([z.string(), z.number()]).transform(v => String(v)),
    unitPriceCents: z.number().int().min(0, "Unit price must be positive"),
    unit: z.string().optional().default("each"),
    taxable: z.boolean().optional().default(false),
    taxId: z.number().int().positive().nullable().optional(),
    taxRatePercentSnapshot: z.string().nullable().optional(),
    taxNameSnapshot: z.string().nullable().optional(),
    taxCents: z.number().int().min(0).optional(),
    sortOrder: z.number().int().optional(),
  })).min(1, "At least one line item is required"),
});

export const updateEstimateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  notes: z.string().optional(),
  status: z.enum(["draft", "sent", "accepted", "rejected"]).optional(),
  assignedEmployeeIds: z.array(z.string()).optional(),
  items: z.array(z.object({
    id: z.number().optional(), // Existing item ID for updates
    name: z.string().min(1, "Item name is required"),
    description: z.string().nullable().optional(),
    taskCode: z.string().nullable().optional(),
    quantity: z.union([z.string(), z.number()]).transform(v => String(v)),
    unitPriceCents: z.number().int().min(0, "Unit price must be positive"),
    unit: z.string().optional().default("each"),
    taxable: z.boolean().optional().default(false),
    taxId: z.number().int().positive().nullable().optional(),
    taxRatePercentSnapshot: z.string().nullable().optional(),
    taxNameSnapshot: z.string().nullable().optional(),
    taxCents: z.number().int().min(0).optional(),
    sortOrder: z.number().int().optional(),
  })).optional(),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Subcontractor = typeof subcontractors.$inferSelect;
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type InsertConversationParticipant = z.infer<typeof insertConversationParticipantSchema>;
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
export type ScheduleItem = typeof scheduleItems.$inferSelect;
export type InsertScheduleItem = z.infer<typeof insertScheduleItemSchema>;
export type SignatureRequest = typeof signatureRequests.$inferSelect;
export type InsertSignatureRequest = z.infer<typeof insertSignatureRequestSchema>;
export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type EstimateItem = typeof estimateItems.$inferSelect;
export type InsertEstimateItem = z.infer<typeof insertEstimateItemSchema>;
export type CreateEstimatePayload = z.infer<typeof createEstimateSchema>;
export type UpdateEstimatePayload = z.infer<typeof updateEstimateSchema>;
export type CompanyCounter = typeof companyCounters.$inferSelect;
export type ServiceCatalogItem = typeof serviceCatalogItems.$inferSelect;
export type InsertServiceCatalogItem = typeof serviceCatalogItems.$inferInsert;
export type EstimateAttachment = typeof estimateAttachments.$inferSelect;
export type InsertEstimateAttachment = typeof estimateAttachments.$inferInsert;
export type EstimateDocument = typeof estimateDocuments.$inferSelect;
export type InsertEstimateDocument = typeof estimateDocuments.$inferInsert;

// Estimate with items and attachments type
export interface EstimateWithItems extends Estimate {
  items: EstimateItem[];
  attachments?: EstimateAttachment[];
  createdBy?: { firstName: string | null; lastName: string | null } | null;
}

// Company Taxes table
export const companyTaxes = pgTable("company_taxes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 40 }).notNull(),
  ratePercent: decimal("rate_percent", { precision: 5, scale: 3 }).notNull(), // e.g., 8.625
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("company_taxes_company_name_unique").on(table.companyId, table.name),
]);

export const insertCompanyTaxSchema = createInsertSchema(companyTaxes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CompanyTax = typeof companyTaxes.$inferSelect;
export type InsertCompanyTax = z.infer<typeof insertCompanyTaxSchema>;

// Finalize Job Schema - for wizard completion (job + client + schedule)
export const finalizeJobSchema = z.object({
  job: insertJobSchema, // companyId already omitted
  client: z.union([
    z.object({
      mode: z.literal("existing"),
      id: z.number().positive("Client is required"),
    }),
    z.object({
      mode: z.literal("new"),
      data: insertClientSchema, // companyId already omitted
    }),
  ]),
  schedule: z.object({
    startDateTime: z.string().min(1, "Start date/time is required"),
    endDateTime: z.string().min(1, "End date/time is required"),
    location: z.string().optional(),
    notes: z.string().optional(),
    subcontractorId: z.number().optional().nullable(),
  }).refine((data) => {
    const start = new Date(data.startDateTime);
    const end = new Date(data.endDateTime);
    return end > start;
  }, {
    message: "End time must be after start time",
    path: ["endDateTime"],
  }),
});

export type FinalizeJobPayload = z.infer<typeof finalizeJobSchema>;

// Leads table - potential customers/jobs before conversion
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").references(() => customers.id),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  email: varchar("email"),
  phone: varchar("phone"),
  description: text("description"),
  notes: text("notes"),
  status: varchar("status", { length: 50 }).default("new").notNull(), // new, contacted, qualified, converted, lost
  addressLine1: varchar("address_line_1"),
  addressLine2: varchar("address_line_2"),
  city: varchar("city"),
  state: varchar("state"),
  postalCode: varchar("postal_code"),
  source: varchar("source", { length: 100 }), // e.g., "Website", "Referral", "Google Ads"
  estimatedValue: integer("estimated_value"), // in cents
  serviceType: varchar("service_type", { length: 100 }),
  preferredContactMethod: varchar("preferred_contact_method", { length: 50 }),
  convertedToCustomerId: integer("converted_to_customer_id").references(() => customers.id),
  convertedToJobId: integer("converted_to_job_id").references(() => jobs.id),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  lastContactedAt: timestamp("last_contacted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("leads_company_id_idx").on(table.companyId),
  index("leads_status_idx").on(table.status),
]);

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

// Time entry category enum
export const timeEntryCategoryEnum = pgEnum("time_entry_category", ["job", "shop", "drive", "admin", "break"]);

// Time tracking table for clock in/out
export const timeLogs = pgTable("time_logs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  jobId: integer("job_id").references(() => jobs.id),
  category: timeEntryCategoryEnum("category").default("job"),
  clockInAt: timestamp("clock_in_at").notNull(),
  clockOutAt: timestamp("clock_out_at"),
  date: date("date").notNull(),
  notes: text("notes"),
  autoClosed: boolean("auto_closed").default(false),
  autoClosedReason: varchar("auto_closed_reason", { length: 50 }),
  editedAt: timestamp("edited_at"),
  editedByUserId: varchar("edited_by_user_id").references(() => users.id),
  editReason: text("edit_reason"),
  originalClockInAt: timestamp("original_clock_in_at"),
  originalClockOutAt: timestamp("original_clock_out_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("time_logs_company_id_idx").on(table.companyId),
  index("time_logs_user_id_idx").on(table.userId),
  index("time_logs_date_idx").on(table.date),
  index("time_logs_job_id_idx").on(table.jobId),
]);

export const insertTimeLogSchema = createInsertSchema(timeLogs).omit({
  id: true,
  createdAt: true,
});

export type TimeLog = typeof timeLogs.$inferSelect;
export type InsertTimeLog = z.infer<typeof insertTimeLogSchema>;
export type TimeEntryCategory = "job" | "shop" | "drive" | "admin" | "break";
