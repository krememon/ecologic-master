import type { Express } from "express";
import { createServer, type Server, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { conversationRoom } from "./wsRooms";
import { setupAuth, isAuthenticated, getSessionMiddleware } from "./replitAuth";
import passport from "passport";
import { notifyUsers, notifyJobCrew, notifyManagers, notifyOwners, notifyOfficeStaff, notifyJobCrewAndManagers, notifyTechniciansOnly, notifyJobCrewAndOffice, createPaymentNotifications } from "./notificationService";
import { sendPushToUser } from "./pushService";
import { sendApnsPush, sendApnsPushToTokens } from "./apns";
import { sendSignatureRequestEmail, sendTestEmail, getAppBaseUrl, sendPaymentReceiptEmail, getResendFrom, sendSupportEmail } from "./email";
import { aiScopeAnalyzer } from "./ai-scope-analyzer";
import { persistRecomputedTotals, recomputeInvoiceTotalsFromPayments, recomputeJobPaymentAndMaybeArchive } from "./invoiceRecompute";
import { sendReceiptForPayment } from "./receiptService";
import { scrypt, randomBytes, timingSafeEqual, createHash, createHmac } from "crypto";

// Helper function to generate deterministic pairKey for 1:1 conversations (must match storage.ts)
function generatePairKey(companyId: number, userId1: string, userId2: string): string {
  const sorted = [userId1, userId2].sort();
  const str = `${companyId}:${sorted[0]}:${sorted[1]}`;
  return createHash('sha256').update(str).digest('hex');
}
import { promisify } from "util";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { Resend } from "resend";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "canvas";
import { aiScheduler } from "./ai-scheduler";
import * as stripeConnectService from "./services/stripeConnect";
import { insertJobSchema, finalizeJobSchema, insertCustomerSchema, insertScheduleEventSchema, type UserRole, companyMembers, jobs, scheduleItems, clients, customers, subcontractors, users, sessions, conversations, conversationParticipants, messages, signatureRequests, jobLineItems, companyCounters, estimates, crewAssignments } from "../shared/schema";
import { z } from "zod";
import { can, type Permission } from "../shared/permissions";
import { 
  canUploadCategory, 
  canUploadCompanyWide, 
  canDelete, 
  canChangeStatus, 
  canTransitionStatus, 
  canViewCompanyWideDocuments,
  getPermissionErrorMessage,
  requireJobForUpload,
  getAllowedVisibilities,
  canAccessAllJobs,
  type DocumentStatus,
  type DocumentVisibility
} from "../shared/documentPermissions";
import { db } from "./db";
import { eq, and, or, lt, gt, sql, desc, ilike, inArray } from "drizzle-orm";
import Stripe from "stripe";
import { invoices, payments, refunds, plaidAccounts, companies, stripeWebhookEvents, jobReferrals, subcontractPayoutAudit } from "../shared/schema";
import { plaidClient } from "./services/plaid";
import { encryptToken, decryptToken, isEncryptionAvailable } from "./utils/crypto";
import { Products, CountryCode } from "plaid";

// Initialize Stripe only if secret key is available and valid
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripeKeyPrefix = stripeSecretKey.slice(0, 7);

// Validate the key prefix at startup
if (stripeSecretKey && !stripeSecretKey.startsWith("sk_test_") && !stripeSecretKey.startsWith("sk_live_")) {
  console.error(`[stripe] ERROR: STRIPE_SECRET_KEY has invalid prefix "${stripeKeyPrefix}". Must start with sk_test_ or sk_live_`);
}

const stripe = stripeSecretKey && (stripeSecretKey.startsWith("sk_test_") || stripeSecretKey.startsWith("sk_live_"))
  ? new Stripe(stripeSecretKey, { apiVersion: "2025-04-30.basil" as any })
  : null;

if (stripe) {
  console.log(`[stripe] Initialized with key prefix: ${stripeKeyPrefix}`);
} else if (stripeSecretKey) {
  console.error(`[stripe] NOT initialized - invalid key prefix: ${stripeKeyPrefix}`);
}

// Subscription plans removed

const scryptAsync = promisify(scrypt);

async function tryArchiveCompletedPaidJob(jobId: number) {
  try {
    const job = await storage.getJob(jobId);
    if (!job) {
      console.log(`[JobArchive] Job ${jobId} not found, skipping archival`);
      return;
    }
    if (job.status === 'archived' || job.archivedAt) {
      console.log(`[JobArchive] Job ${jobId} already archived, skipping`);
      return;
    }
    const isPaid = job.paymentStatus === 'paid';
    console.log(`[JobArchive] Job ${jobId} check: status=${job.status}, paymentStatus=${job.paymentStatus}, paid=${isPaid}`);
    if (isPaid) {
      const now = new Date();
      await storage.updateJob(jobId, {
        status: 'archived',
        archivedAt: now,
        archivedReason: 'paid',
      } as any);
      console.log(`[JobArchive] Job ${jobId} auto-archived (paid)`);
    } else {
      console.log(`[JobArchive] Job ${jobId} NOT archived - not yet paid`);
    }
  } catch (err) {
    console.error(`[JobArchive] Error archiving job ${jobId}:`, err);
  }
}

// Format 24-hour time (HH:mm) to 12-hour format (h:mm AM/PM)
function formatTime12Hour(time24: string | null): string {
  if (!time24) return '9:00 AM';
  const [hoursStr, minsStr] = time24.split(':');
  let hours = parseInt(hoursStr, 10);
  const mins = minsStr || '00';
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${mins} ${ampm}`;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Logo-specific multer with stricter limits
const logoUpload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for logos
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG and JPG files are allowed'));
    }
  },
});

// Utility function to extract user ID consistently from different auth methods
function getUserId(user: any): string {
  if (user.claims && user.claims.sub) {
    return user.claims.sub;
  }
  return user.id || user.sub;
}

// Render simple HTML page for unsubscribe result
function renderUnsubscribePage({ success, error, channel = 'email' }: { success: boolean; error?: string; channel?: 'email' | 'sms' }): string {
  const channelLabel = channel === 'sms' ? 'text messages' : 'emails';
  const title = success ? 'Unsubscribed' : 'Unsubscribe Error';
  const message = success 
    ? `You have been successfully unsubscribed from marketing ${channelLabel}. You will no longer receive promotional messages from this company.`
    : (error || 'An error occurred while processing your request.');
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: white; padding: 40px; border-radius: 8px; max-width: 400px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { margin: 0 0 16px; font-size: 24px; color: ${success ? '#10b981' : '#ef4444'}; }
    p { color: #666; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${success ? '✓' : '⚠'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// Track connected WebSocket clients
const wsClients = new Map<string, Set<WebSocket>>();

// Track WebSocket rooms (conversation-based)
const wsRooms = new Map<string, Set<WebSocket>>();

// Extended WebSocket type with custom data
interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  rooms?: Set<string>;
}

function broadcastToUser(userId: string, message: any) {
  const userSockets = wsClients.get(userId);
  if (userSockets) {
    const messageStr = JSON.stringify(message);
    userSockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }
}

async function broadcastToCompany(companyId: number, message: any, excludeUserId?: string) {
  // Get all company members
  const members = await db
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(eq(companyMembers.companyId, companyId));
  
  const messageStr = JSON.stringify(message);
  
  // Broadcast to all members
  for (const member of members) {
    if (excludeUserId && member.userId === excludeUserId) {
      continue; // Skip the user who triggered the action
    }
    
    const userSockets = wsClients.get(member.userId);
    if (userSockets) {
      userSockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      });
    }
  }
}

async function sendPushNotification(userId: string, notification: any) {
  try {
    await sendPushToUser(userId, {
      title: notification.title || "EcoLogic",
      body: notification.body || "",
      data: {
        type: notification.type || "",
        entityType: notification.entityType || "",
        entityId: String(notification.entityId || ""),
        linkUrl: notification.linkUrl || "",
      },
    });
  } catch (err) {
    console.error("[push] sendPushNotification error for user:", userId, err);
  }
}

// Simple authentication middleware for protected routes
async function requireAuthentication(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

// Permission middleware for RBAC
function requirePerm(permissions: Permission | Permission[]) {
  return async (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = getUserId(req.user);
    const company = await storage.getUserCompany(userId);
    
    if (!company) {
      return res.status(403).json({ 
        code: 'NO_COMPANY',
        message: "No company access" 
      });
    }

    const userRole = await storage.getUserRole(userId, company.id);
    
    if (!userRole) {
      return res.status(403).json({ message: "No role assigned" });
    }

    const permsToCheck = Array.isArray(permissions) ? permissions : [permissions];
    const hasPermission = permsToCheck.some(perm => can(userRole.role, perm));

    if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    // Attach role and company to request for use in route handlers
    req.userRole = userRole.role;
    req.companyId = company.id;
    next();
  };
}

// Export for use in other modules
export { broadcastToCompany };

interface GeneratedInvoicePdf {
  filePath: string;
  fileUrl: string;
  fileName: string;
  invoiceNumber: string;
  totalCents: number;
}

async function generateInvoicePdfForJob(
  jobId: number,
  companyId: number,
  userId?: string,
): Promise<GeneratedInvoicePdf> {
  const job = await storage.getJob(jobId);
  if (!job || job.companyId !== companyId) {
    throw new Error('Job not found');
  }

  const company = await storage.getCompany(companyId);
  if (!company) throw new Error('Company not found');

  const lineItems = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)).orderBy(jobLineItems.sortOrder);
  if (!lineItems || lineItems.length === 0) {
    throw new Error('No line items on job');
  }

  let customer: any = null;
  if (job.customerId) {
    customer = await storage.getCustomer(job.customerId);
  } else if (job.clientId) {
    const client = await storage.getClient(job.clientId);
    if (client) {
      customer = {
        firstName: client.name?.split(' ')[0] || '',
        lastName: client.name?.split(' ').slice(1).join(' ') || '',
        email: client.email,
        phone: client.phone,
        address: client.address,
      };
    }
  }

  let invoiceNumber: string;
  const existingInvoice = await storage.getInvoiceByJobId(jobId, companyId);
  if (existingInvoice?.invoiceNumber) {
    invoiceNumber = existingInvoice.invoiceNumber;
  } else {
    try {
      const [counter] = await db
        .insert(companyCounters)
        .values({ companyId, estimateCounter: 0, invoiceCounter: 1 })
        .onConflictDoUpdate({
          target: companyCounters.companyId,
          set: { invoiceCounter: sql`${companyCounters.invoiceCounter} + 1` },
        })
        .returning();
      invoiceNumber = `INV-${String(counter.invoiceCounter).padStart(5, '0')}`;
    } catch (e) {
      const timestamp = Date.now().toString().slice(-6);
      invoiceNumber = `INV-${timestamp}`;
    }
  }

  const fileName = `Invoice_${invoiceNumber.replace(/-/g, '_')}.pdf`;
  const filePath = path.join('uploads', fileName);
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
  }

  let subtotalCents = 0;
  for (const item of lineItems) {
    subtotalCents += item.lineTotalCents || 0;
  }
  const subtotal = subtotalCents / 100;
  const total = subtotal;
  const invoiceDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const custName = customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : job.clientName || 'Customer';
  const custEmail = customer?.email || '';
  const custPhone = customer?.phone || '';
  const custAddress = customer?.address || job.location || '';

  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const MARGIN = 48;
  const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
  const LOGO_SIZE = 80;
  const HEADER_BOX_WIDTH = 180;
  const GRAY_LIGHT = '#F5F5F5';
  const GRAY_TEXT = '#666666';
  const GRAY_BORDER = '#E0E0E0';
  const BLACK = '#000000';
  const COL_SERVICE = MARGIN;
  const COL_QTY = 340;
  const COL_PRICE = 400;
  const COL_AMOUNT = 490;
  const TABLE_ROW_HEIGHT = 20;

  const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  let yPos = MARGIN;
  const leftColumnWidth = CONTENT_WIDTH - HEADER_BOX_WIDTH - 20;

  if (company.logo) {
    try {
      const logoPath = company.logo.startsWith('/') ? company.logo.substring(1) : company.logo;
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, MARGIN, yPos, { width: LOGO_SIZE, height: LOGO_SIZE });
        yPos += LOGO_SIZE + 8;
      }
    } catch (e) {}
  }

  doc.fontSize(16).font('Helvetica-Bold').fillColor(BLACK);
  doc.text(company.name, MARGIN, yPos, { width: leftColumnWidth });
  yPos += 20;
  doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
  if (company.addressLine1) {
    let addressLine = company.addressLine1;
    if (company.addressLine2) addressLine += ', ' + company.addressLine2;
    doc.text(addressLine, MARGIN, yPos, { width: leftColumnWidth });
    yPos += 13;
  }
  if (company.city || company.state || company.postalCode) {
    const cityLine = [company.city, company.state, company.postalCode].filter(Boolean).join(', ');
    doc.text(cityLine, MARGIN, yPos, { width: leftColumnWidth });
    yPos += 13;
  }
  if (company.phone) {
    doc.text(company.phone, MARGIN, yPos, { width: leftColumnWidth });
    yPos += 13;
  }
  if (company.email) {
    doc.text(company.email, MARGIN, yPos, { width: leftColumnWidth });
    yPos += 13;
  }

  const boxX = PAGE_WIDTH - MARGIN - HEADER_BOX_WIDTH;
  const boxPadding = 12;
  const boxHeight = 85;
  const boxY = MARGIN;
  doc.rect(boxX, boxY, HEADER_BOX_WIDTH, boxHeight).fillAndStroke(GRAY_LIGHT, GRAY_BORDER);
  let boxTextY = boxY + boxPadding;
  doc.fontSize(18).font('Helvetica-Bold').fillColor(BLACK);
  doc.text('INVOICE', boxX + boxPadding, boxTextY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
  boxTextY += 22;
  doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
  doc.text(`#${invoiceNumber}`, boxX + boxPadding, boxTextY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
  boxTextY += 16;
  doc.fontSize(9).font('Helvetica').fillColor(GRAY_TEXT);
  doc.text(`Date: ${invoiceDate}`, boxX + boxPadding, boxTextY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
  boxTextY += 14;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(BLACK);
  doc.text(`Total: $${total.toFixed(2)}`, boxX + boxPadding, boxTextY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
  yPos = Math.max(yPos, boxY + boxHeight) + 25;

  doc.fontSize(10).font('Helvetica-Bold').fillColor(BLACK);
  doc.text('BILL TO', MARGIN, yPos);
  yPos += 15;
  doc.fontSize(11).font('Helvetica').fillColor(BLACK);
  doc.text(custName, MARGIN, yPos);
  yPos += 14;
  doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
  if (custAddress) { doc.text(custAddress, MARGIN, yPos); yPos += 12; }
  if (custPhone) { doc.text(custPhone, MARGIN, yPos); yPos += 12; }
  if (custEmail) { doc.text(custEmail, MARGIN, yPos); yPos += 12; }
  yPos += 20;

  if (job.title) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor(BLACK);
    doc.text('JOB:', MARGIN, yPos);
    doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
    doc.text(job.title, MARGIN + 35, yPos);
    yPos += 15;
  }
  yPos += 10;

  doc.rect(MARGIN, yPos, CONTENT_WIDTH, 25).fillAndStroke(GRAY_LIGHT, GRAY_BORDER);
  yPos += 7;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(BLACK);
  doc.text('SERVICE', COL_SERVICE + 8, yPos);
  doc.text('QTY', COL_QTY, yPos, { width: 50, align: 'right' });
  doc.text('PRICE', COL_PRICE, yPos, { width: 70, align: 'right' });
  doc.text('AMOUNT', COL_AMOUNT, yPos, { width: 70, align: 'right' });
  yPos += 20;

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    if (i % 2 === 1) {
      doc.rect(MARGIN, yPos, CONTENT_WIDTH, TABLE_ROW_HEIGHT).fill(GRAY_LIGHT);
    }
    doc.fontSize(9).font('Helvetica').fillColor(BLACK);
    doc.text(item.name || 'Service', COL_SERVICE + 8, yPos + 5, { width: COL_QTY - COL_SERVICE - 20 });
    const qty = parseFloat(item.quantity) || 1;
    const unitPrice = (item.unitPriceCents || 0) / 100;
    const lineTotal = (item.lineTotalCents || 0) / 100;
    doc.text(qty.toString(), COL_QTY, yPos + 5, { width: 50, align: 'right' });
    doc.text(`$${unitPrice.toFixed(2)}`, COL_PRICE, yPos + 5, { width: 70, align: 'right' });
    doc.text(`$${lineTotal.toFixed(2)}`, COL_AMOUNT, yPos + 5, { width: 70, align: 'right' });
    yPos += TABLE_ROW_HEIGHT;
  }

  yPos += 15;
  doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
  doc.text('Subtotal:', COL_PRICE, yPos, { width: 70, align: 'right' });
  doc.text(`$${subtotal.toFixed(2)}`, COL_AMOUNT, yPos, { width: 70, align: 'right' });
  yPos += 15;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(BLACK);
  doc.text('TOTAL:', COL_PRICE, yPos, { width: 70, align: 'right' });
  doc.text(`$${total.toFixed(2)}`, COL_AMOUNT, yPos, { width: 70, align: 'right' });

  if (company.footerText) {
    doc.fontSize(9).font('Helvetica').fillColor(GRAY_TEXT);
    doc.text(company.footerText, MARGIN, PAGE_HEIGHT - MARGIN - 40, { width: CONTENT_WIDTH, align: 'center' });
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  const fileUrl = `/uploads/${fileName}`;

  if (userId) {
    await storage.createDocument({
      companyId,
      jobId,
      name: fileName,
      type: 'invoice',
      category: 'Invoices',
      status: 'Approved',
      visibility: 'internal',
      fileUrl,
      uploadedBy: userId,
    });
  }

  const today = new Date().toISOString().split('T')[0];
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  if (existingInvoice) {
    await storage.updateInvoice(existingInvoice.id, {
      pdfUrl: fileUrl,
    });
  } else {
    await storage.createInvoice({
      companyId,
      jobId,
      clientId: null,
      customerId: customer?.id || job.customerId || null,
      invoiceNumber,
      amount: total.toFixed(2),
      subtotalCents,
      taxCents: 0,
      totalCents: subtotalCents,
      status: 'pending',
      issueDate: today,
      dueDate,
      pdfUrl: fileUrl,
      notes: `Generated from job: ${job.title}`,
    });
  }

  return { filePath, fileUrl, fileName, invoiceNumber, totalCents: subtotalCents };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Note: uploads directory and static route handled in index.ts (before all middleware)

  // Redirect /auth to /login (no Replit auth screen)
  app.get('/auth', (req, res) => {
    res.redirect(302, '/login');
  });

  // STRIPE RETURN - Let SPA handle it (no server redirect)
  // The React StripeReturn page reads session_id from query params and polls for payment

  // Also handle /pay/* routes server-side for safety
  app.get('/pay/success', (req, res) => {
    console.log('[PaySuccess] Server-side hit:', req.originalUrl);
    res.redirect(302, '/jobs');
  });
  app.get('/pay/cancel', (req, res) => {
    console.log('[PayCancel] Server-side hit:', req.originalUrl);
    res.redirect(302, '/jobs');
  });

  // Auth middleware - MUST be set up before any authenticated routes
  await setupAuth(app);

  // General file upload endpoint (for logos, etc.)
  app.post('/api/upload', isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      console.log('[Upload] File received:', file.originalname, file.mimetype, file.size);

      // Generate a unique filename with original extension
      const ext = path.extname(file.originalname) || '.png';
      const newFilename = `${file.filename}${ext}`;
      const newPath = path.join('uploads', newFilename);
      
      // Rename to include extension
      fs.renameSync(file.path, newPath);

      const url = `/uploads/${newFilename}`;
      console.log('[Upload] File saved:', url);
      
      res.json({ url });
    } catch (error) {
      console.error('[Upload] Error:', error);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  });

  // Company logo upload endpoint - uploads file AND saves to company record
  app.post('/api/company/logo', isAuthenticated, (req: any, res, next) => {
    // Wrap multer to handle errors gracefully
    logoUpload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
        }
        if (err.message) {
          return res.status(400).json({ error: err.message });
        }
        return res.status(400).json({ error: 'Upload failed' });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Get user's company
      const company = await storage.getUserCompany(userId);
      if (!company) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(404).json({ error: 'Company not found' });
      }

      // Check if user is Owner/Admin
      const member = await storage.getCompanyMember(company.id, userId);
      if (!member || !['OWNER', 'SUPERVISOR'].includes(member.role.toUpperCase())) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(403).json({ error: 'Only Owner or Admin can upload company logo' });
      }

      // Generate a unique filename with original extension
      const ext = path.extname(file.originalname) || '.png';
      const newFilename = `company_${company.id}_logo_${Date.now()}${ext}`;
      const newPath = path.join('uploads', newFilename);
      
      // Rename to include extension
      fs.renameSync(file.path, newPath);

      const logoUrl = `/uploads/${newFilename}`;

      // Delete old logo file if exists
      if (company.logo) {
        const oldLogoPath = company.logo.startsWith('/') ? company.logo.substring(1) : company.logo;
        if (fs.existsSync(oldLogoPath)) {
          try { fs.unlinkSync(oldLogoPath); } catch (e) { /* ignore */ }
        }
      }

      // Update company with new logo URL
      await storage.updateCompany(company.id, { logo: logoUrl });
      
      res.json({ logoUrl });
    } catch (error) {
      console.error('[CompanyLogo] Error:', error);
      res.status(500).json({ error: 'Failed to upload logo' });
    }
  });

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      
      
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get user's company
      const company = await storage.getUserCompany(user.id);
      
      // Get user's role in the company (if they have one)
      let role: UserRole | null = null;
      if (company) {
        const userRole = await storage.getUserRole(user.id, company.id);
        if (userRole) {
          role = userRole.role;
        }
      }

      const isMobile = !!req.headers['authorization']?.startsWith('Bearer ');
      console.log(`[auth] ${isMobile ? 'mobile' : 'web'} app user fetched`, {
        userId,
        email: user.email,
        companyId: company?.id ?? null,
        role,
        onboardingChoice: user.onboardingChoice,
      });

      if (company) {
        console.log("[auth] companyId detected:", company.id);
      }

      const responseData = {
        ...user,
        role,
        company: company ? {
          id: company.id,
          name: company.name,
          logo: company.logo,
          primaryColor: company.primaryColor,
          secondaryColor: company.secondaryColor,
          onboardingCompleted: company.onboardingCompleted ?? false,
          subscriptionStatus: company.subscriptionStatus ?? 'inactive',
          subscriptionPlan: company.subscriptionPlan ?? null,
          teamSizeRange: company.teamSizeRange ?? null,
          maxUsers: company.maxUsers ?? 1,
          trialEndsAt: company.trialEndsAt,
          currentPeriodEnd: company.currentPeriodEnd ?? null,
        } : null
      };
      
      if (company) {
        console.log("[auth] redirecting to dashboard");
      }

      res.json(responseData);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get linked account methods
  app.get('/api/auth/linked-accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      console.log("Linked accounts endpoint - userId:", userId);
      
      const linkedAccounts = await storage.getLinkedAccountMethods(userId);
      console.log("Linked accounts result:", linkedAccounts);
      
      res.json(linkedAccounts);
    } catch (error) {
      console.error("Error fetching linked accounts:", error);
      res.status(500).json({ message: "Failed to fetch linked accounts" });
    }
  });

  // Google account linking route
  app.get('/api/auth/google/link', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      console.log("Starting Google account linking for user:", userId);
      
      // Store the linking intent in session
      req.session.linkingAccount = {
        userId: userId,
        userEmail: req.user.claims.email,
        action: 'link'
      };
      
      // Redirect to Google OAuth with linking parameters
      const googleAuthUrl = `/auth/google?link=true`;
      res.redirect(googleAuthUrl);
    } catch (error) {
      console.error("Error starting Google account linking:", error);
      res.status(500).json({ message: "Failed to start Google account linking" });
    }
  });

  // Set password for users who signed up with Google only
  app.post('/api/set-password', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { password } = req.body;

      if (!password || password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.password) {
        return res.status(400).json({ message: "Password already set for this account" });
      }

      const hashedPassword = await hashPassword(password);
      await storage.updateUser(user.id, { password: hashedPassword });

      res.json({ message: "Password set successfully" });
    } catch (error) {
      console.error("Error setting password:", error);
      res.status(500).json({ message: "Failed to set password" });
    }
  });

  // Update user profile
  app.patch('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { firstName, lastName, email, phone } = req.body;

      const updateData: any = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      
      // Validate and normalize email if provided
      if (email !== undefined) {
        const { normalizeEmail } = await import("@shared/emailUtils");
        const normalizedEmail = normalizeEmail(email);
        
        // Check if email is changing and if new email already exists
        const currentUser = await storage.getUser(userId);
        if (currentUser && currentUser.email !== normalizedEmail) {
          const existingUser = await storage.getUserByEmail(normalizedEmail);
          if (existingUser && existingUser.id !== userId) {
            return res.status(409).json({ 
              code: 'EMAIL_IN_USE',
              message: 'This email is currently in use' 
            });
          }
        }
        
        updateData.email = normalizedEmail;
      }
      
      // Validate and normalize phone if provided
      if (phone !== undefined) {
        if (phone === "" || phone === null) {
          // Allow clearing phone
          updateData.phone = null;
        } else {
          const { validatePhone, normalizePhone } = await import("@shared/phoneUtils");
          if (!validatePhone(phone)) {
            return res.status(400).json({ message: "Invalid phone number format" });
          }
          updateData.phone = normalizePhone(phone);
        }
      }

      const updatedUser = await storage.updateUser(userId, updateData);
      
      res.json(updatedUser);
    } catch (error: any) {
      console.error("Error updating user profile:", error);
      
      // Handle database unique constraint violation
      if (error.code === '23505' || error.message?.includes('unique constraint')) {
        return res.status(409).json({ 
          code: 'EMAIL_IN_USE',
          message: 'This email is currently in use' 
        });
      }
      
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Set onboarding choice (owner or employee)
  const onboardingChoiceSchema = z.object({
    choice: z.enum(["owner", "employee"])
  });
  
  app.post('/api/auth/onboarding-choice', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const parsed = onboardingChoiceSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid choice. Must be 'owner' or 'employee'" });
      }
      
      const { choice } = parsed.data;
      const updatedUser = await storage.updateUser(userId, { onboardingChoice: choice });
      
      res.json({ ok: true, onboardingChoice: updatedUser.onboardingChoice });
    } catch (error) {
      console.error("Error setting onboarding choice:", error);
      res.status(500).json({ message: "Failed to set onboarding choice" });
    }
  });

  // Company routes (Owner/Supervisor only)
  app.get('/api/company', requirePerm('org.view'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (company) {
        res.json({
          ...company,
          industry: company.industry || null,
          onboardingCompleted: company.onboardingCompleted ?? false,
        });
      } else {
        res.status(404).json({ message: "No company found" });
      }
    } catch (error) {
      console.error("Error fetching company:", error);
      res.status(500).json({ message: "Failed to fetch company" });
    }
  });

  // Get company info with invite code (Owner/Supervisor only)
  app.get('/api/company/info', requirePerm('org.view'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "No company found" });
      }

      res.json(company);
    } catch (error) {
      console.error("Error fetching company info:", error);
      res.status(500).json({ message: "Failed to fetch company info" });
    }
  });

  // Rotate company invite code (Owner only)
  app.post('/api/company/rotate-code', requirePerm('org.manage'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "No company found" });
      }

      // Generate new unique invite code
      const { generateUniqueInviteCode } = await import("@shared/inviteCode");
      const newCode = await generateUniqueInviteCode(async (code) => {
        const existing = await storage.getCompanyByInviteCode(code);
        return !!existing;
      });

      // Update company with new code
      const updatedCompany = await storage.rotateInviteCode(company.id, newCode);
      
      // Broadcast invite code rotation to company members
      await broadcastToCompany(company.id, {
        type: 'invite_code_rotated',
        data: {
          companyId: company.id,
          version: updatedCompany.inviteCodeVersion
        }
      });
      
      res.json({ 
        inviteCode: updatedCompany.inviteCode,
        inviteCodeVersion: updatedCompany.inviteCodeVersion,
        inviteCodeRotatedAt: updatedCompany.inviteCodeRotatedAt
      });
    } catch (error) {
      console.error("Error rotating invite code:", error);
      res.status(500).json({ message: "Failed to rotate invite code" });
    }
  });

  // Get company profile (Owner only)
  app.get('/api/company/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const company = await storage.getCompany(member.companyId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }
      
      res.json({
        name: company.name,
        logo: company.logo,
        logoFitMode: company.logoFitMode || 'contain',
        phone: company.phone,
        email: company.email,
        addressLine1: company.addressLine1,
        addressLine2: company.addressLine2,
        city: company.city,
        state: company.state,
        postalCode: company.postalCode,
        country: company.country,
        licenseNumber: company.licenseNumber,
        defaultFooterText: company.defaultFooterText,
        telnyxPhone: company.telnyxPhone || null,
      });
    } catch (error: any) {
      console.error('Error fetching company profile:', error);
      res.status(500).json({ error: 'Failed to fetch company profile' });
    }
  });

  // Update company profile (Owner only)
  app.patch('/api/company/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const { name, logo, logoFitMode, phone, email, addressLine1, addressLine2, city, state, postalCode, country, licenseNumber, defaultFooterText } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Company name is required' });
      }
      
      const updatedCompany = await storage.updateCompany(member.companyId, {
        name: name.trim(),
        logo: logo || null,
        logoFitMode: logoFitMode || 'contain',
        phone: phone || null,
        email: email || null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        city: city || null,
        state: state || null,
        postalCode: postalCode || null,
        country: country || null,
        licenseNumber: licenseNumber || null,
        defaultFooterText: defaultFooterText || null,
      });
      
      res.json({
        name: updatedCompany.name,
        logo: updatedCompany.logo,
        phone: updatedCompany.phone,
        email: updatedCompany.email,
        addressLine1: updatedCompany.addressLine1,
        addressLine2: updatedCompany.addressLine2,
        city: updatedCompany.city,
        state: updatedCompany.state,
        postalCode: updatedCompany.postalCode,
        country: updatedCompany.country,
        licenseNumber: updatedCompany.licenseNumber,
        defaultFooterText: updatedCompany.defaultFooterText,
      });
    } catch (error: any) {
      console.error('Error updating company profile:', error);
      res.status(500).json({ error: 'Failed to update company profile' });
    }
  });

  // =====================
  // Telnyx SMS Routes
  // =====================

  app.post('/api/company/telnyx-number', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (role !== 'OWNER' && role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only Owner or Admin can set the Telnyx number' });
      }

      const { telnyxPhone } = req.body;
      if (!telnyxPhone || !/^\+\d{10,15}$/.test(telnyxPhone)) {
        return res.status(400).json({ error: 'Invalid phone number. Use E.164 format (e.g. +13472840837)' });
      }

      const updated = await storage.updateCompany(company.id, { telnyxPhone });
      console.log(`[telnyx] company telnyx phone set last4=${telnyxPhone.slice(-4)} companyId=${company.id}`);
      res.json({ success: true, telnyxPhone: updated?.telnyxPhone || telnyxPhone });
    } catch (error: any) {
      console.error('[telnyx] Error setting telnyx number:', error);
      res.status(500).json({ error: 'Failed to set Telnyx number' });
    }
  });

  app.post('/api/sms/test-send', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (role !== 'OWNER' && role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only Owner or Admin can send test SMS' });
      }

      const fromPhone = company.telnyxPhone;
      if (!fromPhone) {
        return res.status(400).json({ error: 'Set your Telnyx number first before sending SMS' });
      }

      const { toPhone, text } = req.body;
      if (!toPhone || !text) {
        return res.status(400).json({ error: 'toPhone and text are required' });
      }

      let normalizedTo = toPhone.replace(/[^\d+]/g, '');
      if (normalizedTo.startsWith('+')) {
        // already E.164
      } else {
        const digits = normalizedTo.replace(/\D/g, '');
        if (digits.length === 10) {
          normalizedTo = '+1' + digits;
        } else if (digits.length === 11 && digits.startsWith('1')) {
          normalizedTo = '+' + digits;
        } else {
          normalizedTo = '+' + digits;
        }
      }

      if (!/^\+\d{10,15}$/.test(normalizedTo)) {
        return res.status(400).json({ error: `Invalid phone number format. Got: ${normalizedTo}` });
      }

      const apiKey = process.env.TELNYX_API_KEY;
      const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;

      if (!apiKey || !profileId) {
        return res.status(500).json({ error: 'Telnyx not configured. Set TELNYX_API_KEY and TELNYX_MESSAGING_PROFILE_ID.' });
      }

      const telnyxRes = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: fromPhone,
          to: normalizedTo,
          text,
          messaging_profile_id: profileId,
        }),
      });

      const telnyxBody = await telnyxRes.json().catch(() => ({}));

      if (telnyxRes.ok) {
        const msgId = (telnyxBody as any)?.data?.id || 'unknown';
        console.log(`[telnyx] test-send to=***${normalizedTo.slice(-4)} status=sent msgId=${msgId}`);
        res.json({ success: true, messageId: msgId, normalizedTo });
      } else {
        const errMsg = (telnyxBody as any)?.errors?.[0]?.detail || `Telnyx API error (${telnyxRes.status})`;
        console.log(`[telnyx] test-send FAILED to=***${normalizedTo.slice(-4)} status=${telnyxRes.status} error=${errMsg}`);
        res.status(400).json({ error: errMsg });
      }
    } catch (error: any) {
      console.error('[telnyx] Error sending test SMS:', error);
      res.status(500).json({ error: 'Failed to send test SMS' });
    }
  });

  // =====================
  // Company Time Settings Routes
  // =====================

  // Get auto clock-out time setting (Owners and Supervisors only)
  app.get('/api/company/time-settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      const role = member.role as UserRole;
      if (role === 'TECHNICIAN') {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const company = await storage.getCompany(member.companyId);
      res.json({
        autoClockOutTime: company?.autoClockOutTime || "18:00",
      });
    } catch (error: any) {
      console.error('Error getting time settings:', error);
      res.status(500).json({ error: 'Failed to get time settings' });
    }
  });

  // Update auto clock-out time setting (Owner only)
  app.patch('/api/company/time-settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const { autoClockOutTime } = req.body;
      
      // Validate time format (HH:MM)
      if (!autoClockOutTime || !/^\d{2}:\d{2}$/.test(autoClockOutTime)) {
        return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 18:00)' });
      }
      
      await storage.updateCompanyAutoClockOutTime(member.companyId, autoClockOutTime);
      
      res.json({ autoClockOutTime });
    } catch (error: any) {
      console.error('Error updating time settings:', error);
      res.status(500).json({ error: 'Failed to update time settings' });
    }
  });

  // =====================
  // Estimate Settings Routes
  // =====================
  app.get('/api/settings/estimates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(404).json({ error: 'Company not found' });

      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const company = await storage.getCompany(member.companyId);
      res.json({
        hideConvertedEstimates: company?.hideConvertedEstimates !== false,
      });
    } catch (error: any) {
      console.error('Error getting estimate settings:', error);
      res.status(500).json({ error: 'Failed to get estimate settings' });
    }
  });

  app.put('/api/settings/estimates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(404).json({ error: 'Company not found' });

      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { hideConvertedEstimates } = req.body;
      if (typeof hideConvertedEstimates !== 'boolean') {
        return res.status(400).json({ error: 'hideConvertedEstimates must be a boolean' });
      }

      await storage.updateCompany(member.companyId, { hideConvertedEstimates });
      res.json({ hideConvertedEstimates });
    } catch (error: any) {
      console.error('Error updating estimate settings:', error);
      res.status(500).json({ error: 'Failed to update estimate settings' });
    }
  });

  // =====================
  // Company Taxes Routes
  // =====================

  // Get company taxes (Owner only)
  app.get('/api/company/taxes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const taxes = await storage.getCompanyTaxes(member.companyId);
      res.json(taxes);
    } catch (error: any) {
      console.error('Error fetching company taxes:', error);
      res.status(500).json({ error: 'Failed to fetch company taxes' });
    }
  });

  // Create company tax (Owner only)
  app.post('/api/company/taxes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const { name, ratePercent } = req.body;
      
      // Validation: name
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Tax name is required' });
      }
      const trimmedName = name.trim();
      if (trimmedName.length < 2 || trimmedName.length > 40) {
        return res.status(400).json({ error: 'Tax name must be 2-40 characters' });
      }
      
      // Validation: ratePercent
      const rate = parseFloat(ratePercent);
      if (isNaN(rate) || rate < 0 || rate > 20) {
        return res.status(400).json({ error: 'Rate must be a number between 0 and 20' });
      }
      // Round to 3 decimal places
      const roundedRate = Math.round(rate * 1000) / 1000;
      
      // Create tax
      const tax = await storage.createCompanyTax({
        companyId: member.companyId,
        name: trimmedName,
        ratePercent: roundedRate.toString(),
      });
      
      res.status(201).json(tax);
    } catch (error: any) {
      console.error('Error creating company tax:', error);
      // Check for unique constraint violation (case-insensitive)
      if (error.code === '23505' || error.message?.includes('unique')) {
        return res.status(400).json({ error: 'A tax with this name already exists' });
      }
      res.status(500).json({ error: 'Failed to create company tax' });
    }
  });

  // Delete company tax (Owner only)
  app.delete('/api/company/taxes/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const taxId = parseInt(req.params.id);
      if (isNaN(taxId)) {
        return res.status(400).json({ error: 'Invalid tax ID' });
      }
      
      await storage.deleteCompanyTax(taxId);
      res.status(204).send();
    } catch (error: any) {
      console.error('Error deleting company tax:', error);
      res.status(500).json({ error: 'Failed to delete company tax' });
    }
  });

  // =====================
  // EMAIL BRANDING ROUTES
  // =====================

  // Get email branding settings (Owner only)
  app.get('/api/company/email-branding', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const company = await storage.getCompany(member.companyId);
      const branding = await storage.getEmailBranding(member.companyId);
      
      // Always return complete object with defaults (image-only header)
      res.json({
        headerBannerUrl: branding?.headerBannerUrl || null,
        fromName: branding?.fromName || company?.name || 'EcoLogic',
        replyToEmail: branding?.replyToEmail || company?.email || null,
        footerText: branding?.footerText || '',
        showPhone: branding?.showPhone ?? true,
        showAddress: branding?.showAddress ?? true,
      });
    } catch (error: any) {
      console.error('Error fetching email branding:', error);
      res.status(500).json({ error: 'Failed to fetch email branding' });
    }
  });

  // Update email branding settings (Owner only)
  app.put('/api/company/email-branding', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const {
        headerBannerUrl,
        fromName,
        replyToEmail,
        footerText,
        showPhone,
        showAddress,
      } = req.body;
      
      // Validate email format if provided
      if (replyToEmail && replyToEmail.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(replyToEmail)) {
          return res.status(400).json({ error: 'Invalid reply-to email format' });
        }
      }
      
      const branding = await storage.upsertEmailBranding(member.companyId, {
        headerBannerUrl: headerBannerUrl || null,
        fromName: fromName || null,
        replyToEmail: replyToEmail || null,
        footerText: footerText || null,
        showPhone: showPhone ?? true,
        showAddress: showAddress ?? true,
      });
      
      res.json(branding);
    } catch (error: any) {
      console.error('Error updating email branding:', error);
      res.status(500).json({ error: 'Failed to update email branding' });
    }
  });

  // Send test email with branding (Owner only)
  app.post('/api/company/email-branding/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const user = await storage.getUser(userId);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member || !user) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      if (!user.email) {
        return res.status(400).json({ error: 'No email address on your account' });
      }
      
      const company = await storage.getCompany(member.companyId);
      const branding = await storage.getEmailBranding(member.companyId);
      
      // Import messaging service
      const { messagingService } = await import('./services/messaging');
      
      // Build branded HTML (image-only header)
      const headerBannerUrl = branding?.headerBannerUrl || '';
      const footerText = branding?.footerText || '';
      const fromName = branding?.fromName || company?.name || 'EcoLogic';
      const showPhone = branding?.showPhone ?? true;
      const showAddress = branding?.showAddress ?? true;
      
      const footerParts: string[] = [];
      if (showPhone && company?.phone) {
        footerParts.push(`Phone: ${company.phone}`);
      }
      if (showAddress && company?.addressLine1) {
        const addr = [company.addressLine1, company.city, company.state, company.postalCode].filter(Boolean).join(', ');
        footerParts.push(addr);
      }
      if (footerText) {
        footerParts.push(footerText);
      }
      
      // Header is image-only: if no image, show nothing
      const headerHtml = headerBannerUrl 
        ? `<tr><td style="padding: 0; line-height: 0;"><img src="${headerBannerUrl}" alt="${fromName}" style="width: 100%; height: auto; display: block; border-radius: 8px 8px 0 0;" /></td></tr>`
        : '';
      
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; max-width: 100%;">
          ${headerHtml}
          <tr>
            <td style="padding: 30px;">
              <h2 style="margin: 0 0 20px 0; color: #333333;">Test Email</h2>
              <p style="margin: 0 0 15px 0; color: #555555; line-height: 1.6;">
                This is a test email from ${fromName} to preview your email branding settings.
              </p>
              <p style="margin: 0 0 15px 0; color: #555555; line-height: 1.6;">
                Your customers will see emails styled like this when you send campaigns.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                <tr>
                  <td style="background-color: #0d9488; border-radius: 6px; padding: 12px 24px;">
                    <span style="color: white; font-weight: 600; text-decoration: none;">Sample Button</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${footerParts.length > 0 ? `
          <tr>
            <td style="padding: 20px 30px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #888888; font-size: 12px; text-align: center; line-height: 1.8;">
                ${footerParts.join('<br />')}
              </p>
            </td>
          </tr>
          ` : ''}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
      
      // Send via Resend
      const result = await messagingService.sendEmail({
        to: user.email,
        subject: 'Test Email - Your Email Branding Preview',
        html,
        replyTo: branding?.replyToEmail || undefined,
        fromName: fromName,
      });
      
      if (result.success) {
        res.json({ success: true, message: `Test email sent to ${user.email}` });
      } else {
        res.status(500).json({ error: result.error || 'Failed to send test email' });
      }
    } catch (error: any) {
      console.error('Error sending test email:', error);
      res.status(500).json({ error: 'Failed to send test email' });
    }
  });

  // =====================
  // QUICKBOOKS INTEGRATION ROUTES
  // =====================

  const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
  const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
  // Ensure redirect URI includes the callback path
  const QB_BASE_URL = process.env.QB_REDIRECT_URI || '';
  const QB_REDIRECT_URI = QB_BASE_URL.includes('/api/integrations/quickbooks/callback') 
    ? QB_BASE_URL 
    : `${QB_BASE_URL.replace(/\/$/, '')}/api/integrations/quickbooks/callback`;
  const QB_ENV = process.env.QB_ENV || 'sandbox';
  
  const QB_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
  const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  const QB_API_BASE = QB_ENV === 'production' 
    ? 'https://quickbooks.api.intuit.com' 
    : 'https://sandbox-quickbooks.api.intuit.com';

  function createQboState(companyId: number): string {
    const payload = { c: companyId, t: Date.now() };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const secret = process.env.SESSION_SECRET || 'qbo-state-secret';
    const signature = createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${signature}`;
  }

  function verifyQboState(state: string): { companyId: number } | null {
    try {
      const [data, signature] = state.split('.');
      if (!data || !signature) return null;
      
      const secret = process.env.SESSION_SECRET || 'qbo-state-secret';
      const expectedSig = createHmac('sha256', secret).update(data).digest('base64url');
      if (signature !== expectedSig) return null;
      
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
      if (Date.now() - payload.t > 10 * 60 * 1000) return null;
      
      return { companyId: payload.c };
    } catch {
      return null;
    }
  }

  // Helper: Get valid QBO access token (refreshes if expired)
  async function getQboAccessToken(companyId: number): Promise<string | null> {
    const company = await storage.getCompany(companyId);
    if (!company?.qboRefreshToken) return null;
    
    const now = new Date();
    const expiresAt = company.qboTokenExpiresAt ? new Date(company.qboTokenExpiresAt) : null;
    
    // If token is still valid (with 5 min buffer), return it
    if (expiresAt && expiresAt.getTime() - 5 * 60 * 1000 > now.getTime() && company.qboAccessToken) {
      return company.qboAccessToken;
    }
    
    // Token expired, refresh it
    if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
      console.error('QuickBooks credentials not configured');
      return null;
    }
    
    try {
      const basicAuth = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');
      const response = await fetch(QB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: company.qboRefreshToken,
        }),
      });
      
      if (!response.ok) {
        console.error('Failed to refresh QBO token:', await response.text());
        return null;
      }
      
      const tokens = await response.json();
      const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      
      await storage.updateCompany(companyId, {
        qboAccessToken: tokens.access_token,
        qboRefreshToken: tokens.refresh_token,
        qboTokenExpiresAt: newExpiresAt,
      });
      
      return tokens.access_token;
    } catch (error) {
      console.error('Error refreshing QBO token:', error);
      return null;
    }
  }

  // Helper: Ensure EcoLogic customer is mapped to a QBO customer (idempotent)
  async function ensureQboCustomer(companyId: number, customerId: number): Promise<string | null> {
    const company = await storage.getCompany(companyId);
    if (!company?.qboRealmId) {
      console.error('[QB] ensureQboCustomer: Company not connected to QBO');
      return null;
    }

    const customer = await storage.getCustomer(customerId);
    if (!customer) {
      console.error('[QB] ensureQboCustomer: Customer not found');
      return null;
    }

    // If already mapped, return existing ID
    if (customer.qboCustomerId) {
      console.log('[QB] Customer already mapped to QBO:', customer.qboCustomerId);
      return customer.qboCustomerId;
    }

    const accessToken = await getQboAccessToken(companyId);
    if (!accessToken) {
      console.error('[QB] ensureQboCustomer: Could not get access token');
      return null;
    }

    // DisplayName: prefer Company Name, otherwise First + Last
    const displayName = customer.companyName?.trim() || `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer';
    
    try {
      // Search for existing QBO customer by DisplayName
      const searchQuery = encodeURIComponent(`DisplayName = '${displayName.replace(/'/g, "\\'")}'`);
      const searchResponse = await fetch(
        `${QB_API_BASE}/v3/company/${company.qboRealmId}/query?query=select * from Customer where ${searchQuery}`,
        {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        const existingCustomers = searchData.QueryResponse?.Customer || [];
        
        // Check for match by email if multiple results
        let matchedCustomer = existingCustomers.find((c: any) => 
          c.PrimaryEmailAddr?.Address?.toLowerCase() === customer.email?.toLowerCase()
        ) || existingCustomers[0];
        
        if (matchedCustomer) {
          console.log('[QB] Found existing QBO customer:', matchedCustomer.Id);
          await storage.updateCustomer(customerId, { qboCustomerId: matchedCustomer.Id });
          return matchedCustomer.Id;
        }
      }

      // Create new QBO customer
      console.log('[QB] Creating new QBO customer for:', displayName);
      const createResponse = await fetch(
        `${QB_API_BASE}/v3/company/${company.qboRealmId}/customer`,
        {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            DisplayName: displayName,
            GivenName: customer.firstName,
            FamilyName: customer.lastName,
            PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
            PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
            BillAddr: customer.address ? {
              Line1: customer.address,
              City: customer.city || undefined,
              CountrySubDivisionCode: customer.state || undefined,
              PostalCode: customer.zip || undefined,
            } : undefined,
            CompanyName: customer.companyName || undefined,
          }),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[QB] Failed to create QBO customer:', errorText);
        return null;
      }

      const createData = await createResponse.json();
      const qboCustomerId = createData.Customer?.Id;
      
      if (qboCustomerId) {
        console.log('[QB] Created QBO customer:', qboCustomerId);
        await storage.updateCustomer(customerId, { qboCustomerId });
        return qboCustomerId;
      }

      return null;
    } catch (error) {
      console.error('[QB] Error in ensureQboCustomer:', error);
      return null;
    }
  }

  // Helper function to get or create a default QuickBooks service item
  async function ensureQboServiceItem(companyId: number): Promise<{ value: string; name: string } | null> {
    const company = await storage.getCompany(companyId);
    if (!company?.qboRealmId) return null;

    const accessToken = await getQboAccessToken(companyId);
    if (!accessToken) return null;

    const itemName = 'EcoLogic Service';
    
    try {
      // Search for existing item
      const searchQuery = encodeURIComponent(`Name = '${itemName}'`);
      const searchResponse = await fetch(
        `${QB_API_BASE}/v3/company/${company.qboRealmId}/query?query=select * from Item where ${searchQuery}`,
        {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        const existingItem = searchData.QueryResponse?.Item?.[0];
        if (existingItem) {
          console.log('[QB] Found existing service item:', existingItem.Id);
          return { value: existingItem.Id, name: existingItem.Name };
        }
      }

      // Get an income account to use
      const accountQuery = encodeURIComponent("AccountType = 'Income'");
      const accountResponse = await fetch(
        `${QB_API_BASE}/v3/company/${company.qboRealmId}/query?query=select * from Account where ${accountQuery} MAXRESULTS 1`,
        {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      let incomeAccountId: string | null = null;
      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        incomeAccountId = accountData.QueryResponse?.Account?.[0]?.Id;
      }

      if (!incomeAccountId) {
        console.error('[QB] No income account found');
        return null;
      }

      // Create new service item
      console.log('[QB] Creating new service item:', itemName);
      const createResponse = await fetch(
        `${QB_API_BASE}/v3/company/${company.qboRealmId}/item`,
        {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            Name: itemName,
            Type: 'Service',
            IncomeAccountRef: { value: incomeAccountId },
          }),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[QB] Failed to create service item:', errorText);
        return null;
      }

      const createData = await createResponse.json();
      const newItem = createData.Item;
      if (newItem) {
        console.log('[QB] Created service item:', newItem.Id);
        return { value: newItem.Id, name: newItem.Name };
      }

      return null;
    } catch (error) {
      console.error('[QB] Error in ensureQboServiceItem:', error);
      return null;
    }
  }

  // Helper function to get or find "Undeposited Funds" account for QBO payments
  async function getDepositAccountRef(accessToken: string, realmId: string): Promise<{ value: string; name: string } | null> {
    try {
      const qboEnv = process.env.QB_ENV || 'sandbox';
      const baseUrl = qboEnv === 'production' 
        ? 'https://quickbooks.api.intuit.com' 
        : 'https://sandbox-quickbooks.api.intuit.com';

      // Query for "Undeposited Funds" account first
      const query = encodeURIComponent("SELECT * FROM Account WHERE Name = 'Undeposited Funds' AND AccountType = 'Other Current Asset'");
      const response = await fetch(
        `${baseUrl}/v3/company/${realmId}/query?query=${query}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.QueryResponse?.Account?.length > 0) {
          const account = data.QueryResponse.Account[0];
          console.log('[QB-PAY] Found Undeposited Funds account:', account.Id);
          return { value: account.Id, name: account.Name };
        }
      }

      // If not found, try to find any Bank account
      const bankQuery = encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 1");
      const bankResponse = await fetch(
        `${baseUrl}/v3/company/${realmId}/query?query=${bankQuery}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        }
      );

      if (bankResponse.ok) {
        const bankData = await bankResponse.json();
        if (bankData.QueryResponse?.Account?.length > 0) {
          const bankAccount = bankData.QueryResponse.Account[0];
          console.log('[QB-PAY] Using Bank account:', bankAccount.Id, bankAccount.Name);
          return { value: bankAccount.Id, name: bankAccount.Name };
        }
      }

      console.log('[QB-PAY] No deposit account found, will omit DepositToAccountRef');
      return null;
    } catch (error) {
      console.error('[QB-PAY] Error finding deposit account:', error);
      return null;
    }
  }

  // Helper function to sync payment to QuickBooks
  async function syncPaymentToQbo(paymentId: number, companyId: number): Promise<{ success: boolean; qboPaymentId?: string; error?: string }> {
    console.log('[QB-PAY] Payment sync triggered paymentId=' + paymentId);
    
    try {
      // Get payment with invoice
      const payment = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (!payment.length) {
        console.log('[QB-PAY] Payment not found paymentId=' + paymentId);
        return { success: false, error: 'Payment not found' };
      }
      const paymentRecord = payment[0];

      // Check if already synced (idempotent)
      if (paymentRecord.qboPaymentId) {
        console.log('[QB-PAY] Skipping, already synced qboPaymentId=' + paymentRecord.qboPaymentId);
        return { success: true, qboPaymentId: paymentRecord.qboPaymentId };
      }

      // Concurrency-safe: Check if another process is already syncing
      if (paymentRecord.qboPaymentSyncStatus === 'syncing') {
        console.log('[QB-PAY] Skipping, another process is syncing paymentId=' + paymentId);
        return { success: false, error: 'Already syncing in another process' };
      }

      // Atomic compare-and-set: Mark as "syncing" only if not already synced/syncing
      // Use .returning() to verify we actually updated the row
      const updateResult = await db.update(payments)
        .set({
          qboPaymentSyncStatus: 'syncing',
          updatedAt: new Date()
        })
        .where(
          and(
            eq(payments.id, paymentId),
            sql`(${payments.qboPaymentId} IS NULL)`,
            sql`(${payments.qboPaymentSyncStatus} IS NULL OR ${payments.qboPaymentSyncStatus} NOT IN ('syncing', 'synced'))`
          )
        )
        .returning({ id: payments.id });
      
      // If no rows were updated, another process got there first
      if (updateResult.length === 0) {
        console.log('[QB-PAY] Failed to acquire sync lock (no rows updated), checking if synced paymentId=' + paymentId);
        // Re-fetch to check if it was synced by another process
        const lockCheck = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
        if (lockCheck.length && lockCheck[0].qboPaymentId) {
          console.log('[QB-PAY] Already synced by another process qboPaymentId=' + lockCheck[0].qboPaymentId);
          return { success: true, qboPaymentId: lockCheck[0].qboPaymentId };
        }
        return { success: false, error: 'Could not acquire sync lock - another process is syncing' };
      }
      console.log('[QB-PAY] Acquired sync lock paymentId=' + paymentId);

      // Get company QB settings
      const company = await storage.getCompany(companyId);
      if (!company?.qboRealmId) {
        console.log('[QB-PAY] QuickBooks not connected for companyId=' + companyId);
        await db.update(payments).set({
          qboPaymentSyncStatus: 'failed',
          qboPaymentLastSyncError: 'QuickBooks not connected',
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
        return { success: false, error: 'QuickBooks not connected' };
      }

      // Get invoice to check if it's synced
      if (!paymentRecord.invoiceId) {
        console.log('[QB-PAY] Payment has no invoice paymentId=' + paymentId);
        await db.update(payments).set({
          qboPaymentSyncStatus: 'failed',
          qboPaymentLastSyncError: 'Payment has no invoice',
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
        return { success: false, error: 'Payment has no invoice' };
      }

      let invoice = await db.select().from(invoices).where(eq(invoices.id, paymentRecord.invoiceId)).limit(1);
      if (!invoice.length) {
        console.log('[QB-PAY] Invoice not found invoiceId=' + paymentRecord.invoiceId);
        await db.update(payments).set({
          qboPaymentSyncStatus: 'failed',
          qboPaymentLastSyncError: 'Invoice not found',
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
        return { success: false, error: 'Invoice not found' };
      }
      let invoiceRecord = invoice[0];

      console.log('[QB-PAY] invoice.qboInvoiceId=' + (invoiceRecord.qboInvoiceId || 'null') + ' qboPaymentId=' + (paymentRecord.qboPaymentId || 'null'));

      // If invoice not yet synced to QBO, try to sync it first
      if (!invoiceRecord.qboInvoiceId) {
        console.log('[QB-PAY] Invoice not synced, attempting auto-sync invoiceId=' + paymentRecord.invoiceId);
        const syncResult = await syncInvoiceToQuickBooks(paymentRecord.invoiceId, companyId);
        
        if (!syncResult.success) {
          console.log('[QB-PAY] Invoice sync failed, marking payment as waiting: ' + syncResult.error);
          await db.update(payments).set({
            qboPaymentSyncStatus: 'waiting',
            qboPaymentLastSyncError: 'Invoice sync failed: ' + (syncResult.error || 'Unknown'),
            updatedAt: new Date()
          }).where(eq(payments.id, paymentId));
          return { success: false, error: 'Invoice not synced - payment marked waiting' };
        }
        
        // Re-fetch invoice to get the qboInvoiceId
        invoice = await db.select().from(invoices).where(eq(invoices.id, paymentRecord.invoiceId)).limit(1);
        if (!invoice.length || !invoice[0].qboInvoiceId) {
          console.log('[QB-PAY] Invoice still missing qboInvoiceId after sync');
          await db.update(payments).set({
            qboPaymentSyncStatus: 'waiting',
            qboPaymentLastSyncError: 'Invoice sync succeeded but qboInvoiceId still missing',
            updatedAt: new Date()
          }).where(eq(payments.id, paymentId));
          return { success: false, error: 'Invoice sync incomplete' };
        }
        invoiceRecord = invoice[0];
        console.log('[QB-PAY] Invoice synced successfully qboInvoiceId=' + invoiceRecord.qboInvoiceId);
      }

      // Get customer for QBO customer ID
      let qboCustomerId: string | null = null;
      if (invoiceRecord.customerId) {
        const customer = await db.select().from(customers).where(eq(customers.id, invoiceRecord.customerId)).limit(1);
        if (customer.length && customer[0].qboCustomerId) {
          qboCustomerId = customer[0].qboCustomerId;
        }
      }

      if (!qboCustomerId) {
        console.log('[QB-PAY] Customer not synced to QuickBooks customerId=' + invoiceRecord.customerId);
        await db.update(payments).set({
          qboPaymentSyncStatus: 'failed',
          qboPaymentLastSyncError: 'Customer not synced to QuickBooks',
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
        return { success: false, error: 'Customer not synced to QuickBooks' };
      }

      // Get access token
      const accessToken = await getQboAccessToken(companyId);
      if (!accessToken) {
        console.log('[QB-PAY] Could not get QuickBooks access token');
        await db.update(payments).set({
          qboPaymentSyncStatus: 'failed',
          qboPaymentLastSyncError: 'Could not get QuickBooks access token',
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
        return { success: false, error: 'Could not get QuickBooks access token' };
      }

      const qboEnv = process.env.QB_ENV || 'sandbox';
      const baseUrl = qboEnv === 'production' 
        ? 'https://quickbooks.api.intuit.com' 
        : 'https://sandbox-quickbooks.api.intuit.com';

      // Calculate amount in dollars (2 decimal places)
      const amountDollars = paymentRecord.amountCents 
        ? Number((paymentRecord.amountCents / 100).toFixed(2))
        : Number(parseFloat(paymentRecord.amount).toFixed(2));

      // Get deposit account (Undeposited Funds or Bank)
      const depositAccountRef = await getDepositAccountRef(accessToken, company.qboRealmId);

      // Map EcoLogic payment method to QBO payment type
      let qboPaymentMethodRef: { value: string; name: string } | undefined;
      const method = paymentRecord.paymentMethod?.toLowerCase();
      if (method === 'cash') {
        qboPaymentMethodRef = { value: '1', name: 'Cash' };
      } else if (method === 'check') {
        qboPaymentMethodRef = { value: '2', name: 'Check' };
      } else if (method === 'credit_card' || method === 'stripe' || method === 'card') {
        qboPaymentMethodRef = { value: '3', name: 'Credit Card' };
      }

      // Create QBO Payment with linked invoice
      const qboPaymentData: any = {
        CustomerRef: { value: qboCustomerId },
        TotalAmt: amountDollars,
        TxnDate: new Date().toISOString().split('T')[0], // Today's date
        Line: [{
          Amount: amountDollars,
          LinkedTxn: [{
            TxnId: invoiceRecord.qboInvoiceId,
            TxnType: 'Invoice'
          }]
        }]
      };

      // Add deposit account if available
      if (depositAccountRef) {
        qboPaymentData.DepositToAccountRef = depositAccountRef;
      }

      if (qboPaymentMethodRef) {
        qboPaymentData.PaymentMethodRef = qboPaymentMethodRef;
      }

      // Set PaymentRefNum for de-duplication: prefer check number, then Stripe PaymentIntent ID
      if (paymentRecord.checkNumber) {
        qboPaymentData.PaymentRefNum = paymentRecord.checkNumber;
      } else if (paymentRecord.stripePaymentIntentId) {
        // Use Stripe PaymentIntent ID as reference for de-duplication
        qboPaymentData.PaymentRefNum = paymentRecord.stripePaymentIntentId;
      }

      // Add private note with EcoLogic payment info for audit trail
      const noteLines = [`EcoLogic Payment ID: ${paymentId}`];
      if (paymentRecord.stripePaymentIntentId) {
        noteLines.push(`Stripe: ${paymentRecord.stripePaymentIntentId}`);
      }
      qboPaymentData.PrivateNote = noteLines.join(' | ');

      console.log('[QB-PAY] Creating QBO payment payload:', JSON.stringify({
        CustomerRef: qboPaymentData.CustomerRef,
        TotalAmt: qboPaymentData.TotalAmt,
        TxnDate: qboPaymentData.TxnDate,
        LinkedTxnId: invoiceRecord.qboInvoiceId,
        DepositToAccountRef: depositAccountRef ? 'set' : 'omitted',
        PaymentMethodRef: qboPaymentMethodRef?.name || 'omitted'
      }));

      // QBO-side de-duplication: Check if payment with this PaymentRefNum already exists
      if (qboPaymentData.PaymentRefNum) {
        // Escape single quotes in PaymentRefNum to avoid QBO query errors
        const escapedPaymentRefNum = qboPaymentData.PaymentRefNum.replace(/'/g, "\\'");
        const dedupeQuery = encodeURIComponent(`SELECT * FROM Payment WHERE PaymentRefNum = '${escapedPaymentRefNum}'`);
        try {
          const dedupeResponse = await fetch(
            `${baseUrl}/v3/company/${company.qboRealmId}/query?query=${dedupeQuery}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
              }
            }
          );
          
          if (dedupeResponse.ok) {
            const dedupeData = await dedupeResponse.json();
            if (dedupeData.QueryResponse?.Payment?.length > 0) {
              const existingPayment = dedupeData.QueryResponse.Payment[0];
              console.log('[QB-PAY] Found existing QBO payment with PaymentRefNum, using existing: ' + existingPayment.Id);
              // Save the existing payment ID to our record
              await db.update(payments).set({
                qboPaymentId: existingPayment.Id,
                qboPaymentSyncStatus: 'synced',
                qboPaymentLastSyncError: null,
                qboPaymentLastSyncedAt: new Date(),
                updatedAt: new Date()
              }).where(eq(payments.id, paymentId));
              return { success: true, qboPaymentId: existingPayment.Id };
            }
          }
        } catch (dedupeError) {
          console.log('[QB-PAY] De-duplication check failed, proceeding with create:', dedupeError);
        }
      }

      const createResponse = await fetch(
        `${baseUrl}/v3/company/${company.qboRealmId}/payment`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(qboPaymentData)
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[QB-PAY] Payment creation failed status=' + createResponse.status + ':', errorText);
        await db.update(payments).set({
          qboPaymentSyncStatus: 'failed',
          qboPaymentLastSyncError: `QBO API error: ${createResponse.status}`,
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
        return { success: false, error: `QBO API error: ${createResponse.status}` };
      }

      const createData = await createResponse.json();
      const newQboPaymentId = createData.Payment?.Id;

      if (newQboPaymentId) {
        await db.update(payments).set({
          qboPaymentId: newQboPaymentId,
          qboPaymentSyncStatus: 'synced',
          qboPaymentLastSyncError: null,
          qboPaymentLastSyncedAt: new Date(),
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
        console.log('[QB-PAY] Created QBO payment: ' + newQboPaymentId);
        console.log('[QB-PAY] Saved qboPaymentId: ' + newQboPaymentId);
        return { success: true, qboPaymentId: newQboPaymentId };
      }

      console.log('[QB-PAY] No payment ID returned from QBO');
      await db.update(payments).set({
        qboPaymentSyncStatus: 'failed',
        qboPaymentLastSyncError: 'No payment ID returned from QBO',
        updatedAt: new Date()
      }).where(eq(payments.id, paymentId));
      return { success: false, error: 'No payment ID returned from QBO' };
    } catch (error: any) {
      console.error('[QB-PAY] Error syncing payment:', error);
      try {
        await db.update(payments).set({
          qboPaymentSyncStatus: 'failed',
          qboPaymentLastSyncError: error.message || 'Unknown error',
          updatedAt: new Date()
        }).where(eq(payments.id, paymentId));
      } catch {}
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  // GET /api/integrations/quickbooks/status - Check connection status
  app.get('/api/integrations/quickbooks/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const company = await storage.getCompany(member.companyId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }
      
      res.json({
        connected: !!company.qboRealmId && !!company.qboRefreshToken,
        connectedAt: company.qboConnectedAt,
        realmId: company.qboRealmId,
      });
    } catch (error: any) {
      console.error('Error checking QuickBooks status:', error);
      res.status(500).json({ error: 'Failed to check QuickBooks status' });
    }
  });

  // GET /api/integrations/quickbooks/connect - Initiate OAuth flow
  app.get('/api/integrations/quickbooks/connect', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      if (!QB_CLIENT_ID || !QB_REDIRECT_URI) {
        return res.status(500).json({ error: 'QuickBooks integration not configured' });
      }
      
      // Generate secure state token with embedded companyId
      const state = createQboState(member.companyId);
      console.log('[QB] Initiating OAuth for companyId:', member.companyId);
      console.log('[QB] QB_REDIRECT_URI:', QB_REDIRECT_URI);
      
      const authUrl = new URL(QB_AUTH_BASE);
      authUrl.searchParams.set('client_id', QB_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
      authUrl.searchParams.set('redirect_uri', QB_REDIRECT_URI);
      authUrl.searchParams.set('state', state);
      
      console.log('[QB] Full OAuth URL:', authUrl.toString());
      res.redirect(authUrl.toString());
    } catch (error: any) {
      console.error('Error initiating QuickBooks OAuth:', error);
      res.status(500).json({ error: 'Failed to initiate QuickBooks connection' });
    }
  });

  // GET /api/integrations/quickbooks/callback - OAuth callback
  app.get('/api/integrations/quickbooks/callback', async (req: any, res) => {
    console.log('[QB] CALLBACK HIT');
    console.log('[QB] Query params:', JSON.stringify(req.query));
    console.log('[QB] Full URL:', req.originalUrl);
    try {
      const { code, realmId, state, error: oauthError, error_description } = req.query;
      
      if (error_description) {
        console.error('[QB] Error description:', error_description);
      }
      
      if (oauthError) {
        console.error('[QB] OAuth error from Intuit:', oauthError);
        return res.redirect('/customize/quickbooks?error=oauth');
      }
      
      // Verify signed state token and extract companyId
      if (!state) {
        console.error('[QB] No state parameter');
        return res.redirect('/customize/quickbooks?error=state');
      }
      
      const stateData = verifyQboState(state as string);
      if (!stateData) {
        console.error('[QB] Invalid or expired state token');
        return res.redirect('/customize/quickbooks?error=state');
      }
      
      const { companyId } = stateData;
      console.log('[QB] Valid state for companyId:', companyId);
      
      if (!code || !realmId) {
        console.error('[QB] Missing code or realmId');
        return res.redirect('/customize/quickbooks?error=missing');
      }
      
      if (!QB_CLIENT_ID || !QB_CLIENT_SECRET || !QB_REDIRECT_URI) {
        console.error('[QB] QuickBooks credentials not configured');
        return res.redirect('/customize/quickbooks?error=config');
      }
      
      // Exchange code for tokens
      console.log('[QB] Exchanging code for tokens...');
      const basicAuth = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');
      const tokenResponse = await fetch(QB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: QB_REDIRECT_URI,
        }),
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[QB] Token exchange failed:', errorText);
        return res.redirect('/customize/quickbooks?error=token');
      }
      
      const tokens = await tokenResponse.json();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      console.log('[QB] Token exchange successful, saving to company:', companyId);
      
      // Store tokens in database
      await storage.updateCompany(companyId, {
        qboRealmId: realmId as string,
        qboAccessToken: tokens.access_token,
        qboRefreshToken: tokens.refresh_token,
        qboTokenExpiresAt: expiresAt,
        qboConnectedAt: new Date(),
      });
      
      console.log('[QB] Connection saved successfully');
      res.redirect('/customize/quickbooks?connected=true');
    } catch (error: any) {
      console.error('[QB] Error in callback:', error);
      res.redirect('/customize/quickbooks?error=unknown');
    }
  });

  // POST /api/integrations/quickbooks/test - Test QuickBooks connection
  app.post('/api/integrations/quickbooks/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const company = await storage.getCompany(member.companyId);
      if (!company?.qboRealmId) {
        return res.status(400).json({ error: 'QuickBooks not connected' });
      }
      
      const accessToken = await getQboAccessToken(member.companyId);
      if (!accessToken) {
        return res.status(400).json({ error: 'Unable to get access token' });
      }
      
      // Call QBO CompanyInfo endpoint to test connection
      const response = await fetch(
        `${QB_API_BASE}/v3/company/${company.qboRealmId}/companyinfo/${company.qboRealmId}`,
        {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[QB] Test connection failed:', errorText);
        return res.status(400).json({ error: 'Connection test failed' });
      }
      
      const data = await response.json();
      const companyName = data.CompanyInfo?.CompanyName || 'Unknown';
      
      res.json({ 
        success: true, 
        companyName,
        testedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error testing QuickBooks connection:', error);
      res.status(500).json({ error: 'Connection test failed' });
    }
  });

  // POST /api/integrations/quickbooks/disconnect - Disconnect QuickBooks
  app.post('/api/integrations/quickbooks/disconnect', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      await storage.updateCompany(member.companyId, {
        qboRealmId: null,
        qboAccessToken: null,
        qboRefreshToken: null,
        qboTokenExpiresAt: null,
        qboConnectedAt: null,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error disconnecting QuickBooks:', error);
      res.status(500).json({ error: 'Failed to disconnect QuickBooks' });
    }
  });

  // Shared function to sync invoice to QuickBooks (used by manual endpoint and auto-sync)
  async function syncInvoiceToQuickBooks(invoiceId: number, companyId: number): Promise<{ success: boolean; qboInvoiceId?: string; alreadySynced?: boolean; error?: string }> {
    try {
      const company = await storage.getCompany(companyId);
      if (!company?.qboRealmId) {
        return { success: false, error: 'QuickBooks not connected' };
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice || invoice.companyId !== companyId) {
        return { success: false, error: 'Invoice not found' };
      }
      
      console.log('[QB] Loaded invoice qboInvoiceId:', invoice.qboInvoiceId);
      
      // Idempotent: if already synced, return existing ID
      if (invoice.qboInvoiceId) {
        console.log('[QB] Already synced, skipping create. qboInvoiceId:', invoice.qboInvoiceId);
        return { success: true, qboInvoiceId: invoice.qboInvoiceId, alreadySynced: true };
      }
      
      console.log('[QB] Creating QBO invoice now...');
      
      // Resolve customer: invoice.customerId → job.customerId → fail
      let resolvedCustomerId = invoice.customerId;
      if (!resolvedCustomerId && invoice.jobId) {
        const job = await storage.getJob(invoice.jobId);
        if (job?.customerId) {
          resolvedCustomerId = job.customerId;
          console.log('[QB] Using customer from job:', resolvedCustomerId);
        }
      }
      
      if (!resolvedCustomerId) {
        await storage.updateInvoice(invoiceId, {
          qboSyncStatus: 'failed',
          qboLastSyncError: 'Invoice has no customer',
          qboLastSyncedAt: new Date(),
        });
        return { success: false, error: 'Invoice has no customer' };
      }
      
      const qboCustomerId = await ensureQboCustomer(companyId, resolvedCustomerId);
      if (!qboCustomerId) {
        await storage.updateInvoice(invoiceId, {
          qboSyncStatus: 'failed',
          qboLastSyncError: 'Failed to create/find QBO customer',
          qboLastSyncedAt: new Date(),
        });
        return { success: false, error: 'Failed to create QBO customer' };
      }
      
      const accessToken = await getQboAccessToken(companyId);
      if (!accessToken) {
        await storage.updateInvoice(invoiceId, {
          qboSyncStatus: 'failed',
          qboLastSyncError: 'Failed to get access token',
          qboLastSyncedAt: new Date(),
        });
        return { success: false, error: 'Unable to get access token' };
      }
      
      // Fetch line items
      let actualLineItems = invoice.lineItems || [];
      if (actualLineItems.length === 0 && invoice.jobId) {
        const jobLineItemsResult = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, invoice.jobId));
        actualLineItems = jobLineItemsResult.map(item => ({
          name: item.name,
          description: item.description,
          quantity: parseFloat(item.quantity) || 1,
          unitPriceCents: item.unitPriceCents || 0,
          unit: item.unit,
        }));
        console.log('[QB] Fetched', actualLineItems.length, 'line items from job_line_items');
      }
      
      const serviceItem = await ensureQboServiceItem(companyId);
      if (!serviceItem) {
        await storage.updateInvoice(invoiceId, {
          qboSyncStatus: 'failed',
          qboLastSyncError: 'Failed to create QuickBooks service item',
          qboLastSyncedAt: new Date(),
        });
        return { success: false, error: 'Failed to create QuickBooks service item' };
      }
      
      // Build QBO line items
      const qboLines: any[] = actualLineItems
        .filter((item: any) => {
          const qty = parseFloat(item.quantity) || 1;
          const unitPrice = item.unitPriceCents ? item.unitPriceCents / 100 : (parseFloat(item.unitPrice) || 0);
          return qty * unitPrice > 0;
        })
        .map((item: any, idx: number) => {
          const qty = parseFloat(item.quantity) || 1;
          const unitPrice = item.unitPriceCents ? item.unitPriceCents / 100 : (parseFloat(item.unitPrice) || 0);
          return {
            LineNum: idx + 1,
            Amount: qty * unitPrice,
            DetailType: 'SalesItemLineDetail',
            Description: item.description || item.name || 'Service',
            SalesItemLineDetail: { ItemRef: serviceItem, Qty: qty, UnitPrice: unitPrice },
          };
        });
      
      // Fallback to total if no line items
      if (qboLines.length === 0) {
        const totalAmount = invoice.totalCents ? invoice.totalCents / 100 : parseFloat(invoice.amount) || 0;
        if (totalAmount > 0) {
          qboLines.push({
            LineNum: 1,
            Amount: totalAmount,
            DetailType: 'SalesItemLineDetail',
            Description: `Invoice ${invoice.invoiceNumber}`,
            SalesItemLineDetail: { ItemRef: serviceItem, Qty: 1, UnitPrice: totalAmount },
          });
        } else {
          await storage.updateInvoice(invoiceId, {
            qboSyncStatus: 'failed',
            qboLastSyncError: 'Invoice has no line items or amount',
            qboLastSyncedAt: new Date(),
          });
          return { success: false, error: 'Invoice has no line items or amount' };
        }
      }
      
      console.log('[QB] Creating invoice for customer:', qboCustomerId, 'lines:', qboLines.length);
      const createResponse = await fetch(
        `${QB_API_BASE}/v3/company/${company.qboRealmId}/invoice`,
        {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            CustomerRef: { value: qboCustomerId },
            DocNumber: invoice.invoiceNumber,
            TxnDate: invoice.issueDate,
            DueDate: invoice.dueDate,
            Line: qboLines,
            PrivateNote: `EcoLogic Invoice ${invoice.invoiceNumber}`,
          }),
        }
      );
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[QB] Failed to create invoice:', errorText);
        await storage.updateInvoice(invoiceId, {
          qboSyncStatus: 'failed',
          qboLastSyncError: errorText.substring(0, 500),
          qboLastSyncedAt: new Date(),
        });
        return { success: false, error: 'Failed to create QBO invoice' };
      }
      
      const createData = await createResponse.json();
      const qboInvoiceId = createData.Invoice?.Id;
      
      if (qboInvoiceId) {
        console.log('[QB] Created invoice:', qboInvoiceId);
        await storage.updateInvoice(invoiceId, {
          qboInvoiceId,
          qboSyncStatus: 'synced',
          qboLastSyncError: null,
          qboLastSyncedAt: new Date(),
        });
        
        // Sync waiting payments (non-blocking)
        db.select().from(payments)
          .where(and(eq(payments.invoiceId, invoiceId), eq(payments.qboPaymentSyncStatus, 'waiting')))
          .then(waitingPayments => {
            waitingPayments.forEach(p => {
              syncPaymentToQbo(p.id, companyId).catch(err => console.error('[QB] Payment sync error:', err));
            });
          }).catch(() => {});
        
        return { success: true, qboInvoiceId };
      }
      
      await storage.updateInvoice(invoiceId, {
        qboSyncStatus: 'failed',
        qboLastSyncError: 'No invoice ID returned',
        qboLastSyncedAt: new Date(),
      });
      return { success: false, error: 'No invoice ID returned from QBO' };
    } catch (error: any) {
      console.error('[QB] Error syncing invoice:', error);
      try {
        await storage.updateInvoice(invoiceId, {
          qboSyncStatus: 'failed',
          qboLastSyncError: error.message?.substring(0, 500) || 'Unknown error',
          qboLastSyncedAt: new Date(),
        });
      } catch {}
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  // POST /api/integrations/quickbooks/sync-invoice/:id - Sync invoice to QuickBooks
  app.post('/api/integrations/quickbooks/sync-invoice/:id', isAuthenticated, async (req: any, res) => {
    const invoiceId = parseInt(req.params.id);
    console.log('[QB] Sync endpoint hit for invoiceId:', invoiceId);
    
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const result = await syncInvoiceToQuickBooks(invoiceId, member.companyId);
      
      if (result.success) {
        return res.json(result);
      } else {
        return res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[QB] Error in sync endpoint:', error);
      res.status(500).json({ error: 'Failed to sync invoice' });
    }
  });

  // =====================
  // LEADS ROUTES
  // =====================

  // Get all leads for company
  app.get('/api/leads', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'leads.view')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const leads = await storage.getLeads(member.companyId);
      res.json(leads);
    } catch (error: any) {
      console.error('Error fetching leads:', error);
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  });

  // Get single lead
  app.get('/api/leads/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'leads.view')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const leadId = parseInt(req.params.id);
      if (isNaN(leadId)) {
        return res.status(400).json({ error: 'Invalid lead ID' });
      }
      
      const lead = await storage.getLead(leadId);
      console.log('[DEBUG] getLead result:', JSON.stringify(lead, null, 2));
      if (!lead || lead.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      res.json(lead);
    } catch (error: any) {
      console.error('Error fetching lead:', error);
      res.status(500).json({ error: 'Failed to fetch lead' });
    }
  });

  // Create lead
  app.post('/api/leads', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'leads.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const leadData = {
        ...req.body,
        createdByUserId: userId,
      };
      
      const lead = await storage.createLead(member.companyId, leadData);
      console.log('[Leads] created', { leadId: lead.id, companyId: member.companyId, userId });
      res.status(201).json(lead);
    } catch (error: any) {
      console.error('Error creating lead:', error);
      res.status(500).json({ error: 'Failed to create lead' });
    }
  });

  // Update lead
  app.patch('/api/leads/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'leads.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const leadId = parseInt(req.params.id);
      if (isNaN(leadId)) {
        return res.status(400).json({ error: 'Invalid lead ID' });
      }
      
      const existingLead = await storage.getLead(leadId);
      if (!existingLead || existingLead.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      const lead = await storage.updateLead(leadId, req.body);
      console.log('[Leads] updated', { leadId, userId });
      res.json(lead);
    } catch (error: any) {
      console.error('Error updating lead:', error);
      res.status(500).json({ error: 'Failed to update lead' });
    }
  });

  // Delete lead
  app.delete('/api/leads/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (!can(member.role as UserRole, 'leads.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const leadId = parseInt(req.params.id);
      if (isNaN(leadId)) {
        return res.status(400).json({ error: 'Invalid lead ID' });
      }
      
      const existingLead = await storage.getLead(leadId);
      if (!existingLead || existingLead.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      await storage.deleteLead(leadId);
      console.log('[Leads] deleted', { leadId, userId });
      res.status(204).send();
    } catch (error: any) {
      console.error('Error deleting lead:', error);
      res.status(500).json({ error: 'Failed to delete lead' });
    }
  });

  // =====================
  // Time tracking endpoints
  // =====================
  
  const normalizeCategory = (cat: string | null | undefined): string | null => {
    if (!cat) return null;
    return cat === 'admin' ? 'work' : cat;
  };

  // Get time data for today (role-aware response)
  app.get('/api/time/today', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      // Auto-close any expired time entries before returning data
      await storage.autoCloseExpiredTimeEntries(userId, member.companyId);
      
      const today = new Date().toISOString().split('T')[0];
      const role = member.role as UserRole;
      const now = Date.now();
      
      if (role === 'TECHNICIAN') {
        const logs = await storage.getUserTimeLogsToday(userId, member.companyId, today);
        const activeLogWithJob = await storage.getActiveTimeLogWithJob(userId, member.companyId);
        
        let totalMinutes = 0;
        for (const log of logs) {
          const start = new Date(log.clockInAt).getTime();
          const end = log.clockOutAt ? new Date(log.clockOutAt).getTime() : now;
          totalMinutes += (end - start) / 60000;
        }
        
        return res.json({
          role: 'technician',
          isClockedIn: !!activeLogWithJob,
          clockedInAt: activeLogWithJob?.clockInAt || null,
          hoursToday: Math.round(totalMinutes / 60 * 100) / 100,
          currentJobId: activeLogWithJob?.jobId || null,
          currentJobTitle: activeLogWithJob?.job?.title || null,
          currentCategory: normalizeCategory(activeLogWithJob?.category),
        });
      }
      
      const allLogs = await storage.getCompanyTimeLogsToday(member.companyId, today);
      
      const clockedInUsers = new Set<string>();
      let totalMinutes = 0;
      
      for (const log of allLogs) {
        const start = new Date(log.clockInAt).getTime();
        const end = log.clockOutAt ? new Date(log.clockOutAt).getTime() : now;
        totalMinutes += (end - start) / 60000;
        
        if (!log.clockOutAt) {
          clockedInUsers.add(log.userId);
        }
      }
      
      const myActiveLogWithJob = await storage.getActiveTimeLogWithJob(userId, member.companyId);
      const myLogs = await storage.getUserTimeLogsToday(userId, member.companyId, today);
      let myMinutes = 0;
      for (const log of myLogs) {
        const start = new Date(log.clockInAt).getTime();
        const end = log.clockOutAt ? new Date(log.clockOutAt).getTime() : now;
        myMinutes += (end - start) / 60000;
      }
      
      return res.json({
        role: 'manager',
        totalHoursToday: Math.round(totalMinutes / 60 * 100) / 100,
        activeTechCount: clockedInUsers.size,
        isClockedIn: !!myActiveLogWithJob,
        clockedInAt: myActiveLogWithJob?.clockInAt || null,
        myHoursToday: Math.round(myMinutes / 60 * 100) / 100,
        currentJobId: myActiveLogWithJob?.jobId || null,
        currentJobTitle: myActiveLogWithJob?.job?.title || null,
        currentCategory: normalizeCategory(myActiveLogWithJob?.category),
        activeLog: myActiveLogWithJob ? {
          id: myActiveLogWithJob.id,
          jobId: myActiveLogWithJob.jobId,
          jobTitle: myActiveLogWithJob.job?.title || null,
          clockInAt: myActiveLogWithJob.clockInAt,
          category: normalizeCategory(myActiveLogWithJob.category),
        } : null,
      });
    } catch (error: any) {
      console.error('Error getting time data:', error);
      res.status(500).json({ error: 'Failed to get time data' });
    }
  });
  
  // Get user's assigned job IDs (for clock-in job picker)
  app.get('/api/time/my-assignments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      // Get crew assignments for this user
      const crewAssignments = await storage.getUserJobAssignments(userId);
      const crewJobIds = new Set(crewAssignments.map(a => a.jobId));
      
      // Also get jobs where user is directly assigned via job.assignedTo
      const allJobs = await storage.getJobs(member.companyId);
      const directJobIds = allJobs
        .filter(j => j.assignedTo === userId)
        .map(j => j.id);
      
      // Combine both sets
      directJobIds.forEach(id => crewJobIds.add(id));
      const assignedJobIds = Array.from(crewJobIds);
      
      res.json({ assignedJobIds });
    } catch (error: any) {
      console.error('Error fetching assignments:', error);
      res.status(500).json({ error: 'Unable to fetch assignments' });
    }
  });
  
  // Clock in (Technicians only)
  app.post('/api/time/clock-in', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      const clockAllowedRoles = ['TECHNICIAN', 'OWNER', 'SUPERVISOR'];
      if (!clockAllowedRoles.includes(member.role)) {
        return res.status(403).json({ error: 'Your role cannot clock in' });
      }
      
      const activeLog = await storage.getActiveTimeLog(userId, member.companyId);
      if (activeLog) {
        return res.status(400).json({ error: 'Already clocked in' });
      }
      
      const { jobId, category } = req.body;
      
      if (jobId && member.role === 'TECHNICIAN') {
        const assignments = await storage.getUserJobAssignments(userId);
        const isCrewAssigned = assignments.some(a => a.jobId === jobId);
        
        const job = await storage.getJob(jobId);
        const isDirectlyAssigned = job?.assignedTo === userId;
        
        if (!isCrewAssigned && !isDirectlyAssigned) {
          return res.status(403).json({ error: 'Not assigned to this job' });
        }
      }
      
      const validCategories = ['job', 'shop', 'drive', 'admin', 'work', 'break'];
      if (category && !validCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      const dbCategory = category === 'work' ? 'admin' : category;
      
      const log = await storage.clockIn(userId, member.companyId, jobId, dbCategory);
      console.log('[Time] clocked in', { userId, logId: log.id, jobId, category });

      const clockUser = await storage.getUser(userId);
      const clockUserName = clockUser ? `${clockUser.firstName || ''} ${clockUser.lastName || ''}`.trim() || 'A team member' : 'A team member';
      let clockBody = `${clockUserName} clocked in`;
      if (jobId) {
        const clockJob = await storage.getJob(jobId);
        if (clockJob) clockBody += ` on ${clockJob.title || clockJob.jobNumber || `Job #${jobId}`}`;
      }
      if (category && category !== 'job') clockBody += ` (${category})`;
      notifyManagers(member.companyId, {
        type: 'tech_clocked_in',
        title: 'Technician Clocked In',
        body: clockBody,
        entityType: 'time_log',
        entityId: log.id,
        linkUrl: '/time-tracking',
        excludeUserIds: [userId],
      }).catch(err => console.error('[Clock-in notification error]', err));

      res.json({ success: true, timeSessionId: log.id, clockedInAt: log.clockInAt, jobId: log.jobId, category: normalizeCategory(log.category) });
    } catch (error: any) {
      console.error('Error clocking in:', error);
      res.status(500).json({ error: 'Unable to clock in' });
    }
  });
  
  // Switch job/category (Technicians only)
  app.post('/api/time/switch', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      // Auto-close any expired time entries before switching
      await storage.autoCloseExpiredTimeEntries(userId, member.companyId);
      
      const switchAllowedRoles = ['TECHNICIAN', 'OWNER', 'SUPERVISOR'];
      if (!switchAllowedRoles.includes(member.role)) {
        return res.status(403).json({ error: 'Your role cannot switch jobs' });
      }
      
      const { jobId, category } = req.body;
      
      if (jobId && member.role === 'TECHNICIAN') {
        const assignments = await storage.getUserJobAssignments(userId);
        const isCrewAssigned = assignments.some(a => a.jobId === jobId);
        
        const job = await storage.getJob(jobId);
        const isDirectlyAssigned = job?.assignedTo === userId;
        
        if (!isCrewAssigned && !isDirectlyAssigned) {
          return res.status(403).json({ error: 'Not assigned to this job' });
        }
      }
      
      const validCategories = ['job', 'shop', 'drive', 'admin', 'work', 'break'];
      if (category && !validCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      const dbCategory = category === 'work' ? 'admin' : category;
      
      const result = await storage.switchJob(userId, member.companyId, jobId, dbCategory);
      console.log('[Time] switched job', { userId, endedId: result.ended.id, startedId: result.started.id, jobId, category });
      res.json({ 
        success: true, 
        ended: { id: result.ended.id, clockOutAt: result.ended.clockOutAt },
        started: { id: result.started.id, clockInAt: result.started.clockInAt, jobId: result.started.jobId, category: normalizeCategory(result.started.category) },
      });
    } catch (error: any) {
      console.error('Error switching job:', error);
      if (error.message === 'No active time entry to switch from') {
        return res.status(400).json({ error: 'Not currently clocked in' });
      }
      res.status(500).json({ error: 'Unable to switch job' });
    }
  });
  
  // Clock out (Technicians only)
  app.post('/api/time/clock-out', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      // Auto-close any expired time entries before clocking out
      await storage.autoCloseExpiredTimeEntries(userId, member.companyId);
      
      const clockOutAllowedRoles = ['TECHNICIAN', 'OWNER', 'SUPERVISOR'];
      if (!clockOutAllowedRoles.includes(member.role)) {
        return res.status(403).json({ error: 'Your role cannot clock out' });
      }
      
      const log = await storage.clockOut(userId, member.companyId);
      if (!log) {
        return res.status(400).json({ error: 'No active session to clock out' });
      }
      
      let liveLocationDeletedCount = 0;
      try {
        liveLocationDeletedCount = await storage.deleteUserLiveLocation(userId, member.companyId, log.id);
      } catch {}
      
      const startTime = new Date(log.clockInAt).getTime();
      const endTime = log.clockOutAt ? new Date(log.clockOutAt).getTime() : Date.now();
      const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));

      const clockOutUser = await storage.getUser(userId);
      const clockOutName = clockOutUser ? `${clockOutUser.firstName || ''} ${clockOutUser.lastName || ''}`.trim() || 'A team member' : 'A team member';
      const hours = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      let clockOutBody = `${clockOutName} clocked out after ${durationStr}`;
      if (log.jobId) {
        const clockOutJob = await storage.getJob(log.jobId);
        if (clockOutJob) clockOutBody += ` on ${clockOutJob.title || clockOutJob.jobNumber || `Job #${log.jobId}`}`;
      }
      notifyManagers(member.companyId, {
        type: 'tech_clocked_out',
        title: 'Technician Clocked Out',
        body: clockOutBody,
        entityType: 'time_log',
        entityId: log.id,
        linkUrl: '/time-tracking',
        excludeUserIds: [userId],
      }).catch(err => console.error('[Clock-out notification error]', err));
      
      console.log('[GEO] clock-out complete', { userId, timeLogId: log.id, durationMinutes, deletedCount: liveLocationDeletedCount });
      res.json({ 
        success: true, 
        clockedOutAt: log.clockOutAt,
        durationMinutes,
        jobId: log.jobId,
        category: normalizeCategory(log.category),
      });
    } catch (error: any) {
      console.error('Error clocking out:', error);
      res.status(500).json({ error: 'Unable to clock out' });
    }
  });

  // Get time entries for Timesheets page (role-aware)
  app.get('/api/time/entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }

      const role = member.role as UserRole;

      if (role === 'TECHNICIAN') {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get date range from query params
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required' });
      }

      const normEntries = (arr: any[]) => arr.map(e => ({ ...e, category: normalizeCategory(e.category) ?? e.category }));

      if (role === 'TECHNICIAN') {
        await storage.autoCloseExpiredTimeEntries(userId, member.companyId);
        const entries = await storage.getTimeEntriesForUser(userId, member.companyId, startDate, endDate);
        return res.json({ role: 'technician', entries: normEntries(entries) });
      }

      await storage.autoCloseExpiredTimeEntriesForCompany(member.companyId);
      const entries = await storage.getTimeEntriesForCompany(member.companyId, startDate, endDate);
      return res.json({ role: 'manager', entries: normEntries(entries) });
    } catch (error: any) {
      console.error('Error getting time entries:', error);
      res.status(500).json({ error: 'Failed to get time entries' });
    }
  });

  // Edit a time entry (Managers only)
  app.patch('/api/time/entries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const entryId = parseInt(req.params.id);
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      const role = member.role as UserRole;
      
      // Only managers can edit time entries (Owner, Supervisor)
      if (role === 'TECHNICIAN') {
        return res.status(403).json({ error: 'Only managers can edit time entries' });
      }
      
      // Get the entry to verify it belongs to this company
      const entry = await storage.getTimeEntryById(entryId);
      if (!entry) {
        return res.status(404).json({ error: 'Time entry not found' });
      }
      
      if (entry.companyId !== member.companyId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const { clockInAt, clockOutAt, editReason } = req.body;
      
      // Validate required fields
      if (!clockInAt || !clockOutAt || !editReason) {
        return res.status(400).json({ error: 'clockInAt, clockOutAt, and editReason are required' });
      }
      
      if (typeof editReason !== 'string' || editReason.trim().length === 0) {
        return res.status(400).json({ error: 'A reason is required for editing time entries' });
      }
      
      const startTime = new Date(clockInAt);
      const endTime = new Date(clockOutAt);
      
      // Validate times
      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        return res.status(400).json({ error: 'Invalid time format' });
      }
      
      if (startTime >= endTime) {
        return res.status(400).json({ error: 'Start time must be before end time' });
      }
      
      // Check duration is reasonable (max 16 hours)
      const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      if (durationHours > 16) {
        return res.status(400).json({ error: 'Duration cannot exceed 16 hours' });
      }
      
      const updated = await storage.updateTimeEntry(entryId, {
        clockInAt: startTime,
        clockOutAt: endTime,
        editedByUserId: userId,
        editReason: editReason.trim(),
      });
      
      if (!updated) {
        return res.status(500).json({ error: 'Failed to update time entry' });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error('Error updating time entry:', error);
      res.status(500).json({ error: 'Failed to update time entry' });
    }
  });
  
  // POST /api/location/ping - Record a location ping from the mobile app
  app.post('/api/location/ping', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { timeSessionId, sessionId, jobId, lat, lng, accuracy, accuracy_m, heading, speed, altitude, capturedAt, captured_at, timestamp: ts } = req.body;
      const resolvedSessionId = timeSessionId || sessionId;

      if (lat == null || lng == null) {
        console.log('[GEO] ping rejected: missing lat/lng', { userId });
        return res.status(400).json({ error: 'lat and lng are required' });
      }

      if (!resolvedSessionId) {
        console.log('[GEO] ping rejected: missing sessionId', { userId });
        return res.status(400).json({ error: 'timeSessionId/sessionId is required (must be clocked in)' });
      }

      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        console.log('[GEO] ping rejected: not a company member', { userId });
        return res.status(404).json({ error: 'Not a company member' });
      }

      const timeEntry = await storage.getTimeEntryById(resolvedSessionId);
      if (!timeEntry) {
        console.log('[GEO] ping rejected: session not found', { userId, sessionId: resolvedSessionId });
        return res.status(404).json({ error: 'Time session not found' });
      }
      if (timeEntry.userId !== userId) {
        console.warn(`[GEO] ping rejected: session ownership mismatch, user ${userId} tried session ${resolvedSessionId} owned by ${timeEntry.userId}`);
        return res.status(403).json({ error: 'Time session does not belong to you' });
      }
      if (timeEntry.companyId !== member.companyId) {
        console.warn('[GEO] ping rejected: company mismatch', { userId, memberCompanyId: member.companyId, timeEntryCompanyId: timeEntry.companyId, timeLogId: resolvedSessionId });
        return res.status(403).json({ error: 'Time session does not belong to your company' });
      }
      if (timeEntry.clockOutAt) {
        console.warn(`[GEO] ping rejected: session already ended, sessionId=${resolvedSessionId}`);
        return res.status(403).json({ error: 'Time session already ended' });
      }

      const resolvedAccuracy = accuracy_m ?? accuracy ?? null;
      const resolvedCapturedAt = captured_at || capturedAt || ts;
      const resolvedJobId = jobId || timeEntry.jobId || null;

      const ping = await storage.createLocationPing({
        companyId: member.companyId,
        userId,
        timeLogId: resolvedSessionId,
        jobId: resolvedJobId,
        latitude: lat,
        longitude: lng,
        accuracy: resolvedAccuracy,
        heading: heading ?? null,
        speed: speed ?? null,
        altitude: altitude ?? null,
        capturedAt: resolvedCapturedAt ? new Date(resolvedCapturedAt) : new Date(),
      });

      await storage.upsertUserLiveLocation({
        userId,
        companyId: member.companyId,
        timeLogId: resolvedSessionId,
        jobId: resolvedJobId,
        latitude: lat,
        longitude: lng,
        accuracy: resolvedAccuracy,
      });

      console.log('[GEO] ping accepted', { userId, sessionId: resolvedSessionId, lat, lng, pingId: ping.id });
      res.json({ success: true, pingId: ping.id });
    } catch (error: any) {
      console.error('[GEO] Error recording location ping:', error);
      res.status(500).json({ error: 'Failed to record location' });
    }
  });

  // POST /api/location/batch - Record multiple location pings in one request
  app.post('/api/location/batch', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { sessionId, points } = req.body;
      console.log('[geo-api] received batch userId=' + userId + ' sessionId=' + sessionId + ' points=' + (Array.isArray(points) ? points.length : 0));

      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }
      if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({ error: 'points array is required and must not be empty' });
      }

      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(404).json({ error: 'Not a company member' });
      }

      const timeEntry = await storage.getTimeEntryById(sessionId);
      if (!timeEntry) {
        return res.status(404).json({ error: 'Time session not found' });
      }
      if (timeEntry.userId !== userId) {
        return res.status(403).json({ error: 'Time session does not belong to you' });
      }
      if (timeEntry.companyId !== member.companyId) {
        return res.status(403).json({ error: 'Time session does not belong to your company' });
      }
      if (timeEntry.clockOutAt) {
        return res.status(403).json({ error: 'Time session already ended' });
      }

      let accepted = 0;
      let rejected = 0;
      let latestAccepted: { lat: number; lng: number; accuracy: number | null; recordedAt?: string } | null = null;
      let latestTime = 0;

      for (const point of points) {
        if (point.accuracy != null && point.accuracy > 100) {
          rejected++;
          continue;
        }

        const capturedAt = point.recordedAt ? new Date(point.recordedAt) : new Date();

        await storage.createLocationPing({
          companyId: member.companyId,
          userId,
          timeLogId: sessionId,
          jobId: timeEntry.jobId || null,
          latitude: point.lat,
          longitude: point.lng,
          accuracy: point.accuracy || null,
          heading: null,
          speed: null,
          altitude: null,
          capturedAt,
        });

        accepted++;

        const pointTime = capturedAt.getTime();
        if (pointTime >= latestTime) {
          latestTime = pointTime;
          latestAccepted = point;
        }
      }

      if (latestAccepted) {
        await storage.upsertUserLiveLocation({
          userId,
          companyId: member.companyId,
          timeLogId: sessionId,
          jobId: timeEntry.jobId || null,
          latitude: latestAccepted.lat,
          longitude: latestAccepted.lng,
          accuracy: latestAccepted.accuracy || null,
        });
      }

      console.log('[geo-api] received batch userId=' + userId + ' sessionId=' + sessionId + ' points=' + (accepted + rejected));
      console.log('[GEO] batch accepted', { userId, sessionId, accepted, rejected });
      res.json({ success: true, accepted, rejected });
    } catch (error: any) {
      console.error('[GEO] Error recording batch location:', error);
      res.status(500).json({ error: 'Failed to record batch location' });
    }
  });

  // GET /api/location/live - Get live locations for CLOCKED-IN employees only (uses user_live_locations table)
  app.get('/api/location/live', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      if (!member) {
        return res.status(404).json({ error: 'Not a company member' });
      }

      const userRole = (member.role || 'TECHNICIAN').toUpperCase();
      const allLocations = await storage.getActiveLiveLocations(company.id);

      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      const fresh = allLocations.filter(l => {
        if (!l.updatedAt) return false;
        const age = Date.now() - new Date(l.updatedAt).getTime();
        if (age > 10 * 60 * 1000) {
          if (l.userId === userId) {
            console.log(`[geo-live] self location stale: age=${Math.round(age/1000)}s updatedAt=${l.updatedAt}`);
          }
          return false;
        }
        return true;
      });

      let filtered: typeof fresh;
      if (userRole === 'OWNER') {
        filtered = fresh;
      } else if (userRole === 'SUPERVISOR') {
        const supervisorAssignments = await storage.getUserJobAssignments(userId);
        const supervisorJobIds = new Set(supervisorAssignments.map(a => a.jobId));

        const filteredResults: typeof fresh = [];
        for (const loc of fresh) {
          if (loc.userId === userId) {
            filteredResults.push(loc);
            continue;
          }
          if (loc.jobId && supervisorJobIds.has(loc.jobId)) {
            filteredResults.push(loc);
            continue;
          }
          const locUserAssignments = await storage.getUserJobAssignments(loc.userId);
          const hasSharedJob = locUserAssignments.some(a => supervisorJobIds.has(a.jobId));
          if (hasSharedJob) {
            filteredResults.push(loc);
          }
        }
        filtered = filteredResults;
      } else {
        filtered = fresh.filter(l => l.userId === userId);
      }

      const selfInAll = allLocations.some(l => l.userId === userId);
      const selfInFresh = fresh.some(l => l.userId === userId);
      const selfInFiltered = filtered.some(l => l.userId === userId);
      console.log(`[geo-live] requester=${userId} companyId=${company.id} role=${userRole} totalActive=${allLocations.length} fresh=${fresh.length} filtered=${filtered.length} selfInAll=${selfInAll} selfInFresh=${selfInFresh} selfInFiltered=${selfInFiltered}`);

      if (filtered.length === 0) {
        return res.json([]);
      }

      const enriched = await Promise.all(
        filtered.map(async (loc) => {
          const user = await storage.getUser(loc.userId);
          const locMember = await storage.getCompanyMember(company.id, loc.userId);
          return {
            userId: loc.userId,
            name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
            initials: user
              ? `${(user.firstName || '')[0] || ''}${(user.lastName || '')[0] || ''}`.toUpperCase()
              : '??',
            avatarUrl: user?.profileImageUrl || null,
            role: locMember?.role || 'TECHNICIAN',
            lat: loc.latitude,
            lng: loc.longitude,
            accuracy: loc.accuracy,
            jobId: loc.jobId,
            jobTitle: loc.jobTitle || null,
            timeSessionId: loc.timeLogId,
            updatedAt: loc.updatedAt,
          };
        })
      );

      res.json(enriched);
    } catch (error: any) {
      console.error('[GEO] Error fetching live locations:', error);
      res.status(500).json({ error: 'Failed to fetch live locations' });
    }
  });

  // GET /api/schedule/live-locations - Get latest location pings with RBAC (legacy)
  app.get('/api/schedule/live-locations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      if (!member) {
        return res.status(404).json({ error: 'Not a company member' });
      }

      const userRole = (member.role || 'TECHNICIAN').toUpperCase();
      const sinceMinutes = parseInt(req.query.since as string) || 30;

      const allPings = await storage.getLatestLocationPings(company.id, sinceMinutes);

      // RBAC: Only Owner sees all employee locations, everyone else sees only themselves
      const canSeeAll = userRole === 'OWNER';
      const filteredPings = canSeeAll
        ? allPings
        : allPings.filter(p => p.userId === userId);

      // Enrich with user info and member role
      const enrichedPings = await Promise.all(
        filteredPings.map(async (ping) => {
          const user = await storage.getUser(ping.userId);
          const pingMember = await storage.getCompanyMember(company.id, ping.userId);
          return {
            id: ping.id,
            userId: ping.userId,
            name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
            userInitials: user
              ? `${(user.firstName || '')[0] || ''}${(user.lastName || '')[0] || ''}`.toUpperCase()
              : '??',
            role: pingMember?.role || 'TECHNICIAN',
            lat: ping.latitude,
            lng: ping.longitude,
            accuracy_m: ping.accuracy || null,
            captured_at: ping.capturedAt,
            jobId: ping.jobId,
            timeSessionId: ping.timeLogId,
          };
        })
      );

      res.json(enrichedPings);
    } catch (error: any) {
      console.error('Error fetching live locations:', error);
      res.status(500).json({ error: 'Failed to fetch live locations' });
    }
  });

  // Get labor totals for a job
  app.get('/api/jobs/:jobId/labor', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Job not found' });
      }
      
      // RBAC: Technicians can only see labor for jobs they're assigned to
      if (member.role === 'TECHNICIAN') {
        const assignments = await storage.getUserJobAssignments(userId);
        const isCrewAssigned = assignments.some(a => a.jobId === jobId);
        const isDirectlyAssigned = job.assignedTo === userId;
        
        if (!isCrewAssigned && !isDirectlyAssigned) {
          return res.status(403).json({ error: 'Not authorized to view this job labor' });
        }
      }
      
      const laborData = await storage.getJobLaborTotals(jobId);
      res.json(laborData);
    } catch (error: any) {
      console.error('Error fetching job labor:', error);
      res.status(500).json({ error: 'Unable to fetch labor data' });
    }
  });

  // Set company industry and seed price book presets (Owner only - onboarding)
  app.patch('/api/company/industry', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      if (member.role !== 'OWNER') {
        return res.status(403).json({ error: 'Only owners can set company industry' });
      }
      
      const { industry } = req.body;
      
      const { INDUSTRIES, INDUSTRY_PRESETS } = await import('./industryPresets');
      
      if (!industry || !INDUSTRIES.includes(industry)) {
        return res.status(400).json({ error: 'Invalid industry selection' });
      }
      
      const company = await storage.getCompany(member.companyId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }
      
      // Check if price book is empty before seeding
      const existingItems = await storage.getServiceCatalogItems(member.companyId);
      
      if (existingItems.length === 0) {
        // Seed preset items for this industry
        const presets = INDUSTRY_PRESETS[industry] || [];
        for (const preset of presets) {
          await storage.createServiceCatalogItem({
            companyId: member.companyId,
            name: preset.name,
            description: preset.description || null,
            defaultPriceCents: preset.defaultPriceCents,
            unit: preset.unit,
            category: preset.category || null,
            isPreset: true,
            presetIndustry: industry,
          });
        }
      }
      
      // Update company with industry and mark onboarding completed
      const updatedCompany = await storage.updateCompany(member.companyId, {
        industry,
        onboardingCompleted: true,
      });
      
      res.json({ 
        success: true, 
        industry: updatedCompany.industry,
        itemsSeeded: existingItems.length === 0 ? (INDUSTRY_PRESETS[industry]?.length || 0) : 0
      });
    } catch (error: any) {
      console.error('Error setting company industry:', error);
      res.status(500).json({ error: 'Failed to set company industry' });
    }
  });

  // Employee management routes
  // List employees in organization (Owner/Supervisor only)
  app.get('/api/org/users', requirePerm('users.view'), async (req: any, res) => {
    try {
      const { search, role, status, limit, offset } = req.query;
      
      const result = await storage.getOrgUsers(req.companyId, {
        search,
        role,
        status,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });

      const activeRows = await db.execute(
        sql`SELECT DISTINCT user_id FROM time_logs WHERE company_id = ${req.companyId} AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`
      );
      const activeClockedInIds = new Set(activeRows.rows.map((r: any) => r.user_id));

      const usersWithClockStatus = result.users.map((u: any) => ({
        ...u,
        isClockedIn: activeClockedInIds.has(u.id),
      }));

      res.json({ ...result, users: usersWithClockStatus });
    } catch (error) {
      console.error("Error fetching employees:", error);
      res.status(500).json({ message: "Failed to fetch employees" });
    }
  });

  // Update user role or status (Owner/Supervisor only)
  app.patch('/api/org/users/:userId', requirePerm('users.manage'), async (req: any, res) => {
    try {
      const { userId } = req.params;
      const { role, status } = req.body;
      
      let updatedUser;
      
      if (role) {
        updatedUser = await storage.updateUserRole(userId, req.companyId, role, req.userRole);
      } else if (status !== undefined) {
        updatedUser = await storage.updateUserStatus(userId, req.companyId, status, req.userRole);
        
        // If deactivating, broadcast session revocation to all user's devices
        if (status === 'INACTIVE') {
          broadcastToUser(userId, {
            type: 'session_revoked',
            data: {
              code: 'ACCOUNT_INACTIVE',
              message: 'Your account has been deactivated. Contact your administrator.'
            }
          });
        }
      } else {
        return res.status(400).json({ message: "Must provide role or status to update" });
      }
      
      res.json(updatedUser);
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(error.message.includes("cannot") || error.message.includes("Cannot") ? 400 : 500)
        .json({ message: error.message || "Failed to update user" });
    }
  });

  // Remove employee from company (Owner/Supervisor only)
  app.delete('/api/org/users/:userId', requirePerm('users.manage'), async (req: any, res) => {
    try {
      const { userId } = req.params;
      
      // Verify the user being removed belongs to this company
      const membership = await db
        .select()
        .from(companyMembers)
        .where(and(
          eq(companyMembers.userId, userId),
          eq(companyMembers.companyId, req.companyId)
        ))
        .limit(1);
      
      if (!membership || membership.length === 0) {
        return res.status(404).json({ 
          code: 'USER_NOT_FOUND',
          message: "Employee not found in this company" 
        });
      }
      
      const employeeRole = membership[0].role;
      
      // Prevent removing the last OWNER
      if (employeeRole === 'OWNER') {
        const ownerCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(companyMembers)
          .where(and(
            eq(companyMembers.companyId, req.companyId),
            eq(companyMembers.role, 'OWNER')
          ));
        
        if (ownerCount[0].count <= 1) {
          return res.status(409).json({ 
            code: 'LAST_OWNER',
            message: "Cannot remove the last owner of the company" 
          });
        }
      }
      
      // Remove membership (in transaction)
      await db.transaction(async (tx) => {
        // Delete company membership
        await tx
          .delete(companyMembers)
          .where(and(
            eq(companyMembers.userId, userId),
            eq(companyMembers.companyId, req.companyId)
          ));
        
        // Increment tokenVersion to invalidate all sessions
        await tx
          .update(users)
          .set({ 
            tokenVersion: sql`${users.tokenVersion} + 1`,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Delete all sessions for this user
        await tx
          .delete(sessions)
          .where(sql`(sess->>'userId')::text = ${userId}`);
      });
      
      // Broadcast session revocation to all user's devices
      broadcastToUser(userId, {
        type: 'session_revoked',
        data: {
          code: 'REMOVED_FROM_COMPANY',
          message: 'Your access to this company has been removed.'
        }
      });
      
      res.status(204).send();
    } catch (error: any) {
      console.error("Error removing employee:", error);
      res.status(500).json({ message: "Failed to remove employee" });
    }
  });

  // Get single user profile (requires same company)
  app.get('/api/users/:userId', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const { userId } = req.params;
      
      // Get both users' companies
      const currentUserCompany = await storage.getUserCompany(currentUserId);
      const targetUserCompany = await storage.getUserCompany(userId);
      
      // Verify same company
      if (!currentUserCompany || !targetUserCompany || currentUserCompany.id !== targetUserCompany.id) {
        return res.status(403).json({ message: "Cannot access users outside your organization" });
      }
      
      // Fetch user details (role comes from companyMembers, not users table)
      const [targetUser] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          profileImageUrl: users.profileImageUrl,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Get role from companyMembers
      const [membership] = await db
        .select({ role: companyMembers.role })
        .from(companyMembers)
        .where(and(
          eq(companyMembers.userId, userId),
          eq(companyMembers.companyId, targetUserCompany.id)
        ))
        .limit(1);
      
      res.json({
        id: targetUser.id,
        name: `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim() || targetUser.email,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        email: targetUser.email,
        avatar: targetUser.profileImageUrl,
        role: membership?.role || 'member',
        status: targetUser.status,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get user's jobs summary (requires same organization)
  app.get('/api/users/:userId/jobs/summary', isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = req.params;
      
      // Verify both users are in the same organization
      const targetUserCompany = await storage.getUserCompany(userId);
      const currentUserCompany = await storage.getUserCompany(req.user.claims.sub);
      
      if (!targetUserCompany || !currentUserCompany || targetUserCompany.id !== currentUserCompany.id) {
        return res.status(403).json({ message: "Cannot access jobs summary for users outside your organization" });
      }
      
      const summary = await storage.getUserJobsSummary(userId, targetUserCompany.id);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching jobs summary:", error);
      res.status(500).json({ message: "Failed to fetch jobs summary" });
    }
  });

  // Get current user's membership/role
  app.get('/api/user/membership', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      
      res.json({
        role: member?.role || 'Technician',
        companyId: company.id,
        companyName: company.name,
      });
    } catch (error) {
      console.error("Error fetching user membership:", error);
      res.status(500).json({ message: "Failed to fetch membership" });
    }
  });

  // Get current user's assigned job IDs (for document filtering)
  app.get('/api/user/assigned-jobs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const assignments = await storage.getUserJobAssignments(userId);
      res.json(assignments.map(a => a.jobId));
    } catch (error) {
      console.error("Error fetching user assigned jobs:", error);
      res.status(500).json({ message: "Failed to fetch assigned jobs" });
    }
  });

  // DELETE /api/account - Delete user's account
  app.delete('/api/account', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      console.log(`[delete-account] Starting account deletion for userId=${userId}`);
      
      const company = await storage.getUserCompany(userId);
      
      if (company) {
        const member = await storage.getCompanyMember(company.id, userId);
        const userRole = member?.role?.toUpperCase();
        const allMembers = await storage.getCompanyMembers(company.id);
        const ownerCount = allMembers.filter(m => m.role?.toUpperCase() === 'OWNER').length;
        const isLastOwner = userRole === 'OWNER' && ownerCount <= 1;
        
        if (isLastOwner) {
          // Last owner deleting account -> full company wipe
          console.log(`[delete-account] User is last owner of company ${company.id}, performing full company deletion`);
          
          // Cancel Stripe subscription if exists (non-blocking)
          if (stripe && company.stripeSubscriptionId) {
            try {
              await stripe.subscriptions.cancel(company.stripeSubscriptionId);
              console.log(`[delete-account] Cancelled Stripe subscription ${company.stripeSubscriptionId}`);
            } catch (stripeError: any) {
              console.error(`[delete-account] Stripe cancellation failed (continuing):`, stripeError.message);
              // Continue with deletion even if Stripe fails
            }
          }
          
          // Delete entire company and all related data (including user)
          await storage.deleteCompanyAndAllData(company.id, userId);
          console.log(`[delete-account] Full company deletion completed`);
        } else {
          // Not last owner -> delete user only, company remains
          console.log(`[delete-account] User is not last owner, deleting user only`);
          await storage.deleteUserAccount(userId);
          console.log(`[delete-account] User deletion completed`);
        }
      } else {
        // User has no company -> just delete the user
        console.log(`[delete-account] User has no company, deleting user only`);
        await storage.deleteUserAccount(userId);
        console.log(`[delete-account] User deletion completed`);
      }
      
      // Session was already deleted in deleteUserAccount(), so just respond
      // The client will redirect to login page after receiving success
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[delete-account] Error:", error);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.post('/api/companies', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const userId = (req.user as any)?.id ?? (req.user as any)?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      console.log("[companies] create: userId=", userId, "provider=", (req.user as any)?.provider);
      
      const { name, logo, primaryColor, secondaryColor, teamSizeRange, planKey, userLimit } = req.body;
      
      const { generateUniqueInviteCode } = await import("@shared/inviteCode");
      const inviteCode = await generateUniqueInviteCode(async (code) => {
        const existing = await storage.getCompanyByInviteCode(code);
        return !!existing;
      });
      
      const company = await storage.createCompany({
        name,
        inviteCode,
        logo,
        primaryColor,
        secondaryColor,
        ownerId: userId,
        teamSizeRange: teamSizeRange || null,
        subscriptionPlan: planKey || null,
        maxUsers: userLimit || 1,
      });
      
      res.status(201).json(company);
    } catch (error) {
      console.error("Error creating company:", error);
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  // Join company with invite code (for existing users)
  app.post('/api/join-company', isAuthenticated, async (req: any, res) => {
    try {
      const { inviteCode } = req.body;
      const userId = getUserId(req.user);
      
      if (!inviteCode) {
        return res.status(400).json({ message: "Invite code is required" });
      }

      // Check if user already belongs to a company
      const existingCompany = await storage.getUserCompany(userId);
      if (existingCompany) {
        return res.status(400).json({ 
          code: 'ALREADY_IN_COMPANY',
          message: "You already belong to a company" 
        });
      }

      // Normalize and validate invite code
      const { normalizeCode } = await import("@shared/inviteCode");
      const normalizedCode = normalizeCode(inviteCode);
      const company = await storage.getCompanyByInviteCode(normalizedCode);
      
      if (!company) {
        return res.status(400).json({ 
          code: 'INVALID_CODE',
          message: "Invalid or expired invite code" 
        });
      }

      // Add user to company with TECHNICIAN role (default for joining members)
      await db.insert(companyMembers).values({
        userId: userId,
        companyId: company.id,
        role: 'TECHNICIAN',
        permissions: { canCreateJobs: true, canManageInvoices: true, canViewSchedule: true }
      });
      
      // Rotate invite code after successful join (security best practice)
      const { generateInviteCode } = await import("@shared/inviteCode");
      const newInviteCode = generateInviteCode();
      const updatedCompany = await storage.rotateInviteCode(company.id, newInviteCode);
      
      // Broadcast invite code rotation to company members
      await broadcastToCompany(company.id, {
        type: 'invite_code_rotated',
        data: {
          companyId: company.id,
          version: updatedCompany.inviteCodeVersion
        }
      }, userId); // Exclude the joining user
      
      res.json({ 
        message: "Successfully joined company",
        company: {
          id: company.id,
          name: company.name
        }
      });
    } catch (error: any) {
      console.error("Error joining company:", error);
      res.status(500).json({ message: "Failed to join company" });
    }
  });

  // Also support legacy path for backward compatibility
  app.get('/api/subscription/status', isAuthenticated, async (req: any, res) => {
    return res.redirect(307, '/api/subscriptions/status');
  });

  app.get('/api/subscriptions/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);

      if (process.env.NODE_ENV !== 'production' && process.env.BYPASS_SUBSCRIPTION === '1') {
        return res.json({
          active: true,
          status: 'active',
          planKey: 'dev',
          userLimit: 999,
          currentPeriodEnd: null,
          bypass: true,
          reason: 'dev_bypass',
        });
      }

      const user = await storage.getUser(userId);
      if (user?.subscriptionBypass) {
        console.log(`[subscriptions] DEV BYPASS active for ${user.email}`);
        return res.json({
          active: true,
          status: 'active',
          planKey: 'bypass',
          userLimit: 999,
          currentPeriodEnd: null,
          bypass: true,
          reason: 'user_bypass',
        });
      }

      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.json({ active: false, status: 'no_company' });
      }
      const periodEnd = company.currentPeriodEnd || company.trialEndsAt || null;
      const expired = periodEnd ? new Date(periodEnd) < new Date() : false;
      const statusInDb = company.subscriptionStatus || 'inactive';
      const isActiveInDb = statusInDb === 'active' || statusInDb === 'trialing';
      const active = isActiveInDb && !expired;
      res.json({
        active,
        status: active ? statusInDb : 'inactive',
        planKey: company.subscriptionPlan || null,
        userLimit: company.maxUsers || 1,
        currentPeriodEnd: periodEnd,
      });
    } catch (error) {
      console.error('[subscriptions/status] Error:', error);
      res.status(500).json({ message: 'Failed to check subscription status' });
    }
  });

  app.post('/api/subscriptions/dev-activate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      console.log('[dev-activate] User', userId, 'activating subscription (DEV ONLY)');

      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(400).json({ message: 'No company found. Please create a company first.' });
      }

      const { subscriptionPlans } = await import("@shared/subscriptionPlans");
      const planKey = company.subscriptionPlan || 'starter';
      const plan = subscriptionPlans[planKey] || subscriptionPlans.starter;

      const currentPeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await storage.updateCompany(company.id, {
        subscriptionStatus: 'active',
        subscriptionPlan: planKey,
        maxUsers: plan.userLimit,
        currentPeriodEnd,
        onboardingCompleted: true,
      });

      console.log('[dev-activate] Company', company.id, 'activated, period ends', currentPeriodEnd.toISOString());
      res.json({
        ok: true,
        active: true,
        status: 'active',
        planKey,
        userLimit: plan.userLimit,
        currentPeriodEnd,
      });
    } catch (error: any) {
      console.error('[dev-activate] Error:', error);
      res.status(500).json({ message: 'Failed to activate subscription' });
    }
  });

  // TODO: Replace this stub with real Apple/Google receipt validation.
  // When mobile builds are ready:
  //   - For Apple: verify receipt via App Store Server API (verifyReceipt or App Store Server Notifications v2)
  //   - For Google: verify purchase token via Google Play Developer API (purchases.subscriptions.get)
  //   - Parse the validated response for expiresDate, autoRenewStatus, etc.
  //   - Set currentPeriodEnd from the store's expiration date
  //   - Store originalTransactionId for deduplication and renewal tracking
  app.post('/api/subscriptions/validate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { receipt, platform, planKey } = req.body;

      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(400).json({ message: 'No company found' });
      }

      if (!receipt || !platform || !planKey) {
        return res.status(400).json({ message: 'Missing receipt, platform, or planKey' });
      }

      const { subscriptionPlans } = await import("@shared/subscriptionPlans");
      const plan = subscriptionPlans[planKey];
      if (!plan) {
        return res.status(400).json({ message: 'Invalid plan key' });
      }

      // TODO: Call Apple/Google server API here to validate the receipt
      // and extract the real currentPeriodEnd, originalTransactionId, etc.
      console.log('[validate] STUB: receipt validation for company', company.id, 'platform:', platform, 'plan:', planKey);
      console.log('[validate] TODO: Replace with real Apple/Google receipt validation');

      const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await storage.updateCompany(company.id, {
        subscriptionStatus: 'active',
        subscriptionPlan: planKey,
        maxUsers: plan.userLimit,
        subscriptionPlatform: platform,
        originalTransactionId: receipt,
        currentPeriodEnd,
        onboardingCompleted: true,
      });

      res.json({
        active: true,
        status: 'active',
        planKey,
        userLimit: plan.userLimit,
        currentPeriodEnd,
      });
    } catch (error: any) {
      console.error('[validate] Error:', error);
      res.status(500).json({ message: 'Failed to validate receipt' });
    }
  });

  // TODO: For mobile, restore should re-fetch latest receipt from the store
  // and re-validate via /api/subscriptions/validate flow
  app.post('/api/subscriptions/restore', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(400).json({ message: 'No company found' });
      }

      const isActive = company.subscriptionStatus === 'active' || company.subscriptionStatus === 'trialing';
      const periodEnd = company.currentPeriodEnd || company.trialEndsAt;
      const expired = periodEnd ? new Date(periodEnd) < new Date() : true;

      if (isActive && !expired) {
        await storage.updateCompany(company.id, {
          onboardingCompleted: true,
        });
        return res.json({
          active: true,
          status: company.subscriptionStatus,
          planKey: company.subscriptionPlan,
          userLimit: company.maxUsers,
          currentPeriodEnd: periodEnd,
        });
      }

      res.json({ active: false, message: 'No active subscription found' });
    } catch (error: any) {
      console.error('[restore] Error:', error);
      res.status(500).json({ message: 'Failed to restore purchases' });
    }
  });

  // Client routes
  app.get('/api/clients', isAuthenticated, async (req: any, res) => {
    try {
      
      const user = req.user;
      const company = await storage.getUserCompany(user.claims.sub);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const clients = await storage.getClients(company.id);
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.post('/api/clients', async (req: any, res) => {
    // SECURITY: Don't log full request body - log only non-sensitive keys
    console.log('server:POST /api/clients:entered', { keys: Object.keys(req.body) });
    try {
      if (!req.isAuthenticated()) {
        console.log('server:POST /api/clients:unauthorized');
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      const company = await storage.getUserCompany(user.claims.sub);
      
      if (!company) {
        console.log('server:POST /api/clients:company-not-found');
        return res.status(404).json({ message: "Company not found" });
      }
      
      const client = await storage.createClient({
        ...req.body,
        companyId: company.id
      });
      
      console.log('server:POST /api/clients:ok', client);
      res.status(201).json(client);
    } catch (error) {
      console.error("server:POST /api/clients:error", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.patch('/api/clients/:id', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      const company = await storage.getUserCompany(user.claims.sub);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const clientId = parseInt(req.params.id);
      const client = await storage.updateClient(clientId, req.body);
      
      res.json(client);
    } catch (error) {
      console.error("Error updating client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  app.delete('/api/clients/:id', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      const company = await storage.getUserCompany(user.claims.sub);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const clientId = parseInt(req.params.id);
      await storage.deleteClient(clientId);
      
      res.status(200).json({ message: "Client deleted successfully" });
    } catch (error) {
      console.error("Error deleting client:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  // Dashboard stats
  app.get('/api/dashboard/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const stats = await storage.getDashboardStats(company.id);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // AI Job Scope Analysis
  app.post('/api/ai/analyze-job-scope', isAuthenticated, async (req: any, res) => {
    try {
      const { description } = req.body;
      
      if (!description || description.trim().length < 10) {
        return res.status(400).json({ message: "Please provide a detailed job description (minimum 10 characters)" });
      }

      const analysis = await aiScopeAnalyzer.analyzeJobScope(description);
      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing job scope:", error);
      res.status(500).json({ message: "Failed to analyze job scope. Please try again." });
    }
  });

  // Subcontractors routes
  app.get('/api/subcontractors', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const subcontractors = await storage.getSubcontractors(company.id);
      res.json(subcontractors);
    } catch (error) {
      console.error("Error fetching subcontractors:", error);
      res.status(500).json({ message: "Failed to fetch subcontractors" });
    }
  });

  app.post('/api/subcontractors', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const subcontractor = await storage.createSubcontractor({
        ...req.body,
        companyId: company.id
      });
      
      res.status(201).json(subcontractor);
    } catch (error) {
      console.error("Error creating subcontractor:", error);
      res.status(500).json({ message: "Failed to create subcontractor" });
    }
  });

  app.get('/api/subcontractors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid subcontractor ID" });
      }
      const sub = await storage.getSubcontractor(id);
      if (!sub || sub.companyId !== company.id) {
        return res.status(404).json({ message: "Contractor not found" });
      }
      res.json(sub);
    } catch (error) {
      console.error("Error fetching subcontractor:", error);
      res.status(500).json({ message: "Failed to fetch contractor" });
    }
  });

  app.get('/api/subcontractors/:id/referrals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });
      const subId = parseInt(req.params.id);
      if (isNaN(subId)) return res.status(400).json({ message: "Invalid subcontractor ID" });
      const sub = await storage.getSubcontractor(subId);
      if (!sub || sub.companyId !== company.id) return res.status(404).json({ message: "Contractor not found" });

      const subEmail = sub.email?.trim().toLowerCase() || null;
      console.log(`[sub-referrals] sub#${subId} companyId=${company.id} subEmail=${subEmail}`);

      // ─── Find the other company (if they have an EcoLogic account) ───────────
      let otherCompanyId: number | null = null;
      if (subEmail) {
        const otherUser = await storage.getUserByEmail(subEmail);
        if (otherUser) {
          const otherCo = await storage.getUserCompany(otherUser.id);
          if (otherCo) otherCompanyId = otherCo.id;
        }
      }
      console.log(`[sub-referrals] otherCompanyId=${otherCompanyId}`);

      // ─── Collect MY company members' emails (for received pending matching) ───
      const myMembers = await storage.getCompanyMembers(company.id);
      const myMemberEmails: string[] = [];
      for (const m of myMembers) {
        const u = await storage.getUser(m.userId);
        if (u?.email) myMemberEmails.push(u.email.trim().toLowerCase());
      }
      console.log(`[sub-referrals] myMemberEmails=${myMemberEmails.join(',')}`);

      // ─── Enrich a referral row with job + customer data ───────────────────────
      async function enrichReferral(ref: any) {
        const job = ref.jobId ? await storage.getJob(ref.jobId) : null;
        let customerName: string | null = null;
        if (job?.customerId) {
          const cust = await storage.getCustomer(job.customerId);
          if (cust) {
            customerName = [cust.firstName, cust.lastName].filter(Boolean).join(' ') || cust.companyName || null;
          }
        }
        return {
          id: ref.id,
          jobId: ref.jobId,
          status: ref.status,
          referralType: ref.referralType,
          referralValue: ref.referralValue,
          message: ref.message,
          createdAt: ref.createdAt,
          acceptedAt: ref.acceptedAt,
          inviteSentTo: ref.inviteSentTo,
          jobTotalAtAcceptanceCents: ref.jobTotalAtAcceptanceCents,
          contractorPayoutAmountCents: ref.contractorPayoutAmountCents,
          companyShareAmountCents: ref.companyShareAmountCents,
          jobTitle: job?.title || null,
          jobStatus: job?.status || null,
          jobLocation: job?.location || null,
          jobStartDate: job?.startDate || null,
          jobScheduledTime: job?.scheduledTime || null,
          jobEstimatedCost: job?.estimatedCost || null,
          customerName,
        };
      }

      // ─── SENT: we are sender ──────────────────────────────────────────────────
      // Pending:  inviteSentTo matches sub's email
      // Accepted: receiverCompanyId matches their company
      const sentConditions: any[] = [eq(jobReferrals.senderCompanyId, company.id)];
      const sentReceiverConditions: any[] = [];
      if (subEmail) sentReceiverConditions.push(ilike(jobReferrals.inviteSentTo, subEmail));
      if (otherCompanyId) sentReceiverConditions.push(eq(jobReferrals.receiverCompanyId, otherCompanyId));

      const sentRefs = sentReceiverConditions.length > 0
        ? await db.select().from(jobReferrals)
            .where(and(eq(jobReferrals.senderCompanyId, company.id), or(...sentReceiverConditions)))
            .orderBy(desc(jobReferrals.createdAt))
        : [];

      // ─── RECEIVED: they are sender, we are receiver ───────────────────────────
      // Accepted: receiverCompanyId = myCompanyId
      // Pending:  inviteSentTo is one of my company's member emails
      let receivedRefs: any[] = [];
      if (otherCompanyId) {
        const receivedConditions: any[] = [eq(jobReferrals.receiverCompanyId, company.id)];
        if (myMemberEmails.length > 0) {
          // also include pending invites sent to any of our member emails
          for (const email of myMemberEmails) {
            receivedConditions.push(ilike(jobReferrals.inviteSentTo, email));
          }
        }
        receivedRefs = await db.select().from(jobReferrals)
          .where(and(eq(jobReferrals.senderCompanyId, otherCompanyId), or(...receivedConditions)))
          .orderBy(desc(jobReferrals.createdAt));
      }

      const [sent, received] = await Promise.all([
        Promise.all(sentRefs.map(enrichReferral)),
        Promise.all(receivedRefs.map(enrichReferral)),
      ]);

      // Deduplicate by ID in case a referral matches multiple conditions
      const dedup = (arr: any[]) => Array.from(new Map(arr.map(r => [r.id, r])).values());

      console.log(`[sub-referrals] RESULT sub#${subId} sent=${sent.length} received=${received.length}`);
      res.json({ sent: dedup(sent), received: dedup(received) });
    } catch (error) {
      console.error("Error fetching subcontractor referrals:", error);
      res.status(500).json({ message: "Failed to fetch referrals" });
    }
  });

  app.delete('/api/subcontractors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid subcontractor ID" });
      }
      console.log(`[contractors] deleting subcontractor id=${id} companyId=${company.id}`);
      const deleted = await storage.deleteSubcontractorSecure(id, company.id);
      console.log(`[contractors] delete affectedRows=${deleted ? 1 : 0}`);
      if (!deleted) {
        return res.status(404).json({ message: "Contractor not found" });
      }
      res.json({ message: "Contractor deleted" });
    } catch (error) {
      console.error("Error deleting subcontractor:", error);
      res.status(500).json({ message: "Failed to delete contractor" });
    }
  });

  // Jobs routes
  app.get('/api/jobs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role?.toUpperCase() || '';
      
      let jobs = await storage.getJobs(company.id);

      // Filter out archived jobs unless explicitly requested
      const includeArchived = req.query.includeArchived === 'true';
      if (!includeArchived) {
        jobs = jobs.filter((job: any) => job.status !== 'archived' && !job.archivedAt && !job.deletedAt);
      }
      
      // For technicians, only return jobs they are assigned to (for Home page Today list)
      if (userRole === 'TECHNICIAN') {
        const assignedJobIds = new Set<number>();
        
        // Get all crew assignments for this user
        for (const job of jobs) {
          const crewAssignments = await storage.getJobCrewAssignments(job.id);
          if (crewAssignments.some(c => c.userId === userId)) {
            assignedJobIds.add(job.id);
          }
        }
        
        jobs = jobs.filter(job => assignedJobIds.has(job.id));
      }
      
      // Include crew assignment info for frontend filtering
      const jobsWithCrew = await Promise.all(jobs.map(async (job) => {
        const crewAssignments = await storage.getJobCrewAssignments(job.id);
        return {
          ...job,
          assignedEmployeeIds: crewAssignments.map(c => c.userId),
        };
      }));
      
      res.json(jobsWithCrew);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  // Get single job by ID
  app.get('/api/jobs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.id);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const job = await storage.getJob(jobId);
      
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Get client info if available (legacy clients table)
      let client = null;
      if (job.clientId) {
        client = await storage.getClient(job.clientId);
      }
      
      // Get customer info if available (customers table - used by NewJobSheet)
      let customer = null;
      if (job.customerId) {
        customer = await storage.getCustomer(job.customerId);
      }
      
      // Get line items for this job
      const lineItems = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)).orderBy(jobLineItems.sortOrder);
      
      // Get crew assignments for this job
      const crewAssignments = await storage.getJobCrewAssignments(jobId);
      const assignedEmployeeIds = crewAssignments.map(c => c.userId);
      const assignedEmployees = crewAssignments.map(c => ({
        id: c.userId,
        firstName: c.user?.firstName || null,
        lastName: c.user?.lastName || null,
        email: c.user?.email || null,
        profileImageUrl: c.user?.profileImageUrl || null,
      }));
      
      // Get schedule from job's own fields first (startDate, scheduledTime, scheduledEndTime)
      // Then fallback to schedule_items table for legacy compatibility
      let scheduleDate = null;
      let scheduleStartTime = null;
      let scheduleEndTime = null;
      
      // Primary source: job's own schedule fields (used by PATCH /api/jobs/:id/schedule)
      if (job.startDate) {
        const rawDate = job.startDate;
        if (typeof rawDate === 'string') {
          scheduleDate = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
        } else if (rawDate instanceof Date) {
          const y = rawDate.getFullYear();
          const m = (rawDate.getMonth() + 1).toString().padStart(2, '0');
          const d = rawDate.getDate().toString().padStart(2, '0');
          scheduleDate = `${y}-${m}-${d}`;
        }
        scheduleStartTime = job.scheduledTime || null;
        scheduleEndTime = job.scheduledEndTime || null;
      }
      
      // Fallback source: schedule_items table (legacy)
      if (!scheduleDate) {
        const scheduleItemsList = await storage.getScheduleItemsByJob(jobId);
        const scheduleItem = scheduleItemsList.length > 0 ? scheduleItemsList[0] : null;
        
        if (scheduleItem) {
          const startDt = new Date(scheduleItem.startDateTime);
          const endDt = new Date(scheduleItem.endDateTime);
          scheduleDate = startDt.toISOString().split('T')[0];
          scheduleStartTime = startDt.toTimeString().slice(0, 5);
          scheduleEndTime = endDt.toTimeString().slice(0, 5);
        }
      }
      
      res.json({
        ...job,
        clientName: client?.name || job.clientName || null,
        client: client ? {
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone
        } : null,
        customer: customer ? {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
        } : null,
        lineItems,
        assignedEmployeeIds,
        assignedEmployees,
        scheduleDate,
        scheduleStartTime,
        scheduleEndTime,
      });
    } catch (error) {
      console.error("Error fetching job:", error);
      res.status(500).json({ message: "Failed to fetch job" });
    }
  });

  app.get('/api/clients/:clientId/jobs', isAuthenticated, async (req: any, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Verify the client belongs to the user's company
      const client = await storage.getClient(clientId);
      if (!client || client.companyId !== company.id) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      const jobs = await storage.getJobsByClient(clientId);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching client jobs:", error);
      res.status(500).json({ message: "Failed to fetch client jobs" });
    }
  });

  // Finalize job creation (wizard) - atomic job + schedule creation
  app.post('/api/jobs/finalize', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ code: 'COMPANY_NOT_FOUND', message: "Company not found" });
      }
      
      // Validate request body with finalize schema
      const validationResult = finalizeJobSchema.safeParse(req.body);
      if (!validationResult.success) {
        const firstError = validationResult.error.errors[0];
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR',
          message: firstError.message,
          field: firstError.path.join('.'),
        });
      }
      
      const { job: jobData, client: clientData, schedule: scheduleData } = validationResult.data;
      
      let clientId: number;
      
      // Handle client creation or selection
      if (clientData) {
        if (clientData.mode === "existing") {
          // Verify client exists and belongs to company
          const existingClient = await storage.getClient(clientData.id);
          if (!existingClient || existingClient.companyId !== company.id) {
            return res.status(404).json({ 
              code: 'CLIENT_NOT_FOUND', 
              message: "Client not found",
              field: 'client.id'
            });
          }
          clientId = clientData.id;
        } else {
          // Create new client
          const newClient = await storage.createClient({
            ...clientData.data,
            companyId: company.id
          });
          clientId = newClient.id;
        }
      } else {
        return res.status(400).json({ 
          code: 'MISSING_CLIENT', 
          message: "Client is required",
          field: 'client'
        });
      }
      
      // Get client data for customer lookup/creation
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ 
          code: 'CLIENT_NOT_FOUND', 
          message: "Client not found after creation",
          field: 'client'
        });
      }
      
      // Parse and validate schedule dates
      const startDate = new Date(scheduleData.startDateTime);
      const endDate = new Date(scheduleData.endDateTime);
      
      if (!isFinite(+startDate) || !isFinite(+endDate)) {
        return res.status(400).json({ 
          code: 'INVALID_DATETIME', 
          message: "Invalid start or end date/time",
          field: 'schedule.startDateTime'
        });
      }
      
      if (endDate <= startDate) {
        return res.status(400).json({ 
          code: 'INVALID_TIME_RANGE', 
          message: "End time must be after start time",
          field: 'schedule.endDateTime'
        });
      }
      
      // Create job and schedule in atomic transaction
      const job = await db.transaction(async (tx) => {
        // Find or create corresponding customer for this client
        // This ensures jobs appear under the customer's Jobs tab
        let customerId: number | null = null;
        
        // Try to find existing customer by email (most reliable) or by name+phone
        const companyCustomers = await storage.getCustomersByCompany(company.id);
        const clientEmail = client.email?.toLowerCase().trim();
        const clientPhone = client.phone?.replace(/\D/g, '');
        const nameParts = (client.name || '').trim().split(/\s+/);
        const clientFirstName = nameParts[0] || '';
        const clientLastName = nameParts.slice(1).join(' ') || '';
        
        // Match by email if available, otherwise match by name AND phone
        const matchingCustomer = companyCustomers.find(c => {
          if (clientEmail && c.email?.toLowerCase().trim() === clientEmail) {
            return true;
          }
          if (clientPhone && c.phone?.replace(/\D/g, '') === clientPhone &&
              c.firstName?.toLowerCase() === clientFirstName.toLowerCase()) {
            return true;
          }
          return false;
        });
        
        if (matchingCustomer) {
          customerId = matchingCustomer.id;
        } else {
          // Create customer from client data inside transaction
          const [newCustomer] = await tx
            .insert(customers)
            .values({
              companyId: company.id,
              firstName: clientFirstName || 'Customer',
              lastName: clientLastName,
              email: client.email || null,
              phone: client.phone || null,
              address: client.address || null,
            })
            .returning();
          customerId = newCustomer.id;
        }
        
        // Create the job with both clientId and customerId
        const [createdJob] = await tx
          .insert(jobs)
          .values({
            ...jobData,
            companyId: company.id,
            clientId,
            customerId,
          } as any)
          .returning();
        
        // Create the schedule item
        await tx
          .insert(scheduleItems)
          .values({
            jobId: createdJob.id,
            companyId: company.id,
            startDateTime: startDate,
            endDateTime: endDate,
            location: scheduleData.location || null,
            notes: scheduleData.notes || null,
            subcontractorId: scheduleData.subcontractorId || null,
            status: "scheduled",
          });
        
        return createdJob;
      });
      
      res.status(201).json(job);
    } catch (error) {
      console.error("Error finalizing job creation:", error);
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  app.post('/api/jobs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Validate request body with zod schema
      const validationResult = insertJobSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: validationResult.error.errors 
        });
      }
      
      const job = await storage.createJob({
        ...validationResult.data,
        companyId: company.id
      });
      
      res.status(201).json(job);
    } catch (error) {
      console.error("Error creating job:", error);
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  // New simplified job creation endpoint - accepts partial data
  app.post('/api/jobs/create', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ code: 'COMPANY_NOT_FOUND', message: "Company not found" });
      }
      
      const {
        title,
        description,
        location,
        city,
        postalCode,
        locationLat,
        locationLng,
        locationPlaceId,
        priority,
        customerId,
        customerName,
        scheduleDate,
        scheduleStartTime,
        scheduleEndTime,
        assignedEmployeeIds,
        notes,
        jobType,
        lineItems,
      } = req.body;
      
      // Customer is required
      if (!customerId) {
        return res.status(400).json({ code: 'CUSTOMER_REQUIRED', message: "Customer is required" });
      }
      
      // Verify customer exists and belongs to company
      const customer = await storage.getCustomer(customerId);
      if (!customer || customer.companyId !== company.id) {
        return res.status(404).json({ code: 'CUSTOMER_NOT_FOUND', message: "Customer not found" });
      }
      
      // Create job with minimal required fields
      const jobTitle = title || `Job for ${customerName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim()}`;
      
      const job = await db.transaction(async (tx) => {
        // Create the job
        // Note: jobs.clientId references the old 'clients' table, but NewJobSheet uses 'customers'
        // We only set clientName (text field) to store the customer name for display
        // Normalize time to 15-minute intervals for consistency
        const normalizeTimeTo15Min = (time: string): string => {
          if (!time) return '09:00';
          const [hours, mins] = time.split(':').map(Number);
          const normalizedMins = Math.floor(mins / 15) * 15;
          return `${hours.toString().padStart(2, '0')}:${normalizedMins.toString().padStart(2, '0')}`;
        };
        
        // Set startDate, scheduledTime, and scheduledEndTime if schedule is provided
        // These are the canonical fields used by the Schedule page
        const startDateValue = scheduleDate || null;
        const scheduledTimeValue = scheduleDate ? normalizeTimeTo15Min(scheduleStartTime || '09:00') : null;
        const scheduledEndTimeValue = scheduleDate && scheduleEndTime ? normalizeTimeTo15Min(scheduleEndTime) : null;
        
        const [createdJob] = await tx
          .insert(jobs)
          .values({
            title: jobTitle,
            description: description || null,
            location: location || null,
            city: city || null,
            postalCode: postalCode || null,
            locationLat: locationLat || null,
            locationLng: locationLng || null,
            locationPlaceId: locationPlaceId || null,
            priority: priority || 'medium',
            status: 'pending',
            companyId: company.id,
            customerId: customerId,
            clientName: customerName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
            notes: notes || null,
            jobType: jobType || null,
            startDate: startDateValue,
            scheduledTime: scheduledTimeValue,
            scheduledEndTime: scheduledEndTimeValue,
          } as any)
          .returning();
        
        // Create schedule item if schedule data is provided
        if (scheduleDate) {
          let startDateTime: Date;
          let endDateTime: Date;
          
          if (scheduleStartTime) {
            startDateTime = new Date(`${scheduleDate}T${scheduleStartTime}`);
          } else {
            startDateTime = new Date(`${scheduleDate}T09:00:00`);
          }
          
          if (scheduleEndTime) {
            endDateTime = new Date(`${scheduleDate}T${scheduleEndTime}`);
          } else {
            // Default to 1 hour after start
            endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
          }
          
          if (isFinite(+startDateTime) && isFinite(+endDateTime)) {
            await tx
              .insert(scheduleItems)
              .values({
                jobId: createdJob.id,
                companyId: company.id,
                startDateTime,
                endDateTime,
                location: location || null,
                notes: null,
                subcontractorId: null,
                status: "scheduled",
              });
          }
        }
        
        // Assign technicians if provided - create crew assignments
        if (assignedEmployeeIds && Array.isArray(assignedEmployeeIds) && assignedEmployeeIds.length > 0) {
          // Insert crew assignments for each employee
          for (const employeeId of assignedEmployeeIds) {
            await tx.insert(crewAssignments).values({
              jobId: createdJob.id,
              userId: employeeId,
              companyId: company.id,
              assignedBy: userId,
            });
          }
          // Also set the first technician to the job's assignedTo field for backwards compatibility
          await tx
            .update(jobs)
            .set({ assignedTo: assignedEmployeeIds[0] })
            .where(eq(jobs.id, createdJob.id));
        }
        
        // Insert line items if provided
        if (lineItems && Array.isArray(lineItems) && lineItems.length > 0) {
          const validLineItems = lineItems.filter((item: any) => item.name && item.name.trim());
          for (let i = 0; i < validLineItems.length; i++) {
            const item = validLineItems[i];
            const quantity = parseFloat(item.quantity) || 1;
            const unitPriceCents = parseInt(item.unitPriceCents) || 0;
            const lineTotalCents = Math.round(quantity * unitPriceCents);
            
            // Calculate tax for this line item
            let taxCents = 0;
            if (item.taxable && item.taxRatePercentSnapshot) {
              const taxRate = parseFloat(item.taxRatePercentSnapshot) || 0;
              taxCents = Math.round(lineTotalCents * taxRate / 100);
            }
            
            const totalCents = lineTotalCents + taxCents;
            
            console.log("[LineItemSave]", { 
              name: item.name, 
              jobId: createdJob.id, 
              taxable: item.taxable, 
              taxId: item.taxId,
              taxRatePercentSnapshot: item.taxRatePercentSnapshot,
              lineTotalCents,
              taxCents,
              totalCents
            });
            
            await tx.insert(jobLineItems).values({
              jobId: createdJob.id,
              name: item.name.trim(),
              description: item.description || null,
              taskCode: item.taskCode || null,
              quantity: quantity.toString(),
              unitPriceCents,
              unit: item.unit || 'each',
              taxable: item.taxable || false,
              taxId: item.taxable && item.taxId ? item.taxId : null,
              taxRatePercentSnapshot: item.taxable && item.taxRatePercentSnapshot ? item.taxRatePercentSnapshot : null,
              taxNameSnapshot: item.taxable && item.taxNameSnapshot ? item.taxNameSnapshot : null,
              lineTotalCents,
              taxCents,
              totalCents,
              sortOrder: i,
            });
          }
        }
        
        return createdJob;
      });
      
      // Send notifications to newly assigned crew (outside transaction)
      if (assignedEmployeeIds && Array.isArray(assignedEmployeeIds) && assignedEmployeeIds.length > 0) {
        const assigner = await storage.getUser(userId);
        const assignerName = assigner ? `${assigner.firstName || ''} ${assigner.lastName || ''}`.trim() || 'Someone' : 'Someone';
        const jobTitle = job.title || `Job #${job.id}`;
        await notifyTechniciansOnly(assignedEmployeeIds, company.id, {
          type: 'job_assigned',
          title: 'New Job Assignment',
          body: `${assignerName} assigned you to job: ${jobTitle}`,
          entityType: 'job',
          entityId: job.id,
          linkUrl: `/jobs/${job.id}`,
        });
      }
      
      // AUTO-CREATE INVOICE: Create invoice automatically if job has line items
      if (lineItems && Array.isArray(lineItems) && lineItems.length > 0) {
        const validLineItems = lineItems.filter((item: any) => item.name && item.name.trim());
        if (validLineItems.length > 0) {
          try {
            // Check if invoice already exists for this job (prevent duplicates)
            const existingInvoice = await storage.getInvoiceByJobId(job.id, company.id);
            if (!existingInvoice) {
              // Calculate totals from line items
              let subtotalCents = 0;
              let taxCents = 0;
              for (const item of validLineItems) {
                const qty = parseFloat(item.quantity) || 1;
                const unitPrice = parseInt(item.unitPriceCents) || 0;
                const lineTotal = Math.round(qty * unitPrice);
                subtotalCents += lineTotal;
                if (item.taxable && item.taxRatePercentSnapshot) {
                  const taxRate = parseFloat(item.taxRatePercentSnapshot) || 0;
                  taxCents += Math.round(lineTotal * taxRate / 100);
                }
              }
              const totalCents = subtotalCents + taxCents;
              
              // Generate invoice number
              const invoiceNumber = `INV-${Date.now()}`;
              const today = new Date();
              const dueDate = new Date(today);
              dueDate.setDate(dueDate.getDate() + 30);
              
              // Get user role for audit
              const roleResult = await storage.getUserRole(userId, company.id);
              const userRole = roleResult?.role || 'OWNER';
              
              const createdInvoice = await storage.createInvoice({
                companyId: company.id,
                jobId: job.id,
                clientId: null,
                customerId: customerId || null,
                invoiceNumber,
                amount: (totalCents / 100).toFixed(2),
                subtotalCents,
                taxCents,
                totalCents,
                status: 'pending',
                issueDate: today.toISOString().split('T')[0],
                dueDate: dueDate.toISOString().split('T')[0],
                notes: `Invoice for job: ${job.title || 'Job #' + job.id}`,
                createdByUserId: userId,
                createdByRole: userRole,
              });
              
              // Auto-sync to QuickBooks (fire-and-forget)
              console.log('[QB] Auto-sync scheduled for invoiceId:', createdInvoice.id);
              syncInvoiceToQuickBooks(createdInvoice.id, company.id)
                .then(result => {
                  if (result.success) {
                    console.log('[QB] Auto-sync success invoiceId:', createdInvoice.id, 'qboInvoiceId:', result.qboInvoiceId);
                  } else {
                    console.log('[QB] Auto-sync failed invoiceId:', createdInvoice.id, 'error:', result.error);
                  }
                })
                .catch(err => console.error('[QB] Auto-sync error invoiceId:', createdInvoice.id, err.message));
            }
          } catch (invoiceError) {
            // Log but don't fail the job creation
            console.error('[AutoInvoice] Failed to auto-create invoice:', invoiceError);
          }
        }
      }
      
      res.status(201).json(job);
    } catch (error) {
      console.error("Error creating job:", error);
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  // Update job (PATCH)
  app.patch('/api/jobs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const jobId = parseInt(req.params.id);
      
      // Verify job exists and belongs to company
      const existingJob = await storage.getJob(jobId);
      if (!existingJob || existingJob.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const {
        title,
        description,
        status,
        location,
        city,
        postalCode,
        locationLat,
        locationLng,
        locationPlaceId,
        priority,
        customerId,
        customerName,
        scheduleDate,
        scheduleStartTime,
        scheduleEndTime,
        assignedEmployeeIds,
        notes,
        jobType,
        lineItems,
      } = req.body;
      
      // Update job fields
      const jobUpdateData: any = {};
      if (title !== undefined) jobUpdateData.title = title;
      if (description !== undefined) jobUpdateData.description = description;
      if (location !== undefined) jobUpdateData.location = location;
      if (city !== undefined) jobUpdateData.city = city;
      if (postalCode !== undefined) jobUpdateData.postalCode = postalCode;
      if (locationLat !== undefined) jobUpdateData.locationLat = locationLat;
      if (locationLng !== undefined) jobUpdateData.locationLng = locationLng;
      if (locationPlaceId !== undefined) jobUpdateData.locationPlaceId = locationPlaceId;
      if (priority !== undefined) jobUpdateData.priority = priority;
      if (customerId !== undefined) jobUpdateData.customerId = customerId;
      if (customerName !== undefined) jobUpdateData.clientName = customerName;
      if (notes !== undefined) jobUpdateData.notes = notes;
      if (jobType !== undefined) jobUpdateData.jobType = jobType;
      if (status !== undefined) {
        jobUpdateData.status = status;
        if (status === 'completed' && existingJob.status !== 'completed') {
          jobUpdateData.completedAt = new Date();
        }
      }
      
      const updatedJob = await storage.updateJob(jobId, jobUpdateData);

      if (status === 'completed' && existingJob.status !== 'completed') {
        await tryArchiveCompletedPaidJob(jobId);
      }
      
      // Update schedule if provided
      if (scheduleDate !== undefined) {
        // Normalize time to 15-minute intervals for consistency
        const normalizeTimeTo15Min = (time: string): string => {
          if (!time) return '09:00';
          const [hours, mins] = time.split(':').map(Number);
          const normalizedMins = Math.floor(mins / 15) * 15;
          return `${hours.toString().padStart(2, '0')}:${normalizedMins.toString().padStart(2, '0')}`;
        };
        
        // Update the job's startDate, scheduledTime, and scheduledEndTime fields (canonical for Schedule page)
        if (scheduleDate) {
          const normalizedTime = normalizeTimeTo15Min(scheduleStartTime || '09:00');
          const normalizedEndTime = scheduleEndTime ? normalizeTimeTo15Min(scheduleEndTime) : null;
          await db.update(jobs).set({
            startDate: scheduleDate,
            scheduledTime: normalizedTime,
            scheduledEndTime: normalizedEndTime,
            updatedAt: new Date(),
          }).where(eq(jobs.id, jobId));
        } else {
          // Clear schedule
          await db.update(jobs).set({
            startDate: null,
            scheduledTime: null,
            scheduledEndTime: null,
            updatedAt: new Date(),
          }).where(eq(jobs.id, jobId));
        }
        
        const existingScheduleItems = await storage.getScheduleItemsByJob(jobId);
        
        if (scheduleDate) {
          let startDateTime: Date;
          let endDateTime: Date;
          
          if (scheduleStartTime && scheduleEndTime) {
            startDateTime = new Date(`${scheduleDate}T${scheduleStartTime}:00`);
            endDateTime = new Date(`${scheduleDate}T${scheduleEndTime}:00`);
          } else if (scheduleStartTime) {
            startDateTime = new Date(`${scheduleDate}T${scheduleStartTime}:00`);
            endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
          } else {
            startDateTime = new Date(`${scheduleDate}T09:00:00`);
            endDateTime = new Date(`${scheduleDate}T10:00:00`);
          }
          
          if (existingScheduleItems.length > 0) {
            // Update existing schedule item
            await storage.updateScheduleItem(existingScheduleItems[0].id, {
              startDateTime,
              endDateTime,
            });
          } else {
            // Create new schedule item
            await storage.createScheduleItem({
              jobId,
              companyId: company.id,
              title: updatedJob.title || 'Job',
              startDateTime,
              endDateTime,
              allDay: false,
            });
          }
        } else if (existingScheduleItems.length > 0) {
          // Remove schedule if date cleared
          await storage.deleteScheduleItem(existingScheduleItems[0].id);
        }
        
        // Check if schedule actually changed and send notification
        const normalizedTime = normalizeTimeTo15Min(scheduleStartTime || '09:00');
        const normalizedEndTime = scheduleEndTime ? normalizeTimeTo15Min(scheduleEndTime) : null;
        // Normalize old date to YYYY-MM-DD string for comparison
        const oldDateStr = existingJob.startDate ? (typeof existingJob.startDate === 'string' ? existingJob.startDate.split('T')[0] : existingJob.startDate.toISOString().split('T')[0]) : null;
        const oldTime = existingJob.scheduledTime || null;
        const oldEndTime = existingJob.scheduledEndTime || null;
        const newDateStr = scheduleDate || null;
        const newTime = scheduleDate ? normalizedTime : null;
        const newEndTime = normalizedEndTime;
        
        const scheduleChanged = oldDateStr !== newDateStr || oldTime !== newTime || oldEndTime !== newEndTime;
        if (scheduleChanged && newDateStr) {
          const dateFormatted = new Date(newDateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const timeFormatted = formatTime12Hour(newTime);
          await notifyJobCrewAndOffice(jobId, company.id, {
            type: 'job_rescheduled',
            title: 'Job Rescheduled',
            body: `${existingJob.title || `Job #${jobId}`} rescheduled to ${dateFormatted} at ${timeFormatted}`,
            entityType: 'job',
            entityId: jobId,
            linkUrl: `/jobs/${jobId}`,
          });
        }
      }
      
      // Update crew assignments if provided
      let crewToAdd: string[] = [];
      let crewToRemove: string[] = [];
      if (assignedEmployeeIds !== undefined) {
        const existingCrew = await storage.getJobCrewAssignments(jobId);
        const existingIds = existingCrew.map(c => c.userId);
        
        crewToRemove = existingIds.filter(id => !assignedEmployeeIds.includes(id));
        if (crewToRemove.length > 0) {
          await storage.removeJobCrewAssignments(jobId, crewToRemove);
        }
        
        crewToAdd = assignedEmployeeIds.filter((id: string) => !existingIds.includes(id));
        if (crewToAdd.length > 0) {
          await storage.addJobCrewAssignments(jobId, crewToAdd, company.id, userId);
        }

        if (crewToAdd.length > 0) {
          const assigner = await storage.getUser(userId);
          const assignerName = assigner ? `${assigner.firstName || ''} ${assigner.lastName || ''}`.trim() || 'Someone' : 'Someone';
          await notifyTechniciansOnly(crewToAdd, company.id, {
            type: 'job_assigned',
            title: 'New Job Assignment',
            body: `${assignerName} assigned you to job: ${existingJob.title || existingJob.jobNumber || `Job #${jobId}`}`,
            entityType: 'job',
            entityId: jobId,
            linkUrl: `/jobs/${jobId}`,
          });
        }
      }
      
      // Update line items if provided
      if (lineItems !== undefined) {
        // Delete existing line items and create new ones
        await db.delete(jobLineItems).where(eq(jobLineItems.jobId, jobId));
        
        if (lineItems && lineItems.length > 0) {
          for (let i = 0; i < lineItems.length; i++) {
            const item = lineItems[i];
            const lineTotalCents = Math.round(parseFloat(item.quantity) * item.unitPriceCents);
            
            // Calculate tax for this line item
            let taxCents = 0;
            if (item.taxable && item.taxRatePercentSnapshot) {
              const taxRate = parseFloat(item.taxRatePercentSnapshot) || 0;
              taxCents = Math.round(lineTotalCents * taxRate / 100);
            }
            
            const totalCents = lineTotalCents + taxCents;
            
            await db.insert(jobLineItems).values({
              jobId,
              name: item.name,
              description: item.description || null,
              taskCode: item.taskCode || null,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              unit: item.unit || 'each',
              taxable: item.taxable || false,
              taxId: item.taxable && item.taxId ? item.taxId : null,
              taxRatePercentSnapshot: item.taxable && item.taxRatePercentSnapshot ? item.taxRatePercentSnapshot : null,
              taxNameSnapshot: item.taxable && item.taxNameSnapshot ? item.taxNameSnapshot : null,
              lineTotalCents,
              taxCents,
              totalCents,
              sortOrder: i,
            });
          }
        }
        
        // If invoice exists for this job, recalculate its totals
        const existingInvoice = await storage.getInvoiceByJobId(jobId, company.id);
        if (existingInvoice) {
          const updatedLineItems = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId));
          const subtotalCents = updatedLineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
          const invoiceTaxCents = updatedLineItems.reduce((sum, item) => sum + (item.taxCents || 0), 0);
          const totalCents = subtotalCents + invoiceTaxCents;
          const totalAmount = (totalCents / 100).toFixed(2);
          
          await db.update(invoices)
            .set({
              amount: totalAmount,
              subtotalCents,
              taxCents: invoiceTaxCents,
              totalCents,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, existingInvoice.id));
        } else if (lineItems && lineItems.length > 0) {
          // AUTO-CREATE INVOICE: No invoice exists and we're adding line items
          try {
            const validLineItems = lineItems.filter((item: any) => item.name && item.name.trim());
            if (validLineItems.length > 0) {
              let subtotalCents = 0;
              let taxCents = 0;
              for (const item of validLineItems) {
                const qty = parseFloat(item.quantity) || 1;
                const unitPrice = parseInt(item.unitPriceCents) || 0;
                const lineTotal = Math.round(qty * unitPrice);
                subtotalCents += lineTotal;
                if (item.taxable && item.taxRatePercentSnapshot) {
                  const taxRate = parseFloat(item.taxRatePercentSnapshot) || 0;
                  taxCents += Math.round(lineTotal * taxRate / 100);
                }
              }
              const totalCents = subtotalCents + taxCents;
              
              const invoiceNumber = `INV-${Date.now()}`;
              const today = new Date();
              const dueDate = new Date(today);
              dueDate.setDate(dueDate.getDate() + 30);
              
              const roleResult = await storage.getUserRole(userId, company.id);
              const userRole = roleResult?.role || 'OWNER';
              
              const createdInvoice = await storage.createInvoice({
                companyId: company.id,
                jobId: jobId,
                clientId: null,
                customerId: existingJob.customerId || null,
                invoiceNumber,
                amount: (totalCents / 100).toFixed(2),
                subtotalCents,
                taxCents,
                totalCents,
                status: 'pending',
                issueDate: today.toISOString().split('T')[0],
                dueDate: dueDate.toISOString().split('T')[0],
                notes: `Invoice for job: ${existingJob.title || 'Job #' + jobId}`,
                createdByUserId: userId,
                createdByRole: userRole,
              });
              
              // Auto-sync to QuickBooks (fire-and-forget)
              console.log('[QB] Auto-sync scheduled for invoiceId:', createdInvoice.id);
              syncInvoiceToQuickBooks(createdInvoice.id, company.id)
                .then(result => {
                  if (result.success) {
                    console.log('[QB] Auto-sync success invoiceId:', createdInvoice.id, 'qboInvoiceId:', result.qboInvoiceId);
                  } else {
                    console.log('[QB] Auto-sync failed invoiceId:', createdInvoice.id, 'error:', result.error);
                  }
                })
                .catch(err => console.error('[QB] Auto-sync error invoiceId:', createdInvoice.id, err.message));
            }
          } catch (invoiceError) {
            console.error('[AutoInvoice] Failed to auto-create invoice on update:', invoiceError);
          }
        }
      }
      
      // Send notifications for job updates
      const jobTitle = updatedJob?.title || existingJob.title || existingJob.jobNumber || `Job #${jobId}`;
      
      // Check if schedule changed (job_rescheduled)
      const oldScheduleDate = existingJob.startDate;
      const newScheduleDate = scheduleDate;
      if (scheduleDate !== undefined && scheduleDate !== oldScheduleDate) {
        await notifyJobCrew(jobId, company.id, {
          type: 'job_rescheduled',
          title: 'Job Rescheduled',
          body: newScheduleDate 
            ? `${jobTitle} has been rescheduled to ${new Date(newScheduleDate).toLocaleDateString()}`
            : `${jobTitle} schedule has been cleared`,
          entityType: 'job',
          entityId: jobId,
          linkUrl: `/jobs/${jobId}`,
        });
      }

      // Notify on key status changes
      const KEY_STATUSES = ['in_progress', 'on_hold', 'canceled', 'completed'];
      if (status && status !== existingJob.status && KEY_STATUSES.includes(status)) {
        const statusLabel = status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const clientName = (existingJob as any).clientName || (existingJob as any).customerName || '';
        const statusBody = clientName ? `${clientName} – ${jobTitle}: ${statusLabel}` : `${jobTitle}: ${statusLabel}`;

        await notifyJobCrewAndManagers(jobId, company.id, {
          type: 'job_status_changed',
          title: 'Job Status Updated',
          body: statusBody,
          entityType: 'job',
          entityId: jobId,
          linkUrl: `/jobs/${jobId}`,
        });
      }

      // Notify crew of assignment changes via PATCH
      if (crewToAdd.length > 0) {
        const assigner = await storage.getUser(userId);
        const assignerName = assigner ? `${assigner.firstName || ''} ${assigner.lastName || ''}`.trim() || 'Someone' : 'Someone';
        await notifyTechniciansOnly(crewToAdd, company.id, {
          type: 'job_assigned',
          title: 'Assigned to Job',
          body: `${assignerName} assigned you to: ${jobTitle}`,
          entityType: 'job',
          entityId: jobId,
          linkUrl: `/jobs/${jobId}`,
        });
      }

      if (crewToRemove.length > 0) {
        await notifyTechniciansOnly(crewToRemove, company.id, {
          type: 'job_unassigned',
          title: 'Removed from Job',
          body: `You have been removed from: ${jobTitle}`,
          entityType: 'job',
          entityId: jobId,
          linkUrl: `/jobs/${jobId}`,
        });
      }

      if (status === 'completed') {
        await tryArchiveCompletedPaidJob(jobId);
      }

      res.json(updatedJob);
    } catch (error) {
      console.error("Error updating job:", error);
      res.status(500).json({ message: "Failed to update job" });
    }
  });

  // Delete job
  app.delete('/api/jobs/:id', isAuthenticated, requirePerm("jobs.delete"), async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.id);
      const companyId = req.companyId;
      
      const job = await storage.getJob(jobId);
      
      if (!job) {
        return res.status(404).json({ 
          message: "Job not found",
          code: "JOB_NOT_FOUND" 
        });
      }
      
      if (job.companyId !== companyId) {
        return res.status(403).json({ 
          message: "Forbidden",
          code: "FORBIDDEN" 
        });
      }

      const jobInvoices = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.jobId, jobId));
      let hasFinancialRecords = false;

      if (jobInvoices.length > 0) {
        const invoiceIds = jobInvoices.map(inv => inv.id);
        for (const invId of invoiceIds) {
          const [refundRow] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.invoiceId, invId)).limit(1);
          if (refundRow) { hasFinancialRecords = true; break; }
          const [paymentRow] = await db.select({ id: payments.id }).from(payments).where(eq(payments.invoiceId, invId)).limit(1);
          if (paymentRow) { hasFinancialRecords = true; break; }
        }
      }

      if (hasFinancialRecords) {
        await storage.updateJob(jobId, {
          deletedAt: new Date(),
          deletedReason: 'has_financial_records',
          status: 'archived',
        } as any);
        console.log(`[JobDelete] Job ${jobId} soft-deleted (has financial records)`);
        return res.status(200).json({ softDeleted: true });
      }

      await storage.deleteJob(jobId);
      console.log(`[JobDelete] Job ${jobId} hard-deleted`);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting job:", error);
      res.status(500).json({ message: "Failed to delete job" });
    }
  });

  // Archive job (for jobs with time logs or other references)
  app.patch('/api/jobs/:id/archive', isAuthenticated, requirePerm("jobs.delete"), async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.id);
      const companyId = req.companyId;
      
      const job = await storage.getJob(jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      if (job.companyId !== companyId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const archivedJob = await storage.updateJob(jobId, {
        status: 'archived',
        archivedAt: new Date(),
        archivedReason: 'manual',
      } as any);
      
      res.json(archivedJob);
    } catch (error) {
      console.error("Error archiving job:", error);
      res.status(500).json({ message: "Failed to archive job" });
    }
  });

  app.patch('/api/jobs/:id/unarchive', isAuthenticated, requirePerm("jobs.delete"), async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.id);
      const companyId = req.companyId;

      const job = await storage.getJob(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.companyId !== companyId) return res.status(403).json({ message: "Forbidden" });

      if (job.status !== 'archived' && !job.archivedAt) {
        return res.status(400).json({ message: "Job is not archived" });
      }

      const restoredJob = await storage.updateJob(jobId, {
        status: 'active',
        archivedAt: null,
        archivedReason: null,
      } as any);

      console.log(`[unarchive] Job ${jobId} restored to active by user`);
      res.json(restoredJob);
    } catch (error) {
      console.error("Error unarchiving job:", error);
      res.status(500).json({ message: "Failed to unarchive job" });
    }
  });

  // Cancel job (Owner/Supervisor/Dispatcher only)
  app.patch('/api/jobs/:id/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // RBAC: Only Owner, Supervisor, Dispatcher can cancel jobs
      const member = await storage.getCompanyMember(company.id, userId);
      if (!member) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const allowedRoles = ['OWNER', 'SUPERVISOR'];
      if (!allowedRoles.includes(member.role.toUpperCase())) {
        return res.status(403).json({ message: "You don't have permission to cancel jobs" });
      }
      
      const jobId = parseInt(req.params.id);
      const job = await storage.getJob(jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      if (job.companyId !== company.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Don't notify if already cancelled
      const wasAlreadyCancelled = job.status === 'cancelled';
      
      // Update status to cancelled
      const cancelledJob = await storage.updateJob(jobId, { status: 'cancelled' } as any);
      
      // Notify assigned technicians (only if status actually changed)
      if (!wasAlreadyCancelled) {
        const customerName = job.clientName || 'a customer';
        await notifyTechniciansOnly(
          (await storage.getJobCrewAssignments(jobId)).map(c => c.userId),
          company.id,
          {
            type: 'job_cancelled',
            title: 'Job Cancelled',
            body: `Job for ${customerName} has been cancelled`,
            entityType: 'job',
            entityId: jobId,
            linkUrl: `/jobs/${jobId}`,
          }
        );
      }
      
      res.json(cancelledJob);
    } catch (error) {
      console.error("Error cancelling job:", error);
      res.status(500).json({ message: "Failed to cancel job" });
    }
  });

  // Assign technician to job (Admin-only: Owner/Supervisor)
  app.patch('/api/jobs/:id/assign', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Check if user is admin (Owner or Supervisor)
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role?.toUpperCase() || 'TECHNICIAN';
      
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "Only Owner or Supervisor can assign technicians" });
      }
      
      const jobId = parseInt(req.params.id);
      const { technicianId } = req.body;
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // If technicianId is provided, verify technician is in the company
      if (technicianId) {
        const techMember = await storage.getCompanyMember(company.id, technicianId);
        if (!techMember) {
          return res.status(400).json({ message: "Technician not found in company" });
        }
      }
      
      // Update the job's assignedTo field
      const updatedJob = await storage.updateJob(jobId, { assignedTo: technicianId || null });
      
      res.json(updatedJob);
    } catch (error) {
      console.error("Error assigning technician:", error);
      res.status(500).json({ message: "Failed to assign technician" });
    }
  });

  // Get crew assignments for a job
  app.get('/api/jobs/:jobId/crew', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Verify job belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const assignments = await storage.getJobCrewAssignments(jobId);
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching crew assignments:", error);
      res.status(500).json({ message: "Failed to fetch crew assignments" });
    }
  });

  // Bulk assign crew members to a job (Admin-only: Owner/Supervisor)
  app.post('/api/jobs/:jobId/crew', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Check if user is admin (Owner or Supervisor)
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role?.toUpperCase() || 'TECHNICIAN';
      
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "Only Owner or Supervisor can assign crew members" });
      }
      
      const jobId = parseInt(req.params.jobId);
      const { userIds } = req.body;
      
      if (!Array.isArray(userIds)) {
        return res.status(400).json({ message: "userIds array is required" });
      }
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Verify all users are in the company (if any are provided)
      for (const uid of userIds) {
        const userMember = await storage.getCompanyMember(company.id, uid);
        if (!userMember) {
          return res.status(400).json({ message: `User ${uid} is not a member of this company` });
        }
      }
      
      // SET/REPLACE approach: get current assignments, compute adds and removes
      const currentAssignments = await storage.getJobCrewAssignments(jobId);
      const currentIds = new Set(currentAssignments.map((a: any) => a.userId));
      const newIds = new Set(userIds);
      
      // IDs to add
      const toAdd = userIds.filter((id: string) => !currentIds.has(id));
      // IDs to remove
      const toRemove = currentAssignments.filter((a: any) => !newIds.has(a.userId)).map((a: any) => a.userId);
      
      // Remove unselected crew members
      if (toRemove.length > 0) {
        await storage.removeJobCrewAssignments(jobId, toRemove);
      }
      
      // Add new crew members
      let added = 0;
      if (toAdd.length > 0) {
        const result = await storage.addJobCrewAssignments(jobId, toAdd, company.id, userId);
        added = result.added;
      }
      
      // Send notifications to newly assigned crew members
      if (toAdd.length > 0) {
        const assigner = await storage.getUser(userId);
        const assignerName = assigner ? `${assigner.firstName || ''} ${assigner.lastName || ''}`.trim() || 'Someone' : 'Someone';
        await notifyTechniciansOnly(toAdd, company.id, {
          type: 'job_assigned',
          title: 'New Job Assignment',
          body: `${assignerName} assigned you to job: ${job.title || job.jobNumber || `Job #${jobId}`}`,
          entityType: 'job',
          entityId: jobId,
          linkUrl: `/jobs/${jobId}`,
        });
      }

      // Send notifications to removed crew members
      if (toRemove.length > 0) {
        const jobLabel = job.title || job.jobNumber || `Job #${jobId}`;
        await notifyUsers(toRemove, {
          companyId: company.id,
          type: 'job_unassigned',
          title: 'Removed from Job',
          body: `You were removed from: ${jobLabel}`,
          entityType: 'job',
          entityId: jobId,
          linkUrl: `/jobs`,
        });
      }

      res.json({ ok: true, added, removed: toRemove.length });
    } catch (error) {
      console.error("Error assigning crew:", error);
      res.status(500).json({ message: "Failed to assign crew members" });
    }
  });

  // Remove a crew member from a job (Admin-only: Owner/Supervisor)
  app.delete('/api/jobs/:jobId/crew/:userId', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const company = await storage.getUserCompany(currentUserId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Check if user is admin (Owner or Supervisor)
      const member = await storage.getCompanyMember(company.id, currentUserId);
      const userRole = member?.role?.toUpperCase() || 'TECHNICIAN';
      
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "Only Owner or Supervisor can remove crew members" });
      }
      
      const jobId = parseInt(req.params.jobId);
      const targetUserId = req.params.userId;
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      await storage.removeJobCrewAssignment(jobId, targetUserId);
      
      res.json({ ok: true });
    } catch (error) {
      console.error("Error removing crew member:", error);
      res.status(500).json({ message: "Failed to remove crew member" });
    }
  });

  // Bulk remove crew members from a job (Admin-only: Owner/Supervisor)
  app.post('/api/jobs/:jobId/crew/remove', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const company = await storage.getUserCompany(currentUserId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Check if user is admin (Owner or Supervisor)
      const member = await storage.getCompanyMember(company.id, currentUserId);
      const userRole = member?.role?.toUpperCase() || 'TECHNICIAN';
      
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "Only Owner or Supervisor can remove crew members" });
      }
      
      const jobId = parseInt(req.params.jobId);
      const { userIds } = req.body;
      
      if (!Array.isArray(userIds)) {
        return res.status(400).json({ message: "userIds array is required" });
      }
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const result = await storage.removeJobCrewAssignments(jobId, userIds);
      
      res.json({ ok: true, removed: result.removed });
    } catch (error) {
      console.error("Error removing crew members:", error);
      res.status(500).json({ message: "Failed to remove crew members" });
    }
  });

  // Get job line items
  app.get('/api/jobs/:jobId/line-items', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const lineItems = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)).orderBy(jobLineItems.sortOrder);
      
      // Add subtotalCents as alias for lineTotalCents (pre-tax)
      // totalCents is now persisted in the database
      const lineItemsWithSubtotal = lineItems.map(item => ({
        ...item,
        subtotalCents: item.lineTotalCents, // lineTotalCents is the pre-tax subtotal
      }));
      
      res.json(lineItemsWithSubtotal);
    } catch (error) {
      console.error("Error fetching job line items:", error);
      res.status(500).json({ message: "Failed to fetch job line items" });
    }
  });

  // PATCH /api/jobs/:jobId/schedule - Save schedule to job
  app.patch('/api/jobs/:jobId/schedule', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const { scheduledDate, scheduledTime, scheduledEndTime, timezone } = req.body;
      
      // Store date and time as separate fields to avoid timezone conversion issues
      // The frontend sends YYYY-MM-DD and HH:mm, we store them as-is
      // Normalize time to 15-minute intervals (00, 15, 30, 45)
      const normalizeTimeTo15Min = (time: string): string => {
        if (!time) return '09:00';
        const [hours, mins] = time.split(':').map(Number);
        const normalizedMins = Math.floor(mins / 15) * 15;
        return `${hours.toString().padStart(2, '0')}:${normalizedMins.toString().padStart(2, '0')}`;
      };
      
      const incomingTime = scheduledTime || '09:00';
      const timeStr = normalizeTimeTo15Min(incomingTime);
      const endTimeStr = scheduledEndTime ? normalizeTimeTo15Min(scheduledEndTime) : null;
      
      if (timeStr !== incomingTime) {
        console.log('[ScheduleNormalize]', { incoming: incomingTime, normalized: timeStr });
      }
      
      // Update job with schedule - store date and time separately
      const [updated] = await db
        .update(jobs)
        .set({
          startDate: scheduledDate || null,
          scheduledTime: scheduledDate ? timeStr : null,
          scheduledEndTime: endTimeStr,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId))
        .returning();
      
      // Also update any estimate that was converted to this job
      // so the estimate card shows the schedule too
      if (scheduledDate) {
        await db
          .update(estimates)
          .set({
            scheduledDate: new Date(scheduledDate + 'T12:00:00'),
            scheduledTime: timeStr,
            scheduledEndTime: endTimeStr,
            updatedAt: new Date(),
          })
          .where(eq(estimates.convertedJobId, jobId));
      }
      
      console.log(`[ScheduleSave]`, { jobId, scheduledDate, scheduledTime: timeStr, scheduledEndTime: endTimeStr, timezone });
      
      // Check if schedule actually changed and send notification
      // Normalize old date to YYYY-MM-DD string for comparison
      const oldDateStr = job.startDate ? (typeof job.startDate === 'string' ? job.startDate.split('T')[0] : job.startDate.toISOString().split('T')[0]) : null;
      const oldTime = job.scheduledTime || null;
      const oldEndTime = job.scheduledEndTime || null;
      const newDateStr = scheduledDate || null;
      const newTime = scheduledDate ? timeStr : null;
      const newEndTime = endTimeStr;
      
      const scheduleChanged = oldDateStr !== newDateStr || oldTime !== newTime || oldEndTime !== newEndTime;
      if (scheduleChanged && newDateStr) {
        const dateFormatted = new Date(newDateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeFormatted = formatTime12Hour(newTime);
        await notifyJobCrewAndOffice(jobId, company.id, {
          type: 'job_rescheduled',
          title: 'Job Rescheduled',
          body: `${job.title || `Job #${jobId}`} rescheduled to ${dateFormatted} at ${timeFormatted}`,
          entityType: 'job',
          entityId: jobId,
          linkUrl: `/jobs/${jobId}`,
        });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error scheduling job:", error);
      res.status(500).json({ message: "Failed to schedule job" });
    }
  });

  // Job Photos routes
  app.get('/api/jobs/:jobId/photos', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const photos = await storage.getJobPhotos(jobId);
      res.json(photos);
    } catch (error) {
      console.error("Error fetching job photos:", error);
      res.status(500).json({ message: "Failed to fetch job photos" });
    }
  });

  app.post('/api/jobs/:jobId/photos', isAuthenticated, upload.single('photo'), async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const userId = getUserId(req.user);
      const file = req.file;

      if (!file) {
        return res.status(400).json({ message: "No photo file uploaded" });
      }

      // Move file to permanent location
      const fileName = `${Date.now()}-${file.originalname}`;
      const filePath = path.join('uploads', fileName);
      fs.renameSync(file.path, filePath);

      const photoData = {
        jobId,
        uploadedBy: userId,
        title: null, // Simplified: no longer capturing title
        description: null, // Simplified: no longer capturing description
        photoUrl: `/uploads/${fileName}`,
        location: req.body.location || null,
        phase: null, // Simplified: no longer capturing phase
        weather: null, // Simplified: no longer capturing weather
        isPublic: true,
      };

      const photo = await storage.createJobPhoto(photoData);
      res.status(201).json(photo);
    } catch (error) {
      console.error("Error uploading job photo:", error);
      res.status(500).json({ message: "Failed to upload photo" });
    }
  });

  app.delete('/api/jobs/photos/:photoId', isAuthenticated, async (req: any, res) => {
    try {
      const photoId = parseInt(req.params.photoId);
      await storage.deleteJobPhoto(photoId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting job photo:", error);
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  // Job Documents routes (for attachments on job detail page)
  app.get('/api/jobs/:jobId/documents', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Get documents for this job
      const allDocs = await storage.getDocuments(company.id);
      const jobDocs = allDocs.filter(doc => doc.jobId === jobId);
      
      res.json(jobDocs);
    } catch (error) {
      console.error("Error fetching job documents:", error);
      res.status(500).json({ message: "Failed to fetch job documents" });
    }
  });

  app.post('/api/jobs/:jobId/documents', isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      // Move file to permanent location
      const fileName = `${Date.now()}-${file.originalname}`;
      const filePath = path.join('uploads', fileName);
      fs.renameSync(file.path, filePath);
      
      const visibility = req.body.visibility || 'assigned_crew_only';
      
      const documentData = {
        companyId: company.id,
        jobId,
        name: file.originalname || `Attachment-${Date.now()}`,
        fileUrl: `/uploads/${fileName}`,
        type: file.mimetype,
        fileSize: file.size,
        visibility,
        uploadedBy: userId,
        category: 'Photos',
        status: 'Draft',
      };
      
      const document = await storage.createDocument(documentData);

      res.status(201).json(document);
    } catch (error) {
      console.error("Error uploading job document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // Document routes
  app.get('/api/documents', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Get user role for filtering
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role || 'TECHNICIAN';
      const normalizedRole = userRole.toUpperCase();

      if (normalizedRole === 'TECHNICIAN') {
        return res.status(403).json({ message: "Technicians cannot access the documents page" });
      }
      
      let docs = await storage.getDocuments(company.id);
      
      // OWNER bypasses all visibility restrictions
      if (normalizedRole === 'OWNER') {
        return res.json(docs);
      }
      
      // Get allowed visibility levels for this role
      const allowedVisibilities = getAllowedVisibilities(userRole);
      
      // Determine if user can access all jobs or only assigned ones
      const canSeeAllJobs = canAccessAllJobs(userRole);
      
      // Get user's assigned job IDs if needed
      let assignedJobIds: Set<number> = new Set();
      if (!canSeeAllJobs) {
        const userAssignments = await storage.getUserJobAssignments(userId);
        assignedJobIds = new Set(userAssignments.map(a => a.jobId));
      }
      
      // DEBUG: Log before filtering
      const countBeforeFilter = docs.length;
      
      // Filter documents by:
      // 1. Visibility level - must be in allowed visibilities for this role
      // 2. Job access - for job-scoped docs, technicians only see assigned jobs
      //    For company-scoped docs (no jobId), visibility alone determines access
      docs = docs.filter(doc => {
        // Check visibility level first
        const docVisibility = (doc.visibility || 'internal') as DocumentVisibility;
        if (!allowedVisibilities.includes(docVisibility)) {
          return false;
        }
        
        // For job-scoped documents, check job assignment if user can't see all jobs
        if (doc.jobId && !canSeeAllJobs) {
          // Only show job-scoped docs for jobs user is assigned to
          return assignedJobIds.has(doc.jobId);
        }
        
        // Company-scoped docs (no jobId) pass through if visibility allows
        return true;
      });
      
      // DEBUG: Log after filtering
      console.log('[Documents API Debug]', {
        role: normalizedRole,
        userId,
        countBeforeFilter,
        countAfterFilter: docs.length,
        allowedVisibilities,
        canSeeAllJobs,
        assignedJobIds: Array.from(assignedJobIds),
      });
      
      res.json(docs);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post('/api/documents', isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const { name, category, jobId, customerId, visibility } = req.body;
      
      // Get user role for permission check
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role || 'TECHNICIAN';
      
      // Role-based permission check: Can this role upload this category?
      if (!canUploadCategory(userRole, category)) {
        return res.status(403).json({ message: getPermissionErrorMessage('upload') });
      }
      
      // Check if this role requires a job for this category
      if (!jobId && !customerId && requireJobForUpload(userRole, category)) {
        return res.status(403).json({ message: "Documents of this type must be attached to a job or client" });
      }
      
      // Technicians can only upload to jobs they are assigned to
      if (userRole.toUpperCase() === 'TECHNICIAN' && jobId) {
        const assignments = await storage.getJobCrewAssignments(parseInt(jobId));
        const isAssigned = assignments.some(a => a.userId === userId);
        if (!isAssigned) {
          return res.status(403).json({ message: "You can only upload to jobs you are assigned to" });
        }
      }
      
      // Validate customerId belongs to the same company
      if (customerId) {
        const customer = await storage.getCustomer(parseInt(customerId));
        if (!customer || customer.companyId !== company.id) {
          return res.status(400).json({ message: "Invalid client selected" });
        }
      }
      
      const fileName = `${Date.now()}-${req.file.originalname}`;
      const filePath = `uploads/${fileName}`;
      
      // Move file to proper location
      const fs = await import('fs');
      fs.renameSync(req.file.path, filePath);
      
      const documentData = {
        companyId: company.id,
        jobId: jobId ? parseInt(jobId) : null,
        customerId: customerId ? parseInt(customerId) : null,
        name: name || req.file.originalname,
        type: req.file.mimetype,
        category: category || 'Other',
        visibility: visibility || 'internal',
        fileUrl: `/${filePath}`,
        fileSize: req.file.size,
        uploadedBy: userId,
      };
      
      const document = await storage.createDocument(documentData);

      res.status(201).json(document);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // Bulk delete documents - MUST come before :documentId route to avoid matching "bulk" as an ID
  app.delete('/api/documents/bulk', isAuthenticated, async (req: any, res) => {
    try {
      // SECURITY: Log only document IDs, not full body
      console.log('[DELETE] Bulk delete request, ids:', req.body?.ids?.length || 0);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        console.log('[DELETE] Company not found for user:', userId);
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Permission check: Only Admins can delete documents
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role || 'TECHNICIAN';
      console.log('[DELETE] User role:', userRole, 'canDelete:', canDelete(userRole));
      
      if (!canDelete(userRole)) {
        console.log('[DELETE] Permission denied for role:', userRole);
        return res.status(403).json({ message: getPermissionErrorMessage('delete') });
      }
      
      const { documentIds } = req.body;
      
      if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
        console.log('[DELETE] Invalid documentIds:', documentIds);
        return res.status(400).json({ message: "documentIds array is required" });
      }
      
      // Parse IDs as integers
      const ids = documentIds.map((id: string | number) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id));
      console.log('[DELETE] Parsed IDs:', ids);
      
      if (ids.length === 0) {
        console.log('[DELETE] No valid IDs after parsing');
        return res.status(400).json({ message: "No valid document IDs provided" });
      }
      
      // Get documents that belong to this company BEFORE deletion (for file cleanup)
      const docsToDelete = await storage.getDocumentsByIds(ids, company.id);
      console.log('[DELETE] Found', docsToDelete.length, 'documents belonging to company');
      
      // Delete files for company-owned documents only
      try {
        const fs = await import('fs');
        for (const doc of docsToDelete) {
          if (doc.fileUrl) {
            const filePath = doc.fileUrl.startsWith('/') ? doc.fileUrl.slice(1) : doc.fileUrl;
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log('[DELETE] Deleted file:', filePath);
            }
          }
        }
      } catch (fileError) {
        console.log('[DELETE] File deletion failed (continuing with DB delete):', fileError);
      }
      
      const deletedCount = await storage.deleteDocumentsBulk(ids, company.id);
      console.log('[DELETE] Bulk delete successful, count:', deletedCount);
      res.json({ success: true, deleted: deletedCount, deletedIds: ids, message: `Successfully deleted ${deletedCount} document(s)` });
    } catch (error) {
      console.error("[DELETE] Error bulk deleting documents:", error);
      res.status(500).json({ message: "Failed to delete documents" });
    }
  });

  // Single document delete - comes after /bulk to avoid route conflict
  app.delete('/api/documents/:documentId', isAuthenticated, async (req: any, res) => {
    try {
      console.log('[DELETE] Single delete request for documentId:', req.params.documentId);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        console.log('[DELETE] Company not found for user:', userId);
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Permission check: Only Admins can delete documents
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role || 'TECHNICIAN';
      console.log('[DELETE] User role:', userRole, 'canDelete:', canDelete(userRole));
      
      if (!canDelete(userRole)) {
        console.log('[DELETE] Permission denied for role:', userRole);
        return res.status(403).json({ message: getPermissionErrorMessage('delete') });
      }
      
      const documentId = parseInt(req.params.documentId);
      
      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      // SECURITY: Get document with company verification to prevent cross-tenant access
      const doc = await storage.getDocumentSecure(documentId, company.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Try to delete the file
      try {
        if (doc.fileUrl) {
          const fs = await import('fs');
          const filePath = doc.fileUrl.startsWith('/') ? doc.fileUrl.slice(1) : doc.fileUrl;
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('[DELETE] Deleted file:', filePath);
          }
        }
      } catch (fileError) {
        console.log('[DELETE] File deletion failed (continuing with DB delete):', fileError);
      }
      
      // SECURITY: Use secure delete method with company verification
      await storage.deleteDocumentSecure(documentId, company.id);
      console.log('[DELETE] Document deleted successfully:', documentId);
      res.json({ success: true, deletedIds: [documentId] });
    } catch (error) {
      console.error("[DELETE] Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.patch('/api/documents/:documentId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role || 'TECHNICIAN';
      
      const documentId = parseInt(req.params.documentId);
      const { status } = req.body;
      
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }
      
      // SECURITY: Get document with company verification to prevent cross-tenant access
      const doc = await storage.getDocumentSecure(documentId, company.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Check if user can change status for this category
      if (!canChangeStatus(userRole, doc.category)) {
        return res.status(403).json({ message: getPermissionErrorMessage('changeStatus') });
      }
      
      // Check if this specific transition is allowed
      if (!canTransitionStatus(userRole, doc.category, doc.status as DocumentStatus, status as DocumentStatus)) {
        return res.status(403).json({ message: "You don't have permission to make this status change" });
      }
      
      // SECURITY: Use secure update method with company verification
      const updatedDoc = await storage.updateDocumentSecure(documentId, company.id, { status });
      if (!updatedDoc) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(updatedDoc);
    } catch (error) {
      console.error("Error updating document:", error);
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  // Update document visibility (Owner + Supervisor only)
  app.patch('/api/documents/:documentId/visibility', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // Only Owner and Supervisor can change visibility
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "You don't have permission to change document visibility" });
      }
      
      const documentId = parseInt(req.params.documentId);
      const { visibility } = req.body;
      
      // Validate visibility value
      const validVisibilities = ['customer_internal', 'assigned_crew_only', 'office_only', 'internal', 'owner_only'];
      if (!visibility || !validVisibilities.includes(visibility)) {
        return res.status(400).json({ message: "Invalid visibility value" });
      }
      
      // Supervisor cannot set owner_only
      if (userRole === 'SUPERVISOR' && visibility === 'owner_only') {
        return res.status(403).json({ message: "Supervisors cannot set Owner Only visibility" });
      }
      
      // SECURITY: Use secure update method with company verification
      const updatedDoc = await storage.updateDocumentSecure(documentId, company.id, { visibility });
      if (!updatedDoc) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(updatedDoc);
    } catch (error) {
      console.error("Error updating document visibility:", error);
      res.status(500).json({ message: "Failed to update document visibility" });
    }
  });

  // ===================
  // Approval Workflow Routes
  // ===================
  
  // RBAC: Owner, Supervisor, Dispatcher, Estimator can create approvals (Technician cannot)
  const canCreateApproval = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR'].includes(upperRole);
  };

  // GET /api/approvals - List approval workflows for company
  app.get('/api/approvals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase() as UserRole;
      
      // Get all approval workflows for company
      const workflows = await storage.getApprovalWorkflows(company.id);
      
      // For each workflow, attach related job and document info if available
      const enrichedWorkflows = await Promise.all(workflows.map(async (workflow) => {
        let relatedJob = null;
        let relatedDocument = null;
        
        if (workflow.relatedJobId) {
          const job = await storage.getJob(workflow.relatedJobId);
          if (job) {
            relatedJob = { id: job.id, title: job.title, address: job.address };
          }
        }
        
        if (workflow.relatedDocumentId) {
          const doc = await storage.getDocument(workflow.relatedDocumentId);
          if (doc) {
            // Apply document visibility check - if user can't see doc, filter this workflow
            const allowedVisibilities = getAllowedVisibilities(userRole);
            if (userRole !== 'OWNER' && !allowedVisibilities.includes(doc.visibility as DocumentVisibility)) {
              return null; // User cannot see this workflow due to doc visibility
            }
            relatedDocument = { id: doc.id, name: doc.name, fileUrl: doc.fileUrl, category: doc.category };
          }
        }
        
        // Get signatures for this workflow
        const signatures = await storage.getApprovalSignatures(workflow.id);
        
        return {
          ...workflow,
          relatedJob,
          relatedDocument,
          signatures,
        };
      }));
      
      // Filter out nulls (workflows user can't see due to doc visibility)
      const visibleWorkflows = enrichedWorkflows.filter(w => w !== null);
      
      res.json(visibleWorkflows);
    } catch (error) {
      console.error("Error fetching approval workflows:", error);
      res.status(500).json({ message: "Failed to fetch approval workflows" });
    }
  });

  // GET /api/approvals/:id - Get single approval workflow with details
  app.get('/api/approvals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const workflowId = parseInt(req.params.id);
      const workflow = await storage.getApprovalWorkflow(workflowId);
      
      if (!workflow || workflow.companyId !== company.id) {
        return res.status(404).json({ message: "Approval workflow not found" });
      }
      
      // Get related data
      let relatedJob = null;
      let relatedDocument = null;
      
      if (workflow.relatedJobId) {
        const job = await storage.getJob(workflow.relatedJobId);
        if (job) {
          relatedJob = { id: job.id, title: job.title, address: job.address };
        }
      }
      
      if (workflow.relatedDocumentId) {
        const doc = await storage.getDocument(workflow.relatedDocumentId);
        if (doc) {
          relatedDocument = { id: doc.id, name: doc.name, fileUrl: doc.fileUrl, category: doc.category };
        }
      }
      
      const signatures = await storage.getApprovalSignatures(workflowId);
      const history = await storage.getApprovalHistory(workflowId);
      
      res.json({
        ...workflow,
        relatedJob,
        relatedDocument,
        signatures,
        history,
      });
    } catch (error) {
      console.error("Error fetching approval workflow:", error);
      res.status(500).json({ message: "Failed to fetch approval workflow" });
    }
  });

  // POST /api/approvals - Create new approval workflow
  app.post('/api/approvals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase() as UserRole;
      
      // RBAC check
      if (!canCreateApproval(userRole)) {
        return res.status(403).json({ message: "You don't have permission to create approval workflows" });
      }
      
      const { title, description, type, relatedJobId, relatedDocumentId, customerName, customerEmail } = req.body;
      
      if (!title || !type) {
        return res.status(400).json({ message: "Title and type are required" });
      }
      
      // Validate type
      const validTypes = ['estimate', 'change_order', 'authorization', 'other'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: "Invalid approval type" });
      }
      
      // If relatedDocumentId is provided, verify user can access it
      if (relatedDocumentId) {
        const doc = await storage.getDocument(relatedDocumentId);
        if (!doc || doc.companyId !== company.id) {
          return res.status(404).json({ message: "Document not found" });
        }
        
        // Check doc visibility
        const allowedVisibilities = getAllowedVisibilities(userRole);
        if (userRole !== 'OWNER' && !allowedVisibilities.includes(doc.visibility as DocumentVisibility)) {
          return res.status(403).json({ message: "You don't have access to this document" });
        }
      }
      
      // If relatedJobId is provided, verify it exists and belongs to company
      if (relatedJobId) {
        const job = await storage.getJob(relatedJobId);
        if (!job || job.companyId !== company.id) {
          return res.status(404).json({ message: "Job not found" });
        }
      }
      
      const workflow = await storage.createApprovalWorkflow({
        companyId: company.id,
        title,
        description: description || null,
        type,
        status: 'draft',
        relatedJobId: relatedJobId || null,
        relatedDocumentId: relatedDocumentId || null,
        customerName: customerName || null,
        customerEmail: customerEmail || null,
        createdBy: userId,
      });
      
      // Create history entry
      await storage.createApprovalHistory({
        workflowId: workflow.id,
        action: 'created',
        description: `Approval workflow "${title}" created`,
        performedBy: userId,
      });
      
      res.status(201).json(workflow);
    } catch (error) {
      console.error("Error creating approval workflow:", error);
      res.status(500).json({ message: "Failed to create approval workflow" });
    }
  });

  // POST /api/approvals/:id/signatures - Add signature request to workflow
  app.post('/api/approvals/:id/signatures', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canCreateApproval(userRole)) {
        return res.status(403).json({ message: "You don't have permission to add signature requests" });
      }
      
      const workflowId = parseInt(req.params.id);
      const workflow = await storage.getApprovalWorkflow(workflowId);
      
      if (!workflow || workflow.companyId !== company.id) {
        return res.status(404).json({ message: "Approval workflow not found" });
      }
      
      const { signerName, signerEmail, signerType } = req.body;
      
      if (!signerName || !signerEmail || !signerType) {
        return res.status(400).json({ message: "Signer name, email, and type are required" });
      }
      
      // Generate unique access token
      const accessToken = randomBytes(32).toString('hex');
      
      const signature = await storage.createApprovalSignature({
        workflowId,
        signerName,
        signerEmail,
        signerType,
        status: 'pending',
        accessToken,
      });
      
      // Create history entry
      await storage.createApprovalHistory({
        workflowId,
        action: 'signature_requested',
        description: `Signature requested from ${signerName} (${signerEmail})`,
        performedBy: userId,
      });
      
      res.status(201).json(signature);
    } catch (error) {
      console.error("Error adding signature request:", error);
      res.status(500).json({ message: "Failed to add signature request" });
    }
  });

  // ===================
  // Job Invoice Routes
  // ===================

  // Helper to check if user can create invoices (without assignment check)
  const canCreateInvoicesBase = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR'].includes(upperRole);
  };
  
  // Helper to check if user can create invoices (includes TECHNICIAN with assignment check done separately)
  const canCreateInvoices = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR', 'TECHNICIAN'].includes(upperRole);
  };

  // GET /api/jobs/:jobId/invoice - Get invoice for a job
  app.get('/api/jobs/:jobId/invoice', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const jobId = parseInt(req.params.jobId);
      const invoice = await storage.getInvoiceByJobId(jobId, company.id);
      
      if (!invoice) {
        return res.json({ invoice: null });
      }
      
      const computed = await recomputeInvoiceTotalsFromPayments(invoice.id);
      res.json({
        invoice: {
          ...invoice,
          paidAmountCents: computed.paidCents,
          balanceDueCents: computed.owedCents,
          computedStatus: computed.computedStatus,
        }
      });
    } catch (error) {
      console.error("Error fetching job invoice:", error);
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });

  // POST /api/jobs/:jobId/invoice - Create invoice record for a job
  app.post('/api/jobs/:jobId/invoice', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canCreateInvoices(userRole)) {
        return res.status(403).json({ message: "You do not have permission to create invoices" });
      }

      const jobId = parseInt(req.params.jobId);
      
      // For technicians, verify they are assigned to this job
      if (userRole === 'TECHNICIAN') {
        const crewAssignments = await storage.getJobCrewAssignments(jobId);
        const isAssigned = crewAssignments.some(c => c.userId === userId);
        if (!isAssigned) {
          return res.status(403).json({ message: "You can only create invoices for jobs you are assigned to" });
        }
      }
      
      // Check if invoice already exists for this job
      const existingInvoice = await storage.getInvoiceByJobId(jobId, company.id);
      if (existingInvoice) {
        return res.json({ invoice: existingInvoice, message: "Invoice already exists" });
      }
      
      // Get job with full details
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Get line items for this job
      const lineItems = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)).orderBy(jobLineItems.sortOrder);

      // Validation: Job must have line items
      if (!lineItems || lineItems.length === 0) {
        return res.status(400).json({ 
          message: "Add line items before creating an invoice.",
          code: "NO_LINE_ITEMS"
        });
      }

      // Validation: Job must have a customer
      if (!job.customerId && !job.clientId && !job.clientName) {
        return res.status(400).json({ 
          message: "Assign a customer before creating an invoice.",
          code: "NO_CUSTOMER"
        });
      }

      // Calculate totals from line items (subtotal, tax, and total)
      const subtotalCents = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
      const taxCents = lineItems.reduce((sum, item) => sum + (item.taxCents || 0), 0);
      const totalCents = subtotalCents + taxCents;
      const totalAmount = (totalCents / 100).toFixed(2);

      // Generate invoice number
      let invoiceNumber: string;
      try {
        const counter = await storage.getNextAtomicCounter(company.id, 'invoice');
        invoiceNumber = `INV-${counter.toString().padStart(5, '0')}`;
      } catch (err) {
        // Fallback to timestamp-based number
        invoiceNumber = `INV-${Date.now()}`;
      }

      // Create invoice record
      const today = new Date();
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + 30); // Due in 30 days

      const invoice = await storage.createInvoice({
        companyId: company.id,
        jobId: jobId,
        clientId: job.clientId || null,
        customerId: job.customerId || null,
        invoiceNumber,
        amount: totalAmount,
        subtotalCents,
        taxCents,
        totalCents,
        status: 'pending',
        issueDate: today.toISOString().split('T')[0],
        dueDate: dueDate.toISOString().split('T')[0],
        notes: `Invoice for job: ${job.title || job.clientName || 'Job #' + jobId}`,
        // Audit fields
        createdByUserId: userId,
        createdByRole: userRole,
      });

      // Auto-sync to QuickBooks (fire-and-forget, non-blocking)
      console.log('[QB] Auto-sync scheduled for invoiceId:', invoice.id);
      syncInvoiceToQuickBooks(invoice.id, company.id)
        .then(result => {
          if (result.success) {
            console.log('[QB] Auto-sync success invoiceId:', invoice.id, 'qboInvoiceId:', result.qboInvoiceId);
          } else {
            console.log('[QB] Auto-sync failed invoiceId:', invoice.id, 'error:', result.error);
          }
        })
        .catch(err => console.error('[QB] Auto-sync error invoiceId:', invoice.id, err.message));

      res.status(201).json({ invoice });
    } catch (error) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  // POST /api/jobs/:jobId/invoice/pdf - Generate invoice PDF for a job
  app.post('/api/jobs/:jobId/invoice/pdf', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canCreateInvoices(userRole)) {
        return res.status(403).json({ message: "You do not have permission to generate invoices" });
      }

      const jobId = parseInt(req.params.jobId);
      
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }

      const lineItems = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)).orderBy(jobLineItems.sortOrder);
      if (!lineItems || lineItems.length === 0) {
        return res.status(400).json({ 
          message: "Add line items before generating an invoice.",
          code: "NO_LINE_ITEMS"
        });
      }

      if (!job.customerId && !job.clientId && !job.clientName) {
        return res.status(400).json({ 
          message: "Assign a customer before generating an invoice.",
          code: "NO_CUSTOMER"
        });
      }

      const generated = await generateInvoicePdfForJob(jobId, company.id, userId);

      let previewImageUrl: string | null = null;
      try {
        const pdfBuffer = fs.readFileSync(generated.filePath);
        const pdfData = new Uint8Array(pdfBuffer);
        const pdfDoc = await pdfjs.getDocument({ data: pdfData }).promise;
        const page = await pdfDoc.getPage(1);
        
        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');
        
        await page.render({
          canvasContext: context as any,
          viewport: viewport,
        }).promise;
        
        const previewFileName = generated.fileName.replace('.pdf', '_preview.png');
        const previewPath = path.join('uploads', previewFileName);
        const pngBuffer = canvas.toBuffer('image/png');
        fs.writeFileSync(previewPath, pngBuffer);
        
        previewImageUrl = `/uploads/${previewFileName}`;
      } catch (previewError) {
        console.error('[Invoice] Failed to generate preview:', previewError);
      }

      const existingInvoice = await storage.getInvoiceByJobId(jobId, company.id);
      const invoiceId = existingInvoice?.id;

      const allDocs = await storage.getDocumentsByJob(jobId);
      const latestDoc = allDocs?.find((d: any) => d.fileUrl === generated.fileUrl);

      if (existingInvoice && !existingInvoice.qboInvoiceId) {
        console.log('[QB] Auto-sync scheduled for invoiceId:', existingInvoice.id);
        syncInvoiceToQuickBooks(existingInvoice.id, company.id)
          .then(result => {
            if (result.success) {
              console.log('[QB] Auto-sync success invoiceId:', existingInvoice.id, 'qboInvoiceId:', result.qboInvoiceId);
            } else {
              console.log('[QB] Auto-sync failed invoiceId:', existingInvoice.id, 'error:', result.error);
            }
          })
          .catch(err => console.error('[QB] Auto-sync error invoiceId:', existingInvoice.id, err.message));
      }

      console.log(`[Invoice] PDF generated jobId=${jobId} fileName=${generated.fileName} invoiceId=${invoiceId}`);
      res.json({ 
        pdfUrl: generated.fileUrl, 
        previewImageUrl,
        fileName: generated.fileName, 
        documentId: latestDoc?.id,
        invoiceId,
        invoiceNumber: generated.invoiceNumber,
        amount: (generated.totalCents / 100).toFixed(2),
      });
    } catch (error) {
      console.error("Error generating invoice PDF:", error);
      res.status(500).json({ message: "Failed to generate invoice PDF" });
    }
  });

  // GET /api/jobs/:jobId/invoice/pdf/latest - Get the latest invoice PDF for a job
  app.get('/api/jobs/:jobId/invoice/pdf/latest', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Get the latest invoice document for this job
      const docs = await storage.getDocumentsByJob(jobId);
      const invoiceDocs = docs.filter(d => d.type === 'invoice' || d.category === 'Invoices');
      
      if (!invoiceDocs.length) {
        return res.status(404).json({ pdfUrl: null, message: "No invoice found for this job" });
      }

      // Sort by createdAt desc and get the latest
      invoiceDocs.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      const latestDoc = invoiceDocs[0];

      // Check if preview image exists
      const previewFileName = latestDoc.name.replace('.pdf', '_preview.png');
      const previewPath = path.join('uploads', previewFileName);
      const previewImageUrl = fs.existsSync(previewPath) ? `/uploads/${previewFileName}` : null;

      // Try to find the matching invoice record
      let invoiceId: number | null = null;
      let invoiceAmount: string | null = null;
      let invoiceStatus: string | null = null;
      const allInvoices = await storage.getInvoices(company.id);
      const matchingInvoice = allInvoices.find((inv: any) => inv.jobId === jobId);
      if (matchingInvoice) {
        invoiceId = matchingInvoice.id;
        invoiceAmount = matchingInvoice.amount;
        invoiceStatus = matchingInvoice.status;
      }

      res.json({
        pdfUrl: latestDoc.fileUrl,
        fileName: latestDoc.name,
        previewImageUrl,
        documentId: latestDoc.id,
        invoiceId,
        invoiceAmount,
        invoiceStatus,
        createdAt: latestDoc.createdAt,
      });
    } catch (error) {
      console.error("Error fetching latest invoice PDF:", error);
      res.status(500).json({ message: "Failed to fetch latest invoice PDF" });
    }
  });

  // POST /api/jobs/:jobId/invoice/email - Send invoice PDF via email
  app.post('/api/jobs/:jobId/invoice/email', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canCreateInvoices(userRole)) {
        return res.status(403).json({ message: "You do not have permission to send invoices" });
      }

      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }

      const { toEmail, subject, message, pdfUrl } = req.body;
      
      if (!toEmail || !pdfUrl) {
        return res.status(400).json({ message: "Email address and PDF URL are required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(toEmail)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Verify the pdfUrl belongs to this job's invoice documents
      const docs = await storage.getDocumentsByJob(jobId);
      const invoiceDocs = docs.filter(d => d.type === 'invoice' || d.category === 'Invoices');
      const matchingDoc = invoiceDocs.find(doc => doc.fileUrl === pdfUrl);
      if (!matchingDoc) {
        console.warn(`[Invoice] Unauthorized PDF access attempt: ${pdfUrl} for job ${jobId} company ${company.id}`);
        return res.status(403).json({ message: "Invalid PDF document for this job" });
      }

      // Check if Resend is configured
      if (!process.env.RESEND_API_KEY) {
        return res.status(503).json({ 
          message: "Email not configured. Please configure RESEND_API_KEY to send emails.",
          code: "EMAIL_NOT_CONFIGURED"
        });
      }

      // Read PDF file with path traversal protection
      const uploadsDir = path.resolve('uploads');
      const rawPath = pdfUrl.startsWith('/') ? pdfUrl.substring(1) : pdfUrl;
      const resolvedPath = path.resolve(rawPath);
      
      // Ensure the resolved path is within the uploads directory
      if (!resolvedPath.startsWith(uploadsDir + path.sep) && resolvedPath !== uploadsDir) {
        console.warn(`[Invoice] Path traversal attempt blocked: ${pdfUrl}`);
        return res.status(400).json({ message: "Invalid PDF path" });
      }
      
      // Also verify the path starts with uploads/ prefix
      if (!rawPath.startsWith('uploads/') && !rawPath.startsWith('uploads\\')) {
        return res.status(400).json({ message: "Invalid PDF path" });
      }
      
      if (!fs.existsSync(resolvedPath)) {
        return res.status(400).json({ message: "PDF file not found. Please generate the invoice first." });
      }
      
      const pdfBuffer = fs.readFileSync(resolvedPath);
      const pdfFileName = path.basename(resolvedPath);

      const fromEmail = getResendFrom();
      console.log('[email] FROM used:', fromEmail);

      const emailSubject = subject || `Invoice from ${company.name}`;
      const emailBody = message || `Please find attached the invoice for your review.`;

      console.log("[InvoiceEmail] calling Resend now", { 
        fromEmail, 
        toEmail, 
        subject: emailSubject,
        pdfSize: pdfBuffer.length 
      });

      const resend = new Resend(process.env.RESEND_API_KEY);
      
      const { data, error } = await resend.emails.send({
        from: fromEmail,
        reply_to: 'no-reply@ecologicc.com',
        to: toEmail,
        subject: emailSubject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${company.name}</h2>
            <p style="color: #555; white-space: pre-line;">${emailBody}</p>
            <p style="color: #777; font-size: 12px; margin-top: 30px;">
              This invoice is attached as a PDF document.
            </p>
          </div>
        `,
        attachments: [
          {
            filename: pdfFileName,
            content: pdfBuffer,
          },
        ],
      });

      if (error) {
        console.error("[InvoiceEmail] Resend error", error);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to send email", 
          error: error.message || error 
        });
      }

      console.log("[InvoiceEmail] Resend result", { id: data?.id });
      console.log(`[InvoiceEmail] Email sent jobId=${jobId} toEmail=${toEmail}`);
      res.json({ success: true, message: "Invoice sent successfully", id: data?.id });
    } catch (error: any) {
      console.error("Error sending invoice email:", error);
      if (error.message?.includes('API key')) {
        return res.status(503).json({ 
          message: "Email service configuration error. Please check RESEND_API_KEY.",
          code: "EMAIL_NOT_CONFIGURED"
        });
      }
      res.status(500).json({ message: "Failed to send email" });
    }
  });

  // ===================
  // Customer Routes
  // ===================

  // Helper to check if user can create customers (Technician cannot)
  const canCreateCustomers = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR'].includes(upperRole);
  };

  // GET /api/customers - List all customers for the company
  app.get('/api/customers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const customers = await storage.getCustomers(company.id);
      console.log(`[Customers] list userId=${userId} companyId=${company.id} count=${customers.length}`);
      res.json(customers);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  // POST /api/customers - Create a new customer
  app.post('/api/customers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Technician cannot create customers
      if (!canCreateCustomers(userRole)) {
        return res.status(403).json({ message: "You do not have permission to create customers" });
      }

      // Validate request body
      const parseResult = insertCustomerSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: parseResult.error.flatten().fieldErrors 
        });
      }

      const customer = await storage.createCustomer({
        ...parseResult.data,
        companyId: company.id,
      });

      console.log(`[Customers] create customerId=${customer.id} companyId=${company.id} name=${customer.firstName} ${customer.lastName}`);
      res.status(201).json(customer);
    } catch (error) {
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  // PATCH /api/customers/:id - Update a customer
  app.patch('/api/customers/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!['OWNER', 'SUPERVISOR'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to edit customers" });
      }
      
      const customerId = parseInt(req.params.id);
      const customer = await storage.getCustomer(customerId);
      
      if (!customer || customer.companyId !== company.id) {
        return res.status(404).json({ message: "Customer not found" });
      }
      
      // Filter allowed fields for update
      const allowedFields = ['firstName', 'lastName', 'email', 'phone', 'address', 'companyName', 'companyNumber', 'jobTitle', 'notes'];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      
      // Update the customer with provided fields
      const updatedCustomer = await storage.updateCustomer(customerId, updates);
      
      console.log(`[Customers] update customerId=${customerId} userId=${userId}`);
      res.json(updatedCustomer);
    } catch (error) {
      console.error("Error updating customer:", error);
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  // GET /api/customers/:id - Get a single customer by ID
  app.get('/api/customers/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const customerId = parseInt(req.params.id);
      const customer = await storage.getCustomer(customerId);
      
      if (!customer || customer.companyId !== company.id) {
        return res.status(404).json({ message: "Customer not found" });
      }
      
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  // GET /api/customers/:id/jobs - Get jobs for a customer
  app.get('/api/customers/:id/jobs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const customerId = parseInt(req.params.id);
      const customer = await storage.getCustomer(customerId);
      
      if (!customer || customer.companyId !== company.id) {
        return res.status(404).json({ message: "Customer not found" });
      }
      
      // Get jobs for this customer (Job table has customerId field)
      const allJobs = await storage.getJobs(company.id);
      const customerJobs = allJobs.filter(job => job.customerId === customerId);
      
      // Sort by createdAt descending (newest first)
      customerJobs.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      res.json(customerJobs);
    } catch (error) {
      console.error("Error fetching customer jobs:", error);
      res.status(500).json({ message: "Failed to fetch customer jobs" });
    }
  });

  // GET /api/customers/:id/estimates - Get estimates for a customer
  app.get('/api/customers/:id/estimates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Technician cannot access estimates
      if (!canAccessEstimates(userRole)) {
        return res.status(403).json({ message: "You do not have permission to view estimates" });
      }
      
      const customerId = parseInt(req.params.id);
      const customer = await storage.getCustomer(customerId);
      
      if (!customer || customer.companyId !== company.id) {
        return res.status(404).json({ message: "Customer not found" });
      }
      
      // Get estimates for this customer (Estimate table uses customerId)
      const allEstimates = await storage.getEstimatesByCompany(company.id);
      const customerEstimates = allEstimates.filter(est => est.customerId === customerId);
      
      // Sort by createdAt descending (newest first)
      customerEstimates.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      res.json(customerEstimates);
    } catch (error) {
      console.error("Error fetching customer estimates:", error);
      res.status(500).json({ message: "Failed to fetch customer estimates" });
    }
  });

  // DELETE /api/customers/bulk - Bulk delete customers
  app.delete('/api/customers/bulk', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Only Owner and Supervisor can delete customers
      if (!['OWNER', 'SUPERVISOR'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to delete customers" });
      }

      const { customerIds } = req.body;
      
      if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
        return res.status(400).json({ message: "customerIds array is required" });
      }

      // Verify all customers belong to this company
      const allCustomers = await storage.getCustomers(company.id);
      const companyCustomerIds = new Set(allCustomers.map(c => c.id));
      const invalidIds = customerIds.filter((id: number) => !companyCustomerIds.has(id));
      
      if (invalidIds.length > 0) {
        return res.status(403).json({ message: "Some customers do not belong to your company" });
      }

      const deletedCount = await storage.deleteCustomersBulk(customerIds);
      
      console.log(`[Customers] bulkDelete userId=${userId} companyId=${company.id} count=${deletedCount}`);
      res.json({ message: "Customers deleted successfully", deletedCount });
    } catch (error) {
      console.error("Error bulk deleting customers:", error);
      res.status(500).json({ message: "Failed to delete customers" });
    }
  });

  // ===================
  // Campaign Routes (Bulk email/SMS messaging)
  // ===================

  // Helper to check if user can send campaigns (Owner, Supervisor, Dispatcher only)
  const canSendCampaigns = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR'].includes(upperRole);
  };

  // POST /api/campaigns/preview - Get counts of eligible recipients
  app.post('/api/campaigns/preview', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Only Owner/Supervisor/Dispatcher can send campaigns
      if (!canSendCampaigns(userRole)) {
        return res.status(403).json({ message: "You do not have permission to send campaigns" });
      }

      const { customerIds, channel, audienceMode } = req.body;
      
      if (!channel || !['email', 'sms', 'both'].includes(channel)) {
        return res.status(400).json({ message: "channel must be 'email', 'sms', or 'both'" });
      }

      // Fetch all customers for this company
      const allCustomers = await storage.getCustomers(company.id);
      
      // Determine selected customers based on audience mode
      let selectedCustomers;
      if (audienceMode === 'all') {
        selectedCustomers = allCustomers;
      } else {
        if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
          return res.status(400).json({ message: "customerIds array is required when not using 'all' audience mode" });
        }
        selectedCustomers = allCustomers.filter(c => customerIds.includes(c.id));
      }
      
      // Filter for email eligibility
      const emailEligible = selectedCustomers.filter(c => 
        c.email && 
        c.emailOptIn === true && 
        !c.emailUnsubscribedAt
      );
      
      // Filter for SMS eligibility
      const smsEligible = selectedCustomers.filter(c => 
        c.phone && 
        c.smsOptIn === true && 
        !c.smsUnsubscribedAt
      );
      
      // Build exclusion summary
      const excluded: { reason: string; count: number }[] = [];
      
      const noEmailOrNotOptedIn = selectedCustomers.filter(c => 
        !c.email || c.emailOptIn !== true || c.emailUnsubscribedAt
      ).length;
      
      const noPhoneOrNotOptedIn = selectedCustomers.filter(c => 
        !c.phone || c.smsOptIn !== true || c.smsUnsubscribedAt
      ).length;
      
      if ((channel === 'email' || channel === 'both') && noEmailOrNotOptedIn > 0) {
        excluded.push({ reason: 'No email or not opted in', count: noEmailOrNotOptedIn });
      }
      
      if ((channel === 'sms' || channel === 'both') && noPhoneOrNotOptedIn > 0) {
        excluded.push({ reason: 'No phone or not opted in for SMS', count: noPhoneOrNotOptedIn });
      }

      const result = {
        emailCount: (channel === 'email' || channel === 'both') ? emailEligible.length : 0,
        smsCount: (channel === 'sms' || channel === 'both') ? smsEligible.length : 0,
        emailEligibleIds: (channel === 'email' || channel === 'both') ? emailEligible.map(c => c.id) : [],
        smsEligibleIds: (channel === 'sms' || channel === 'both') ? smsEligible.map(c => c.id) : [],
        excluded,
        totalSelected: selectedCustomers.length,
      };

      console.log(`[Campaigns] preview userId=${userId} companyId=${company.id} channel=${channel} emailCount=${result.emailCount} smsCount=${result.smsCount}`);
      res.json(result);
    } catch (error) {
      console.error("Error previewing campaign:", error);
      res.status(500).json({ message: "Failed to preview campaign" });
    }
  });

  // POST /api/campaigns/recipients - Get detailed list of recipients with eligibility
  app.post('/api/campaigns/recipients', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canSendCampaigns(userRole)) {
        return res.status(403).json({ message: "You do not have permission to send campaigns" });
      }

      const { customerIds, channel, audienceMode } = req.body;
      
      if (!channel || !['email', 'sms', 'both'].includes(channel)) {
        return res.status(400).json({ message: "channel must be 'email', 'sms', or 'both'" });
      }

      const allCustomers = await storage.getCustomers(company.id);
      
      let selectedCustomers;
      if (audienceMode === 'all') {
        selectedCustomers = allCustomers;
      } else {
        if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
          return res.status(400).json({ message: "customerIds array is required when not using 'all' audience mode" });
        }
        selectedCustomers = allCustomers.filter(c => customerIds.includes(c.id));
      }
      
      const recipients = selectedCustomers.map(c => {
        const emailUnsubscribed = !!(c.emailUnsubscribedAt || c.emailOptIn === false);
        const smsUnsubscribed = !!(c.smsUnsubscribedAt || c.smsOptIn === false);
        const emailEligible = !!(c.email && c.emailOptIn === true && !c.emailUnsubscribedAt);
        const phoneDigits = c.phone ? c.phone.replace(/\D/g, '') : '';
        const smsEligible = !!(c.phone && phoneDigits.length >= 10 && c.smsOptIn === true && !c.smsUnsubscribedAt);
        
        let emailDisabledReason: string | null = null;
        let smsDisabledReason: string | null = null;
        
        if (!emailEligible) {
          if (!c.email) emailDisabledReason = "No email";
          else if (c.emailUnsubscribedAt) emailDisabledReason = "Unsubscribed";
          else if (!c.emailOptIn) emailDisabledReason = "Not opted in";
        }
        
        if (!smsEligible) {
          if (!c.phone) smsDisabledReason = "No phone";
          else if (c.phone.replace(/\D/g, '').length < 10) smsDisabledReason = "Invalid phone";
          else if (c.smsUnsubscribedAt) smsDisabledReason = "Unsubscribed";
          else if (!c.smsOptIn) smsDisabledReason = "Not opted in";
        }
        
        return {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          companyName: c.companyName,
          email: c.email,
          phone: c.phone,
          emailEligible,
          smsEligible,
          emailDisabledReason,
          smsDisabledReason,
          emailUnsubscribed,
          smsUnsubscribed,
        };
      });

      const emailCount = recipients.filter(r => r.emailEligible).length;
      const smsCount = recipients.filter(r => r.smsEligible).length;

      res.json({ recipients, emailCount, smsCount });
    } catch (error) {
      console.error("Error fetching campaign recipients:", error);
      res.status(500).json({ message: "Failed to fetch recipients" });
    }
  });

  // POST /api/campaigns/send - Send campaign to selected customers
  app.post('/api/campaigns/send', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Only Owner/Supervisor/Dispatcher can send campaigns
      if (!canSendCampaigns(userRole)) {
        return res.status(403).json({ message: "You do not have permission to send campaigns" });
      }

      const { customerIds, channel, subject, emailBody, smsBody, audienceMode, includeUnsubscribed } = req.body;
      
      if (!channel || !['email', 'sms', 'both'].includes(channel)) {
        return res.status(400).json({ message: "channel must be 'email', 'sms', or 'both'" });
      }
      
      // If includeUnsubscribed is set, verify admin role (OWNER/SUPERVISOR only)
      const isAdmin = userRole === 'OWNER' || userRole === 'SUPERVISOR';
      if (includeUnsubscribed && !isAdmin) {
        return res.status(403).json({ message: "Only administrators can send to unsubscribed recipients" });
      }
      
      // Validate required fields based on channel
      if ((channel === 'email' || channel === 'both') && (!subject || !emailBody)) {
        return res.status(400).json({ message: "Subject and email body are required for email campaigns" });
      }
      
      if ((channel === 'sms' || channel === 'both') && !smsBody) {
        return res.status(400).json({ message: "SMS body is required for text campaigns" });
      }

      // Import messaging service
      const { sendBrandedCampaignEmail, sendCampaignSms } = await import('./services/messaging');

      // Fetch email branding settings for this company
      const emailBranding = await storage.getEmailBranding(company.id);

      // Fetch all customers for this company
      const allCustomers = await storage.getCustomers(company.id);
      
      // Determine selected customers based on audience mode
      let selectedCustomers;
      if (audienceMode === 'all') {
        selectedCustomers = allCustomers;
      } else {
        if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
          return res.status(400).json({ message: "customerIds array is required when not using 'all' audience mode" });
        }
        selectedCustomers = allCustomers.filter(c => customerIds.includes(c.id));
      }
      
      // Rate limit: max 500 recipients per send
      if (selectedCustomers.length > 500) {
        return res.status(400).json({ message: "Maximum 500 recipients per campaign" });
      }
      
      // Filter for email eligibility
      // If admin override is enabled, include unsubscribed recipients
      const emailEligible = selectedCustomers.filter(c => {
        if (!c.email) return false;
        if (includeUnsubscribed && isAdmin) {
          // Admin override: include even if unsubscribed
          return true;
        }
        return c.emailOptIn === true && !c.emailUnsubscribedAt;
      });
      
      // Filter for SMS eligibility with diagnostic tracking
      let skippedNoPhone = 0;
      let skippedOptedOut = 0;
      let skippedInvalidPhone = 0;
      const smsEligible = selectedCustomers.filter(c => {
        if (!c.phone) { skippedNoPhone++; return false; }
        const digitsOnly = c.phone.replace(/\D/g, '');
        if (digitsOnly.length < 10) { skippedInvalidPhone++; return false; }
        if (includeUnsubscribed && isAdmin) {
          return true;
        }
        if (c.smsOptIn === false || c.smsUnsubscribedAt) { skippedOptedOut++; return false; }
        return true;
      });

      console.log(`[Campaigns] SMS eligibility: total=${selectedCustomers.length} eligible=${smsEligible.length} skippedNoPhone=${skippedNoPhone} skippedInvalidPhone=${skippedInvalidPhone} skippedOptedOut=${skippedOptedOut}`);

      // Block send if no eligible recipients for the selected channel
      if (channel === 'sms' && smsEligible.length === 0) {
        return res.status(400).json({
          error: "NO_ELIGIBLE_RECIPIENTS",
          message: "No clients have valid phone numbers or SMS consent.",
          skippedNoPhone,
          skippedInvalidPhone,
          skippedOptedOut,
        });
      }
      if (channel === 'email' && emailEligible.length === 0) {
        return res.status(400).json({
          error: "NO_ELIGIBLE_RECIPIENTS",
          message: "No clients have valid email addresses or email consent.",
        });
      }
      if (channel === 'both' && emailEligible.length === 0 && smsEligible.length === 0) {
        return res.status(400).json({
          error: "NO_ELIGIBLE_RECIPIENTS",
          message: "No clients are eligible for email or SMS.",
        });
      }

      // Compute body - use emailBody for email/both, smsBody for sms-only
      const body = channel === 'sms' ? smsBody : emailBody;
      
      // Create campaign record
      const campaign = await storage.createCampaign({
        companyId: company.id,
        sentByUserId: userId,
        channel,
        subject: subject || null,
        body: body!, // Required - already validated above
        emailBody: emailBody || null,
        smsBody: smsBody || null,
        status: 'sent',
        recipientCount: (channel === 'email' ? emailEligible.length : 0) + 
                        (channel === 'sms' ? smsEligible.length : 0) +
                        (channel === 'both' ? emailEligible.length + smsEligible.length : 0),
        emailCount: (channel === 'email' || channel === 'both') ? emailEligible.length : 0,
        smsCount: (channel === 'sms' || channel === 'both') ? smsEligible.length : 0,
      });

      const results = {
        campaignId: campaign.id,
        emailSent: 0,
        emailFailed: 0,
        smsSent: 0,
        smsFailed: 0,
        errors: [] as string[],
      };

      // Send emails
      if (channel === 'email' || channel === 'both') {
        for (const customer of emailEligible) {
          const recipientRecord = await storage.createCampaignRecipient({
            campaignId: campaign.id,
            customerId: customer.id,
            channel: 'email',
            destination: customer.email!,
            status: 'queued',
          });

          // Generate unsubscribe URL for this recipient
          const { generateUnsubscribeUrl } = await import('./services/unsubscribe');
          const unsubscribeUrl = generateUnsubscribeUrl(company.id, customer.id, 'email');
          console.log(`[Campaign] Email unsubscribe URL for customer ${customer.id}: ${unsubscribeUrl}`);
          
          const result = await sendBrandedCampaignEmail({
            to: customer.email!,
            subject: subject!,
            body: emailBody!,
            companyName: company.name,
            branding: emailBranding,
            company: company,
            unsubscribeUrl,
          });

          if (result.success) {
            await storage.updateCampaignRecipient(recipientRecord.id, {
              status: 'sent',
              providerMessageId: result.messageId || null,
            });
            results.emailSent++;
          } else {
            await storage.updateCampaignRecipient(recipientRecord.id, {
              status: 'failed',
              errorMessage: result.error || 'Unknown error',
            });
            results.emailFailed++;
            if (result.error && !results.errors.includes(result.error)) {
              results.errors.push(result.error);
            }
          }
        }
      }

      // Send SMS
      if (channel === 'sms' || channel === 'both') {
        for (const customer of smsEligible) {
          const recipientRecord = await storage.createCampaignRecipient({
            campaignId: campaign.id,
            customerId: customer.id,
            channel: 'sms',
            destination: customer.phone!,
            status: 'queued',
          });

          const smsBodyWithOptOut = smsBody!.includes('STOP')
            ? smsBody!
            : smsBody! + '\n\nReply STOP to opt out';

          const result = await sendCampaignSms({
            to: customer.phone!,
            body: smsBodyWithOptOut,
          });

          if (result.success) {
            await storage.updateCampaignRecipient(recipientRecord.id, {
              status: 'sent',
              providerMessageId: result.messageId || null,
            });
            results.smsSent++;
          } else {
            await storage.updateCampaignRecipient(recipientRecord.id, {
              status: 'failed',
              errorMessage: result.error || 'Unknown error',
            });
            results.smsFailed++;
            if (result.error && !results.errors.includes(result.error)) {
              results.errors.push(result.error);
            }
          }
        }
      }

      console.log(`[Campaigns] send campaignId=${campaign.id} userId=${userId} companyId=${company.id} emailSent=${results.emailSent} smsSent=${results.smsSent}`);
      res.json(results);
    } catch (error: any) {
      console.error("Error sending campaign:", error);
      const errorMessage = error?.message || "Failed to send campaign";
      res.status(500).json({ 
        message: "Failed to send campaign", 
        detail: process.env.NODE_ENV === 'development' ? errorMessage : undefined 
      });
    }
  });

  // POST /api/webhooks/sms - Handle inbound SMS (STOP/unsubscribe)
  app.post('/api/webhooks/sms', async (req: any, res) => {
    try {
      const { From, Body } = req.body;
      
      if (!From || !Body) {
        return res.status(200).send('OK'); // Acknowledge even if incomplete
      }

      const normalizedBody = Body.trim().toLowerCase();
      const stopKeywords = ['stop', 'unsubscribe', 'cancel', 'end', 'quit'];
      
      if (stopKeywords.includes(normalizedBody)) {
        // Find customer by phone number
        const phone = From.replace(/\D/g, '');
        const customer = await storage.findCustomerByPhone(phone);
        
        if (customer) {
          await storage.updateCustomer(customer.id, {
            smsOptIn: false,
            smsUnsubscribedAt: new Date(),
          });
          console.log(`[Webhooks] SMS unsubscribe phone=${From} customerId=${customer.id}`);
        } else {
          console.log(`[Webhooks] SMS unsubscribe phone=${From} - customer not found`);
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error("Error processing SMS webhook:", error);
      res.status(200).send('OK'); // Always acknowledge to Twilio
    }
  });

  app.post('/api/webhooks/plaid/refund', async (req: any, res) => {
    try {
      const webhookSecret = process.env.PLAID_WEBHOOK_SECRET;
      if (webhookSecret) {
        const providedSecret = req.headers['x-plaid-webhook-secret'] || req.body?.webhook_secret;
        if (providedSecret !== webhookSecret) {
          console.warn('[Plaid Webhook] Unauthorized: invalid webhook secret');
          return res.status(401).json({ error: 'Unauthorized' });
        }
      } else {
        console.warn('[Plaid Webhook] No PLAID_WEBHOOK_SECRET configured - webhook verification skipped');
      }

      const { transfer_id, new_status } = req.body;
      if (!transfer_id || !new_status) {
        return res.status(200).json({ received: true });
      }

      const refund = await storage.getRefundByPlaidTransferId(transfer_id);
      if (!refund) {
        console.log(`[Plaid Webhook] Refund not found for transfer_id=${transfer_id}`);
        return res.status(200).json({ received: true });
      }

      const validStatuses = new Set(['posted', 'settled', 'failed', 'returned']);
      if (!validStatuses.has(new_status)) {
        console.log(`[Plaid Webhook] Unknown status "${new_status}" for transfer_id=${transfer_id}`);
        return res.status(200).json({ received: true });
      }

      const statusMap: Record<string, string> = {
        posted: 'pending',
        settled: 'settled',
        failed: 'failed',
        returned: 'returned',
      };
      const mappedStatus = statusMap[new_status] || new_status;

      await storage.updateRefundStatus(refund.id, mappedStatus);
      console.log(`[Plaid Webhook] Refund #${refund.id} status -> ${mappedStatus} (plaid: ${new_status})`);

      const isNowSettled = mappedStatus === 'settled' || mappedStatus === 'succeeded';
      if (isNowSettled) {
        const payment = await storage.getPaymentById(refund.paymentId);
        if (payment) {
          const paymentAmountCents = payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100);

          const allPaymentRefunds = await storage.getRefundsByPaymentId(refund.paymentId);
          const settledStatuses = new Set(['succeeded', 'settled']);
          let settledRefundTotal = 0;
          for (const r of allPaymentRefunds) {
            if (settledStatuses.has(r.id === refund.id ? mappedStatus : r.status)) {
              settledRefundTotal += r.amountCents;
            }
          }

          let paymentStatus = 'paid';
          if (settledRefundTotal >= paymentAmountCents) {
            paymentStatus = 'refunded';
          } else if (settledRefundTotal > 0) {
            paymentStatus = 'partially_refunded';
          }

          await storage.updatePayment(payment.id, {
            refundedAmountCents: settledRefundTotal,
            status: paymentStatus,
          });

          if (payment.invoiceId) {
            const invoice = await storage.getInvoice(payment.invoiceId);
            if (invoice) {
              const invoiceTotalCents = invoice.totalCents || Math.round(parseFloat(invoice.amount || '0') * 100);
              const allPayments = await storage.getPaymentsByInvoiceId(payment.invoiceId);

              let totalPaymentsCents = 0;
              let totalRefundedOnPayments = 0;
              for (const p of allPayments) {
                const pAmt = p.amountCents || Math.round(parseFloat(p.amount || '0') * 100);
                totalPaymentsCents += pAmt;
                totalRefundedOnPayments += (p.id === payment.id ? settledRefundTotal : (p.refundedAmountCents || 0));
              }

              const balanceDueCents = Math.max(0, invoiceTotalCents - totalPaymentsCents);

              let invoiceStatus: string;
              if (totalPaymentsCents === 0) {
                invoiceStatus = 'pending';
              } else if (totalPaymentsCents < invoiceTotalCents) {
                invoiceStatus = 'partial';
              } else {
                if (totalRefundedOnPayments === 0) {
                  invoiceStatus = 'paid';
                } else if (totalRefundedOnPayments >= totalPaymentsCents) {
                  invoiceStatus = 'refunded';
                } else {
                  invoiceStatus = 'partially_refunded';
                }
              }

              await storage.updateInvoice(payment.invoiceId, {
                paidAmountCents: totalPaymentsCents,
                balanceDueCents,
                status: invoiceStatus,
              } as any);

              if (invoice.jobId) {
                const jobPaymentStatus = balanceDueCents === 0 && totalPaymentsCents > 0 ? 'paid' : totalPaymentsCents > 0 ? 'partial' : 'unpaid';
                await storage.updateJob(invoice.jobId, {
                  paymentStatus: jobPaymentStatus,
                  ...(jobPaymentStatus === 'paid' ? { paidAt: new Date() } : {}),
                } as any);
                if (jobPaymentStatus === 'paid') {
                  await tryArchiveCompletedPaidJob(invoice.jobId);
                }
              }
            }
          }
        }
      }

      res.status(200).json({ received: true, status: mappedStatus });
    } catch (error) {
      console.error("[Plaid Webhook] Error processing refund webhook:", error);
      res.status(200).json({ received: true });
    }
  });

  // ===================
  // Estimate Routes (Job-scoped estimates with line items)
  // ===================

  // Helper to check if user can access estimates (Technician cannot)
  const canAccessEstimates = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR'].includes(upperRole);
  };

  // GET /api/estimates - List all estimates for the company (main page view)
  app.get('/api/estimates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Technician cannot access estimates
      if (!canAccessEstimates(userRole)) {
        return res.status(403).json({ message: "You do not have permission to view estimates" });
      }

      const includeArchived = req.query.includeArchived === 'true';
      const allEstimates = await storage.getEstimatesByCompany(company.id);

      let filtered = allEstimates;
      if (!includeArchived) {
        filtered = allEstimates.filter(est => !est.archivedAt);
      }

      res.json(filtered);
    } catch (error) {
      console.error("Error fetching all estimates:", error);
      res.status(500).json({ message: "Failed to fetch estimates" });
    }
  });

  // GET /api/jobs/:jobId/estimates - List estimates for a job
  app.get('/api/jobs/:jobId/estimates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Technician cannot access estimates
      if (!canAccessEstimates(userRole)) {
        return res.status(403).json({ message: "You do not have permission to view estimates" });
      }

      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }

      const estimates = await storage.getEstimatesByJob(jobId);
      console.log(`[Estimates] list jobId=${jobId} userId=${userId} companyId=${company.id} count=${estimates.length}`);
      res.json(estimates);
    } catch (error) {
      console.error("Error fetching estimates:", error);
      res.status(500).json({ message: "Failed to fetch estimates" });
    }
  });

  // POST /api/jobs/:jobId/estimates - Create a new estimate for a job
  app.post('/api/jobs/:jobId/estimates', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;

      const jobId = parseInt(req.params.jobId);
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== companyId) {
        return res.status(404).json({ message: "Job not found" });
      }

      const { title, notes, items, customerId, customerName, customerEmail, customerPhone, customerAddress, taxCents, assignedEmployeeIds, jobType, scheduledDate, scheduledTime, requestedStartAt } = req.body;

      console.log('[Estimates] create request received:', { jobId, requestedStartAt, scheduledDate, scheduledTime, bodyKeys: Object.keys(req.body) });

      // Auto-generate title if not provided
      let estimateTitle = title?.trim();
      if (!estimateTitle) {
        estimateTitle = customerName?.trim() ? `${customerName.trim()} – Estimate` : "Estimate";
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
      }

      // Parse and validate taxCents
      let parsedTaxCents = 0;
      if (taxCents !== undefined && taxCents !== null && taxCents !== '') {
        parsedTaxCents = typeof taxCents === 'number' 
          ? Math.round(taxCents) 
          : Math.round(parseFloat(taxCents));
        if (isNaN(parsedTaxCents) || parsedTaxCents < 0) {
          parsedTaxCents = 0;
        }
      }

      // Validate and normalize items
      const normalizedItems = [];
      for (const item of items) {
        if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
          return res.status(400).json({ message: "Each item must have a name" });
        }
        const unitPriceCents = typeof item.unitPriceCents === 'number' 
          ? Math.round(item.unitPriceCents) 
          : Math.round(parseFloat(item.unitPriceCents));
        if (isNaN(unitPriceCents) || unitPriceCents < 0) {
          return res.status(400).json({ message: "Each item must have a valid unit price (in cents)" });
        }
        if (item.quantity === undefined || item.quantity === null || item.quantity === '') {
          return res.status(400).json({ message: "Each item must have a quantity" });
        }
        const quantity = String(item.quantity);
        const parsedQty = parseFloat(quantity);
        if (isNaN(parsedQty) || parsedQty <= 0) {
          return res.status(400).json({ message: "Each item must have a valid quantity greater than 0" });
        }
        normalizedItems.push({
          name: item.name.trim(),
          description: item.description?.trim() || null,
          taskCode: item.taskCode?.trim() || null,
          quantity,
          unitPriceCents,
          unit: item.unit?.trim() || 'each',
          taxable: item.taxable ?? false,
          taxId: item.taxId || null,
          taxRatePercentSnapshot: item.taxRatePercentSnapshot || null,
          taxNameSnapshot: item.taxNameSnapshot || null,
          taxCents: item.taxCents ?? 0,
          sortOrder: item.sortOrder,
        });
      }

      // Process requestedStartAt - this is the single source of truth for estimate schedule
      // Accept requestedStartAt (ISO string) OR fall back to scheduledDate+scheduledTime for backward compat
      let processedRequestedStartAt: Date | null = null;
      if (requestedStartAt) {
        processedRequestedStartAt = new Date(requestedStartAt);
        console.log('[Estimates] using requestedStartAt:', requestedStartAt, '→', processedRequestedStartAt);
      } else if (scheduledDate) {
        // Backward compatibility: combine date + time into single timestamp
        const timeStr = scheduledTime || '09:00';
        processedRequestedStartAt = new Date(`${scheduledDate}T${timeStr}:00`);
        console.log('[Estimates] using scheduledDate+Time fallback:', scheduledDate, timeStr, '→', processedRequestedStartAt);
      }
      
      const estimate = await storage.createEstimate(
        { 
          jobId, 
          title: estimateTitle, 
          notes: notes || undefined, 
          customerId: customerId ? parseInt(customerId) : undefined,
          customerName: customerName?.trim() || undefined,
          customerEmail: customerEmail?.trim() || undefined,
          customerPhone: customerPhone?.trim() || undefined,
          customerAddress: customerAddress?.trim() || undefined,
          taxCents: parsedTaxCents,
          assignedEmployeeIds: Array.isArray(assignedEmployeeIds) ? assignedEmployeeIds : [],
          jobType: jobType?.trim() || undefined,
          requestedStartAt: processedRequestedStartAt,
          items: normalizedItems 
        },
        companyId,
        userId
      );

      console.log(`[Estimates] CREATED estimateId=${estimate.id} requestedStartAt=${estimate.requestedStartAt}`);

      const estTotalDollars = ((estimate.totalCents || 0) / 100).toFixed(2);
      const estClientName = (estimate as any).customerName || '';
      await notifyManagers(companyId, {
        type: 'estimate_created',
        title: 'Estimate Created',
        body: estClientName ? `${estClientName} – $${estTotalDollars}` : `${estimate.title || estimate.estimateNumber} – $${estTotalDollars}`,
        entityType: 'estimate',
        entityId: estimate.id,
        linkUrl: `/estimates/${estimate.id}`,
      });

      res.status(201).json(estimate);
    } catch (error) {
      console.error("Error creating estimate:", error);
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  // POST /api/estimates - Create a standalone estimate (no job required)
  app.post('/api/estimates', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;

      const { title, notes, items, customerId, customerName, customerEmail, customerPhone, customerAddress, jobAddressLine1, jobCity, jobState, jobZip, taxCents, assignedEmployeeIds, jobId, jobType, scheduledDate, scheduledTime, scheduledEndTime } = req.body;

      // Auto-generate title if not provided
      let estimateTitle = title?.trim();
      if (!estimateTitle) {
        estimateTitle = customerName?.trim() ? `${customerName.trim()} – Estimate` : "Estimate";
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
      }

      // If jobId provided, verify it belongs to company
      let validatedJobId: number | null = null;
      if (jobId) {
        const job = await storage.getJob(jobId);
        if (!job || job.companyId !== companyId) {
          return res.status(404).json({ message: "Job not found" });
        }
        validatedJobId = jobId;
      }

      // Parse and validate taxCents
      let parsedTaxCents = 0;
      if (taxCents !== undefined && taxCents !== null && taxCents !== '') {
        parsedTaxCents = typeof taxCents === 'number' 
          ? Math.round(taxCents) 
          : Math.round(parseFloat(taxCents));
        if (isNaN(parsedTaxCents) || parsedTaxCents < 0) {
          parsedTaxCents = 0;
        }
      }

      // Validate and normalize items
      const normalizedItems = [];
      for (const item of items) {
        if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
          return res.status(400).json({ message: "Each item must have a name" });
        }
        const unitPriceCents = typeof item.unitPriceCents === 'number' 
          ? Math.round(item.unitPriceCents) 
          : Math.round(parseFloat(item.unitPriceCents));
        if (isNaN(unitPriceCents) || unitPriceCents < 0) {
          return res.status(400).json({ message: "Each item must have a valid unit price (in cents)" });
        }
        if (item.quantity === undefined || item.quantity === null || item.quantity === '') {
          return res.status(400).json({ message: "Each item must have a quantity" });
        }
        const quantity = String(item.quantity);
        const parsedQty = parseFloat(quantity);
        if (isNaN(parsedQty) || parsedQty <= 0) {
          return res.status(400).json({ message: "Each item must have a valid quantity greater than 0" });
        }
        normalizedItems.push({
          name: item.name.trim(),
          description: item.description?.trim() || null,
          taskCode: item.taskCode?.trim() || null,
          quantity,
          unitPriceCents,
          unit: item.unit?.trim() || 'each',
          taxable: item.taxable ?? false,
          taxId: item.taxId || null,
          taxRatePercentSnapshot: item.taxRatePercentSnapshot || null,
          taxNameSnapshot: item.taxNameSnapshot || null,
          taxCents: item.taxCents ?? 0,
          sortOrder: item.sortOrder,
        });
      }

      const estimate = await storage.createEstimate(
        { 
          jobId: validatedJobId, 
          title: estimateTitle, 
          notes: notes || undefined, 
          customerId: customerId ? parseInt(customerId) : undefined,
          customerName: customerName?.trim() || undefined,
          customerEmail: customerEmail?.trim() || undefined,
          customerPhone: customerPhone?.trim() || undefined,
          customerAddress: customerAddress?.trim() || undefined,
          jobAddressLine1: jobAddressLine1?.trim() || undefined,
          jobCity: jobCity?.trim() || undefined,
          jobState: jobState?.trim() || undefined,
          jobZip: jobZip?.trim() || undefined,
          taxCents: parsedTaxCents,
          assignedEmployeeIds: Array.isArray(assignedEmployeeIds) ? assignedEmployeeIds : [],
          jobType: jobType?.trim() || undefined,
          scheduledDate: scheduledDate || undefined,
          scheduledTime: scheduledTime || undefined,
          scheduledEndTime: scheduledEndTime || undefined,
          items: normalizedItems 
        },
        companyId,
        userId
      );

      const estTotalDollars2 = ((estimate.totalCents || 0) / 100).toFixed(2);
      const estClientName2 = (estimate as any).customerName || '';
      await notifyManagers(companyId, {
        type: 'estimate_created',
        title: 'Estimate Created',
        body: estClientName2 ? `${estClientName2} – $${estTotalDollars2}` : `${estimate.title || estimate.estimateNumber} – $${estTotalDollars2}`,
        entityType: 'estimate',
        entityId: estimate.id,
        linkUrl: `/estimates/${estimate.id}`,
      });

      res.status(201).json(estimate);
    } catch (error) {
      console.error("Error creating standalone estimate:", error);
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  // GET /api/estimates/:id - Get single estimate with items
  app.get('/api/estimates/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Technician cannot access estimates
      if (!canAccessEstimates(userRole)) {
        return res.status(403).json({ message: "You do not have permission to view estimates" });
      }

      const estimateId = parseInt(req.params.id);
      const estimate = await storage.getEstimate(estimateId);
      
      if (!estimate || estimate.companyId !== company.id) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      console.log(`[Estimates] get estimateId=${estimateId} jobId=${estimate.jobId} companyId=${company.id} requestedStartAt=${(estimate as any).requestedStartAt}`);
      res.json(estimate);
    } catch (error) {
      console.error("Error fetching estimate:", error);
      res.status(500).json({ message: "Failed to fetch estimate" });
    }
  });

  // PUT /api/estimates/:id - Update estimate
  app.put('/api/estimates/:id', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const existingEstimate = await storage.getEstimate(estimateId);
      if (!existingEstimate || existingEstimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      const { title, notes, status, items } = req.body;
      
      // Validate and normalize items if provided
      let normalizedItems;
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ message: "At least one line item is required" });
        }
        normalizedItems = [];
        for (const item of items) {
          if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
            return res.status(400).json({ message: "Each item must have a name" });
          }
          const unitPriceCents = typeof item.unitPriceCents === 'number' 
            ? Math.round(item.unitPriceCents) 
            : Math.round(parseFloat(item.unitPriceCents));
          if (isNaN(unitPriceCents) || unitPriceCents < 0) {
            return res.status(400).json({ message: "Each item must have a valid unit price (in cents)" });
          }
          if (item.quantity === undefined || item.quantity === null || item.quantity === '') {
            return res.status(400).json({ message: "Each item must have a quantity" });
          }
          const quantity = String(item.quantity);
          const parsedQty = parseFloat(quantity);
          if (isNaN(parsedQty) || parsedQty <= 0) {
            return res.status(400).json({ message: "Each item must have a valid quantity greater than 0" });
          }
          normalizedItems.push({
            id: item.id,
            name: item.name.trim(),
            description: item.description?.trim() || null,
            taskCode: item.taskCode?.trim() || null,
            quantity,
            unitPriceCents,
            unit: item.unit?.trim() || 'each',
            taxable: item.taxable ?? false,
            taxId: item.taxId || null,
            taxRatePercentSnapshot: item.taxRatePercentSnapshot || null,
            taxNameSnapshot: item.taxNameSnapshot || null,
            taxCents: item.taxCents ?? 0,
            sortOrder: item.sortOrder,
          });
        }
      }

      const updated = await storage.updateEstimate(estimateId, {
        title: title?.trim(),
        notes,
        status,
        items: normalizedItems,
      });

      console.log(`[Estimates] update estimateId=${estimateId} jobId=${existingEstimate.jobId} companyId=${companyId}`);
      res.json(updated);
    } catch (error) {
      console.error("Error updating estimate:", error);
      res.status(500).json({ message: "Failed to update estimate" });
    }
  });

  // PATCH /api/estimates/:id/assignees - Update assigned employees on an estimate
  app.patch('/api/estimates/:id/assignees', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const existingEstimate = await storage.getEstimate(estimateId);
      if (!existingEstimate || existingEstimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      const { employeeIds } = req.body;
      
      if (!Array.isArray(employeeIds)) {
        return res.status(400).json({ message: "employeeIds must be an array" });
      }

      const updated = await storage.updateEstimate(estimateId, {
        assignedEmployeeIds: employeeIds,
      });

      console.log(`[Estimates] update assignees estimateId=${estimateId} count=${employeeIds.length}`);
      res.json(updated);
    } catch (error) {
      console.error("Error updating estimate assignees:", error);
      res.status(500).json({ message: "Failed to update estimate assignees" });
    }
  });

  // DELETE /api/estimates/:id - Delete estimate (any status allowed)
  app.delete('/api/estimates/:id', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      // Delete related attachments first
      const attachments = await storage.getEstimateAttachments(estimateId);
      for (const attachment of attachments) {
        await storage.deleteEstimateAttachment(attachment.id);
        // Try to delete file from disk
        if (attachment.fileUrl) {
          const filePath = attachment.fileUrl.startsWith('/') ? attachment.fileUrl.substring(1) : attachment.fileUrl;
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
          }
        }
      }

      // Delete related documents (PDFs)
      const documents = await storage.getEstimateDocuments(estimateId, companyId);
      for (const doc of documents) {
        await storage.deleteEstimateDocument(doc.id);
        // Try to delete file from disk
        if (doc.fileUrl) {
          const filePath = doc.fileUrl.startsWith('/') ? doc.fileUrl.substring(1) : doc.fileUrl;
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
          }
          // Also delete preview image if exists
          const previewPath = filePath.replace('.pdf', '_preview.png');
          if (fs.existsSync(previewPath)) {
            try { fs.unlinkSync(previewPath); } catch (e) { /* ignore */ }
          }
        }
      }

      await storage.deleteEstimate(estimateId);
      console.log(`[Estimates] delete estimateId=${estimateId} status=${estimate.status} jobId=${estimate.jobId} companyId=${companyId}`);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting estimate:", error);
      res.status(500).json({ message: "Failed to delete estimate" });
    }
  });

  // POST /api/estimates/:id/attachments - Upload attachment to estimate
  app.post('/api/estimates/:id/attachments', isAuthenticated, requirePerm('estimates.create'), upload.single('file'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Store file URL (using the uploads path)
      const fileUrl = `/uploads/${req.file.filename}`;
      
      const attachment = await storage.createEstimateAttachment({
        estimateId,
        companyId,
        uploadedByUserId: userId,
        fileUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
      });

      console.log(`[Estimates] attachment uploaded estimateId=${estimateId} fileName=${req.file.originalname}`);
      res.status(201).json(attachment);
    } catch (error) {
      console.error("Error uploading estimate attachment:", error);
      res.status(500).json({ message: "Failed to upload attachment" });
    }
  });

  // DELETE /api/estimates/:id/attachments/:attachmentId - Delete attachment
  app.delete('/api/estimates/:id/attachments/:attachmentId', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      const attachmentId = parseInt(req.params.attachmentId);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      await storage.deleteEstimateAttachment(attachmentId);
      console.log(`[Estimates] attachment deleted estimateId=${estimateId} attachmentId=${attachmentId}`);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting estimate attachment:", error);
      res.status(500).json({ message: "Failed to delete attachment" });
    }
  });

  // PATCH /api/estimates/:id/notes - Update estimate notes
  app.patch('/api/estimates/:id/notes', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      const { notes } = req.body;
      
      // Update estimate with notes
      const [updated] = await db
        .update(estimates)
        .set({
          notes: notes || null,
          updatedAt: new Date(),
        })
        .where(eq(estimates.id, estimateId))
        .returning();
      
      console.log(`[Estimates] notes updated estimateId=${estimateId}`);
      res.json(updated);
    } catch (error) {
      console.error("Error updating estimate notes:", error);
      res.status(500).json({ message: "Failed to update estimate notes" });
    }
  });

  // PATCH /api/estimates/:id/schedule - Save schedule to estimate (for draft estimates)
  // Accepts scheduledDate (YYYY-MM-DD) and scheduledTime (HH:mm) directly to avoid timezone issues
  app.patch('/api/estimates/:id/schedule', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      const { scheduledDate, scheduledTime, scheduledEndTime } = req.body;
      
      // Parse scheduledDate (YYYY-MM-DD string) to Date
      let parsedScheduledDate: Date | null = null;
      let parsedScheduledTime: string | null = null;
      let parsedScheduledEndTime: string | null = null;
      
      if (scheduledDate) {
        const dateStr = typeof scheduledDate === 'string' 
          ? scheduledDate.split('T')[0] 
          : scheduledDate;
        // Store at noon UTC to avoid timezone edge cases
        parsedScheduledDate = new Date(`${dateStr}T12:00:00.000Z`);
      }
      
      if (scheduledTime) {
        // Use the time string directly as provided (HH:mm)
        parsedScheduledTime = scheduledTime;
      }
      
      if (scheduledEndTime) {
        parsedScheduledEndTime = scheduledEndTime;
      }
      
      // Update estimate with scheduledDate, scheduledTime, and scheduledEndTime
      const [updated] = await db
        .update(estimates)
        .set({
          scheduledDate: parsedScheduledDate,
          scheduledTime: parsedScheduledTime,
          scheduledEndTime: parsedScheduledEndTime,
          updatedAt: new Date(),
        })
        .where(eq(estimates.id, estimateId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error("Error saving estimate schedule:", error);
      res.status(500).json({ message: "Failed to save estimate schedule" });
    }
  });

  // PATCH /api/estimates/:id/approve - Approve estimate with signature and create job
  app.patch('/api/estimates/:id/approve', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      // Idempotency: If already approved with a converted job, return existing job
      if (estimate.status === 'approved' && (estimate as any).convertedJobId) {
        console.log(`[Estimates] already approved estimateId=${estimateId} convertedJobId=${(estimate as any).convertedJobId}`);
        return res.json({ 
          ...estimate, 
          jobId: (estimate as any).convertedJobId, 
          alreadyConverted: true 
        });
      }

      // Verify status is draft (first time approval)
      if (estimate.status !== 'draft') {
        return res.status(400).json({ message: "Only draft estimates can be approved" });
      }

      const { signatureDataUrl, approvedTotalCents } = req.body;
      
      if (!signatureDataUrl || typeof signatureDataUrl !== 'string') {
        return res.status(400).json({ message: "Signature is required" });
      }

      // Verify total matches (within 1 cent tolerance)
      if (approvedTotalCents !== undefined) {
        const diff = Math.abs(approvedTotalCents - estimate.totalCents);
        if (diff > 1) {
          return res.status(400).json({ message: "Approved total does not match estimate total" });
        }
      }

      // Use transaction to approve estimate and create job atomically
      const result = await db.transaction(async (tx) => {
        // 1. Approve the estimate
        const [approved] = await tx
          .update(estimates)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedByUserId: userId,
            signatureDataUrl,
            updatedAt: new Date(),
          })
          .where(eq(estimates.id, estimateId))
          .returning();

        // 2. Create a job from the estimate (including schedule if set)
        const jobTitle = (estimate as any).customerName 
          ? `Job for ${(estimate as any).customerName}` 
          : estimate.title;
        
        // Get estimate schedule to copy to job
        const estimateScheduledDate = (estimate as any).scheduledDate;
        const estimateScheduledTime = (estimate as any).scheduledTime;
        
        // Convert scheduledDate to YYYY-MM-DD string (handles Date objects and ISO strings)
        let jobStartDate: string | null = null;
        if (estimateScheduledDate) {
          if (typeof estimateScheduledDate === 'string') {
            // ISO string like "2026-01-17T12:00:00.000Z" - extract date part
            jobStartDate = estimateScheduledDate.split('T')[0];
          } else if (estimateScheduledDate instanceof Date) {
            // Date object - convert to YYYY-MM-DD
            jobStartDate = estimateScheduledDate.toISOString().split('T')[0];
          }
        }
        
        const [newJob] = await tx.insert(jobs).values({
          companyId,
          clientId: (estimate as any).clientId || null,
          customerId: estimate.customerId || null,
          clientName: (estimate as any).customerName || null,
          title: jobTitle,
          description: estimate.notes || null,
          status: 'pending',
          priority: 'medium',
          location: (estimate as any).customerAddress || null,
          notes: estimate.notes || null,
          jobType: estimate.jobType || null,
          startDate: jobStartDate,
          scheduledTime: estimateScheduledTime || null,
        }).returning();

        // 3. Copy line items from estimate to job (including tax fields)
        const estimateLineItems = estimate.items || [];
        console.log("EST->JOB tax copy", estimateLineItems.map((li: any) => ({
          name: li.name,
          taxable: li.taxable,
          taxId: li.taxId,
          taxRatePercentSnapshot: li.taxRatePercentSnapshot,
          taxNameSnapshot: li.taxNameSnapshot,
          taxCents: li.taxCents,
        })));
        
        for (const item of estimateLineItems) {
          // Calculate tax cents if taxable and has rate
          const qty = parseFloat(String(item.quantity)) || 1;
          const lineTotalCents = item.lineTotalCents || Math.round(qty * (item.unitPriceCents || 0));
          let taxCents = item.taxCents || 0;
          if (item.taxable && item.taxRatePercentSnapshot && !taxCents) {
            const rate = parseFloat(item.taxRatePercentSnapshot) || 0;
            taxCents = Math.round(lineTotalCents * (rate / 100));
          }
          const totalCents = lineTotalCents + taxCents;
          
          await tx.insert(jobLineItems).values({
            jobId: newJob.id,
            name: item.name,
            description: item.description || null,
            taskCode: item.taskCode || null,
            quantity: String(item.quantity),
            unitPriceCents: item.unitPriceCents,
            unit: item.unit || 'each',
            taxable: item.taxable || false,
            taxId: item.taxId || null,
            taxRatePercentSnapshot: item.taxRatePercentSnapshot || null,
            taxNameSnapshot: item.taxNameSnapshot || null,
            lineTotalCents: lineTotalCents,
            taxCents: taxCents,
            totalCents: totalCents,
            sortOrder: item.sortOrder || 0,
          });
        }

        // 4. Update estimate with convertedJobId, convertedAt, and archivedAt
        const now = new Date();

        await tx
          .update(estimates)
          .set({
            convertedJobId: newJob.id,
            convertedAt: now,
            archivedAt: now,
          })
          .where(eq(estimates.id, estimateId));

        console.log(`[EstimateConvert] estimateId=${estimateId} jobId=${newJob.id} archived=true`);

        return { approved, jobId: newJob.id };
      });
      
      console.log(`[Estimates] approved estimateId=${estimateId} userId=${userId} totalCents=${estimate.totalCents} createdJobId=${result.jobId}`);

      const totalDollars = ((estimate.totalCents || 0) / 100).toFixed(2);
      await notifyManagers(companyId, {
        type: 'estimate_approved',
        title: 'Estimate Approved',
        body: `${estimate.title || `Estimate #${estimate.estimateNumber}`} was approved for $${totalDollars}`,
        entityType: 'job',
        entityId: result.jobId,
        linkUrl: `/jobs/${result.jobId}`,
      });

      res.json({ 
        ...result.approved, 
        jobId: result.jobId, 
        alreadyConverted: false 
      });
    } catch (error) {
      console.error("Error approving estimate:", error);
      res.status(500).json({ message: "Failed to approve estimate" });
    }
  });

  // POST /api/estimates/:id/duplicate - Duplicate estimate + line items into new draft
  app.post('/api/estimates/:id/duplicate', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const existingEstimate = await storage.getEstimate(estimateId);
      if (!existingEstimate || existingEstimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      // Create duplicate with new estimate number
      const items = existingEstimate.items?.map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        sortOrder: item.sortOrder,
      })) || [];

      const duplicate = await storage.createEstimate(
        {
          jobId: existingEstimate.jobId,
          title: `${existingEstimate.title || 'Estimate'} (Copy)`,
          customerName: (existingEstimate as any).customerName || undefined,
          customerEmail: (existingEstimate as any).customerEmail || undefined,
          notes: existingEstimate.notes || undefined,
          taxCents: (existingEstimate as any).taxCents || 0,
          items,
        },
        companyId,
        userId
      );

      console.log(`[Estimates] duplicate sourceId=${estimateId} newId=${duplicate.id} jobId=${existingEstimate.jobId} companyId=${companyId}`);
      res.status(201).json(duplicate);
    } catch (error) {
      console.error("Error duplicating estimate:", error);
      res.status(500).json({ message: "Failed to duplicate estimate" });
    }
  });

  // ===================
  // Estimate Share (PDF Generation & Email) Routes
  // ===================
  
  // RBAC: Owner, Supervisor, Estimator can share estimates (Technician, Dispatcher cannot)
  const canShareEstimateRole = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR'].includes(upperRole);
  };

  // Helper to check if user can share estimates (includes owner fallback)
  const canUserShareEstimate = async (userId: string, companyId: number): Promise<boolean> => {
    // Check company member role
    const member = await storage.getCompanyMember(companyId, userId);
    console.log("[SharePDF] permission check", {
      userId,
      companyId,
      memberRole: member?.role,
      memberExists: !!member
    });
    
    if (member?.role && canShareEstimateRole(member.role)) {
      return true;
    }
    
    // Fallback: Check if user is the company owner (createdByUserId)
    const company = await storage.getCompany(companyId);
    if (company?.createdByUserId === userId) {
      console.log("[SharePDF] User is company owner (createdByUserId match), allowing share");
      return true;
    }
    
    return false;
  };

  // POST /api/estimates/:id/share/pdf - Generate PDF for estimate
  // Use requirePerm to ensure companyId is set on request
  app.post('/api/estimates/:id/share/pdf', requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      console.log("[SharePDF] start", { estimateId, userId, companyId, userRole: req.userRole });
      
      // RBAC check with owner fallback (requirePerm already validates estimates.create permission)
      const canShare = await canUserShareEstimate(userId, companyId);
      if (!canShare) {
        console.log("[SharePDF] permission denied", { userId, companyId });
        return res.status(403).json({ message: "You don't have permission to share estimates" });
      }
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      // Get company profile
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Get customer info if available
      let customer = null;
      if (estimate.customerId) {
        customer = await storage.getCustomer(estimate.customerId);
      }

      // Generate PDF
      const fileName = `Estimate_${estimate.estimateNumber.replace(/-/g, '_')}.pdf`;
      const filePath = path.join('uploads', fileName);
      
      // Ensure uploads directory exists
      if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
      }

      const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Page constants
      const PAGE_WIDTH = 612;
      const PAGE_HEIGHT = 792;
      const MARGIN = 48;
      const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
      const LOGO_SIZE = 80;
      const HEADER_BOX_WIDTH = 180;
      
      // Colors
      const GRAY_LIGHT = '#F5F5F5';
      const GRAY_TEXT = '#666666';
      const GRAY_BORDER = '#E0E0E0';
      const BLACK = '#000000';
      
      // Calculate totals
      const subtotal = (estimate.subtotalCents || 0) / 100;
      const tax = ((estimate as any).taxCents || 0) / 100;
      const total = (estimate.totalCents || 0) / 100;
      
      // Service date
      const serviceDate = estimate.scheduledDate 
        ? new Date(estimate.scheduledDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : new Date(estimate.createdAt!).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // Customer info preparation
      const custName = customer ? `${customer.firstName} ${customer.lastName}` : estimate.customerName || '';
      const custEmail = customer?.email || (estimate as any).customerEmail || '';
      const custPhone = customer?.phone || (estimate as any).customerPhone || '';
      const custAddress = customer?.address || (estimate as any).customerAddress || '';

      // Table column positions
      const COL_SERVICE = MARGIN;
      const COL_QTY = 340;
      const COL_PRICE = 400;
      const COL_AMOUNT = 490;
      const TABLE_ROW_HEIGHT = 20;

      // ========== HELPER FUNCTIONS ==========
      
      const drawHeader = (y: number): number => {
        let leftY = y;
        let rightBoxTop = y;
        
        // LEFT SIDE: Logo + Company Info
        const leftColumnWidth = CONTENT_WIDTH - HEADER_BOX_WIDTH - 20;
        
        // Logo
        if (company.logo) {
          try {
            const logoPath = company.logo.startsWith('/') ? company.logo.substring(1) : company.logo;
            if (fs.existsSync(logoPath)) {
              doc.image(logoPath, MARGIN, leftY, { width: LOGO_SIZE, height: LOGO_SIZE });
              leftY += LOGO_SIZE + 8;
            }
          } catch (e) {
            console.log('Logo not found, skipping');
          }
        }
        
        // Company name
        doc.fontSize(16).font('Helvetica-Bold').fillColor(BLACK);
        doc.text(company.name, MARGIN, leftY, { width: leftColumnWidth });
        leftY += 20;
        
        // Company contact info
        doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
        if (company.addressLine1) {
          let addressLine = company.addressLine1;
          if (company.addressLine2) addressLine += ', ' + company.addressLine2;
          doc.text(addressLine, MARGIN, leftY, { width: leftColumnWidth });
          leftY += 13;
        }
        if (company.city || company.state || company.postalCode) {
          const cityLine = [company.city, company.state, company.postalCode].filter(Boolean).join(', ');
          doc.text(cityLine, MARGIN, leftY, { width: leftColumnWidth });
          leftY += 13;
        }
        if (company.phone) {
          doc.text(company.phone, MARGIN, leftY, { width: leftColumnWidth });
          leftY += 13;
        }
        if (company.email) {
          doc.text(company.email, MARGIN, leftY, { width: leftColumnWidth });
          leftY += 13;
        }
        if (company.licenseNumber) {
          doc.text(`License: ${company.licenseNumber}`, MARGIN, leftY, { width: leftColumnWidth });
          leftY += 13;
        }
        
        // RIGHT SIDE: Estimate Info Box
        const boxX = PAGE_WIDTH - MARGIN - HEADER_BOX_WIDTH;
        const boxPadding = 12;
        const boxHeight = 85;
        
        // Draw box background and border
        doc.rect(boxX, rightBoxTop, HEADER_BOX_WIDTH, boxHeight)
           .fillAndStroke(GRAY_LIGHT, GRAY_BORDER);
        
        let boxY = rightBoxTop + boxPadding;
        
        // ESTIMATE label
        doc.fontSize(18).font('Helvetica-Bold').fillColor(BLACK);
        doc.text('ESTIMATE', boxX + boxPadding, boxY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
        boxY += 22;
        
        // Estimate number
        doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
        doc.text(`#${estimate.estimateNumber}`, boxX + boxPadding, boxY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
        boxY += 16;
        
        // Date
        doc.fontSize(9).font('Helvetica').fillColor(GRAY_TEXT);
        doc.text(`Date: ${serviceDate}`, boxX + boxPadding, boxY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
        boxY += 14;
        
        // Total
        doc.fontSize(11).font('Helvetica-Bold').fillColor(BLACK);
        doc.text(`Total: $${total.toFixed(2)}`, boxX + boxPadding, boxY, { width: HEADER_BOX_WIDTH - (boxPadding * 2) });
        
        // Return the bottom of the header
        return Math.max(leftY, rightBoxTop + boxHeight) + 25;
      };
      
      const drawBillTo = (y: number): number => {
        // Only show if there's customer info
        if (!custName && !custEmail && !custPhone && !custAddress) {
          return y;
        }
        
        // Section label
        doc.fontSize(10).font('Helvetica-Bold').fillColor(BLACK);
        doc.text('BILL TO', MARGIN, y);
        y += 15;
        
        // Customer details
        doc.fontSize(10).font('Helvetica').fillColor(BLACK);
        if (custName) {
          doc.text(custName, MARGIN, y, { width: 250 });
          y += 14;
        }
        
        doc.fillColor(GRAY_TEXT);
        if (custEmail) {
          doc.text(custEmail, MARGIN, y, { width: 250 });
          y += 13;
        }
        if (custPhone) {
          doc.text(custPhone, MARGIN, y, { width: 250 });
          y += 13;
        }
        if (custAddress) {
          doc.text(custAddress, MARGIN, y, { width: 250 });
          y += 13;
        }
        
        return y + 20;
      };
      
      const drawTableHeader = (y: number): number => {
        // Gray background for header row
        doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(GRAY_LIGHT);
        
        const textY = y + 6;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(BLACK);
        doc.text('SERVICE / ITEM', COL_SERVICE + 8, textY);
        doc.text('QTY', COL_QTY, textY, { width: 50, align: 'center' });
        doc.text('UNIT PRICE', COL_PRICE, textY, { width: 70, align: 'right' });
        doc.text('AMOUNT', COL_AMOUNT, textY, { width: 70, align: 'right' });
        
        return y + 22;
      };
      
      // Calculate row height without drawing (for pagination checks)
      // Uses doc.save()/restore() to prevent font state leakage
      const calculateRowHeight = (item: any): number => {
        doc.save();
        
        doc.fontSize(10).font('Helvetica');
        const nameHeight = doc.heightOfString(item.name || '', { width: 260 });
        let rowHeight = Math.max(nameHeight + 10, TABLE_ROW_HEIGHT); // +10 for padding
        
        if (item.description) {
          doc.fontSize(9);
          const descHeight = doc.heightOfString(item.description, { width: 250 });
          rowHeight += descHeight + 6; // +6 for spacing
        }
        
        doc.restore();
        
        return rowHeight;
      };
      
      // Calculate totals section height using actual text metrics
      const calculateTotalsHeight = (): number => {
        doc.save();
        
        // Subtotal line (font size 10)
        doc.fontSize(10).font('Helvetica');
        let height = 20; // padding + subtotal line height
        
        // Tax line if applicable
        if (tax > 0) {
          height += 18;
        }
        
        // Divider + total line (font size 14 bold)
        doc.fontSize(14).font('Helvetica-Bold');
        height += 10 + 24 + 35; // divider gap + total line + bottom margin
        
        doc.restore();
        
        return height;
      };
      
      // Reserved footer space (accounts for divider + footer text + margin)
      const FOOTER_RESERVED = company.defaultFooterText ? 60 : 15;
      const USABLE_HEIGHT = PAGE_HEIGHT - MARGIN - FOOTER_RESERVED;
      
      const drawTableRow = (item: any, y: number, isAlt: boolean): number => {
        const qty = parseFloat(String(item.quantity)) || 1;
        const unitPrice = (item.unitPriceCents || 0) / 100;
        const amount = qty * unitPrice;
        
        // Calculate row height based on content
        const rowHeight = calculateRowHeight(item);
        doc.fontSize(10).font('Helvetica');
        const nameHeight = doc.heightOfString(item.name || '', { width: 260 });
        
        // Alternating row background
        if (isAlt) {
          doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill('#FAFAFA');
        }
        
        // Row divider
        doc.strokeColor(GRAY_BORDER).lineWidth(0.5);
        doc.moveTo(MARGIN, y + rowHeight).lineTo(PAGE_WIDTH - MARGIN, y + rowHeight).stroke();
        
        // Item name
        const textY = y + 6;
        doc.fontSize(10).font('Helvetica').fillColor(BLACK);
        doc.text(item.name || '', COL_SERVICE + 8, textY, { width: 260 });
        
        // Quantity, price, amount
        doc.text(qty.toString(), COL_QTY, textY, { width: 50, align: 'center' });
        doc.text(`$${unitPrice.toFixed(2)}`, COL_PRICE, textY, { width: 70, align: 'right' });
        doc.text(`$${amount.toFixed(2)}`, COL_AMOUNT, textY, { width: 70, align: 'right' });
        
        // Description (if present)
        if (item.description) {
          const descY = textY + nameHeight + 4;
          doc.fontSize(9).fillColor(GRAY_TEXT);
          doc.text(item.description, COL_SERVICE + 16, descY, { width: 250 });
        }
        
        return y + rowHeight;
      };
      
      const drawTotals = (y: number): number => {
        y += 15;
        const totalsX = COL_PRICE;
        const valueX = COL_AMOUNT;
        
        // Subtotal
        doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
        doc.text('Subtotal', totalsX, y, { width: 70, align: 'right' });
        doc.fillColor(BLACK);
        doc.text(`$${subtotal.toFixed(2)}`, valueX, y, { width: 70, align: 'right' });
        y += 16;
        
        // Tax (if applicable)
        if (tax > 0) {
          doc.fillColor(GRAY_TEXT);
          doc.text('Tax', totalsX, y, { width: 70, align: 'right' });
          doc.fillColor(BLACK);
          doc.text(`$${tax.toFixed(2)}`, valueX, y, { width: 70, align: 'right' });
          y += 16;
        }
        
        // Divider line before total
        doc.strokeColor(GRAY_BORDER).lineWidth(1);
        doc.moveTo(totalsX, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
        y += 8;
        
        // Total (bold, larger)
        doc.fontSize(14).font('Helvetica-Bold').fillColor(BLACK);
        doc.text('Total', totalsX, y, { width: 70, align: 'right' });
        doc.text(`$${total.toFixed(2)}`, valueX, y, { width: 70, align: 'right' });
        
        return y + 30;
      };
      
      const SIGNATURE_HEIGHT = 130; // Label + date text + signature image
      
      const drawSignature = (y: number): number => {
        if (estimate.status !== 'approved' || !estimate.signatureDataUrl) {
          return y;
        }
        
        // Check if signature section fits on current page
        if (y + SIGNATURE_HEIGHT > USABLE_HEIGHT) {
          doc.addPage();
          y = MARGIN;
        }
        
        y += 20;
        
        // Section label
        doc.fontSize(11).font('Helvetica-Bold').fillColor(BLACK);
        doc.text('Customer Approval', MARGIN, y);
        y += 18;
        
        // Signed date text
        const approvedDate = estimate.approvedAt 
          ? new Date(estimate.approvedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : 'N/A';
        doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
        doc.text(`Signed on ${approvedDate} for $${total.toFixed(2)}`, MARGIN, y);
        y += 18;
        
        // Signature image
        try {
          if (estimate.signatureDataUrl.startsWith('data:image')) {
            const base64Data = estimate.signatureDataUrl.split(',')[1];
            const signatureBuffer = Buffer.from(base64Data, 'base64');
            doc.image(signatureBuffer, MARGIN, y, { width: 180, height: 60 });
            y += 70;
          }
        } catch (e) {
          console.log('Could not render signature:', e);
        }
        
        return y;
      };
      
      const drawFooter = () => {
        if (!company.defaultFooterText) return;
        
        const footerY = PAGE_HEIGHT - MARGIN - 30;
        
        // Thin divider line
        doc.strokeColor(GRAY_BORDER).lineWidth(0.5);
        doc.moveTo(MARGIN, footerY).lineTo(PAGE_WIDTH - MARGIN, footerY).stroke();
        
        // Footer text
        doc.fontSize(8).font('Helvetica').fillColor(GRAY_TEXT);
        doc.text(company.defaultFooterText, MARGIN, footerY + 10, { 
          width: CONTENT_WIDTH, 
          align: 'center' 
        });
      };

      // ========== RENDER PDF ==========
      
      let yPos = MARGIN;
      
      // Draw header
      yPos = drawHeader(yPos);
      
      // Draw bill to section
      yPos = drawBillTo(yPos);
      
      // Draw items table
      const items = estimate.items || [];
      
      // Table header
      yPos = drawTableHeader(yPos);
      
      // Table rows
      const TABLE_HEADER_HEIGHT = 22;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Calculate height BEFORE checking pagination
        const rowHeight = calculateRowHeight(item);
        
        // Check if row fits on current page (with margin for footer)
        if (yPos + rowHeight > USABLE_HEIGHT) {
          doc.addPage();
          yPos = MARGIN;
          // Repeat table header on new page
          yPos = drawTableHeader(yPos);
        }
        
        // Safety check: if row is taller than entire page usable area, 
        // just render it starting from current position (avoids infinite loop)
        // The row may overflow, but this is the best we can do for extremely long content
        if (rowHeight > USABLE_HEIGHT - MARGIN - TABLE_HEADER_HEIGHT) {
          console.log(`[PDF] Warning: Item "${item.name?.substring(0, 30)}..." is very tall (${rowHeight}px), may overflow page`);
        }
        
        yPos = drawTableRow(item, yPos, i % 2 === 1);
      }
      
      // Check if totals section fits on current page
      const totalsHeight = calculateTotalsHeight();
      if (yPos + totalsHeight > USABLE_HEIGHT) {
        doc.addPage();
        yPos = MARGIN;
      }
      
      // Draw totals
      yPos = drawTotals(yPos);
      
      // Draw signature (if approved)
      yPos = drawSignature(yPos);
      
      // Draw footer on last page
      drawFooter();

      doc.end();

      // Wait for PDF to finish writing
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Generate PNG preview of page 1
      let previewImageUrl: string | null = null;
      try {
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfData = new Uint8Array(pdfBuffer);
        const pdfDoc = await pdfjs.getDocument({ data: pdfData }).promise;
        const page = await pdfDoc.getPage(1);
        
        // Scale for good preview quality (1.5x)
        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        
        // Create canvas
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');
        
        // Render page to canvas
        await page.render({
          canvasContext: context as any,
          viewport: viewport,
        }).promise;
        
        // Save as PNG
        const previewFileName = fileName.replace('.pdf', '_preview.png');
        const previewPath = path.join('uploads', previewFileName);
        const pngBuffer = canvas.toBuffer('image/png');
        fs.writeFileSync(previewPath, pngBuffer);
        
        previewImageUrl = `/uploads/${previewFileName}`;
        console.log(`[Estimates] Preview generated: ${previewFileName}`);
      } catch (previewError) {
        console.error('[Estimates] Failed to generate preview image:', previewError);
        // Continue without preview - not a critical failure
      }

      // Store in estimate_documents table
      const fileUrl = `/uploads/${fileName}`;
      const estimateDoc = await storage.createEstimateDocument({
        estimateId,
        companyId,
        type: 'pdf',
        fileUrl,
        fileName,
        createdByUserId: userId,
      });

      console.log(`[Estimates] PDF generated estimateId=${estimateId} fileName=${fileName} docId=${estimateDoc.id}`);
      res.json({ 
        pdfUrl: fileUrl, 
        previewImageUrl,
        fileName, 
        documentId: estimateDoc.id 
      });
    } catch (error) {
      console.error("Error generating estimate PDF:", error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // GET /api/estimates/:id/share/pdf/latest - Get the latest generated PDF for an estimate
  app.get('/api/estimates/:id/share/pdf/latest', requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      // Get the latest PDF document for this estimate
      const latestDoc = await storage.getLatestEstimateDocument(estimateId, companyId);
      
      if (!latestDoc) {
        return res.status(404).json({ pdfUrl: null, message: "No PDF found for this estimate" });
      }

      // Check if preview image exists
      const previewFileName = latestDoc.fileName.replace('.pdf', '_preview.png');
      const previewPath = path.join('uploads', previewFileName);
      const previewImageUrl = fs.existsSync(previewPath) ? `/uploads/${previewFileName}` : null;

      res.json({
        pdfUrl: latestDoc.fileUrl,
        fileName: latestDoc.fileName,
        previewImageUrl,
        documentId: latestDoc.id,
        createdAt: latestDoc.createdAt,
      });
    } catch (error) {
      console.error("Error fetching latest PDF:", error);
      res.status(500).json({ message: "Failed to fetch latest PDF" });
    }
  });

  // POST /api/estimates/:id/share/email - Send estimate PDF via email
  // Use requirePerm to ensure companyId is set on request
  app.post('/api/estimates/:id/share/email', requirePerm('estimates.create'), async (req: any, res) => {
    console.log("[ShareEmail] HIT", {
      estimateId: req.params.id,
      userId: req.user?.id,
      companyId: req.companyId,
      body: req.body,
    });
    console.log("[ShareEmail] ENV", {
      hasResendKey: !!process.env.RESEND_API_KEY,
    });
    
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // RBAC check with owner fallback (same as PDF generation)
      const canShare = await canUserShareEstimate(userId, companyId);
      if (!canShare) {
        console.log("[ShareEmail] RBAC denied", { userId, companyId });
        return res.status(403).json({ message: "You don't have permission to share estimates" });
      }
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      const { toEmail, subject, message, pdfUrl } = req.body;
      
      if (!toEmail || !pdfUrl) {
        return res.status(400).json({ message: "Email address and PDF URL are required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(toEmail)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Verify the pdfUrl belongs to this company's estimate documents
      const estimateDocs = await storage.getEstimateDocuments(estimateId, companyId);
      const matchingDoc = estimateDocs.find(doc => doc.fileUrl === pdfUrl);
      if (!matchingDoc) {
        console.warn(`[Estimates] Unauthorized PDF access attempt: ${pdfUrl} for estimate ${estimateId} company ${companyId}`);
        return res.status(403).json({ message: "Invalid PDF document for this estimate" });
      }

      // Check if Resend is configured
      if (!process.env.RESEND_API_KEY) {
        return res.status(503).json({ 
          message: "Email not configured. Please configure RESEND_API_KEY to send emails.",
          code: "EMAIL_NOT_CONFIGURED"
        });
      }

      // Read PDF file with path traversal protection
      const uploadsDir = path.resolve('uploads');
      const rawPath = pdfUrl.startsWith('/') ? pdfUrl.substring(1) : pdfUrl;
      const resolvedPath = path.resolve(rawPath);
      
      // Ensure the resolved path is within the uploads directory
      if (!resolvedPath.startsWith(uploadsDir + path.sep) && resolvedPath !== uploadsDir) {
        console.warn(`[Estimates] Path traversal attempt blocked: ${pdfUrl}`);
        return res.status(400).json({ message: "Invalid PDF path" });
      }
      
      // Also verify the path starts with uploads/ prefix
      if (!rawPath.startsWith('uploads/') && !rawPath.startsWith('uploads\\')) {
        return res.status(400).json({ message: "Invalid PDF path" });
      }
      
      if (!fs.existsSync(resolvedPath)) {
        return res.status(400).json({ message: "PDF file not found. Please generate the PDF first." });
      }
      
      const pdfBuffer = fs.readFileSync(resolvedPath);
      const pdfFileName = path.basename(resolvedPath);

      // Get company for branding
      const company = await storage.getCompany(companyId);

      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromEmail = getResendFrom();
      console.log('[email] FROM used:', fromEmail);

      const emailSubject = subject || `Estimate ${estimate.estimateNumber} from ${company?.name || 'Our Company'}`;
      const emailBody = message || `Please find attached the estimate for your review.`;

      console.log("[ShareEmail] calling Resend now", { 
        fromEmail, 
        toEmail, 
        subject: emailSubject,
        pdfSize: pdfBuffer.length 
      });

      const { data, error } = await resend.emails.send({
        from: fromEmail,
        reply_to: 'no-reply@ecologicc.com',
        to: toEmail,
        subject: emailSubject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${company?.name || 'Estimate'}</h2>
            <p style="color: #555; white-space: pre-line;">${emailBody}</p>
            <p style="color: #777; font-size: 12px; margin-top: 30px;">
              This estimate is attached as a PDF document.
            </p>
          </div>
        `,
        attachments: [
          {
            filename: pdfFileName,
            content: pdfBuffer,
          },
        ],
      });

      if (error) {
        console.error("[ShareEmail] Resend error", error);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to send email", 
          error: error.message || error 
        });
      }

      console.log("[ShareEmail] Resend result", { id: data?.id });
      console.log(`[ShareEmail] Email sent estimateId=${estimateId} toEmail=${toEmail}`);
      res.json({ success: true, message: "Email sent successfully", id: data?.id });
    } catch (error: any) {
      console.error("Error sending estimate email:", error);
      if (error.message?.includes('API key')) {
        return res.status(503).json({ 
          message: "Email service configuration error. Please check RESEND_API_KEY.",
          code: "EMAIL_NOT_CONFIGURED"
        });
      }
      res.status(500).json({ message: "Failed to send email" });
    }
  });

  // ===================
  // Signature Request Routes (Phase 1 - New E-signature System)
  // ===================
  
  // RBAC: Owner, Supervisor, Dispatcher, Estimator can create signature requests (Technician cannot)
  const canCreateSignatureRequest = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR'].includes(upperRole);
  };

  // GET /api/signature-requests - List signature requests (filtered by document visibility)
  app.get('/api/signature-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase() as UserRole;
      
      // Get all signature requests for company
      const requests = await storage.getSignatureRequests(company.id);
      
      // Filter by document visibility - only show requests for documents user can access
      const allowedVisibilities = getAllowedVisibilities(userRole);
      
      // Enrich with document and job info, filter by visibility
      const enrichedRequests = await Promise.all(requests.map(async (request) => {
        const doc = await storage.getDocument(request.documentId);
        
        // If document doesn't exist or user can't see it, skip this request
        if (!doc) return null;
        
        // Visibility check (Owner sees all)
        if (userRole !== 'OWNER' && !allowedVisibilities.includes(doc.visibility as DocumentVisibility)) {
          return null;
        }
        
        // Get job info if available
        let job = null;
        if (request.jobId) {
          const jobData = await storage.getJob(request.jobId);
          if (jobData) {
            job = { id: jobData.id, title: jobData.title, address: jobData.address };
          }
        }
        
        // Omit accessToken from list response for security
        const { accessToken: _token, ...requestWithoutToken } = request;
        return {
          ...requestWithoutToken,
          document: {
            id: doc.id,
            name: doc.name,
            fileUrl: doc.fileUrl,
            category: doc.category,
          },
          job,
        };
      }));
      
      // Filter out nulls (requests user can't see)
      const visibleRequests = enrichedRequests.filter(r => r !== null);
      
      res.json(visibleRequests);
    } catch (error) {
      console.error("Error fetching signature requests:", error);
      res.status(500).json({ message: "Failed to fetch signature requests" });
    }
  });

  // GET /api/signature-requests/:id - Get single signature request
  app.get('/api/signature-requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase() as UserRole;
      
      const requestId = parseInt(req.params.id);
      const request = await storage.getSignatureRequest(requestId);
      
      if (!request || request.companyId !== company.id) {
        return res.status(404).json({ message: "Signature request not found" });
      }
      
      // Check document visibility
      const doc = await storage.getDocument(request.documentId);
      if (!doc) {
        return res.status(404).json({ message: "Associated document not found" });
      }
      
      const allowedVisibilities = getAllowedVisibilities(userRole);
      if (userRole !== 'OWNER' && !allowedVisibilities.includes(doc.visibility as DocumentVisibility)) {
        return res.status(403).json({ message: "You don't have access to this signature request" });
      }
      
      // Get job info if available
      let job = null;
      if (request.jobId) {
        const jobData = await storage.getJob(request.jobId);
        if (jobData) {
          job = { id: jobData.id, title: jobData.title, address: jobData.address };
        }
      }
      
      // Omit accessToken from detail response for security
      const { accessToken: _token, ...requestWithoutToken } = request;
      res.json({
        ...requestWithoutToken,
        document: {
          id: doc.id,
          name: doc.name,
          fileUrl: doc.fileUrl,
          category: doc.category,
        },
        job,
      });
    } catch (error) {
      console.error("Error fetching signature request:", error);
      res.status(500).json({ message: "Failed to fetch signature request" });
    }
  });

  // POST /api/signature-requests - Create new signature request
  app.post('/api/signature-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase() as UserRole;
      
      // RBAC check
      if (!canCreateSignatureRequest(userRole)) {
        return res.status(403).json({ message: "You don't have permission to create signature requests" });
      }
      
      const { documentId, customerName, customerEmail, message } = req.body;
      
      if (!documentId || !customerName || !customerEmail) {
        return res.status(400).json({ message: "Document, customer name, and customer email are required" });
      }
      
      // Verify document exists and user can access it
      const doc = await storage.getDocument(documentId);
      if (!doc || doc.companyId !== company.id) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Check document visibility
      const allowedVisibilities = getAllowedVisibilities(userRole);
      if (userRole !== 'OWNER' && !allowedVisibilities.includes(doc.visibility as DocumentVisibility)) {
        return res.status(403).json({ message: "You don't have access to this document" });
      }
      
      // Generate unique access token for secure signing link
      const accessToken = randomBytes(32).toString('hex');
      
      // Create signature request (jobId automatically inherited from document)
      const request = await storage.createSignatureRequest({
        companyId: company.id,
        documentId,
        jobId: doc.jobId || null, // Automatically inherit from document
        customerName,
        customerEmail,
        message: message || null,
        status: 'draft',
        accessToken,
        createdByUserId: userId,
      });
      
      // Return created request with accessToken (only returned once for email purposes)
      // After creation, token is not exposed in list/detail endpoints
      res.status(201).json({
        ...request,
        signingUrl: `/sign/${accessToken}`, // Provide full signing URL for emailing to customer
      });
    } catch (error) {
      console.error("Error creating signature request:", error);
      res.status(500).json({ message: "Failed to create signature request" });
    }
  });

  // PATCH /api/signature-requests/:id - Update signature request status
  app.patch('/api/signature-requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canCreateSignatureRequest(userRole)) {
        return res.status(403).json({ message: "You don't have permission to update signature requests" });
      }
      
      const requestId = parseInt(req.params.id);
      const request = await storage.getSignatureRequest(requestId);
      
      if (!request || request.companyId !== company.id) {
        return res.status(404).json({ message: "Signature request not found" });
      }
      
      const { status } = req.body;
      
      // Validate status
      const validStatuses = ['draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'canceled'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      const updated = await storage.updateSignatureRequest(requestId, { status });
      // Omit accessToken from response
      const { accessToken: _token, ...responseData } = updated;
      res.json(responseData);
    } catch (error) {
      console.error("Error updating signature request:", error);
      res.status(500).json({ message: "Failed to update signature request" });
    }
  });

  // POST /api/signature-requests/:id/send - Send a draft signature request
  app.post('/api/signature-requests/:id/send', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC check: Technician cannot send
      if (!canCreateSignatureRequest(userRole)) {
        return res.status(403).json({ message: "You don't have permission to send signature requests" });
      }
      
      const requestId = parseInt(req.params.id);
      const request = await storage.getSignatureRequest(requestId);
      
      if (!request || request.companyId !== company.id) {
        return res.status(404).json({ message: "Signature request not found" });
      }
      
      // Verify document visibility - user must have access to the underlying document
      const doc = await storage.getDocument(request.documentId);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const allowedVisibilities = getAllowedVisibilities(userRole);
      const visibility = doc.visibility || 'customer_internal';
      if (userRole !== 'OWNER' && !allowedVisibilities.includes(visibility)) {
        return res.status(403).json({ message: "You don't have access to this document" });
      }
      
      // Validation: Only draft requests can be sent
      if (request.status !== 'draft') {
        return res.status(400).json({ message: "Only draft requests can be sent" });
      }
      
      // Validate APP_BASE_URL before generating signing link
      const baseUrl = getAppBaseUrl();
      if (!baseUrl) {
        return res.status(500).json({ 
          message: "Signing link misconfigured",
          error: "APP_BASE_URL missing/invalid. Set it to your public app URL (e.g., https://yourapp.replit.app)"
        });
      }
      
      // Generate signing URL with validated base URL
      const signUrl = `${baseUrl}/sign/${encodeURIComponent(request.accessToken)}`;
      
      // Send email via Resend - no silent skipping
      try {
        await sendSignatureRequestEmail({
          to: request.customerEmail,
          customerName: request.customerName,
          documentName: doc.name,
          signUrl: signUrl,
          message: request.message || undefined,
          companyName: company.name,
        });
        
        // Email succeeded - update status to 'sent' with 14-day expiry
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14); // 14-day expiry
        
        const [finalUpdated] = await db
          .update(signatureRequests)
          .set({
            status: 'sent',
            sentAt: new Date(),
            sentByUserId: userId,
            signUrl: signUrl,
            expiresAt: expiresAt,
            deliveryStatus: 'sent',
            deliveryError: null,
            updatedAt: new Date(),
          })
          .where(eq(signatureRequests.id, requestId))
          .returning();
        
        // Omit accessToken from response but include signUrl for internal use
        const { accessToken: _token, ...responseData } = finalUpdated;
        res.json(responseData);
      } catch (emailError: any) {
        // Email failed - keep as draft, store error
        console.error('[Email] signature request send failed:', emailError);
        
        const errorMessage = emailError?.message || 'Unknown email error';
        
        await db
          .update(signatureRequests)
          .set({
            deliveryStatus: 'failed',
            deliveryError: errorMessage.substring(0, 500), // Truncate for storage
            updatedAt: new Date(),
          })
          .where(eq(signatureRequests.id, requestId));
        
        return res.status(500).json({ 
          message: "Email delivery failed. Please check your email settings.",
          error: errorMessage
        });
      }
    } catch (error) {
      console.error("Error sending signature request:", error);
      res.status(500).json({ message: "Failed to send signature request" });
    }
  });

  // DELETE /api/signature-requests/:id - Delete signature request
  app.delete('/api/signature-requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canCreateSignatureRequest(userRole)) {
        return res.status(403).json({ message: "You don't have permission to delete signature requests" });
      }
      
      const requestId = parseInt(req.params.id);
      const request = await storage.getSignatureRequest(requestId);
      
      if (!request || request.companyId !== company.id) {
        return res.status(404).json({ message: "Signature request not found" });
      }
      
      await storage.deleteSignatureRequest(requestId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting signature request:", error);
      res.status(500).json({ message: "Failed to delete signature request" });
    }
  });

  // ============== PUBLIC INVOICE ROUTES (No Auth) ==============

  // GET /api/public/invoices/:id - Get invoice for public payment page
  app.get('/api/public/invoices/:id', async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      
      if (isNaN(invoiceId)) {
        return res.status(400).json({ message: "Invalid invoice ID" });
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      const company = await storage.getCompany(invoice.companyId);

      let customer = null;
      if (invoice.customerId) {
        const c = await storage.getCustomer(invoice.customerId);
        if (c) {
          customer = {
            name: [c.firstName, c.lastName].filter(Boolean).join(' '),
            email: c.email || null,
            address: c.address || null,
            city: c.city || null,
            state: c.state || null,
            zip: c.zip || null,
          };
        }
      }

      let jobTitle = null;
      if (invoice.jobId) {
        const job = await storage.getJob(invoice.jobId);
        if (job) {
          jobTitle = job.title;
        }
      }

      const computed = await recomputeInvoiceTotalsFromPayments(invoice.id);

      res.json({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalCents: invoice.totalCents,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        paidAmountCents: computed.paidCents,
        balanceDueCents: computed.owedCents,
        computedStatus: computed.computedStatus,
        status: computed.computedStatus,
        dueDate: invoice.dueDate,
        issueDate: invoice.issueDate,
        lineItems: invoice.lineItems,
        company: {
          name: company?.name || 'Unknown Company',
          email: company?.email || null,
          phone: company?.phone || null,
          addressLine1: company?.addressLine1 || null,
          addressLine2: company?.addressLine2 || null,
          city: company?.city || null,
          state: company?.state || null,
          postalCode: company?.postalCode || null,
        },
        customer,
        jobTitle,
      });
    } catch (error) {
      console.error("Error fetching public invoice:", error);
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });


  // POST /api/public/invoices/create-intent - Create a Stripe PaymentIntent for public invoice payment (no auth)
  app.post('/api/public/invoices/create-intent', async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Payment system not configured" });
      }

      const { invoiceId, amountCents: requestedAmountCents } = req.body;

      if (!invoiceId || typeof invoiceId !== 'number') {
        return res.status(400).json({ message: "Invoice ID is required" });
      }

      const invoice = await storage.getInvoice(invoiceId);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (invoice.status === 'void' || invoice.status === 'cancelled') {
        return res.status(400).json({ message: "This invoice is no longer valid" });
      }

      const computed = await recomputeInvoiceTotalsFromPayments(invoice.id);
      if (computed.computedStatus === 'paid') {
        return res.status(400).json({ message: "This invoice has already been paid" });
      }

      const invoiceTotalCents = computed.totalCents;
      const currentBalanceDueCents = computed.owedCents;

      let amountInCents: number;
      if (requestedAmountCents !== undefined && requestedAmountCents !== null) {
        const parsed = parseInt(String(requestedAmountCents), 10);
        if (isNaN(parsed) || parsed < 50) {
          return res.status(400).json({ message: "Payment amount must be at least $0.50" });
        }
        if (parsed > currentBalanceDueCents) {
          return res.status(400).json({ message: "Payment amount cannot exceed balance due" });
        }
        amountInCents = parsed;
      } else {
        amountInCents = currentBalanceDueCents;
      }

      if (amountInCents < 50) {
        return res.status(400).json({ message: "Payment amount must be at least $0.50 (Stripe minimum)" });
      }

      const company = await storage.getCompany(invoice.companyId);

      console.log('[create-intent public]', { invoiceIdParam: invoiceId, invoiceIdDb: invoice.id, companyId: invoice.companyId, totalCents: invoiceTotalCents, balanceDue: currentBalanceDueCents, paidSoFar: computed.paidCents, amountCents: amountInCents });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          invoiceId: String(invoice.id),
          invoiceNumber: invoice.invoiceNumber,
          companyId: String(invoice.companyId),
          jobId: invoice.jobId ? String(invoice.jobId) : '',
          isPartialPayment: amountInCents < currentBalanceDueCents ? 'true' : 'false',
        },
      });

      console.log(`[PublicIntent] Created PaymentIntent ${paymentIntent.id} for invoice ${invoice.id}`);

      const [existingPiPayment] = await db.select({ id: payments.id }).from(payments).where(eq(payments.stripePaymentIntentId, paymentIntent.id));
      if (!existingPiPayment) {
        await db.insert(payments).values({
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          jobId: invoice.jobId || null,
          customerId: invoice.customerId || null,
          amount: (amountInCents / 100).toFixed(2),
          amountCents: amountInCents,
          paymentMethod: 'stripe',
          status: 'processing',
          stripePaymentIntentId: paymentIntent.id,
          paidDate: new Date(),
        });
        console.log(`[PublicIntent] Pre-inserted payment row for PI ${paymentIntent.id}`);
      }

      const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountCents: amountInCents,
        publishableKey,
      });
    } catch (error: any) {
      console.error("Error creating public PaymentIntent:", error);
      res.status(500).json({ message: error.message || "Failed to create payment intent" });
    }
  });

  // GET /api/payments/stripe/confirm - Confirm Stripe payment by payment_intent_id, supports partial payments
  app.get('/api/payments/stripe/confirm', async (req, res) => {
    try {
      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

      const invoiceIdParam = (req.query.invoiceId || req.query.invoice_id) as string;
      const paymentIntentIdParam = (req.query.payment_intent_id || req.query.paymentIntentId) as string;

      if (!invoiceIdParam) {
        return res.status(400).json({ error: 'invoiceId is required' });
      }

      const invoiceId = parseInt(invoiceIdParam, 10);
      if (isNaN(invoiceId)) return res.status(400).json({ error: 'Invalid invoiceId' });

      if (!paymentIntentIdParam) {
        return res.status(400).json({ error: 'payment_intent_id is required' });
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentIdParam);
      if (!paymentIntent || paymentIntent.status !== 'succeeded') {
        console.log(`[StripeConfirm] invoiceId=${invoiceId} pi=${paymentIntentIdParam} status=pending (pi status: ${paymentIntent?.status})`);
        return res.json({ status: 'pending' });
      }
      const piInvoiceId = paymentIntent.metadata?.invoiceId ? parseInt(paymentIntent.metadata.invoiceId) : null;
      if (piInvoiceId !== invoiceId) {
        return res.status(400).json({ error: 'PaymentIntent does not match this invoice' });
      }
      const pi = paymentIntentIdParam;

      const allPayments = await storage.getPaymentsByInvoiceId(invoiceId);
      let matchedPayment = allPayments?.find((p: any) => p.stripePaymentIntentId === pi);

      if (!matchedPayment) {
        console.log(`[StripeConfirm] invoiceId=${invoiceId} pi=${pi} status=pending (no payment row yet)`);
        return res.json({ status: 'pending' });
      }

      if (matchedPayment.status === 'processing') {
        await db.update(payments).set({ status: 'succeeded', paidDate: new Date() }).where(eq(payments.id, matchedPayment.id));
        console.log(`[StripeConfirm] Upgraded payment ${matchedPayment.id} from 'processing' to 'succeeded' (PI confirmed by Stripe)`);
        await persistRecomputedTotals(invoiceId);
        matchedPayment = { ...matchedPayment, status: 'succeeded' };

        const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
        if (inv?.jobId) {
          await recomputeJobPaymentAndMaybeArchive(inv.jobId, 'stripe-confirm');

          let confirmChargeId: string | null = null;
          try {
            const piObj = await stripe.paymentIntents.retrieve(pi);
            confirmChargeId = piObj.latest_charge
              ? (typeof piObj.latest_charge === "string" ? piObj.latest_charge : piObj.latest_charge.id)
              : null;
          } catch (e: any) {
            console.warn(`[SubPayExec] stripe-confirm: Could not resolve charge: ${e.message}`);
          }
          console.log(`[SubPayExec] stripe-confirm: invoiceId=${invoiceId} jobId=${inv.jobId} paymentId=${matchedPayment.id} pi=${pi} chargeId=${confirmChargeId}`);

          stripeConnectService.executeSubcontractPayout({
            jobId: inv.jobId,
            invoiceId,
            paymentId: matchedPayment.id,
            paymentIntentId: pi,
            paymentAmountCents: matchedPayment.amountCents || Math.round(parseFloat(matchedPayment.amount) * 100),
            ownerCompanyId: inv.companyId,
            source: "stripe-confirm",
            chargeId: confirmChargeId,
          }).catch(err => console.error('[SubPayExec] stripe-confirm error:', err?.message));
        }

        sendReceiptForPayment(matchedPayment.id).catch(err =>
          console.error('[receipt] stripe-confirm error:', err?.message));
      }

      const computed = await recomputeInvoiceTotalsFromPayments(invoiceId);
      const balanceRemaining = computed.owedCents;
      const newStatus = computed.computedStatus;

      console.log(`[StripeConfirm] invoiceId=${invoiceId} pi=${pi} status=succeeded paid=${computed.paidCents} owed=${balanceRemaining} newStatus=${newStatus}`);
      return res.json({
        status: 'succeeded',
        paid: true,
        paymentId: matchedPayment.id,
        amountCents: matchedPayment.amountCents,
        balanceRemaining,
        newStatus,
        isPartial: balanceRemaining > 0,
      });
    } catch (error: any) {
      console.error('[StripeConfirm] Error:', error.message);
      res.status(500).json({ error: 'Failed to confirm payment' });
    }
  });

  // POST /api/public/payments/:paymentId/signature - Save signature for a public payment (validated by Stripe session)
  app.post('/api/public/payments/:paymentId/signature', async (req, res) => {
    try {
      const paymentId = parseInt(req.params.paymentId, 10);
      if (isNaN(paymentId)) return res.status(400).json({ error: 'Invalid payment ID' });

      const { signaturePngBase64, invoiceId, sessionId } = req.body;
      if (!signaturePngBase64 || typeof signaturePngBase64 !== 'string') {
        return res.status(400).json({ error: 'Signature image is required' });
      }
      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required for public signature' });
      }

      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
      let sessionInvoiceId: number | null = null;

      if (sessionId.startsWith('pi_')) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(sessionId);
          if (!paymentIntent || paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ error: 'Payment not confirmed by Stripe' });
          }
          sessionInvoiceId = paymentIntent.metadata?.invoiceId ? parseInt(paymentIntent.metadata.invoiceId) : null;
        } catch (e: any) {
          return res.status(400).json({ error: 'Invalid Stripe PaymentIntent' });
        }
      } else {
        let session;
        try {
          session = await stripe.checkout.sessions.retrieve(sessionId);
        } catch (e: any) {
          return res.status(400).json({ error: 'Invalid Stripe session' });
        }
        if (!session || session.payment_status !== 'paid') {
          return res.status(400).json({ error: 'Payment not confirmed by Stripe' });
        }
        sessionInvoiceId = session.metadata?.invoiceId ? parseInt(session.metadata.invoiceId) : null;
      }

      const payment = await storage.getPaymentById(paymentId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      const publicPaidStatuses = ['paid', 'succeeded', 'completed'];
      if (!publicPaidStatuses.includes((payment.status || '').toLowerCase())) {
        return res.status(400).json({ error: 'Signature can only be captured for paid payments' });
      }

      if (sessionInvoiceId && payment.invoiceId && payment.invoiceId !== sessionInvoiceId) {
        return res.status(403).json({ error: 'Session does not match this payment' });
      }

      const existing = await storage.getPaymentSignature(paymentId);
      if (existing) return res.json({ signature: existing });

      const sig = await storage.createPaymentSignature({
        companyId: payment.companyId,
        paymentId,
        jobId: payment.jobId || null,
        invoiceId: invoiceId || payment.invoiceId || null,
        signedByName: '',
        signaturePngBase64,
      });

      sendReceiptForPayment(paymentId).catch(err =>
        console.error('[receipt] after public signature error:', err?.message));

      res.json({ signature: { id: sig.id, signedAt: sig.signedAt } });
    } catch (error: any) {
      console.error('Error saving public payment signature:', error);
      res.status(500).json({ error: 'Failed to save signature' });
    }
  });

  // ============== PUBLIC SIGNATURE ROUTES (No Auth) ==============

  // GET /api/public/signature-requests/:token - Get signature request for public signing
  app.get('/api/public/signature-requests/:token', async (req, res) => {
    try {
      const { token } = req.params;
      console.log("[PublicSign] GET token:", token?.substring(0, 8) + "...");
      
      if (!token || token.length < 32) {
        return res.status(404).json({ message: "Invalid link" });
      }
      
      const request = await storage.getSignatureRequestByToken(token);
      
      if (!request) {
        return res.status(404).json({ message: "Invalid link" });
      }
      
      console.log("[PublicSign] status:", request.status, "expiresAt:", request.expiresAt);
      
      // Check if already signed
      if (request.status === 'signed' || request.signedAt) {
        return res.status(400).json({ message: "Already signed" });
      }
      
      // Check if expired
      if (request.expiresAt && new Date() > new Date(request.expiresAt)) {
        return res.status(410).json({ message: "Link expired" });
      }
      
      // Check if status allows signing (must be sent or viewed)
      if (!['sent', 'viewed'].includes(request.status)) {
        return res.status(400).json({ message: "This request is not available for signing" });
      }
      
      // Get document info
      const doc = await storage.getDocument(request.documentId);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Get company name
      const company = await storage.getCompany(request.companyId);
      
      // Return minimal info needed for signing page (no internal IDs exposed)
      res.json({
        customerName: request.customerName,
        customerEmail: request.customerEmail,
        message: request.message,
        status: request.status,
        documentName: doc.name,
        documentUrl: doc.fileUrl,
        documentCategory: doc.category,
        documentMimeType: doc.mimeType,
        companyName: company?.name || 'Unknown Company',
        viewedAt: request.viewedAt,
        signedAt: request.signedAt,
        expiresAt: request.expiresAt,
      });
    } catch (error) {
      console.error("Error fetching public signature request:", error);
      res.status(500).json({ message: "Failed to fetch signature request" });
    }
  });

  // POST /api/public/signature-requests/:token/viewed - Mark request as viewed
  app.post('/api/public/signature-requests/:token/viewed', async (req, res) => {
    try {
      const { token } = req.params;
      
      const request = await storage.getSignatureRequestByToken(token);
      
      if (!request) {
        return res.status(404).json({ message: "Signature request not found" });
      }
      
      // Only set viewedAt if not already set
      if (!request.viewedAt) {
        await db
          .update(signatureRequests)
          .set({
            viewedAt: new Date(),
            status: request.status === 'sent' ? 'viewed' : request.status,
            updatedAt: new Date(),
          })
          .where(eq(signatureRequests.id, request.id));
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking signature request as viewed:", error);
      res.status(500).json({ message: "Failed to update signature request" });
    }
  });

  // POST /api/public/signature-requests/:token/sign - Sign the document
  app.post('/api/public/signature-requests/:token/sign', async (req, res) => {
    try {
      const { token } = req.params;
      const { signatureDataUrl, signerName } = req.body;
      
      console.log("[PublicSign] POST sign token:", token?.substring(0, 8) + "...");
      
      const request = await storage.getSignatureRequestByToken(token);
      
      if (!request) {
        return res.status(404).json({ message: "Invalid link" });
      }
      
      // Check if already signed
      if (request.status === 'signed' || request.signedAt) {
        return res.status(400).json({ message: "Already signed" });
      }
      
      // Check if expired
      if (request.expiresAt && new Date() > new Date(request.expiresAt)) {
        return res.status(410).json({ message: "Link expired" });
      }
      
      // Can only sign if status is sent or viewed
      if (!['sent', 'viewed'].includes(request.status)) {
        return res.status(400).json({ message: "This request is not available for signing" });
      }
      
      // Validate signature data
      if (!signatureDataUrl || typeof signatureDataUrl !== 'string') {
        return res.status(400).json({ message: "Signature is required" });
      }
      
      if (!signatureDataUrl.startsWith('data:image/png;base64,')) {
        return res.status(400).json({ message: "Invalid signature format" });
      }
      
      // Check size (roughly 2MB limit for base64)
      if (signatureDataUrl.length > 2 * 1024 * 1024 * 1.37) {
        return res.status(400).json({ message: "Signature data too large" });
      }
      
      console.log("[PublicSign] saving signature bytes:", signatureDataUrl.length);
      
      // Store signature data URL directly (for MVP - could move to file storage later)
      const signedNameValue = signerName?.trim() || request.customerName;
      
      // Mark as signed with signature data
      await db
        .update(signatureRequests)
        .set({
          status: 'signed',
          signedAt: new Date(),
          signatureUrl: signatureDataUrl, // Store base64 directly for MVP
          signedName: signedNameValue,
          updatedAt: new Date(),
        })
        .where(eq(signatureRequests.id, request.id));
      
      res.json({ ok: true, message: "Document signed successfully" });
    } catch (error) {
      console.error("Error signing document:", error);
      res.status(500).json({ message: "Failed to sign document" });
    }
  });

  // ============== PUBLIC UNSUBSCRIBE ENDPOINTS ==============

  // GET /api/public/unsubscribe/email/status - Validate token without unsubscribing
  app.get('/api/public/unsubscribe/email/status', async (req, res) => {
    try {
      const { token } = req.query;
      
      if (!token || typeof token !== 'string') {
        return res.json({ valid: false, message: 'Invalid link' });
      }
      
      const { verifyUnsubscribeToken } = await import('./services/unsubscribe');
      const payload = verifyUnsubscribeToken(token);
      
      if (!payload) {
        return res.json({ valid: false, message: 'This link is invalid or has expired' });
      }
      
      if (payload.channel !== 'email') {
        return res.json({ valid: false, message: 'Invalid unsubscribe link' });
      }
      
      const customer = await storage.getCustomer(payload.customerId);
      
      if (!customer || customer.companyId !== payload.companyId) {
        return res.json({ valid: false, message: 'Link not found' });
      }
      
      res.json({ valid: true });
    } catch (error) {
      console.error('[Unsub] Error validating token:', error);
      res.json({ valid: false, message: 'Something went wrong' });
    }
  });

  // POST /api/public/unsubscribe/email/confirm - Confirm unsubscribe
  app.post('/api/public/unsubscribe/email/confirm', async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ ok: false, message: 'Invalid token' });
      }
      
      const { verifyUnsubscribeToken } = await import('./services/unsubscribe');
      const payload = verifyUnsubscribeToken(token);
      
      if (!payload) {
        return res.status(400).json({ ok: false, message: 'This link is invalid or has expired' });
      }
      
      if (payload.channel !== 'email') {
        return res.status(400).json({ ok: false, message: 'Invalid unsubscribe link' });
      }
      
      const customer = await storage.getCustomer(payload.customerId);
      
      if (!customer || customer.companyId !== payload.companyId) {
        return res.status(404).json({ ok: false, message: 'Link not found' });
      }
      
      await storage.updateCustomer(payload.customerId, {
        emailOptIn: false,
        emailUnsubscribedAt: new Date(),
      });
      
      console.log(`[Unsub] Email unsubscribe confirmed: customerId=${payload.customerId} companyId=${payload.companyId}`);
      
      res.json({ ok: true });
    } catch (error) {
      console.error('[Unsub] Error processing unsubscribe:', error);
      res.status(500).json({ ok: false, message: 'Something went wrong' });
    }
  });

  // GET /api/public/unsubscribe/sms/status - Validate SMS unsubscribe token
  app.get('/api/public/unsubscribe/sms/status', async (req, res) => {
    try {
      const { token } = req.query;
      
      if (!token || typeof token !== 'string') {
        return res.json({ valid: false, message: 'Invalid link' });
      }
      
      const { verifyUnsubscribeToken } = await import('./services/unsubscribe');
      const payload = verifyUnsubscribeToken(token);
      
      if (!payload) {
        return res.json({ valid: false, message: 'This link is invalid or has expired' });
      }
      
      if (payload.channel !== 'sms') {
        return res.json({ valid: false, message: 'Invalid unsubscribe link' });
      }
      
      const customer = await storage.getCustomer(payload.customerId);
      
      if (!customer || customer.companyId !== payload.companyId) {
        return res.json({ valid: false, message: 'Link not found' });
      }
      
      res.json({ valid: true });
    } catch (error) {
      console.error('[Unsub] Error validating SMS token:', error);
      res.json({ valid: false, message: 'Something went wrong' });
    }
  });

  // POST /api/public/unsubscribe/sms/confirm - Confirm SMS unsubscribe
  app.post('/api/public/unsubscribe/sms/confirm', async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ ok: false, message: 'Invalid token' });
      }
      
      const { verifyUnsubscribeToken } = await import('./services/unsubscribe');
      const payload = verifyUnsubscribeToken(token);
      
      if (!payload) {
        return res.status(400).json({ ok: false, message: 'This link is invalid or has expired' });
      }
      
      if (payload.channel !== 'sms') {
        return res.status(400).json({ ok: false, message: 'Invalid unsubscribe link' });
      }
      
      const customer = await storage.getCustomer(payload.customerId);
      
      if (!customer || customer.companyId !== payload.companyId) {
        return res.status(404).json({ ok: false, message: 'Link not found' });
      }
      
      await storage.updateCustomer(payload.customerId, {
        smsOptIn: false,
        smsUnsubscribedAt: new Date(),
      });
      
      console.log(`[Unsub] SMS unsubscribe confirmed: customerId=${payload.customerId} companyId=${payload.companyId}`);
      
      res.json({ ok: true });
    } catch (error) {
      console.error('[Unsub] Error processing SMS unsubscribe:', error);
      res.status(500).json({ ok: false, message: 'Something went wrong' });
    }
  });

  // GET /api/public/email-preferences - Get current email preferences (public, no auth)
  app.get('/api/public/email-preferences', async (req, res) => {
    try {
      const { token } = req.query;
      
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ ok: false, message: 'Invalid token' });
      }
      
      const { verifyUnsubscribeToken } = await import('./services/unsubscribe');
      const payload = verifyUnsubscribeToken(token);
      
      if (!payload) {
        return res.status(400).json({ ok: false, message: 'This link is invalid or has expired' });
      }
      
      const customer = await storage.getCustomer(payload.customerId);
      
      if (!customer || customer.companyId !== payload.companyId) {
        return res.status(404).json({ ok: false, message: 'Link not found' });
      }
      
      res.json({
        ok: true,
        emailOptIn: customer.emailOptIn ?? true,
        smsOptIn: customer.smsOptIn ?? true,
        channel: payload.channel,
      });
    } catch (error) {
      console.error('[Prefs] Error getting email preferences:', error);
      res.status(500).json({ ok: false, message: 'Something went wrong' });
    }
  });

  // POST /api/public/email-preferences - Update email preferences (public, no auth)
  app.post('/api/public/email-preferences', async (req, res) => {
    try {
      const { token, emailOptIn, smsOptIn } = req.body;
      
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ ok: false, message: 'Invalid token' });
      }
      
      const { verifyUnsubscribeToken } = await import('./services/unsubscribe');
      const payload = verifyUnsubscribeToken(token);
      
      if (!payload) {
        return res.status(400).json({ ok: false, message: 'This link is invalid or has expired' });
      }
      
      const customer = await storage.getCustomer(payload.customerId);
      
      if (!customer || customer.companyId !== payload.companyId) {
        return res.status(404).json({ ok: false, message: 'Link not found' });
      }
      
      const updates: Record<string, unknown> = {};
      
      if (typeof emailOptIn === 'boolean') {
        updates.emailOptIn = emailOptIn;
        if (emailOptIn) {
          updates.emailUnsubscribedAt = null;
        } else {
          updates.emailUnsubscribedAt = new Date();
        }
      }
      
      if (typeof smsOptIn === 'boolean') {
        updates.smsOptIn = smsOptIn;
        if (smsOptIn) {
          updates.smsUnsubscribedAt = null;
        } else {
          updates.smsUnsubscribedAt = new Date();
        }
      }
      
      if (Object.keys(updates).length > 0) {
        await storage.updateCustomer(payload.customerId, updates);
        console.log(`[Prefs] Updated preferences: customerId=${payload.customerId} updates=${JSON.stringify(updates)}`);
      }
      
      res.json({ ok: true });
    } catch (error) {
      console.error('[Prefs] Error updating email preferences:', error);
      res.status(500).json({ ok: false, message: 'Something went wrong' });
    }
  });

  // ============== DEBUG ENDPOINTS (Dev Only) ==============

  // POST /api/debug/test-email - Test email configuration (dev only)
  app.post('/api/debug/test-email', isAuthenticated, async (req: any, res) => {
    try {
      // Only allow in development
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: "Not available in production" });
      }
      
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Only owners can test
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      if (userRole !== 'OWNER') {
        return res.status(403).json({ message: "Only owners can test email" });
      }
      
      const { to } = req.body;
      if (!to || typeof to !== 'string') {
        return res.status(400).json({ message: "Email 'to' address is required" });
      }
      
      await sendTestEmail({ to });
      
      res.json({ success: true, message: `Test email sent to ${to}` });
    } catch (error: any) {
      console.error("Test email failed:", error);
      res.status(500).json({ 
        success: false, 
        message: "Test email failed",
        error: error?.message || 'Unknown error'
      });
    }
  });

  // Schedule routes
  app.get('/api/schedule-items', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const { start, end } = req.query;
      
      // If start and end are provided, filter by date range with overlap logic
      if (start && end) {
        const startUtc = new Date(start as string);
        const endUtc = new Date(end as string);
        
        if (isNaN(startUtc.getTime()) || isNaN(endUtc.getTime())) {
          return res.status(400).json({ message: "Invalid start or end date" });
        }
        
        // Overlap condition: (schedule.startDateTime < endUtc) AND (schedule.endDateTime > startUtc)
        const filteredSchedule = await db
          .select({
            id: scheduleItems.id,
            companyId: scheduleItems.companyId,
            jobId: scheduleItems.jobId,
            subcontractorId: scheduleItems.subcontractorId,
            startDateTime: scheduleItems.startDateTime,
            endDateTime: scheduleItems.endDateTime,
            status: scheduleItems.status,
            location: scheduleItems.location,
            notes: scheduleItems.notes,
            createdAt: scheduleItems.createdAt,
            updatedAt: scheduleItems.updatedAt,
            jobTitle: jobs.title,
            jobStatus: jobs.status,
            jobAddress: jobs.address,
            clientName: clients.name,
            clientId: jobs.clientId,
            subcontractorName: subcontractors.name,
          })
          .from(scheduleItems)
          .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
          .leftJoin(clients, eq(jobs.clientId, clients.id))
          .leftJoin(subcontractors, eq(scheduleItems.subcontractorId, subcontractors.id))
          .where(
            and(
              eq(scheduleItems.companyId, company.id),
              lt(scheduleItems.startDateTime, endUtc),
              gt(scheduleItems.endDateTime, startUtc)
            )
          );
        
        return res.json(filteredSchedule);
      }
      
      // Otherwise, return all schedule items with enriched data (legacy behavior)
      const allScheduleItems = await db
        .select({
          id: scheduleItems.id,
          companyId: scheduleItems.companyId,
          jobId: scheduleItems.jobId,
          subcontractorId: scheduleItems.subcontractorId,
          startDateTime: scheduleItems.startDateTime,
          endDateTime: scheduleItems.endDateTime,
          status: scheduleItems.status,
          location: scheduleItems.location,
          notes: scheduleItems.notes,
          createdAt: scheduleItems.createdAt,
          updatedAt: scheduleItems.updatedAt,
          jobTitle: jobs.title,
          jobStatus: jobs.status,
          jobAddress: jobs.address,
          clientName: clients.name,
          clientId: jobs.clientId,
          subcontractorName: subcontractors.name,
        })
        .from(scheduleItems)
        .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
        .leftJoin(clients, eq(jobs.clientId, clients.id))
        .leftJoin(subcontractors, eq(scheduleItems.subcontractorId, subcontractors.id))
        .where(eq(scheduleItems.companyId, company.id))
        .orderBy(desc(scheduleItems.startDateTime));
      
      res.json(allScheduleItems);
    } catch (error) {
      console.error("Error fetching schedule items:", error);
      res.status(500).json({ message: "Failed to fetch schedule items" });
    }
  });

  app.get('/api/schedule-items/:id', isAuthenticated, async (req: any, res) => {
    try {
      const scheduleItemId = parseInt(req.params.id);
      const scheduleItem = await storage.getScheduleItem(scheduleItemId);
      
      if (!scheduleItem) {
        return res.status(404).json({ message: "Schedule item not found" });
      }
      
      res.json(scheduleItem);
    } catch (error) {
      console.error("Error fetching schedule item:", error);
      res.status(500).json({ message: "Failed to fetch schedule item" });
    }
  });

  app.get('/api/jobs/:jobId/schedule', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const scheduleItems = await storage.getScheduleItemsByJob(jobId);
      res.json(scheduleItems);
    } catch (error) {
      console.error("Error fetching job schedule items:", error);
      res.status(500).json({ message: "Failed to fetch job schedule items" });
    }
  });

  app.post('/api/schedule-items', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Validate required fields
      if (!req.body.jobId) {
        return res.status(400).json({ 
          code: 'MISSING_JOB_ID', 
          message: "Job ID is required" 
        });
      }

      if (!req.body.startDateTime || !req.body.endDateTime) {
        return res.status(400).json({ 
          code: 'MISSING_DATETIME', 
          message: "Start and end date/time are required" 
        });
      }

      // Parse and validate dates
      const startDate = new Date(req.body.startDateTime);
      const endDate = new Date(req.body.endDateTime);

      if (!isFinite(+startDate) || !isFinite(+endDate)) {
        return res.status(400).json({ 
          code: 'INVALID_DATETIME', 
          message: "Invalid start or end date/time" 
        });
      }

      if (endDate <= startDate) {
        return res.status(400).json({ 
          code: 'INVALID_TIME_RANGE', 
          message: "End time must be after start time",
          field: 'endDateTime'
        });
      }

      // Verify job exists and belongs to company
      const job = await storage.getJob(req.body.jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ 
          code: 'JOB_NOT_FOUND', 
          message: "Job not found" 
        });
      }
      
      const scheduleItem = await storage.createScheduleItem({
        ...req.body,
        companyId: company.id
      });
      
      res.status(201).json(scheduleItem);
    } catch (error) {
      console.error("Error creating schedule item:", error);
      res.status(500).json({ message: "Failed to create schedule item" });
    }
  });

  app.patch('/api/schedule-items/:id', isAuthenticated, async (req: any, res) => {
    try {
      const scheduleItemId = parseInt(req.params.id);
      const scheduleItem = await storage.updateScheduleItem(scheduleItemId, req.body);
      res.json(scheduleItem);
    } catch (error) {
      console.error("Error updating schedule item:", error);
      res.status(500).json({ message: "Failed to update schedule item" });
    }
  });

  app.delete('/api/schedule-items/:id', isAuthenticated, async (req: any, res) => {
    try {
      const scheduleItemId = parseInt(req.params.id);
      await storage.deleteScheduleItem(scheduleItemId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting schedule item:", error);
      res.status(500).json({ message: "Failed to delete schedule item" });
    }
  });

  // Geocoding endpoint - geocodes address and caches coordinates
  app.post('/api/geocode', isAuthenticated, async (req: any, res) => {
    try {
      let { address, customerId } = req.body;
      
      if (!address) {
        return res.status(400).json({ message: "Address is required" });
      }

      console.log('[Geocode] Original address:', address);
      
      // Add region fallback if address doesn't contain state/city indicators
      // Use "Long Island, NY" as broad fallback (not a specific town like Sayville)
      const hasRegion = /,\s*(NY|New York|NJ|CT|PA|CA|FL|TX|Long Island)/i.test(address);
      let usedFallback = false;
      if (!hasRegion) {
        address = `${address}, Long Island, NY`;
        usedFallback = true;
        console.log('[Geocode] Added broad fallback region:', address);
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: "Geocoding service not configured" });
      }

      const encodedAddress = encodeURIComponent(address);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('[Geocode] Google response status:', data.status, 'results:', data.results?.length || 0);
      if (data.error_message) {
        console.log('[Geocode] Google error message:', data.error_message);
      }
      
      if (data.status !== 'OK' || !data.results?.length) {
        let userMessage = "Could not geocode address";
        if (data.status === 'REQUEST_DENIED') {
          userMessage = "Geocoding API not enabled. Please enable it in Google Cloud Console.";
          console.log('[Geocode] REQUEST_DENIED - API key may need Geocoding API enabled or has referrer restrictions');
        } else if (data.status === 'ZERO_RESULTS') {
          userMessage = "Address not found";
        }
        return res.status(404).json({ 
          message: userMessage, 
          attemptedAddress: address,
          status: data.status,
          error: data.error_message 
        });
      }

      const location = data.results[0].geometry.location;
      const result = { latitude: location.lat, longitude: location.lng };
      
      console.log('[Geocode] Success:', result.latitude, result.longitude, 'precision:', usedFallback ? 'approximate' : 'exact');

      // Cache coordinates on customer if customerId provided
      if (customerId) {
        await db.update(customers)
          .set({ 
            latitude: result.latitude, 
            longitude: result.longitude,
            geocodePrecision: usedFallback ? 'approximate' : 'exact'
          })
          .where(eq(customers.id, customerId));
      }

      res.json({ ...result, precision: usedFallback ? 'approximate' : 'exact' });
    } catch (error) {
      console.error("Geocoding error:", error);
      res.status(500).json({ message: "Failed to geocode address" });
    }
  });

  // Payments routes
  app.get('/api/payments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const allPayments = await storage.getPayments(company.id);

      const invoiceGroups: Record<number, any[]> = {};
      const standalone: any[] = [];

      const invoiceBalanceCache: Record<number, number> = {};
      for (const p of allPayments) {
        if (p.invoiceId && p.invoiceStatus === 'paid') {
          if (!(p.invoiceId in invoiceBalanceCache)) {
            const inv = await storage.getInvoice(p.invoiceId);
            invoiceBalanceCache[p.invoiceId] = inv ? (inv.balanceDueCents ?? -1) : -1;
          }
          const balance = invoiceBalanceCache[p.invoiceId];
          if (balance !== null && balance <= 0) {
            if (!invoiceGroups[p.invoiceId]) invoiceGroups[p.invoiceId] = [];
            invoiceGroups[p.invoiceId].push(p);
          } else {
            standalone.push(p);
          }
        } else {
          standalone.push(p);
        }
      }

      const result: any[] = [...standalone];

      for (const [invoiceIdStr, group] of Object.entries(invoiceGroups)) {
        const invoiceId = parseInt(invoiceIdStr, 10);
        if (group.length <= 1) {
          result.push(...group);
          continue;
        }

        const totalAmountCents = group.reduce((sum: number, p: any) => {
          return sum + (p.amountCents || Math.round(parseFloat(p.amount || '0') * 100));
        }, 0);

        const methods = new Set(group.map((p: any) => (p.paymentMethod || '').toLowerCase()));
        const method = methods.size > 1 ? 'mixed' : (group[0].paymentMethod || '');

        const mostRecent = group.reduce((latest: any, p: any) => {
          const d1 = p.paidDate ? new Date(p.paidDate) : p.createdAt ? new Date(p.createdAt) : new Date(0);
          const d2 = latest.paidDate ? new Date(latest.paidDate) : latest.createdAt ? new Date(latest.createdAt) : new Date(0);
          return d1 > d2 ? p : latest;
        }, group[0]);

        result.push({
          id: `invoice_${invoiceId}`,
          type: 'invoice_paid_group',
          companyId: group[0].companyId,
          invoiceId,
          jobId: group[0].jobId,
          customerId: group[0].customerId,
          amount: (totalAmountCents / 100).toFixed(2),
          amountCents: totalAmountCents,
          paymentMethod: method,
          status: 'paid',
          paidDate: mostRecent.paidDate,
          createdAt: mostRecent.createdAt,
          jobTitle: group[0].jobTitle,
          clientName: group[0].clientName,
          clientFirstName: group[0].clientFirstName,
          clientLastName: group[0].clientLastName,
          invoiceTotalCents: group[0].invoiceTotalCents,
          invoiceStatus: 'paid',
          paymentCount: group.length,
        });
      }

      result.sort((a: any, b: any) => {
        const da = a.paidDate ? new Date(a.paidDate).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db2 = b.paidDate ? new Date(b.paidDate).getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db2 - da;
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  app.get('/api/payments/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const range = (req.query.range as string) || 'month';
      const validRanges = ['week', 'month', 'year'];
      const safeRange = validRanges.includes(range) ? range as 'week' | 'month' | 'year' : 'month';
      const stats = await storage.getPaymentsStats(company.id, safeRange);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching payments stats:", error);
      res.status(500).json({ message: "Failed to fetch payments stats" });
    }
  });

  app.get('/api/payments/ledger', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const countedStatuses = ['paid', 'succeeded', 'completed'];
      const countedSet = new Set(countedStatuses);

      const allInvoices = await storage.getInvoices(company.id);

      const referredOutJobIds = new Set<number>();
      const referralFeeByJob: Record<number, number> = {};
      const referralPayoutStatusByJob: Record<number, string> = {};
      const referredInJobIds = new Set<number>();
      const referredInShareByJob: Record<number, { contractorPayoutPct: number; referralType: string; referralValue: string }> = {};
      try {
        const outReferrals = await db.select().from(jobReferrals).where(
          and(eq(jobReferrals.senderCompanyId, company.id), eq(jobReferrals.status, 'accepted'))
        );
        for (const ref of outReferrals) {
          if (ref.jobId) {
            referredOutJobIds.add(ref.jobId);
            referralFeeByJob[ref.jobId] = ref.companyShareAmountCents || 0;
          }
        }

        const inReferrals = await db.select().from(jobReferrals).where(
          and(eq(jobReferrals.receiverCompanyId, company.id), eq(jobReferrals.status, 'accepted'))
        );
        for (const ref of inReferrals) {
          if (ref.jobId) {
            referredInJobIds.add(ref.jobId);
            referredInShareByJob[ref.jobId] = {
              referralType: ref.referralType,
              referralValue: ref.referralValue,
              contractorPayoutPct: ref.referralType === 'percent' ? parseFloat(ref.referralValue) / 100 : 0,
            };
          }
        }

        const allReferralJobIds = new Set([...referredOutJobIds, ...referredInJobIds]);
        if (allReferralJobIds.size > 0) {
          const auditRecords = await db.select().from(subcontractPayoutAudit).where(
            eq(subcontractPayoutAudit.ownerCompanyId, company.id)
          );
          for (const a of auditRecords) {
            if (a.jobId && referredOutJobIds.has(a.jobId)) {
              if (a.status === 'completed') {
                referralPayoutStatusByJob[a.jobId] = 'completed';
              } else if (!referralPayoutStatusByJob[a.jobId]) {
                referralPayoutStatusByJob[a.jobId] = a.status || 'pending';
              }
            }
          }
        }
      } catch (e) {
        console.error("[ledger] Error loading referral data:", e);
      }

      const allCompanyPayments = await db
        .select()
        .from(payments)
        .where(eq(payments.companyId, company.id));

      const paymentsByInvoice: Record<number, typeof allCompanyPayments> = {};
      for (const p of allCompanyPayments) {
        if (p.invoiceId) {
          (paymentsByInvoice[p.invoiceId] ??= []).push(p);
        }
      }

      let allRefunds: any[] = [];
      try { allRefunds = await storage.getRefundsByCompanyId(company.id); } catch {}
      const settledRefundStatuses = new Set(['succeeded', 'settled']);
      const refundTotalsByInvoice: Record<number, number> = {};
      for (const r of allRefunds) {
        if (r.invoiceId && settledRefundStatuses.has(r.status)) {
          refundTotalsByInvoice[r.invoiceId] = (refundTotalsByInvoice[r.invoiceId] || 0) + r.amountCents;
        }
      }

      const range = (req.query.range as string) || 'month';
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const todayStr = now.toISOString().split('T')[0];

      let rangeStart: Date;
      if (range === 'week') {
        rangeStart = new Date(now);
        rangeStart.setDate(rangeStart.getDate() - 6);
        rangeStart.setHours(0, 0, 0, 0);
      } else if (range === 'year') {
        rangeStart = new Date(now.getFullYear(), 0, 1);
      } else {
        rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      let stillOwedCents = 0;
      let paidTodayCents = 0;
      let earningsRangeCents = 0;
      let overdueCount = 0;

      const items = allInvoices
        .filter((inv: any) => {
          const s = (inv.status || '').toLowerCase();
          if (s === 'cancelled' || s === 'void' || s === 'draft') return false;
          const total = inv.totalCents || Math.round(parseFloat(inv.amount || '0') * 100);
          return total > 0;
        })
        .map((inv: any) => {
          const totalCents = inv.totalCents || Math.round(parseFloat(inv.amount || '0') * 100);
          const invPayments = paymentsByInvoice[inv.id] || [];

          let paidCents = 0;
          let succeededCount = 0;
          const statusSamples: string[] = [];
          let lastPayment: any = null;

          for (const p of invPayments) {
            const st = (p.status || '').toLowerCase();
            if (statusSamples.length < 5) statusSamples.push(st);
            if (countedSet.has(st)) {
              paidCents += (p.amountCents || 0);
              succeededCount++;
            }
            if (!lastPayment || (p.paidDate && (!lastPayment.paidDate || new Date(p.paidDate) > new Date(lastPayment.paidDate)))) {
              lastPayment = p;
            }
          }

          const refundedCents = refundTotalsByInvoice[inv.id] || 0;

          const isReferredOut = inv.jobId && referredOutJobIds.has(inv.jobId) &&
            inv.job?.companyId && inv.job.companyId !== inv.companyId;

          const isReferredIn = !isReferredOut && inv.jobId && referredInJobIds.has(inv.jobId);

          let shareMultiplier = 1;
          let displayTotalCents = totalCents;
          if (isReferredIn) {
            const shareInfo = referredInShareByJob[inv.jobId!];
            if (shareInfo && shareInfo.referralType === 'percent') {
              shareMultiplier = shareInfo.contractorPayoutPct;
              displayTotalCents = Math.round(totalCents * shareMultiplier);
            }
          } else if (isReferredOut) {
            const refInfo = referredOutJobIds.has(inv.jobId!) ? referralFeeByJob[inv.jobId!] : 0;
            shareMultiplier = 0;
          }

          for (const p of invPayments) {
            const st = (p.status || '').toLowerCase();
            if (countedSet.has(st)) {
              const pAmt = p.amountCents || 0;
              const shareAmt = isReferredOut ? 0 : Math.round(pAmt * shareMultiplier);
              const paidDate = p.paidDate ? new Date(p.paidDate) : p.createdAt ? new Date(p.createdAt) : null;
              if (paidDate) {
                if (paidDate >= todayStart && paidDate <= todayEnd) paidTodayCents += shareAmt;
                if (paidDate >= rangeStart) earningsRangeCents += shareAmt;
              }
            }
          }

          let balanceDueCents = Math.max(0, displayTotalCents - paidCents);

          const dbStatus = (inv.status || '').toLowerCase();
          let computedStatus: string;
          let referralFeeCents = 0;

          if (isReferredOut) {
            referralFeeCents = referralFeeByJob[inv.jobId!] || 0;
            const payoutStatus = referralPayoutStatusByJob[inv.jobId!];
            if (payoutStatus === 'completed') {
              computedStatus = 'referred_paid';
              balanceDueCents = 0;
            } else {
              computedStatus = 'referred';
              balanceDueCents = 0;
            }
          } else if (dbStatus === 'refunded' || dbStatus === 'partially_refunded') {
            computedStatus = dbStatus;
          } else if (balanceDueCents === 0 && totalCents > 0) {
            computedStatus = 'paid';
          } else if (paidCents > 0 && balanceDueCents > 0) {
            computedStatus = 'partial';
          } else {
            computedStatus = 'unpaid';
          }

          if (balanceDueCents > 0) {
            stillOwedCents += balanceDueCents;
            if (inv.dueDate && inv.dueDate < todayStr) overdueCount++;
          }

          let customerName = 'Unknown Customer';
          if (inv.customer?.firstName || inv.customer?.lastName) {
            customerName = [inv.customer.firstName, inv.customer.lastName].filter(Boolean).join(' ');
          } else if (inv.customer?.companyName) {
            customerName = inv.customer.companyName;
          } else if (inv.client?.name) {
            customerName = inv.client.name;
          } else if (inv.job?.clientName) {
            customerName = inv.job.clientName;
          }

          return {
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            customerId: inv.customerId,
            customerName,
            jobId: inv.jobId,
            jobTitle: inv.job?.title || null,
            totalCents: displayTotalCents,
            paidCents: isReferredIn ? Math.min(paidCents, displayTotalCents) : paidCents,
            balanceDueCents,
            refundedCents,
            referralFeeCents,
            isReferredOut: !!isReferredOut,
            isReferredIn: !!isReferredIn,
            computedStatus,
            dueDate: inv.dueDate,
            issueDate: inv.issueDate,
            createdAt: inv.createdAt,
            lastActivityDate: inv.paidDate || inv.updatedAt || inv.createdAt,
            lastPayment: lastPayment ? {
              amountCents: lastPayment.amountCents,
              status: lastPayment.status,
              paymentMethod: lastPayment.paymentMethod,
              paidDate: lastPayment.paidDate,
              stripePaymentIntentId: lastPayment.stripePaymentIntentId,
            } : null,
            diagnostics: {
              paymentRowsFound: invPayments.length,
              succeededCount,
              latestStatusesSample: statusSamples,
              invoiceIdKeyUsed: inv.id,
            },
          };
        });

      items.sort((a: any, b: any) => {
        const da = a.lastActivityDate ? new Date(a.lastActivityDate).getTime() : 0;
        const db2 = b.lastActivityDate ? new Date(b.lastActivityDate).getTime() : 0;
        return db2 - da;
      });

      res.json({
        items,
        stats: {
          stillOwedCents,
          paidTodayCents,
          overdueCount,
          earningsRangeCents,
          range,
        },
        debug: {
          countedStatuses,
          companyIdUsed: company.id,
          totalInvoicesScanned: allInvoices.length,
          totalPaymentRows: allCompanyPayments.length,
        },
      });
    } catch (error) {
      console.error("Error fetching payments ledger:", error);
      res.status(500).json({ message: "Failed to fetch payments ledger" });
    }
  });

  app.get('/api/payments/breakdown', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const range = (req.query.range as string) || 'this_month';
      const now = new Date();
      let startDate: Date;
      let endDate: Date;
      
      if (range === 'last_month') {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        startDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
        endDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0, 23, 59, 59, 999);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      }
      
      const breakdown = await storage.getPaymentsBreakdown(company.id, startDate, endDate);
      res.json(breakdown);
    } catch (error) {
      console.error("Error fetching payments breakdown:", error);
      res.status(500).json({ message: "Failed to fetch payments breakdown" });
    }
  });

  app.get('/api/payments/invoice/:invoiceId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const invoiceId = parseInt(req.params.invoiceId, 10);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      let isReceiverViewing = false;
      let isCrossCompanyAccess = false;
      if (invoice.companyId !== company.id) {
        if (invoice.jobId) {
          const refs = await db.select().from(jobReferrals).where(
            and(
              eq(jobReferrals.jobId, invoice.jobId),
              eq(jobReferrals.status, 'accepted')
            )
          );
          for (const ref of refs) {
            if (ref.receiverCompanyId === company.id) {
              isReceiverViewing = true;
              isCrossCompanyAccess = true;
            } else if (ref.senderCompanyId === company.id) {
              isCrossCompanyAccess = true;
            }
          }
        }
        if (!isCrossCompanyAccess) {
          return res.status(404).json({ message: "Invoice not found" });
        }
      }

      const invoicePayments = await storage.getPaymentsByInvoiceId(invoiceId);

      let customerName: string | null = null;
      if (invoice.customerId) {
        const customer = await storage.getCustomer(invoice.customerId);
        if (customer) customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.companyName || null;
      }

      let jobTitle: string | null = null;
      if (invoice.jobId) {
        const job = await storage.getJob(invoice.jobId);
        if (job) jobTitle = job.title || null;
      }

      const enrichedPayments = await Promise.all(invoicePayments.map(async (p: any) => {
        let collectedByName: string | null = null;
        if (p.collectedByUserId) {
          const collector = await storage.getUser(p.collectedByUserId);
          if (collector) collectedByName = [collector.firstName, collector.lastName].filter(Boolean).join(" ") || collector.username || null;
        }
        return {
          ...p,
          customerName: customerName || "Unknown Customer",
          collectedByName,
        };
      }));

      let invoiceRefunds: any[] = [];
      try {
        invoiceRefunds = await storage.getRefundsByInvoiceId(invoiceId);
      } catch (e) {}

      const invoiceTotalCents = invoice.totalCents || Math.round(parseFloat(invoice.amount || '0') * 100);
      let totalPaymentsCents = 0;
      let totalRefundedOnPayments = 0;
      for (const p of invoicePayments) {
        const pAmt = (p as any).amountCents || Math.round(parseFloat((p as any).amount || '0') * 100);
        totalPaymentsCents += pAmt;
        totalRefundedOnPayments += ((p as any).refundedAmountCents || 0);
      }

      const settledRefundStatuses = new Set(['succeeded', 'settled']);
      const pendingRefundStatuses = new Set(['pending', 'posted']);
      let totalRefundsCents = 0;
      let pendingRefundsCents = 0;
      for (const r of invoiceRefunds) {
        if (settledRefundStatuses.has(r.status)) {
          totalRefundsCents += r.amountCents;
        }
        if (pendingRefundStatuses.has(r.status)) {
          pendingRefundsCents += r.amountCents;
        }
      }

      let isReferredIn = false;
      let isSenderViewing = false;
      let companySharePct = 1;
      let referralRef: any = null;
      if (invoice.jobId) {
        const refs = await db.select().from(jobReferrals).where(
          and(
            eq(jobReferrals.jobId, invoice.jobId),
            eq(jobReferrals.status, 'accepted')
          )
        );
        if (refs.length > 0) {
          referralRef = refs[0];
          if (referralRef.referralType === 'percent' && referralRef.referralValue) {
            const pct = parseFloat(referralRef.referralValue) / 100;
            if (referralRef.receiverCompanyId === company.id) {
              isReferredIn = true;
              companySharePct = pct;
            } else if (referralRef.senderCompanyId === company.id) {
              isSenderViewing = true;
              companySharePct = 1 - pct;
            }
          }
        }
      }

      const isSplitPayment = isReferredIn || isSenderViewing;

      if (isSenderViewing && totalPaymentsCents === 0 && invoice.jobId && referralRef) {
        const receiverInvoices = await db.select().from(invoices)
          .where(and(
            eq(invoices.jobId, invoice.jobId),
            eq(invoices.companyId, referralRef.receiverCompanyId)
          ));

        if (receiverInvoices.length > 0) {
          const recvInv = receiverInvoices[0];
          const recvPayments = await storage.getPaymentsByInvoiceId(recvInv.id);
          const countedStatuses = ['succeeded', 'settled', 'paid', 'completed', 'posted'];
          const countedSet = new Set(countedStatuses);

          for (const p of recvPayments) {
            const st = (p.status || '').toLowerCase();
            if (countedSet.has(st)) {
              totalPaymentsCents += (p as any).amountCents || 0;
            }
          }

          const recvEnriched = recvPayments.filter((p: any) => countedSet.has((p.status || '').toLowerCase())).map((p: any) => ({
            ...p,
            amountCents: Math.round((p.amountCents || 0) * companySharePct),
            originalAmountCents: p.amountCents,
            customerName: customerName || "Unknown Customer",
            collectedByName: null,
          }));
          enrichedPayments.push(...recvEnriched);
        }
      }

      const displayTotalCents = isSplitPayment ? Math.round(invoiceTotalCents * companySharePct) : invoiceTotalCents;
      const displayPaymentsCents = isSplitPayment ? Math.min(Math.round(totalPaymentsCents * companySharePct), displayTotalCents) : totalPaymentsCents;
      const displayRefundsCents = isSplitPayment ? Math.round(totalRefundsCents * companySharePct) : totalRefundsCents;
      const displayPendingRefundsCents = isSplitPayment ? Math.round(pendingRefundsCents * companySharePct) : pendingRefundsCents;

      const balanceDueCents = Math.max(0, displayTotalCents - displayPaymentsCents);
      const netCollectedCents = Math.max(0, displayPaymentsCents - displayRefundsCents);

      let computedStatus: string;
      if (displayPaymentsCents === 0) {
        computedStatus = 'unpaid';
      } else if (displayPaymentsCents < displayTotalCents) {
        computedStatus = 'partial';
      } else {
        if (displayRefundsCents === 0) {
          computedStatus = 'paid';
        } else if (displayRefundsCents >= displayPaymentsCents) {
          computedStatus = 'refunded';
        } else {
          computedStatus = 'partially_refunded';
        }
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();

      let canRecordManualPayment = false;
      if (isSplitPayment) {
        canRecordManualPayment = false;
      } else if (['OWNER', 'ADMIN', 'DISPATCHER', 'SUPERVISOR'].includes(userRole)) {
        canRecordManualPayment = true;
      } else if (userRole === 'TECHNICIAN' && invoice.jobId) {
        const assignments = await storage.getUserJobAssignments(userId);
        canRecordManualPayment = assignments.some(a => a.jobId === invoice.jobId);
      }

      const shareEnrichedPayments = isSplitPayment
        ? enrichedPayments.map((p: any) => ({
            ...p,
            amountCents: p.originalAmountCents ? p.amountCents : Math.round((p.amountCents || 0) * companySharePct),
            originalAmountCents: p.originalAmountCents || p.amountCents,
          }))
        : enrichedPayments;

      res.json({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceTotalCents: displayTotalCents,
        grossInvoiceTotalCents: isSplitPayment ? invoiceTotalCents : undefined,
        paidAmountCents: displayPaymentsCents,
        totalPaymentsCents: displayPaymentsCents,
        totalRefundsCents: displayRefundsCents,
        pendingRefundsCents: displayPendingRefundsCents,
        netCollectedCents,
        balanceDueCents,
        invoiceStatus: computedStatus,
        isReferredIn,
        isSenderViewing,
        isSplitPayment,
        companySharePct: isSplitPayment ? companySharePct : undefined,
        customerName: customerName || "Unknown Customer",
        jobTitle,
        jobId: invoice.jobId,
        payments: shareEnrichedPayments,
        refunds: invoiceRefunds,
        canRecordManualPayment,
      });
    } catch (error) {
      console.error("Error fetching invoice payments:", error);
      res.status(500).json({ message: "Failed to fetch invoice payments" });
    }
  });

  app.get('/api/payments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const paymentId = parseInt(req.params.id, 10);
      if (isNaN(paymentId)) return res.status(400).json({ message: "Invalid payment ID" });

      const allPayments = await storage.getPayments(company.id);
      const payment = allPayments.find((p: any) => p.id === paymentId);
      if (!payment) return res.status(404).json({ message: "Payment not found" });

      let customerName = [payment.clientFirstName, payment.clientLastName].filter(Boolean).join(" ") || null;
      if (!customerName && payment.customerId) {
        const customer = await storage.getCustomer(payment.customerId);
        if (customer) customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.companyName || null;
      }

      let invoiceNumber = null;
      if (payment.invoiceId) {
        const invoice = await storage.getInvoice(payment.invoiceId);
        if (invoice) invoiceNumber = invoice.invoiceNumber;
      }

      let collectedByName = null;
      if (payment.collectedByUserId) {
        const collector = await storage.getUser(payment.collectedByUserId);
        if (collector) collectedByName = [collector.firstName, collector.lastName].filter(Boolean).join(" ") || collector.username || null;
      }

      res.json({
        ...payment,
        customerName: customerName || "Unknown Customer",
        invoiceNumber,
        collectedByName,
      });
    } catch (error) {
      console.error("Error fetching payment details:", error);
      res.status(500).json({ message: "Failed to fetch payment details" });
    }
  });

  app.post('/api/payments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const payment = await storage.createPayment({
        ...req.body,
        companyId: company.id
      });
      
      res.status(201).json(payment);
    } catch (error) {
      console.error("Error creating payment:", error);
      res.status(500).json({ message: "Failed to create payment" });
    }
  });

  app.patch('/api/payments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const paymentId = parseInt(req.params.id);
      const payment = await storage.updatePayment(paymentId, req.body);
      res.json(payment);
    } catch (error) {
      console.error("Error updating payment:", error);
      res.status(500).json({ message: "Failed to update payment" });
    }
  });

  // ============= Standalone Invoice Routes =============

  // GET /api/invoices - Get all invoices for company
  app.get('/api/invoices', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const invoiceList = await storage.getInvoices(company.id);

      const companyPayments = await db
        .select({
          invoiceId: payments.invoiceId,
          amountCents: payments.amountCents,
          status: payments.status,
        })
        .from(payments)
        .where(eq(payments.companyId, company.id));

      const paidStatuses = new Set(['paid', 'succeeded', 'completed']);
      const paidSums: Record<number, number> = {};
      for (const p of companyPayments) {
        if (p.invoiceId && paidStatuses.has((p.status || '').toLowerCase())) {
          paidSums[p.invoiceId] = (paidSums[p.invoiceId] || 0) + (p.amountCents || 0);
        }
      }

      const enriched = invoiceList.map((inv: any) => {
        const totalCents = inv.totalCents || Math.round(parseFloat(inv.amount || '0') * 100);
        const computedPaidCents = paidSums[inv.id] || 0;
        const computedOwedCents = Math.max(0, totalCents - computedPaidCents);
        let computedStatus: string;
        const dbStatus = (inv.status || '').toLowerCase();
        if (dbStatus === 'refunded' || dbStatus === 'partially_refunded' || dbStatus === 'cancelled' || dbStatus === 'void' || dbStatus === 'draft') {
          computedStatus = dbStatus;
        } else if (computedOwedCents === 0 && totalCents > 0) {
          computedStatus = 'paid';
        } else if (computedPaidCents > 0) {
          computedStatus = 'partial';
        } else {
          computedStatus = dbStatus || 'unpaid';
        }
        return {
          ...inv,
          paidAmountCents: computedPaidCents,
          balanceDueCents: computedOwedCents,
          computedStatus,
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // GET /api/invoices/:id - Get single invoice details
  app.get('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      const computed = await recomputeInvoiceTotalsFromPayments(invoiceId);
      
      res.json({
        ...invoice,
        paidAmountCents: computed.paidCents,
        balanceDueCents: computed.owedCents,
        computedStatus: computed.computedStatus,
      });
    } catch (error) {
      console.error("Error fetching invoice:", error);
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });

  // GET /api/invoices/:id/payments - Get payments for an invoice
  app.get('/api/invoices/:id/payments', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      const invoicePayments = await storage.getPaymentsByInvoiceId(invoiceId);
      res.json(invoicePayments);
    } catch (error) {
      console.error("Error fetching invoice payments:", error);
      res.status(500).json({ message: "Failed to fetch invoice payments" });
    }
  });

  // PATCH /api/invoices/:id - Update invoice (mark as paid, void, etc.)
  app.patch('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Only Owner/Supervisor can update invoices
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "You do not have permission to update invoices" });
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      const { status, paidAt } = req.body;
      
      const updateData: any = {};
      if (status) updateData.status = status;
      if (paidAt) updateData.paidAt = new Date(paidAt);

      if (status === 'paid' && invoice.status !== 'paid') {
        const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100);
        updateData.paidAmountCents = invoiceTotalCents;
        updateData.balanceDueCents = 0;
        updateData.paidDate = new Date().toISOString().split('T')[0];
        if (!paidAt) updateData.paidAt = new Date();
      }
      
      const updatedInvoice = await storage.updateInvoice(invoiceId, updateData);

      if (status === 'paid' && invoice.status !== 'paid') {
        console.log("[invoice] status change", { invoiceId, fromStatus: invoice.status, toStatus: 'paid', companyId: company.id, triggeredBy: "manual-mark-paid" });

        const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100);
        const existingPayment = await storage.getPaymentByInvoiceId(invoiceId);
        if (!existingPayment) {
          const payment = await storage.createPayment({
            companyId: company.id,
            jobId: invoice.jobId || null,
            invoiceId: invoiceId,
            customerId: invoice.customerId || null,
            amount: (invoiceTotalCents / 100).toFixed(2),
            amountCents: invoiceTotalCents,
            paymentMethod: 'other',
            status: 'paid',
            collectedByUserId: userId,
            collectedByRole: userRole,
            paidDate: new Date(),
            notes: 'Invoice marked as paid',
          });
          console.log(`[Invoice] Auto-created payment ${payment.id} for invoice ${invoiceId}`);

          syncPaymentToQbo(payment.id, company.id).then(result => {
            if (result.success) console.log(`[QB] Payment ${payment.id} synced: ${result.qboPaymentId}`);
            else console.log(`[QB] Payment ${payment.id} sync: ${result.error}`);
          }).catch(err => console.error('[QB] Payment sync error:', err));
        }

        if (invoice.jobId) {
          await storage.updateJob(invoice.jobId, { paymentStatus: 'paid', paidAt: new Date() } as any);
          console.log(`[Invoice] Job ${invoice.jobId} paymentStatus updated to paid`);
          await tryArchiveCompletedPaidJob(invoice.jobId);
        }

        const paidAmountDollars = (invoiceTotalCents / 100).toFixed(2);
        await notifyOwners(company.id, {
          type: 'invoice_paid',
          title: 'Payment Received',
          body: `Invoice paid – $${paidAmountDollars}`,
          entityType: 'invoice',
          entityId: invoiceId,
          linkUrl: `/invoices/${invoiceId}`,
        });
      }
      
      console.log(`[Invoice] Updated invoice`, { invoiceId, status, userId });
      res.json(updatedInvoice);
    } catch (error) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ message: "Failed to update invoice" });
    }
  });

  // POST /api/invoices/:id/test-paid-notification — TEMP test endpoint (OWNER only)
  app.post('/api/invoices/:id/test-paid-notification', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member || member.role.toUpperCase() !== 'OWNER') {
        return res.status(403).json({ message: 'Owner only' });
      }

      const invoiceId = parseInt(req.params.id);
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice || invoice.companyId !== member.companyId) {
        return res.status(404).json({ message: 'Invoice not found' });
      }

      const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount || '0') * 100);
      const paidAmountDollars = (invoiceTotalCents / 100).toFixed(2);

      console.log("[invoice] TEST-paid-notification", { invoiceId, companyId: member.companyId, currentStatus: invoice.status, totalDollars: paidAmountDollars });

      await notifyOwners(member.companyId, {
        type: 'invoice_paid',
        title: 'Payment Received',
        body: `Invoice paid – $${paidAmountDollars}`,
        entityType: 'invoice',
        entityId: invoiceId,
        linkUrl: `/invoices/${invoiceId}`,
      });

      res.json({ ok: true, invoiceId, companyId: member.companyId, amountDollars: paidAmountDollars });
    } catch (error: any) {
      console.error("[invoice] test-paid-notification error:", error);
      res.status(500).json({ message: error.message || "Failed" });
    }
  });

  // POST /api/invoices/:id/send/email - Send invoice via email with payment link (Resend)
  app.post('/api/invoices/:id/send/email', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const { email } = req.body;
      
      console.log("[EmailSend] start", { 
        invoiceId, 
        to: email,
        hasResendKey: !!process.env.RESEND_API_KEY,
        hasAppBaseUrl: !!process.env.APP_BASE_URL
      });
      
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!['OWNER', 'SUPERVISOR'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to send invoices" });
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: "Email address is required" });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address format" });
      }
      
      // Check if Resend is configured
      if (!process.env.RESEND_API_KEY) {
        console.error("[EmailSend] Missing RESEND_API_KEY");
        return res.status(500).json({ message: "Email service not configured: missing RESEND_API_KEY" });
      }
      
      const fromEmail = getResendFrom();
      console.log('[email] FROM used:', fromEmail);

      const appBaseUrl = process.env.APP_BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
      const paymentLink = `${appBaseUrl}/invoice/${invoice.id}/pay`;
      
      console.log("[EmailSend] building email", { from: fromEmail, paymentLink });
      
      // Format amount
      const amountFormatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(invoice.totalCents / 100);
      
      // Format due date
      const dueDateFormatted = invoice.dueDate 
        ? new Date(invoice.dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null;
      
      const resend = new Resend(process.env.RESEND_API_KEY);
      
      const emailHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1e293b; font-size: 24px; margin-bottom: 20px;">Invoice from ${company.name}</h1>
          
          <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="margin: 0 0 10px 0; color: #64748b;">Invoice Number</p>
            <p style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600; color: #1e293b;">${invoice.invoiceNumber}</p>
            
            <p style="margin: 0 0 10px 0; color: #64748b;">Amount Due</p>
            <p style="margin: 0 0 20px 0; font-size: 24px; font-weight: 700; color: #1e293b;">${amountFormatted}</p>
            
            ${dueDateFormatted ? `
              <p style="margin: 0 0 10px 0; color: #64748b;">Due Date</p>
              <p style="margin: 0; font-size: 16px; color: #1e293b;">${dueDateFormatted}</p>
            ` : ''}
          </div>
          
          <a href="${paymentLink}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
            Pay Now
          </a>
          
          <p style="margin-top: 20px; color: #64748b; font-size: 14px;">
            Or copy this link: <a href="${paymentLink}" style="color: #2563eb;">${paymentLink}</a>
          </p>
          
          <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
            If you have any questions about this invoice, please contact us.
          </p>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
          
          <p style="color: #94a3b8; font-size: 12px;">
            Sent by ${company.name} via EcoLogic
          </p>
        </div>
      `;
      
      try {
        const { data, error } = await resend.emails.send({
          from: fromEmail,
          reply_to: 'no-reply@ecologicc.com',
          to: email,
          subject: `Invoice ${invoice.invoiceNumber} from ${company.name} - ${amountFormatted}`,
          html: emailHtml,
        });
        
        if (error) {
          console.error("[EmailSend] Resend error:", error);
          return res.status(500).json({ 
            message: "Failed to send email",
            detail: error.message,
            name: error.name
          });
        }
        
        // Update invoice status to 'sent' if it was draft
        if (invoice.status === 'draft') {
          await storage.updateInvoice(invoiceId, { status: 'sent' });
        }
        
        console.log("[EmailSend] sent successfully", { invoiceId, to: email, resendId: data?.id });
        res.json({ success: true, emailId: data?.id });
      } catch (resendError: any) {
        console.error("[EmailSend] Resend exception:", resendError);
        return res.status(500).json({ 
          message: "Failed to send email",
          detail: resendError?.message,
          name: resendError?.name,
          statusCode: resendError?.statusCode,
          type: resendError?.type
        });
      }
    } catch (error: any) {
      console.error("[EmailSend] Unexpected error:", error);
      res.status(500).json({ 
        message: "Failed to send invoice",
        detail: error?.message 
      });
    }
  });

  // POST /api/invoices/:id/send/text - Send invoice via SMS with payment link (Twilio)
  app.post('/api/invoices/:id/send/text', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!['OWNER', 'SUPERVISOR'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to send invoices" });
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      const { phone } = req.body;
      
      if (!phone || typeof phone !== 'string') {
        return res.status(400).json({ message: "Phone number is required" });
      }
      
      // Validate Twilio credentials
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioFromNumber = process.env.TWILIO_FROM_NUMBER;
      
      if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
        console.error("[InvoiceSend] Twilio credentials not configured");
        return res.status(500).json({ message: "SMS service not configured" });
      }
      
      // Normalize phone to E.164 format (assume US if no country code)
      const digitsOnly = phone.replace(/\D/g, '');
      let e164Phone: string;
      if (digitsOnly.length === 10) {
        e164Phone = `+1${digitsOnly}`;
      } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        e164Phone = `+${digitsOnly}`;
      } else if (digitsOnly.startsWith('1') && digitsOnly.length > 11) {
        e164Phone = `+${digitsOnly}`;
      } else {
        e164Phone = `+${digitsOnly}`;
      }
      
      // Validate phone has at least 10 digits
      if (digitsOnly.length < 10) {
        return res.status(400).json({ message: "Invalid phone number - must have at least 10 digits" });
      }
      
      // Build payment link
      const appBaseUrl = process.env.APP_BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
      const paymentLink = `${appBaseUrl}/invoice/${invoice.id}/pay`;
      
      // Format amount
      const amountFormatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(invoice.totalCents / 100);
      
      // Format due date if present
      let dueDateStr = '';
      if (invoice.dueDate) {
        const dueDate = new Date(invoice.dueDate);
        dueDateStr = ` Due ${dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`;
      }
      
      // Compose SMS message
      const smsBody = `${company.name} Invoice ${invoice.invoiceNumber} for ${amountFormatted} is ready.${dueDateStr} Pay here: ${paymentLink}`;
      
      // Send SMS via Twilio
      const twilio = await import('twilio');
      const twilioClient = twilio.default(twilioAccountSid, twilioAuthToken);
      
      console.log(`[InvoiceSend] Sending SMS invoiceId=${invoiceId} to=${e164Phone}`);
      
      const message = await twilioClient.messages.create({
        body: smsBody,
        from: twilioFromNumber,
        to: e164Phone,
      });
      
      console.log(`[InvoiceSend] SMS sent invoiceId=${invoiceId} sid=${message.sid}`);
      
      // Update invoice status to 'sent' if it was draft
      if (invoice.status === 'draft') {
        await storage.updateInvoice(invoiceId, { status: 'sent' });
      }
      
      res.json({ 
        success: true, 
        messageSid: message.sid
      });
    } catch (error: any) {
      console.error("Error sending invoice SMS:", error);
      
      // Check for Twilio-specific errors
      if (error.code && error.message) {
        return res.status(400).json({ message: `SMS failed: ${error.message}` });
      }
      
      res.status(500).json({ message: "Failed to send invoice" });
    }
  });

  // POST /api/invoices/bulk-delete - Bulk delete invoices (Owner/Supervisor only)
  app.post('/api/invoices/bulk-delete', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "You do not have permission to delete invoices" });
      }
      
      const { invoiceIds } = req.body;
      
      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ message: "invoiceIds array is required" });
      }
      
      let hardDeletedCount = 0;
      let softDeletedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];
      
      for (const invoiceId of invoiceIds) {
        try {
          const invoice = await storage.getInvoice(invoiceId);
          
          if (!invoice || invoice.companyId !== company.id) {
            skippedCount++;
            continue;
          }
          
          const hasRefs = await storage.invoiceHasFinancialRefs(invoiceId);
          const isPaidOrPartial = invoice.status === 'paid' || invoice.status === 'partial';
          
          if (hasRefs || isPaidOrPartial) {
            await storage.softDeleteInvoice(invoiceId, 'has_financial_records');
            softDeletedCount++;
          } else {
            await storage.deleteInvoice(invoiceId);
            hardDeletedCount++;
          }
        } catch (err: any) {
          errors.push(`Invoice ${invoiceId}: ${err.message || 'unknown error'}`);
        }
      }
      
      const totalRemoved = hardDeletedCount + softDeletedCount;
      console.log(`[Invoice] Bulk delete: hard=${hardDeletedCount} soft=${softDeletedCount} skipped=${skippedCount}`, { userId });
      res.json({ success: true, hardDeletedCount, softDeletedCount, skippedCount, deletedCount: totalRemoved, errors });
    } catch (error) {
      console.error("Error bulk deleting invoices:", error);
      res.status(500).json({ message: "Failed to delete invoices" });
    }
  });

  // POST /api/invoices - Create standalone invoice (not job-linked)
  app.post('/api/invoices', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!canCreateInvoices(userRole)) {
        return res.status(403).json({ message: "You do not have permission to create invoices" });
      }

      const { 
        customerId, 
        invoiceNumber, 
        amount, 
        subtotalCents, 
        taxCents, 
        totalCents, 
        status, 
        issueDate, 
        dueDate, 
        scheduledAt, 
        tags, 
        notes,
        lineItems 
      } = req.body;

      // Validate required fields
      if (!customerId) {
        return res.status(400).json({ message: "Customer is required" });
      }
      if (!invoiceNumber) {
        return res.status(400).json({ message: "Invoice number is required" });
      }

      // Create invoice
      const invoice = await storage.createInvoice({
        companyId: company.id,
        customerId,
        invoiceNumber,
        amount: amount || "0",
        subtotalCents: subtotalCents || 0,
        taxCents: taxCents || 0,
        totalCents: totalCents || 0,
        status: status || 'draft',
        issueDate: issueDate || new Date().toISOString().split('T')[0],
        dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        tags: tags || [],
        lineItems: lineItems || [],
        notes: notes || null,
      });

      console.log(`[Invoice] Created standalone invoice`, { invoiceId: invoice.id, customerId, companyId: company.id });

      // Auto-sync to QuickBooks (fire-and-forget, non-blocking)
      console.log('[QB] Auto-sync scheduled for invoiceId:', invoice.id);
      syncInvoiceToQuickBooks(invoice.id, company.id)
        .then(result => {
          if (result.success) {
            console.log('[QB] Auto-sync success invoiceId:', invoice.id, 'qboInvoiceId:', result.qboInvoiceId);
          } else {
            console.log('[QB] Auto-sync failed invoiceId:', invoice.id, 'error:', result.error);
          }
        })
        .catch(err => console.error('[QB] Auto-sync error invoiceId:', invoice.id, err.message));

      res.status(201).json(invoice);
    } catch (error) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  // Invoice scanning route with OpenAI vision
  app.post('/api/scan-invoice', isAuthenticated, async (req: any, res) => {
    try {
      const { imageData } = req.body;
      
      if (!imageData) {
        return res.status(400).json({ message: "Image data is required" });
      }

      // Import OpenAI client
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Please analyze this invoice image and extract the following information in JSON format:
                {
                  "invoiceNumber": "string (invoice number)",
                  "amount": "string (total amount as decimal)",
                  "issueDate": "string (YYYY-MM-DD format)",
                  "dueDate": "string (YYYY-MM-DD format)",
                  "clientName": "string (vendor/company name)",
                  "notes": "string (any additional details or line items)"
                }
                
                If any field cannot be determined from the image, use null for that field. For dates, convert to YYYY-MM-DD format. For amount, extract only the number without currency symbols.`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageData
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 500
      });

      const extractedData = JSON.parse(response.choices[0].message.content);
      
      // Find matching client if clientName is provided
      let clientId = null;
      if (extractedData.clientName) {
        const userId = getUserId(req.user);
        const company = await storage.getUserCompany(userId);
        
        if (company) {
          const clients = await storage.getClients(company.id);
          const matchingClient = clients.find(client => 
            client.name.toLowerCase().includes(extractedData.clientName.toLowerCase()) ||
            extractedData.clientName.toLowerCase().includes(client.name.toLowerCase())
          );
          
          if (matchingClient) {
            clientId = matchingClient.id.toString();
          }
        }
      }

      // Format the response to match form structure
      const formattedData = {
        invoiceNumber: extractedData.invoiceNumber || null,
        amount: extractedData.amount || "",
        clientId: clientId || "none",
        issueDate: extractedData.issueDate || new Date().toISOString().split('T')[0],
        dueDate: extractedData.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        notes: extractedData.notes || ""
      };

      res.json(formattedData);
    } catch (error) {
      console.error("Error scanning invoice:", error);
      res.status(500).json({ message: "Failed to analyze invoice image" });
    }
  });

  // ============= Messaging API Routes =============
  
  // Get company users for messaging (exclude current user, only active)
  app.get('/api/messaging/users', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      const users = await storage.getCompanyUsersForMessaging(company.id, userId);
      res.json(users);
    } catch (error) {
      console.error('Error fetching messaging users:', error);
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });

  // Single endpoint to open a DM: find-or-create + fetch messages in one call
  app.post('/api/dm/open', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const { userId: targetUserId, limit = 50 } = req.body;

      if (!targetUserId) {
        return res.status(400).json({ message: 'userId is required' });
      }

      // Get current user's company
      const company = await storage.getUserCompany(currentUserId);
      if (!company) {
        return res.status(403).json({ message: 'No company found for user' });
      }

      // Validate target user exists, is ACTIVE, and in same company
      const [targetUser] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          profileImageUrl: users.profileImageUrl,
          status: users.status,
          role: companyMembers.role,
        })
        .from(users)
        .innerJoin(companyMembers, eq(users.id, companyMembers.userId))
        .where(
          and(
            eq(users.id, targetUserId),
            eq(companyMembers.companyId, company.id),
            sql`UPPER(${users.status}) = 'ACTIVE'`
          )
        )
        .limit(1);

      if (!targetUser) {
        return res.status(403).json({ 
          code: 'USER_NOT_FOUND',
          message: 'Target user not found or not accessible' 
        });
      }

      // Deterministically get or create the 1:1 conversation
      const conversation = await storage.getOrCreateConversation(
        currentUserId,
        targetUserId,
        company.id
      );

      // Fetch messages
      const messages = await storage.getConversationMessages(conversation.id, limit);

      // Format response
      res.json({
        conversation: { id: conversation.id },
        otherUser: {
          id: targetUser.id,
          name: `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim() || targetUser.email,
          avatar: targetUser.profileImageUrl,
          role: targetUser.role,
          status: targetUser.status,
        },
        messages: messages.map((msg: any) => ({
          id: msg.id,
          senderId: msg.senderId,
          body: msg.body,
          createdAt: msg.createdAt,
        })),
      });
    } catch (error) {
      console.error('Error opening DM:', error);
      res.status(500).json({ message: 'Failed to open DM' });
    }
  });

  // Get user's conversations
  app.get('/api/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      const conversations = await storage.getUserConversations(userId, company.id);
      
      // Enrich conversations with other participant info and unread count
      const enriched = await Promise.all(conversations.map(async (conv: any) => {
        // Get all participants
        const participants = await db
          .select({
            id: conversationParticipants.id,
            userId: conversationParticipants.userId,
            lastReadAt: conversationParticipants.lastReadAt,
            user: {
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              email: users.email,
              profileImageUrl: users.profileImageUrl,
              status: users.status,
            }
          })
          .from(conversationParticipants)
          .innerJoin(users, eq(conversationParticipants.userId, users.id))
          .where(eq(conversationParticipants.conversationId, conv.id));

        // Find the other participant (not current user)
        const otherParticipant = participants.find((p: any) => p.userId !== userId);
        const currentUserParticipant = participants.find((p: any) => p.userId === userId);

        // Get last message
        const [lastMessage] = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conv.id),
              sql`${messages.deletedAt} IS NULL`
            )
          )
          .orderBy(desc(messages.createdAt))
          .limit(1);

        // Calculate unread count
        let unreadCount = 0;
        if (currentUserParticipant?.lastReadAt) {
          const [result] = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conv.id),
                sql`${messages.createdAt} > ${currentUserParticipant.lastReadAt}`,
                sql`${messages.senderId} != ${userId}`,
                sql`${messages.deletedAt} IS NULL`
              )
            );
          unreadCount = result?.count || 0;
        } else {
          // Never read, count all messages from other user
          const [result] = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conv.id),
                sql`${messages.senderId} != ${userId}`,
                sql`${messages.deletedAt} IS NULL`
              )
            );
          unreadCount = result?.count || 0;
        }

        return {
          id: conv.id,
          isGroup: conv.isGroup,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          otherUser: otherParticipant?.user,
          lastMessage: lastMessage || null,
          unreadCount,
        };
      }));

      res.json(enriched);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({ message: 'Failed to fetch conversations' });
    }
  });

  // iOS-style message threads endpoint
  app.get('/api/messages/threads', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const conversations = await storage.getUserConversations(userId, company.id);
      
      // Format for iOS-style display
      const threads = await Promise.all(conversations.map(async (conv: any) => {
        // Get participants
        const participants = await db
          .select({
            userId: conversationParticipants.userId,
            lastReadAt: conversationParticipants.lastReadAt,
            user: {
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
            }
          })
          .from(conversationParticipants)
          .innerJoin(users, eq(conversationParticipants.userId, users.id))
          .where(eq(conversationParticipants.conversationId, conv.id));

        const otherParticipant = participants.find((p: any) => p.userId !== userId);
        const currentUserParticipant = participants.find((p: any) => p.userId === userId);

        // Get last message
        const [lastMessage] = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conv.id),
              sql`${messages.deletedAt} IS NULL`
            )
          )
          .orderBy(desc(messages.createdAt))
          .limit(1);

        // Calculate unread count
        let unreadCount = 0;
        if (currentUserParticipant?.lastReadAt) {
          const [result] = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conv.id),
                sql`${messages.createdAt} > ${currentUserParticipant.lastReadAt}`,
                sql`${messages.senderId} != ${userId}`,
                sql`${messages.deletedAt} IS NULL`
              )
            );
          unreadCount = result?.count || 0;
        } else {
          const [result] = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conv.id),
                sql`${messages.senderId} != ${userId}`,
                sql`${messages.deletedAt} IS NULL`
              )
            );
          unreadCount = result?.count || 0;
        }

        // Synthesize message preview
        let messageText: string | null = null;
        let messageType: 'text' | 'image' | 'file' | 'system' = 'text';
        
        if (lastMessage) {
          // Check for text message first
          if (lastMessage.body) {
            messageText = lastMessage.body;
            messageType = 'text';
          } 
          // Check for attachments
          else if (lastMessage.attachments) {
            const attachments = lastMessage.attachments as any;
            if (Array.isArray(attachments) && attachments.length > 0) {
              // Count attachments by type
              let photoCount = 0;
              let videoCount = 0;
              let audioCount = 0;
              let fileCount = 0;
              
              for (const attachment of attachments) {
                const mimeType = attachment.type || attachment.mimeType || '';
                if (mimeType.startsWith('image/')) {
                  photoCount++;
                } else if (mimeType.startsWith('video/')) {
                  videoCount++;
                } else if (mimeType.startsWith('audio/')) {
                  audioCount++;
                } else {
                  fileCount++;
                }
              }
              
              // Generate preview based on attachment types
              if (photoCount > 0 && videoCount === 0 && audioCount === 0 && fileCount === 0) {
                // Only photos
                messageText = photoCount === 1 ? 'Photo' : `${photoCount} Photos`;
                messageType = 'image';
              } else if (videoCount > 0 && photoCount === 0 && audioCount === 0 && fileCount === 0) {
                // Only videos
                messageText = videoCount === 1 ? 'Video' : `${videoCount} Videos`;
                messageType = 'file';
              } else if (audioCount > 0 && photoCount === 0 && videoCount === 0 && fileCount === 0) {
                // Only audio
                messageText = audioCount === 1 ? 'Audio' : `${audioCount} Audio Files`;
                messageType = 'file';
              } else if (fileCount > 0 && photoCount === 0 && videoCount === 0 && audioCount === 0) {
                // Only files
                messageText = fileCount === 1 ? 'File' : `${fileCount} Files`;
                messageType = 'file';
              } else {
                // Mixed types
                const totalCount = photoCount + videoCount + audioCount + fileCount;
                messageText = totalCount === 1 ? 'Attachment' : `${totalCount} Attachments`;
                messageType = 'file';
              }
            } else {
              messageText = 'Message';
              messageType = 'system';
            }
          } 
          // Fallback for empty message
          else {
            messageText = 'Message';
            messageType = 'system';
          }
        }

        // Format for iOS-style display
        return {
          id: conv.id.toString(),
          otherUser: {
            id: otherParticipant?.userId || '',
            name: `${otherParticipant?.user?.firstName || ''} ${otherParticipant?.user?.lastName || ''}`.trim() || 'Unknown User',
          },
          lastMessage: lastMessage ? {
            id: lastMessage.id.toString(),
            text: messageText,
            type: messageType,
            createdAt: lastMessage.createdAt.toISOString(),
            senderId: lastMessage.senderId,
          } : null,
          unreadCount,
          lastReadAt: currentUserParticipant?.lastReadAt?.toISOString() || null,
        };
      }));

      // Sort by last message time (most recent first)
      threads.sort((a, b) => {
        const aTime = a.lastMessage?.createdAt || new Date(0).toISOString();
        const bTime = b.lastMessage?.createdAt || new Date(0).toISOString();
        return bTime.localeCompare(aTime);
      });

      res.json(threads.slice(0, limit));
    } catch (error) {
      console.error('Error fetching message threads:', error);
      res.status(500).json({ message: 'Failed to fetch message threads' });
    }
  });

  // Get all coworkers with their thread status (for inbox that shows everyone)
  app.get('/api/messages/people-list', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Get all active users in the company (excluding current user)
      // Join through companyMembers to get coworkers in the same company
      const coworkers = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          status: users.status,
        })
        .from(users)
        .innerJoin(companyMembers, eq(companyMembers.userId, users.id))
        .where(
          and(
            eq(companyMembers.companyId, company.id),
            sql`${users.id} != ${userId}`,
            sql`UPPER(${users.status}) = 'ACTIVE'`
          )
        );

      // For each coworker, find their 1:1 thread with current user
      const peopleList = await Promise.all(coworkers.map(async (coworker) => {
        // Create pairKey using the same hash function as storage.ts
        const pairKey = generatePairKey(company.id, userId, coworker.id);

        // Find existing 1:1 conversation
        const [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.pairKey, pairKey),
              eq(conversations.isGroup, false)
            )
          )
          .limit(1);

        let lastMessage: any = null;
        let unreadCount = 0;
        let currentUserParticipant: any = null;

        if (conversation) {
          // Get last message
          const [msg] = await db
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                sql`${messages.deletedAt} IS NULL`
              )
            )
            .orderBy(desc(messages.createdAt))
            .limit(1);

          if (msg) {
            // Synthesize message preview
            let messageText: string | null = null;
            let messageType: 'text' | 'image' | 'file' | 'system' = 'text';
            
            if (msg.body) {
              messageText = msg.body;
              messageType = 'text';
            } else if (msg.attachments) {
              const attachments = msg.attachments as any;
              if (Array.isArray(attachments) && attachments.length > 0) {
                const photoCount = attachments.filter((a: any) => (a.type || a.mimeType || '').startsWith('image/')).length;
                const videoCount = attachments.filter((a: any) => (a.type || a.mimeType || '').startsWith('video/')).length;
                const audioCount = attachments.filter((a: any) => (a.type || a.mimeType || '').startsWith('audio/')).length;
                const fileCount = attachments.length - photoCount - videoCount - audioCount;
                
                if (photoCount > 0 && videoCount === 0 && audioCount === 0 && fileCount === 0) {
                  messageText = photoCount === 1 ? 'Photo' : `${photoCount} Photos`;
                  messageType = 'image';
                } else if (videoCount > 0 && photoCount === 0 && audioCount === 0 && fileCount === 0) {
                  messageText = videoCount === 1 ? 'Video' : `${videoCount} Videos`;
                  messageType = 'file';
                } else {
                  const totalCount = attachments.length;
                  messageText = totalCount === 1 ? 'Attachment' : `${totalCount} Attachments`;
                  messageType = 'file';
                }
              } else {
                messageText = 'Message';
                messageType = 'system';
              }
            } else {
              messageText = 'Message';
              messageType = 'system';
            }

            lastMessage = {
              id: msg.id.toString(),
              text: messageText,
              type: messageType,
              senderId: msg.senderId,
              createdAt: msg.createdAt.toISOString(),
            };
          }

          // Get current user's participant record for lastReadAt
          [currentUserParticipant] = await db
            .select()
            .from(conversationParticipants)
            .where(
              and(
                eq(conversationParticipants.conversationId, conversation.id),
                eq(conversationParticipants.userId, userId)
              )
            )
            .limit(1);

          // Calculate unread count
          if (currentUserParticipant?.lastReadAt) {
            const [result] = await db
              .select({ count: sql<number>`count(*)` })
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, conversation.id),
                  sql`${messages.createdAt} > ${currentUserParticipant.lastReadAt}`,
                  sql`${messages.senderId} != ${userId}`,
                  sql`${messages.deletedAt} IS NULL`
                )
              );
            unreadCount = result?.count || 0;
          } else {
            const [result] = await db
              .select({ count: sql<number>`count(*)` })
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, conversation.id),
                  sql`${messages.senderId} != ${userId}`,
                  sql`${messages.deletedAt} IS NULL`
                )
              );
            unreadCount = result?.count || 0;
          }
        }

        return {
          id: coworker.id,
          name: `${coworker.firstName} ${coworker.lastName}`.trim(),
          hasThread: !!conversation,
          threadId: conversation ? conversation.id.toString() : undefined,
          lastMessage: lastMessage,
          unreadCount,
          updatedAt: conversation ? conversation.updatedAt.toISOString() : null,
        };
      }));

      // iOS-style sorting: conversation.updatedAt desc (most recent activity first)
      peopleList.sort((a, b) => {
        // Conversations with activity first (sorted by updatedAt desc)
        const aTime = a.updatedAt || '';
        const bTime = b.updatedAt || '';
        
        if (aTime && bTime) {
          const comparison = bTime.localeCompare(aTime);
          if (comparison !== 0) return comparison;
        } else if (aTime && !bTime) {
          return -1; // Conversations with messages come before those without
        } else if (!aTime && bTime) {
          return 1;
        }
        
        // Finally alphabetically by name for coworkers without conversations
        return a.name.localeCompare(b.name);
      });

      // Diagnostics: log first 3 items for debugging
      const firstThree = peopleList.slice(0, 3).map(p => ({
        name: p.name,
        lastMessageAt: p.lastMessage?.createdAt || null,
        updatedAt: p.updatedAt
      }));
      console.log('[people-list] first 3 items:', JSON.stringify(firstThree));

      res.json(peopleList);
    } catch (error) {
      console.error('Error fetching people list:', error);
      res.status(500).json({ message: 'Failed to fetch people list' });
    }
  });

  // Ensure a 1:1 thread exists with a user (create if needed)
  app.post('/api/messages/threads/ensure', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { otherUserId } = req.body;

      if (!otherUserId) {
        return res.status(400).json({ message: 'otherUserId is required' });
      }

      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Verify other user is in the same company
      const otherUserCompany = await storage.getUserCompany(otherUserId);
      if (!otherUserCompany || otherUserCompany.id !== company.id) {
        return res.status(403).json({ message: 'Cannot message users outside your company' });
      }

      const conversation = await storage.getOrCreateConversation(userId, otherUserId, company.id);
      
      // Diagnostics: log pairKey and threadId for debugging
      const ids = [userId, otherUserId].sort();
      const pairKey = `${ids[0]}_${ids[1]}`;
      console.log('[threads.ensure]', { pairKey, threadId: conversation.id });
      
      res.json({ threadId: conversation.id.toString() });
    } catch (error) {
      console.error('Error ensuring thread:', error);
      res.status(500).json({ message: 'Failed to ensure thread' });
    }
  });

  // Create or get conversation with a user
  app.post('/api/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { otherUserId } = req.body;

      if (!otherUserId) {
        return res.status(400).json({ message: 'otherUserId is required' });
      }

      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Verify other user is in the same company
      const otherUserCompany = await storage.getUserCompany(otherUserId);
      if (!otherUserCompany || otherUserCompany.id !== company.id) {
        return res.status(403).json({ message: 'Cannot message users outside your company' });
      }

      const conversation = await storage.getOrCreateConversation(userId, otherUserId, company.id);
      res.json(conversation);
    } catch (error) {
      console.error('Error creating conversation:', error);
      res.status(500).json({ message: 'Failed to create conversation' });
    }
  });

  // Get single conversation details
  app.get('/api/conversations/:conversationId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const conversationId = parseInt(req.params.conversationId);

      // Verify user is a participant
      const participant = await storage.getConversationParticipant(conversationId, userId);
      if (!participant) {
        return res.status(403).json({ message: 'Not a participant in this conversation' });
      }

      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      // Get all participants to find the other user (role comes from companyMembers, not users)
      const participants = await db
        .select({
          usrId: conversationParticipants.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          profileImageUrl: users.profileImageUrl,
          status: users.status,
        })
        .from(conversationParticipants)
        .innerJoin(users, eq(conversationParticipants.userId, users.id))
        .where(eq(conversationParticipants.conversationId, conversationId));

      console.log('[GET /api/conversations/:id] participants:', JSON.stringify(participants));
      console.log('[GET /api/conversations/:id] currentUserId:', userId);

      const otherParticipant = participants.find((p: any) => p.usrId !== userId);
      console.log('[GET /api/conversations/:id] otherParticipant:', JSON.stringify(otherParticipant));
      
      // Get role from companyMembers if we have the other participant
      let role = 'member';
      if (otherParticipant?.usrId && conversation.companyId) {
        const [membership] = await db
          .select({ role: companyMembers.role })
          .from(companyMembers)
          .where(and(
            eq(companyMembers.userId, otherParticipant.usrId),
            eq(companyMembers.companyId, conversation.companyId)
          ))
          .limit(1);
        role = membership?.role || 'member';
      }
      
      // Format otherUser with computed name field (matching DM open endpoint format)
      const otherUser = otherParticipant ? {
        id: otherParticipant.usrId,
        name: `${otherParticipant.firstName || ''} ${otherParticipant.lastName || ''}`.trim() || otherParticipant.email,
        avatar: otherParticipant.profileImageUrl,
        role,
        status: otherParticipant.status,
      } : null;
      
      console.log('[GET /api/conversations/:id] otherUser:', JSON.stringify(otherUser));

      res.json({
        id: conversation.id,
        isGroup: conversation.isGroup,
        otherUser,
      });
    } catch (error) {
      console.error('Error fetching conversation:', error);
      res.status(500).json({ message: 'Failed to fetch conversation' });
    }
  });

  // Get conversation messages
  app.get('/api/conversations/:conversationId/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const conversationId = parseInt(req.params.conversationId);
      const limit = parseInt(req.query.limit || '50');
      const cursor = req.query.cursor;

      // Verify user is a participant
      const participant = await storage.getConversationParticipant(conversationId, userId);
      if (!participant) {
        console.log('[get messages] User not participant:', { conversationId, userId });
        return res.status(403).json({ message: 'Not a participant in this conversation' });
      }

      const msgs = await storage.getConversationMessages(conversationId, limit, cursor);
      
      // Diagnostics: log message fetch
      console.log('[get messages]', { 
        conversationId, 
        userId, 
        count: msgs.length,
        firstMsgId: msgs[0]?.id,
        lastMsgId: msgs[msgs.length - 1]?.id
      });
      
      // Reverse to get chronological order (oldest first)
      res.json(msgs.reverse());
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ message: 'Failed to fetch messages' });
    }
  });

  // Send a message
  app.post('/api/conversations/:conversationId/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const conversationId = parseInt(req.params.conversationId);
      const { body } = req.body;

      if (!body || !body.trim()) {
        return res.status(400).json({ message: 'Message body is required' });
      }

      // Verify user is a participant
      const participant = await storage.getConversationParticipant(conversationId, userId);
      const isMember = !!participant;
      
      // Diagnostics: log send attempt
      console.log('[send message]', { threadId: conversationId, senderId: userId, isMember });
      
      if (!participant) {
        return res.status(403).json({ message: 'Not a participant in this conversation' });
      }

      const message = await storage.createConversationMessage({
        conversationId,
        senderId: userId,
        body: body.trim(),
      });

      // Get other participants to notify via WebSocket
      const participants = await db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            sql`${conversationParticipants.userId} != ${userId}`
          )
        );

      // Send WebSocket notification to other participants
      participants.forEach(({ userId: recipientId }) => {
        const recipientSockets = wsClients.get(recipientId);
        if (recipientSockets) {
          recipientSockets.forEach((socket) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: 'new_message',
                conversationId,
                message,
              }));
            }
          });
        }
      });

      // Create DM push notification for recipients
      const sender = await storage.getUser(userId);
      const senderCompany = await storage.getUserCompany(userId);

      const recipientUserIds = participants.map(p => p.userId);
      console.log("[dm] message created", { threadId: conversationId, senderUserId: userId, recipientUserIds });

      if (!sender || !senderCompany) {
        console.log("[dm] WARNING: sender or senderCompany not found — skipping push", { senderFound: !!sender, companyFound: !!senderCompany, userId });
      }

      if (recipientUserIds.length === 0) {
        console.log("[dm] WARNING: recipientUserIds is empty — no one to notify", { threadId: conversationId, senderUserId: userId });
      }

      if (sender && senderCompany && recipientUserIds.length > 0) {
        const senderName = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.email || 'Someone';
        const messagePreview = body.trim().length > 80 
          ? body.trim().substring(0, 80) + '...' 
          : body.trim();

        for (const recipientId of recipientUserIds) {
          try {
            await notifyUsers([recipientId], {
              companyId: senderCompany.id,
              type: 'dm_message',
              title: 'New Message',
              body: `${senderName}: ${messagePreview}`,
              entityType: 'conversation',
              entityId: conversationId,
              linkUrl: `/messages/${conversationId}`,
              meta: {
                conversationId,
                senderId: userId,
                messageId: message.id,
              },
              dedupMinutes: 1,
            });
          } catch (notifError) {
            console.error('[dm] Failed to create notification for recipient:', recipientId, notifError);
          }
        }
      }

      res.json(message);
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ message: 'Failed to send message' });
    }
  });

  // Mark conversation as read
  app.post('/api/conversations/:conversationId/read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const conversationId = parseInt(req.params.conversationId);

      // Verify user is a participant
      const participant = await storage.getConversationParticipant(conversationId, userId);
      if (!participant) {
        return res.status(403).json({ message: 'Not a participant in this conversation' });
      }

      await storage.markConversationAsRead(conversationId, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking conversation as read:', error);
      res.status(500).json({ message: 'Failed to mark as read' });
    }
  });

  // ============== DEBUG ENDPOINTS ==============
  // These endpoints help test WebSocket room subscriptions and message delivery
  // PROTECTED: Only available in development environment
  
  // Middleware to gate debug endpoints to development only
  const isDevelopment = (req: any, res: any, next: any) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ message: 'Not found' });
    }
    next();
  };
  
  // Inject a server-generated message (no DB) to isolate socket delivery
  app.post('/debug/inject-message', isDevelopment, isAuthenticated, (req, res) => {
    try {
      const { conversationId, text = 'SERVER TEST MESSAGE' } = req.body || {};
      
      if (!conversationId) {
        return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'conversationId required' });
      }
      
      const roomKey = conversationRoom(conversationId);
      const roomSockets = wsRooms.get(roomKey);
      
      if (!roomSockets || roomSockets.size === 0) {
        return res.json({ 
          ok: false, 
          code: 'NO_SOCKETS',
          message: `No sockets in room ${roomKey}`,
          roomKey
        });
      }
      
      const testMessage = {
        id: 'debug-' + Math.random().toString(36).slice(2),
        conversationId,
        senderId: 'SERVER',
        body: text,
        createdAt: new Date().toISOString(),
        isDebug: true
      };
      
      const broadcastMsg = JSON.stringify({
        type: 'message:created',
        conversationId,
        message: testMessage,
      });
      
      let sentCount = 0;
      roomSockets.forEach((socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(broadcastMsg);
          sentCount++;
        }
      });
      
      console.log(`[DEBUG:INJECT] Sent test message to ${sentCount}/${roomSockets.size} sockets in ${roomKey}`);
      
      res.json({ 
        ok: true, 
        message: testMessage,
        roomKey,
        socketCount: roomSockets.size,
        sentCount
      });
    } catch (error: any) {
      console.error('[DEBUG:INJECT] Error:', error);
      res.status(500).json({ ok: false, code: 'SERVER_ERROR', detail: error?.message });
    }
  });
  
  // Get last 50 messages from DB for a conversation
  app.get('/debug/messages', isDevelopment, isAuthenticated, async (req: any, res) => {
    try {
      const conversationId = parseInt(req.query.conversationId as string);
      
      if (!conversationId) {
        return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'conversationId required' });
      }
      
      const messages = await storage.getConversationMessages(conversationId, 50);
      const roomKey = conversationRoom(conversationId);
      const roomSockets = wsRooms.get(roomKey);
      
      res.json({ 
        ok: true, 
        conversationId,
        messageCount: messages.length,
        messages,
        roomInfo: {
          roomKey,
          socketCount: roomSockets?.size || 0
        }
      });
    } catch (error: any) {
      console.error('[DEBUG:MESSAGES] Error:', error);
      res.status(500).json({ ok: false, code: 'SERVER_ERROR', detail: error?.message });
    }
  });
  
  // Get WebSocket room status
  app.get('/debug/rooms', isDevelopment, isAuthenticated, (req, res) => {
    try {
      const rooms: Record<string, number> = {};
      wsRooms.forEach((sockets, roomKey) => {
        rooms[roomKey] = sockets.size;
      });
      
      const users: Record<string, number> = {};
      wsClients.forEach((sockets, userId) => {
        users[userId] = sockets.size;
      });
      
      res.json({
        ok: true,
        totalRooms: wsRooms.size,
        totalUsers: wsClients.size,
        rooms,
        users
      });
    } catch (error: any) {
      console.error('[DEBUG:ROOMS] Error:', error);
      res.status(500).json({ ok: false, code: 'SERVER_ERROR', detail: error?.message });
    }
  });

  // =============================================================================
  // Service Catalog API (Owner/Supervisor only)
  // =============================================================================

  // GET /api/service-catalog - List all service catalog items for the company
  app.get('/api/service-catalog', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }
      
      // Only Owner and Supervisor can view service catalog
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      const items = await storage.getServiceCatalogItems(member.companyId);
      res.json(items);
    } catch (error: any) {
      console.error('Error fetching service catalog:', error);
      res.status(500).json({ error: 'Failed to fetch service catalog' });
    }
  });

  // POST /api/service-catalog - Create a new service catalog item
  app.post('/api/service-catalog', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }

      // Only Owner and Supervisor can manage service catalog
      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { name, description, defaultPriceCents, unit, category, taskCode, taxable } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const item = await storage.createServiceCatalogItem({
        companyId: member.companyId,
        name,
        description: description || null,
        defaultPriceCents: defaultPriceCents || 0,
        unit: unit || 'each',
        category: category || null,
        taskCode: taskCode || null,
        taxable: taxable ?? false,
      });

      res.status(201).json(item);
    } catch (error: any) {
      console.error('Error creating service catalog item:', error);
      res.status(500).json({ error: 'Failed to create service catalog item' });
    }
  });

  // POST /api/service-catalog/save-from-line-item - Save line item to price book (idempotent)
  // Any authenticated company member who can create jobs can use this
  app.post('/api/service-catalog/save-from-line-item', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }

      const { name, description, defaultPriceCents, unit, taskCode, taxable } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required to save to Price Book' });
      }

      // Check for existing item with same name + unit + price (idempotent)
      const existingItems = await storage.getServiceCatalogItems(member.companyId);
      const duplicate = existingItems.find(item => 
        item.name.toLowerCase() === name.trim().toLowerCase() &&
        item.unit === (unit || 'each') &&
        item.defaultPriceCents === (defaultPriceCents || 0)
      );

      if (duplicate) {
        // Already exists, return existing item silently (no error, no duplicate created)
        return res.status(200).json({ item: duplicate, alreadyExists: true });
      }

      // Create new price book item
      const item = await storage.createServiceCatalogItem({
        companyId: member.companyId,
        name: name.trim(),
        description: description || null,
        defaultPriceCents: defaultPriceCents || 0,
        unit: unit || 'each',
        category: null,
        taskCode: taskCode || null,
        taxable: taxable ?? false,
      });

      res.status(201).json({ item, alreadyExists: false });
    } catch (error: any) {
      console.error('Error saving line item to price book:', error);
      res.status(500).json({ error: 'Failed to save to Price Book' });
    }
  });

  // PATCH /api/service-catalog/:id - Update a service catalog item
  app.patch('/api/service-catalog/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }

      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const itemId = parseInt(req.params.id);
      const existing = await storage.getServiceCatalogItem(itemId);
      if (!existing || existing.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const { name, description, defaultPriceCents, unit, category, taskCode, taxable } = req.body;
      const updated = await storage.updateServiceCatalogItem(itemId, {
        name,
        description,
        defaultPriceCents,
        unit,
        category,
        taskCode,
        taxable,
      });

      res.json(updated);
    } catch (error: any) {
      console.error('Error updating service catalog item:', error);
      res.status(500).json({ error: 'Failed to update service catalog item' });
    }
  });

  // DELETE /api/service-catalog/:id - Delete a service catalog item
  app.delete('/api/service-catalog/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a company member' });
      }

      if (!can(member.role as UserRole, 'customize.manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const itemId = parseInt(req.params.id);
      const existing = await storage.getServiceCatalogItem(itemId);
      if (!existing || existing.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Item not found' });
      }

      await storage.deleteServiceCatalogItem(itemId);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting service catalog item:', error);
      res.status(500).json({ error: 'Failed to delete service catalog item' });
    }
  });

  // =============================================================
  // PAYMENT ENDPOINTS
  // =============================================================

  // POST /api/payments/manual - Record a manual payment (cash or check)
  app.post('/api/payments/manual', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();

      const { invoiceId, method, checkNumber, amountCents: requestedAmountCents, paymentMethod, discount } = req.body;
      const paymentMethodValue = paymentMethod || method;
      
      if (!invoiceId) {
        return res.status(400).json({ message: "Invoice ID is required" });
      }
      
      if (!paymentMethodValue || !['cash', 'check'].includes(paymentMethodValue.toLowerCase())) {
        return res.status(400).json({ message: "Payment method must be 'cash' or 'check'" });
      }

      // Load invoice from DB
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Job-scoped RBAC for manual payments
      let canRecord = false;
      if (['OWNER', 'ADMIN'].includes(userRole)) {
        canRecord = true;
      } else if (userRole === 'DISPATCHER' || userRole === 'SUPERVISOR') {
        canRecord = true;
      } else if (userRole === 'TECHNICIAN' && invoice.jobId) {
        const assignments = await storage.getUserJobAssignments(userId);
        canRecord = assignments.some(a => a.jobId === invoice.jobId);
      }

      if (!canRecord) {
        console.log(`[manual-pay] denied`, { userId, role: userRole, invoiceId, jobId: invoice.jobId, canRecord });
        return res.status(403).json({ message: "You do not have permission to record payments for this job" });
      }

      // Idempotency: Check if invoice is already paid
      if (invoice.status?.toLowerCase() === 'paid') {
        // Return success with current payment status (do NOT create a second payment)
        const existingPayment = await storage.getPaymentByInvoiceId(invoiceId);
        return res.json({
          success: true,
          alreadyPaid: true,
          amountCents: invoice.totalCents || Math.round(parseFloat(invoice.amount) * 100),
          method: existingPayment?.paymentMethod || paymentMethodValue.toLowerCase(),
          invoiceId,
        });
      }

      // Calculate current balance and payment amount
      const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100);
      const currentPaidAmountCents = invoice.paidAmountCents || 0;
      const currentBalanceDueCents = invoice.balanceDueCents || (invoiceTotalCents - currentPaidAmountCents);
      
      // Validate and clamp requested amount
      let amountCents: number;
      if (requestedAmountCents !== undefined) {
        const parsedAmount = parseInt(String(requestedAmountCents), 10);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          return res.status(400).json({ message: "Payment amount must be a positive number" });
        }
        amountCents = Math.min(parsedAmount, currentBalanceDueCents);
      } else {
        amountCents = currentBalanceDueCents;
      }
      
      if (amountCents <= 0) {
        return res.status(400).json({ message: "No balance remaining on this invoice" });
      }
      const amountDollars = (amountCents / 100).toFixed(2);

      const paymentMeta: any = {};
      if (discount && discount.enabled && discount.amountCents > 0) {
        const discCents = Math.min(parseInt(String(discount.amountCents), 10) || 0, currentBalanceDueCents);
        if (discCents > 0) {
          paymentMeta.discount = {
            enabled: true,
            type: discount.type,
            value: discount.value,
            amountCents: discCents,
            reason: discount.reason || null,
          };
          const newTotalCents = Math.max(0, invoiceTotalCents - discCents);
          await db.update(invoices).set({
            totalCents: newTotalCents,
            balanceDueCents: Math.max(0, newTotalCents - currentPaidAmountCents),
            amount: (newTotalCents / 100).toFixed(2),
            updatedAt: new Date(),
          }).where(eq(invoices.id, invoice.id));
          console.log(`[Payment] Invoice ${invoiceId} totalCents adjusted for discount: ${invoiceTotalCents} → ${newTotalCents} (discount=${discCents})`);
        }
      }

      const payment = await storage.createPayment({
        companyId: company.id,
        jobId: invoice.jobId || null,
        invoiceId: invoice.id,
        customerId: invoice.customerId || null,
        amount: amountDollars,
        amountCents: amountCents,
        paymentMethod: paymentMethodValue.toLowerCase(),
        status: 'paid',
        collectedByUserId: userId,
        collectedByRole: userRole,
        checkNumber: paymentMethodValue.toLowerCase() === 'check' ? (checkNumber || null) : null,
        paidDate: new Date(),
        notes: `Manual ${paymentMethodValue.toLowerCase()} payment recorded`,
        meta: Object.keys(paymentMeta).length > 0 ? paymentMeta : undefined,
      });

      const recomputed = await persistRecomputedTotals(invoiceId);
      const newStatus = recomputed.computedStatus;

      if (invoice.jobId) {
        await recomputeJobPaymentAndMaybeArchive(invoice.jobId, 'manual-payment');
      }

      console.log(`[Payment] Manual ${paymentMethodValue} payment recorded for invoice ${invoiceId}: $${amountDollars}`);

      // Sync payment to QuickBooks (non-blocking)
      syncPaymentToQbo(payment.id, company.id).then(result => {
        if (result.success) {
          console.log(`[QB] Payment ${payment.id} synced to QuickBooks: ${result.qboPaymentId}`);
        } else {
          console.log(`[QB] Payment ${payment.id} sync: ${result.error}`);
        }
      }).catch(err => console.error('[QB] Payment sync error:', err));

      const payer = await storage.getUser(userId);
      const payerName = payer ? `${payer.firstName || ''} ${payer.lastName || ''}`.trim() || 'Someone' : 'Someone';
      await createPaymentNotifications({
        companyId: company.id,
        type: 'manual_payment_recorded',
        title: 'Payment Collected',
        body: `${payerName} collected a $${amountDollars} ${paymentMethodValue.toLowerCase()} payment`,
        entityType: 'invoice',
        entityId: invoiceId,
        linkUrl: invoice.jobId ? `/jobs/${invoice.jobId}` : undefined,
        jobId: invoice.jobId || null,
        collectedByUserId: userId,
      });

      if (newStatus === 'paid') {
        console.log("[invoice] status change", { invoiceId, fromStatus: invoice.status, toStatus: 'paid', companyId: company.id, paidAmount: amountDollars, triggeredBy: "manual-payment-collection" });
        await notifyOwners(company.id, {
          type: 'invoice_paid',
          title: 'Payment Received',
          body: `Invoice paid – $${(invoiceTotalCents / 100).toFixed(2)}`,
          entityType: 'invoice',
          entityId: invoiceId,
          linkUrl: `/invoices/${invoiceId}`,
        });
      }

      sendReceiptForPayment(payment.id).catch(err =>
        console.error('[receipt] manual payment error:', err?.message));

      res.json({
        success: true,
        amountCents,
        method: paymentMethodValue.toLowerCase(),
        invoiceId,
        paymentId: payment.id,
        newStatus,
        balanceRemaining: recomputed.owedCents,
      });
    } catch (error: any) {
      console.error('Error recording manual payment:', error);
      res.status(500).json({ message: error.message || "Failed to record payment" });
    }
  });

  // POST /api/payments/record - Record a payment by customer (finds oldest unpaid invoice)
  app.post('/api/payments/record', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      if (!['OWNER', 'SUPERVISOR'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to record payments" });
      }

      const { customerId, amount, method } = req.body;
      
      if (!customerId) {
        return res.status(400).json({ message: "Customer is required" });
      }
      
      const paymentMethodValue = (method || '').toLowerCase();
      if (!['cash', 'check', 'card'].includes(paymentMethodValue)) {
        return res.status(400).json({ message: "Payment method must be 'cash', 'check', or 'card'" });
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      const requestedAmountCents = Math.round(parsedAmount * 100);

      // Find oldest unpaid invoice for this customer in this company
      const allInvoices = await storage.getInvoices(company.id);
      const customerInvoices = allInvoices
        .filter((inv: any) => {
          const matchesCustomer = inv.customerId === customerId;
          const isPaid = inv.status?.toLowerCase() === 'paid';
          const totalCents = inv.totalCents > 0 ? inv.totalCents : Math.round(parseFloat(inv.amount || '0') * 100);
          const paidCents = inv.paidAmountCents || 0;
          const balance = inv.balanceDueCents ?? (totalCents - paidCents);
          return matchesCustomer && !isPaid && balance > 0;
        })
        .sort((a: any, b: any) => {
          const dateA = a.issueDate || a.createdAt || '';
          const dateB = b.issueDate || b.createdAt || '';
          return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
        });

      let invoice;
      if (customerInvoices.length > 0) {
        invoice = customerInvoices[0];
      } else {
        const amountDollarsStr = (requestedAmountCents / 100).toFixed(2);
        const today = new Date().toISOString().split('T')[0];
        const invoiceNumber = `INV-${Date.now()}`;
        invoice = await storage.createInvoice({
          companyId: company.id,
          customerId: customerId,
          invoiceNumber,
          amount: amountDollarsStr,
          subtotalCents: requestedAmountCents,
          taxCents: 0,
          totalCents: requestedAmountCents,
          paidAmountCents: 0,
          balanceDueCents: requestedAmountCents,
          status: 'unpaid',
          issueDate: today,
          dueDate: today,
          lineItems: [{ name: 'Payment', quantity: 1, unitPrice: requestedAmountCents / 100 }],
          createdByUserId: userId,
          createdByRole: userRole,
        } as any);
        console.log(`[Payment] Auto-created invoice ${invoice.id} (${invoiceNumber}) for customer ${customerId}: $${amountDollarsStr}`);
      }

      const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100);
      const currentPaidAmountCents = invoice.paidAmountCents || 0;
      const currentBalanceDueCents = invoice.balanceDueCents || (invoiceTotalCents - currentPaidAmountCents);
      
      const amountCents = Math.min(requestedAmountCents, currentBalanceDueCents);
      if (amountCents <= 0) {
        return res.status(400).json({ message: "No balance remaining on this invoice" });
      }
      const amountDollars = (amountCents / 100).toFixed(2);

      const payment = await storage.createPayment({
        companyId: company.id,
        jobId: invoice.jobId || null,
        invoiceId: invoice.id,
        customerId: customerId,
        amount: amountDollars,
        amountCents: amountCents,
        paymentMethod: paymentMethodValue,
        status: 'paid',
        collectedByUserId: userId,
        collectedByRole: userRole,
        paidDate: new Date(),
        notes: `Manual ${paymentMethodValue} payment recorded`,
      });

      const recomputed2 = await persistRecomputedTotals(invoice.id);
      const newStatus = recomputed2.computedStatus;

      if (invoice.jobId) {
        await recomputeJobPaymentAndMaybeArchive(invoice.jobId, 'record-payment');
      }

      console.log(`[Payment] Customer ${customerId} payment recorded: $${amountDollars} via ${paymentMethodValue} → invoice ${invoice.id} (${newStatus})`);

      syncPaymentToQbo(payment.id, company.id).then(result => {
        if (result.success) {
          console.log(`[QB] Payment ${payment.id} synced to QuickBooks: ${result.qboPaymentId}`);
        } else {
          console.log(`[QB] Payment ${payment.id} sync: ${result.error}`);
        }
      }).catch(err => console.error('[QB] Payment sync error:', err));

      const payer = await storage.getUser(userId);
      const payerName = payer ? `${payer.firstName || ''} ${payer.lastName || ''}`.trim() || 'Someone' : 'Someone';
      await createPaymentNotifications({
        companyId: company.id,
        type: 'manual_payment_recorded',
        title: 'Payment Collected',
        body: `${payerName} collected a $${amountDollars} ${paymentMethodValue} payment`,
        entityType: 'invoice',
        entityId: invoice.id,
        linkUrl: invoice.jobId ? `/jobs/${invoice.jobId}` : undefined,
        jobId: invoice.jobId || null,
        collectedByUserId: userId,
      });

      if (newStatus === 'paid') {
        console.log("[invoice] status change", { invoiceId: invoice.id, fromStatus: invoice.status, toStatus: 'paid', companyId: company.id, paidAmount: amountDollars, triggeredBy: "record-customer-payment" });
        await notifyOwners(company.id, {
          type: 'invoice_paid',
          title: 'Payment Received',
          body: `Invoice paid – $${(invoiceTotalCents / 100).toFixed(2)}`,
          entityType: 'invoice',
          entityId: invoice.id,
          linkUrl: `/invoices/${invoice.id}`,
        });
      }

      res.json({
        success: true,
        amountCents,
        method: paymentMethodValue,
        invoiceId: invoice.id,
        paymentId: payment.id,
        newStatus,
        balanceRemaining: recomputed2.owedCents,
      });
    } catch (error: any) {
      console.error('Error recording customer payment:', error);
      res.status(500).json({ message: error.message || "Failed to record payment" });
    }
  });

  app.get('/.well-known/apple-app-site-association', (_req, res) => {
    const aasa = {
      applinks: {
        apps: [],
        details: [
          {
            appID: "M9WJ473PV5.com.ecologic.app",
            paths: ["/invite/referral/*", "/job-offer/*", "/auth/*"]
          }
        ]
      }
    };
    const body = JSON.stringify(aasa, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(body).toString());
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.end(body);
  });

  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: process.env.ANDROID_PACKAGE_NAME || 'com.ecologic.app',
        sha256_cert_fingerprints: [process.env.ANDROID_CERT_FINGERPRINT || ''].filter(Boolean),
      },
    }]);
  });

  app.get('/invite/referral/:token', async (req, res) => {
    const { token } = req.params;

    if (req.isAuthenticated?.()) {
      return res.redirect(`/referrals/invite/${token}`);
    }

    const schemeUrl = `ecologic://invite/referral/${token}`;
    const fallbackUrl = `/invite/fallback/${token}`;
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Opening EcoLogic...</title>
</head><body>
<script>
window.location.href = '${schemeUrl}';
setTimeout(function() { window.location.replace('${fallbackUrl}'); }, 1500);
</script>
</body></html>`);
  });

  app.get('/invite/fallback/:token', async (req, res) => {
    const { token } = req.params;
    const schemeUrl = `ecologic://invite/referral/${token}`;
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EcoLogic - Job Offer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 40px 32px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .logo { font-size: 28px; font-weight: 800; letter-spacing: 6px; text-transform: uppercase; color: #1e293b; margin-bottom: 8px; }
    .subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { color: #1e293b; font-size: 20px; margin-bottom: 8px; }
    p { color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .hint { color: #94a3b8; font-size: 12px; margin-top: 8px; }
    .buttons { display: flex; flex-direction: column; gap: 12px; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 24px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px; transition: transform 0.1s; }
    .btn:active { transform: scale(0.97); }
    .btn-apple { background: #000; color: white; }
    .btn-google { background: #1a73e8; color: white; }
    .btn-open { background: #059669; color: white; margin-top: 8px; }
    .divider { color: #94a3b8; font-size: 12px; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">ECOLOGIC</div>
    <div class="subtitle">Construction Management</div>
    <div class="icon">📋</div>
    <h2>You've received a job offer!</h2>
    <p>Open the EcoLogic app to view the full job details and respond to this offer.</p>
    <div class="buttons">
      <a href="${schemeUrl}" class="btn btn-open">Open in EcoLogic App</a>
      <p class="hint">If nothing happens, install EcoLogic below and try again.</p>
      <div class="divider">Don't have the app?</div>
      <a href="https://apps.apple.com/app/ecologic/id6743440891" class="btn btn-apple">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
        Download on the App Store
      </a>
      <a href="https://play.google.com/store/apps/details?id=com.ecologic.app" class="btn btn-google">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M3 20.5v-17c0-.59.34-1.11.84-1.35L13.69 12l-9.85 9.85c-.5-.24-.84-.76-.84-1.35zm13.81-5.38L6.05 21.34l8.49-8.49 2.27 2.27zm.91-.91L19.59 12l-1.87-2.21-2.27 2.27 2.27 2.15zM6.05 2.66l10.76 6.22-2.27 2.27-8.49-8.49z"/></svg>
        Get it on Google Play
      </a>
    </div>
  </div>
</body>
</html>`);
  });

  // POST /api/payments/stripe/create-intent - Create a Stripe PaymentIntent for in-app payment
  app.post('/api/payments/stripe/create-intent', isAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);

      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();

      if (!['OWNER', 'ADMIN', 'DISPATCHER', 'SUPERVISOR', 'TECHNICIAN'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to create payments" });
      }

      const { invoiceId, amountCents: requestedAmountCents, discount } = req.body;

      if (!invoiceId) {
        return res.status(400).json({ message: "Invoice ID is required" });
      }

      const invoice = await storage.getInvoice(invoiceId);

      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (userRole === 'TECHNICIAN' && invoice.jobId) {
        const assignments = await storage.getJobCrewAssignments(invoice.jobId);
        const isAssigned = assignments.some(c => c.userId === userId);
        if (!isAssigned) {
          return res.status(403).json({ message: "You can only collect payments for jobs you are assigned to" });
        }
      }

      const computed = await recomputeInvoiceTotalsFromPayments(invoice.id);
      if (computed.computedStatus === 'paid') {
        return res.status(400).json({ message: "This invoice has already been paid" });
      }

      const invoiceTotalCents = computed.totalCents;
      const currentBalanceDueCents = computed.owedCents;

      let amountInCents: number;
      if (requestedAmountCents !== undefined && requestedAmountCents !== null) {
        const parsed = parseInt(String(requestedAmountCents), 10);
        if (isNaN(parsed) || parsed < 50) {
          return res.status(400).json({ message: "Payment amount must be at least $0.50" });
        }
        if (parsed > currentBalanceDueCents) {
          return res.status(400).json({ message: "Payment amount cannot exceed balance due" });
        }
        amountInCents = parsed;
      } else {
        amountInCents = currentBalanceDueCents;
      }

      if (amountInCents < 50) {
        return res.status(400).json({ message: "Payment amount must be at least $0.50 (Stripe minimum)" });
      }

      const stripeMeta: any = {};
      if (discount && discount.enabled && discount.amountCents > 0) {
        const discCents = Math.min(parseInt(String(discount.amountCents), 10) || 0, currentBalanceDueCents);
        if (discCents > 0) {
          stripeMeta.discount = {
            enabled: true,
            type: discount.type,
            value: discount.value,
            amountCents: discCents,
            reason: discount.reason || null,
          };
          const newTotalCents = Math.max(0, invoiceTotalCents - discCents);
          const currentPaidCents = computed.paidCents;
          await db.update(invoices).set({
            totalCents: newTotalCents,
            balanceDueCents: Math.max(0, newTotalCents - currentPaidCents),
            amount: (newTotalCents / 100).toFixed(2),
            updatedAt: new Date(),
          }).where(eq(invoices.id, invoice.id));
          console.log(`[Stripe] Invoice ${invoiceId} totalCents adjusted for discount: ${invoiceTotalCents} → ${newTotalCents} (discount=${discCents})`);
        }
      }

      console.log('[create-intent]', { invoiceIdParam: invoiceId, invoiceIdDb: invoice.id, companyId: company.id, totalCents: invoiceTotalCents, balanceDue: currentBalanceDueCents, paidSoFar: computed.paidCents, amountCents: amountInCents, hasDiscount: !!stripeMeta.discount });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          invoiceId: String(invoice.id),
          companyId: String(company.id),
          jobId: invoice.jobId ? String(invoice.jobId) : '',
          isPartialPayment: amountInCents < currentBalanceDueCents ? 'true' : 'false',
          ...(stripeMeta.discount ? { discountType: stripeMeta.discount.type, discountValue: String(stripeMeta.discount.value), discountAmountCents: String(stripeMeta.discount.amountCents), discountReason: stripeMeta.discount.reason || '' } : {}),
        },
      });

      console.log(`[Stripe] Created PaymentIntent ${paymentIntent.id} for invoice ${invoice.id}`);

      const [existingPiPayment] = await db.select({ id: payments.id }).from(payments).where(eq(payments.stripePaymentIntentId, paymentIntent.id));
      if (!existingPiPayment) {
        await db.insert(payments).values({
          companyId: company.id,
          invoiceId: invoice.id,
          jobId: invoice.jobId || null,
          customerId: invoice.customerId || null,
          amount: (amountInCents / 100).toFixed(2),
          amountCents: amountInCents,
          paymentMethod: 'stripe',
          status: 'processing',
          stripePaymentIntentId: paymentIntent.id,
          paidDate: new Date(),
          meta: Object.keys(stripeMeta).length > 0 ? stripeMeta : undefined,
        });
        console.log(`[Stripe] Pre-inserted payment row for PI ${paymentIntent.id}`);
      }

      const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountCents: amountInCents,
        publishableKey,
      });
    } catch (error: any) {
      console.error('Error creating Stripe PaymentIntent:', error);
      res.status(500).json({ message: error.message || "Failed to create payment intent" });
    }
  });

  // GET /api/payments/latest-for-invoice/:invoiceId - Get latest payment for an invoice
  app.get('/api/payments/latest-for-invoice/:invoiceId', async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      if (isNaN(invoiceId)) {
        return res.status(400).json({ message: "Invalid invoice ID" });
      }
      const payments = await storage.getPaymentsByInvoiceId(invoiceId);
      if (!payments || payments.length === 0) {
        return res.json({ payment: null });
      }
      const latest = payments[payments.length - 1];
      res.json({
        payment: {
          id: latest.id,
          status: latest.status,
          amountCents: latest.amountCents,
          paymentMethod: latest.paymentMethod,
        },
      });
    } catch (error: any) {
      console.error('[LatestPayment] Error:', error.message);
      res.status(500).json({ message: "Failed to fetch latest payment" });
    }
  });

  // ============ REFUNDS API ============

  app.get('/api/payments/:id/refund-context', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const member = await storage.getCompanyMember(company.id, userId);
      if (!member) return res.status(403).json({ message: "Access denied" });
      const role = member.role.toUpperCase();
      if (role === 'TECHNICIAN') {
        return res.status(403).json({ message: "You don't have permission to issue refunds" });
      }

      const paymentId = parseInt(req.params.id);
      const payment = await storage.getPaymentById(paymentId);
      if (!payment || payment.companyId !== company.id) {
        return res.status(404).json({ message: "Payment not found" });
      }

      const amountCents = payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100);
      const refundedAmountCents = payment.refundedAmountCents || 0;

      const existingRefundsList = await storage.getRefundsByPaymentId(paymentId);
      let pendingRefundsCents = 0;
      for (const r of existingRefundsList) {
        if (r.status === 'pending' || r.status === 'posted') {
          pendingRefundsCents += r.amountCents;
        }
      }

      const maxRefundable = amountCents - refundedAmountCents - pendingRefundsCents;

      let customerName = 'Unknown Customer';
      if (payment.customerId) {
        const customer = await storage.getCustomer(payment.customerId);
        if (customer) {
          customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || 'Unknown Customer';
        }
      }

      const hasStripeRef = !!(payment.stripePaymentIntentId || payment.stripeCheckoutSessionId);

      let companyBankLinked = false;
      let customerBankLinked = false;
      try {
        const companyBank = await storage.getPlaidAccount(company.id, 'company', company.id);
        companyBankLinked = !!companyBank;
        if (payment.customerId) {
          const customerBank = await storage.getPlaidAccount(company.id, 'customer', payment.customerId);
          customerBankLinked = !!customerBank;
        }
      } catch (e) {}

      res.json({
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        customerId: payment.customerId,
        customerName,
        amountCents,
        refundedAmountCents,
        maxRefundable,
        hasStripeRef,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        companyBankLinked,
        customerBankLinked,
        paymentMethod: payment.paymentMethod,
        existingRefunds: existingRefundsList,
        pendingRefundsCents,
      });
    } catch (error) {
      console.error("Error fetching refund context:", error);
      res.status(500).json({ message: "Failed to fetch refund context" });
    }
  });

  app.post('/api/refunds', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const member = await storage.getCompanyMember(company.id, userId);
      if (!member) return res.status(403).json({ message: "Access denied" });
      const role = member.role.toUpperCase();
      if (role === 'TECHNICIAN') {
        return res.status(403).json({ message: "You don't have permission to issue refunds" });
      }

      const refundSchema = z.object({
        paymentId: z.number().int().positive(),
        method: z.enum(['card', 'bank', 'cash', 'check', 'other']),
        amountCents: z.number().int().positive(),
        reason: z.string().optional(),
        methodDetail: z.string().optional(),
      });

      const parsed = refundSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid refund request", errors: parsed.error.flatten().fieldErrors });
      }
      const { paymentId, method, amountCents, reason, methodDetail } = parsed.data;

      const payment = await storage.getPaymentById(paymentId);
      if (!payment || payment.companyId !== company.id) {
        return res.status(404).json({ message: "Payment not found" });
      }

      const paymentAmountCents = payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100);
      const alreadyRefunded = payment.refundedAmountCents || 0;
      const maxRefundable = paymentAmountCents - alreadyRefunded;

      if (amountCents > maxRefundable) {
        return res.status(400).json({ message: `Refund amount exceeds maximum refundable ($${(maxRefundable / 100).toFixed(2)})` });
      }

      let provider: 'stripe' | 'plaid' | 'manual' = 'manual';
      let status: string = 'succeeded';
      let stripeRefundId: string | null = null;
      let plaidTransferId: string | null = null;

      if (method === 'card') {
        if (!payment.stripePaymentIntentId) {
          return res.status(400).json({ message: "No original card charge exists for this payment" });
        }
        if (!stripe) {
          return res.status(500).json({ message: "Stripe is not configured" });
        }
        provider = 'stripe';
        try {
          const stripeRefund = await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            amount: amountCents,
            reason: 'requested_by_customer',
            metadata: {
              invoiceId: String(payment.invoiceId || ''),
              paymentId: String(payment.id),
              companyId: String(company.id),
              userId: userId,
            },
          });
          stripeRefundId = stripeRefund.id;
          status = stripeRefund.status === 'succeeded' ? 'succeeded' : 'pending';
        } catch (stripeError: any) {
          console.error("[Refund] Stripe refund failed:", stripeError.message);
          return res.status(400).json({ message: `Stripe refund failed: ${stripeError.message}` });
        }
      } else if (method === 'bank') {
        provider = 'plaid';
        status = 'pending';
      }

      const refund = await storage.createRefund({
        companyId: company.id,
        invoiceId: payment.invoiceId,
        paymentId: payment.id,
        customerId: payment.customerId,
        amountCents,
        method: method as any,
        methodDetail: method === 'other' ? (methodDetail || null) : null,
        provider,
        status: status as any,
        stripeRefundId,
        stripePaymentIntentId: method === 'card' ? (payment.stripePaymentIntentId || null) : null,
        plaidTransferId,
        reason: reason || null,
        createdByUserId: userId,
      });

      const isPendingRefund = status === 'pending' || status === 'posted';

      if (!isPendingRefund) {
        const newRefundedTotal = alreadyRefunded + amountCents;
        let paymentStatus = 'paid';
        if (newRefundedTotal >= paymentAmountCents) {
          paymentStatus = 'refunded';
        } else if (newRefundedTotal > 0) {
          paymentStatus = 'partially_refunded';
        }

        await storage.updatePayment(payment.id, {
          refundedAmountCents: newRefundedTotal,
          status: paymentStatus,
        });

        if (payment.invoiceId) {
          const invoice = await storage.getInvoice(payment.invoiceId);
          if (invoice) {
            const invoiceTotalCents = invoice.totalCents || Math.round(parseFloat(invoice.amount || '0') * 100);
            const allPayments = await storage.getPaymentsByInvoiceId(payment.invoiceId);

            let totalPaymentsCents = 0;
            let totalRefundedOnPayments = 0;
            for (const p of allPayments) {
              const pAmt = p.amountCents || Math.round(parseFloat(p.amount || '0') * 100);
              totalPaymentsCents += pAmt;
              totalRefundedOnPayments += (p.id === payment.id ? newRefundedTotal : (p.refundedAmountCents || 0));
            }

            const netCollected = totalPaymentsCents - totalRefundedOnPayments;
            const balanceDueCents = Math.max(0, invoiceTotalCents - netCollected);

            let invoiceStatus: string;
            if (totalPaymentsCents === 0) {
              invoiceStatus = 'pending';
            } else if (totalRefundedOnPayments > 0 && netCollected <= 0) {
              invoiceStatus = 'refunded';
            } else if (totalPaymentsCents < invoiceTotalCents) {
              invoiceStatus = 'partial';
            } else if (totalRefundedOnPayments > 0) {
              invoiceStatus = 'partially_refunded';
            } else {
              invoiceStatus = 'paid';
            }

            await storage.updateInvoice(payment.invoiceId, {
              paidAmountCents: Math.max(0, netCollected),
              balanceDueCents,
              status: invoiceStatus,
            } as any);

            if (invoice.jobId) {
              const jobPaymentStatus = balanceDueCents === 0 && netCollected > 0 ? 'paid' : netCollected > 0 ? 'partial' : 'unpaid';
              await storage.updateJob(invoice.jobId, {
                paymentStatus: jobPaymentStatus,
                ...(jobPaymentStatus === 'paid' ? { paidAt: new Date() } : {}),
              } as any);
              if (jobPaymentStatus === 'paid') {
                await tryArchiveCompletedPaidJob(invoice.jobId);
              }
            }
          }
        }
      }

      const refundAmountDollars = (amountCents / 100).toFixed(2);
      const refunder = await storage.getUser(userId);
      const refunderName = refunder ? `${refunder.firstName || ''} ${refunder.lastName || ''}`.trim() || 'Someone' : 'Someone';
      await createPaymentNotifications({
        companyId: company.id,
        type: 'refund_issued',
        title: 'Refund Issued',
        body: `${refunderName} issued a $${refundAmountDollars} ${method} refund`,
        entityType: 'invoice',
        entityId: payment.invoiceId || undefined,
        linkUrl: payment.jobId ? `/jobs/${payment.jobId}` : undefined,
        jobId: payment.jobId || null,
        collectedByUserId: null,
      });

      res.json({
        refund,
        isPending: isPendingRefund,
      });
    } catch (error) {
      console.error("Error creating refund:", error);
      res.status(500).json({ message: "Failed to create refund" });
    }
  });

  app.get('/api/refunds/payment/:paymentId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const paymentId = parseInt(req.params.paymentId);
      const payment = await storage.getPaymentById(paymentId);
      if (!payment || payment.companyId !== company.id) {
        return res.status(404).json({ message: "Payment not found" });
      }

      const refundsList = await storage.getRefundsByPaymentId(paymentId);
      res.json(refundsList);
    } catch (error) {
      console.error("Error fetching refunds:", error);
      res.status(500).json({ message: "Failed to fetch refunds" });
    }
  });

  app.get('/api/refunds/debug/:invoiceId', isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: "Not found" });
    }

    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const invoiceId = parseInt(req.params.invoiceId);
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const allPayments = await storage.getPaymentsByInvoiceId(invoiceId);
      const invoiceTotalCents = invoice.totalCents || Math.round(parseFloat(invoice.amount || '0') * 100);

      let totalPaidCents = 0;
      let totalRefundedCents = 0;
      const paymentDetails: any[] = [];

      for (const p of allPayments) {
        const pAmt = p.amountCents || Math.round(parseFloat(p.amount || '0') * 100);
        totalPaidCents += pAmt;

        const paymentRefunds = await storage.getRefundsByPaymentId(p.id);
        const succeededRefunds = paymentRefunds.filter(r => r.status === 'succeeded');
        const pendingRefunds = paymentRefunds.filter(r => r.status === 'pending');
        const succeededTotal = succeededRefunds.reduce((sum, r) => sum + r.amountCents, 0);
        const pendingTotal = pendingRefunds.reduce((sum, r) => sum + r.amountCents, 0);
        totalRefundedCents += succeededTotal;

        paymentDetails.push({
          paymentId: p.id,
          amountCents: pAmt,
          paymentMethod: p.paymentMethod,
          status: p.status,
          stripePaymentIntentId: p.stripePaymentIntentId || null,
          refundedAmountCents: p.refundedAmountCents || 0,
          refunds: paymentRefunds.map(r => ({
            id: r.id,
            amountCents: r.amountCents,
            method: r.method,
            status: r.status,
            stripeRefundId: r.stripeRefundId,
            stripePaymentIntentId: r.stripePaymentIntentId,
            createdAt: r.createdAt,
          })),
          refundSummary: {
            succeededCount: succeededRefunds.length,
            succeededTotal,
            pendingCount: pendingRefunds.length,
            pendingTotal,
          },
        });
      }

      const netCollected = totalPaidCents - totalRefundedCents;

      res.json({
        invoiceId,
        invoiceTotalCents,
        invoiceStatus: invoice.status,
        invoicePaidAmountCents: invoice.paidAmountCents,
        invoiceBalanceDueCents: invoice.balanceDueCents,
        computed: {
          totalPaidCents,
          totalRefundedCents,
          netCollected,
          balanceDue: Math.max(0, invoiceTotalCents - netCollected),
        },
        payments: paymentDetails,
      });
    } catch (error) {
      console.error("Error in refund debug:", error);
      res.status(500).json({ message: "Failed to generate debug info" });
    }
  });

  app.get('/api/debug/stripe/webhooks/recent', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMember(userId);
      if (!member || member.role !== 'owner') {
        return res.status(404).json({ message: "Not found" });
      }

      const events = await db
        .select()
        .from(stripeWebhookEvents)
        .orderBy(desc(stripeWebhookEvents.createdAt))
        .limit(20);

      res.json(events);
    } catch (error) {
      console.error("Error fetching webhook events:", error);
      res.status(500).json({ message: "Failed to fetch webhook events" });
    }
  });

  app.get('/api/debug/invoice/:id/recompute', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMember(userId);
      if (!member || member.role !== 'owner') {
        return res.status(404).json({ message: "Not found" });
      }

      const invoiceId = parseInt(req.params.id);
      const computed = await recomputeInvoiceTotalsFromPayments(invoiceId);

      const invoicePayments = await db
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, invoiceId));

      res.json({
        invoiceId,
        computed,
        paymentRows: invoicePayments.map(p => ({
          id: p.id,
          amountCents: p.amountCents,
          status: p.status,
          paymentMethod: p.paymentMethod,
          stripePaymentIntentId: p.stripePaymentIntentId,
          paidDate: p.paidDate,
        })),
      });
    } catch (error) {
      console.error("Error in invoice recompute debug:", error);
      res.status(500).json({ message: "Failed to recompute" });
    }
  });

  app.get('/api/debug/invoice/:id/payments-truth', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMember(userId);
      if (!member || member.role !== 'owner') {
        return res.status(404).json({ message: "Not found" });
      }

      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) {
        return res.status(400).json({ message: "Invalid invoice ID" });
      }

      const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const allPayments = await db
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, invoiceId));

      const paidStatuses = new Set(['paid', 'succeeded', 'completed']);
      let paidCents = 0;
      for (const p of allPayments) {
        if (paidStatuses.has((p.status || '').toLowerCase())) {
          paidCents += (p.amountCents || 0);
        }
      }
      const owedCents = Math.max(0, (invoice.totalCents || 0) - paidCents);
      const computedStatus = owedCents === 0 && (invoice.totalCents || 0) > 0 ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid';

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      const suspiciousPayments = await db
        .select()
        .from(payments)
        .where(and(
          eq(payments.paymentMethod, 'stripe'),
          sql`${payments.paidDate} > ${thirtyMinAgo}`,
          sql`(${payments.invoiceId} IS NULL OR ${payments.invoiceId} != ${invoiceId})`
        ));

      res.json({
        invoice: {
          id: invoice.id,
          companyId: invoice.companyId,
          totalCents: invoice.totalCents,
          invoiceNumber: invoice.invoiceNumber,
          jobId: invoice.jobId,
          dbStatus: invoice.status,
          dbPaidAmountCents: invoice.paidAmountCents,
          dbBalanceDueCents: invoice.balanceDueCents,
        },
        paymentsAll: allPayments.map(p => ({
          id: p.id,
          companyId: p.companyId,
          invoiceId: p.invoiceId,
          amountCents: p.amountCents,
          status: p.status,
          paymentMethod: p.paymentMethod,
          stripePaymentIntentId: p.stripePaymentIntentId,
          paidDate: p.paidDate,
        })),
        computed: { paidCents, owedCents, computedStatus },
        paymentsSuspicious: suspiciousPayments.map(p => ({
          id: p.id,
          companyId: p.companyId,
          invoiceId: p.invoiceId,
          amountCents: p.amountCents,
          status: p.status,
          stripePaymentIntentId: p.stripePaymentIntentId,
          paidDate: p.paidDate,
        })),
      });
    } catch (error) {
      console.error("Error in payments-truth debug:", error);
      res.status(500).json({ message: "Failed to get payments truth" });
    }
  });

  app.post('/api/debug/payments/:paymentId/send-receipt', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMember(userId);
      if (!member || member.role !== 'owner') {
        return res.status(404).json({ message: "Not found" });
      }
      const paymentId = parseInt(req.params.paymentId, 10);
      if (isNaN(paymentId)) return res.status(400).json({ message: "Invalid payment ID" });
      const result = await sendReceiptForPayment(paymentId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ EMPLOYEES API ============

  app.get('/api/employees', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }
      const members = await storage.getCompanyMembersWithUsers(company.id);
      res.json(members);
    } catch (error: any) {
      console.error('Error fetching employees:', error);
      res.status(500).json({ message: 'Failed to fetch employees' });
    }
  });

  // ============ ANNOUNCEMENTS API ============

  // POST /api/announcements - Create announcement (Owner only)
  const announcementSchema = z.object({
    message: z.string().min(1).max(1000),
    roleTargets: z.array(z.string()).default([]),
    userTargets: z.array(z.string()).default([]),
    sendToAll: z.boolean().default(false),
  });

  app.post('/api/announcements', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Get user's role - Owner only
      const member = await storage.getCompanyMember(company.id, userId);
      if (!member || member.role.toUpperCase() !== 'OWNER') {
        return res.status(403).json({ message: 'Only owners can send announcements' });
      }

      const parsed = announcementSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
      }

      const { message, roleTargets, userTargets, sendToAll } = parsed.data;

      // Resolve recipients
      const allMembers = await storage.getCompanyMembers(company.id);
      const recipientUserIds = new Set<string>();

      if (sendToAll) {
        // All employees except the owner
        allMembers.forEach((m) => {
          if (m.userId !== userId) {
            recipientUserIds.add(m.userId);
          }
        });
      } else {
        // Add users matching roleTargets
        roleTargets.forEach((role) => {
          allMembers.forEach((m) => {
            if (m.role.toUpperCase() === role.toUpperCase() && m.userId !== userId) {
              recipientUserIds.add(m.userId);
            }
          });
        });

        // Add specific user targets (only if they belong to the same company)
        const memberUserIds = new Set(allMembers.map(m => m.userId));
        userTargets.forEach((targetUserId) => {
          if (targetUserId !== userId && memberUserIds.has(targetUserId)) {
            recipientUserIds.add(targetUserId);
          }
        });
      }

      if (recipientUserIds.size === 0) {
        return res.status(400).json({ message: 'No recipients selected' });
      }

      // Get sender info
      const sender = await storage.getUser(userId);
      const senderName = sender 
        ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.email || 'Owner'
        : 'Owner';

      const dedupeKey = `announcement:${Date.now()}:${userId}`;

      const notifications = [];
      for (const recipientId of recipientUserIds) {
        try {
          const notification = await storage.createNotification({
            companyId: company.id,
            recipientUserId: recipientId,
            type: 'announcement',
            title: 'Announcement',
            body: message,
            entityType: 'announcement',
            entityId: null,
            linkUrl: null,
            meta: {
              senderId: userId,
              senderName,
              dedupeKey,
            },
          });
          notifications.push(notification);
        } catch (err) {
          console.error('[Announcement] Failed to create notification for', recipientId, err);
        }
      }

      const pushPreview = message.length > 100 ? message.slice(0, 97) + '...' : message;
      const recipientIds = [...recipientUserIds];
      for (const recipientId of recipientIds) {
        try {
          await sendPushToUser(recipientId, {
            title: 'EcoLogic',
            body: `📢 ${pushPreview}`,
            data: {
              type: 'announcement',
              route: '/notifications',
            },
          });
        } catch (err) {
          console.error('[Announcement] Push failed for', recipientId, err);
        }
      }

      res.json({ 
        success: true, 
        recipientCount: notifications.length 
      });
    } catch (error: any) {
      console.error('Error creating announcement:', error);
      res.status(500).json({ message: 'Failed to create announcement' });
    }
  });

  // ============ PUSH NOTIFICATIONS API ============

  app.post('/api/push/register', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { token, platform, deviceId } = req.body;
      if (!token || !platform || !deviceId) {
        return res.status(400).json({ message: "token, platform, and deviceId are required" });
      }
      if (!["ios", "android", "web"].includes(platform)) {
        return res.status(400).json({ message: "platform must be ios, android, or web" });
      }
      const member = await storage.getCompanyMemberByUserId(userId);
      const pushToken = await storage.registerPushToken({
        userId,
        companyId: member?.companyId || null,
        platform,
        token,
        deviceId,
        isActive: true,
      });
      console.log(`[push] registered token userId=${userId} platform=${platform} tokenSuffix=...${token.slice(-8)}`);
      res.json({ ok: true, id: pushToken.id });
    } catch (error: any) {
      console.error("[push] Register error:", error);
      res.status(500).json({ message: "Failed to register push token" });
    }
  });

  app.post('/api/push/unregister', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ message: "token is required" });
      }
      await storage.deactivateUserPushTokens(userId);
      console.log("[push] Unregistered all tokens for user:", userId);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[push] Unregister error:", error);
      res.status(500).json({ message: "Failed to unregister push token" });
    }
  });

  app.post('/api/push/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const tokens = await storage.getUserPushTokens(userId);
      console.log("[push] Test push for user:", userId, "tokens:", tokens.length);
      if (tokens.length === 0) {
        return res.json({ ok: false, message: "No push tokens registered for this user. Tap 'Enable Notifications' first.", sent: 0, failed: 0, failures: [] });
      }
      const allTokenStrs = tokens.map(t => t.token);
      const result = await sendApnsPushToTokens(allTokenStrs, {
        title: "EcoLogic",
        body: "Remote push works ✅",
        sound: "default",
        data: { type: "test", linkUrl: "/" },
      });
      console.log("[push] Test push result:", JSON.stringify(result));
      res.json({
        ok: result.sent > 0,
        tokensCount: tokens.length,
        ...result,
        tokenSuffixes: tokens.map(t => '...' + t.token.slice(-8)),
      });
    } catch (error: any) {
      console.error("[push] Test push error:", error);
      res.status(500).json({ ok: false, message: "Failed to send test push", error: error.message });
    }
  });

  app.post('/api/dev/scheduler/job_starting_soon/run', isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: "Not found" });
    }
    try {
      const { checkUpcomingJobs } = await import("./jobScheduler");
      const stats = await checkUpcomingJobs();
      res.json({ ok: true, ...stats });
    } catch (error: any) {
      console.error("[dev] scheduler run error:", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/push/tokens/me', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const tokens = await storage.getUserPushTokens(userId);
      res.json({
        userId,
        count: tokens.length,
        tokens: tokens.map(t => ({
          id: t.id,
          platform: t.platform,
          tokenSuffix: '...' + t.token.slice(-8),
          deviceId: t.deviceId,
          isActive: t.isActive,
          lastSeenAt: t.lastSeenAt,
          createdAt: t.createdAt,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch tokens" });
    }
  });

  app.get('/api/push/tokens/company', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member || member.role.toUpperCase() !== 'OWNER') {
        return res.status(403).json({ message: "Owner only" });
      }
      const members = await storage.getCompanyMembers(member.companyId);
      const result = [];
      for (const m of members) {
        const tokens = await storage.getUserPushTokens(m.userId);
        result.push({
          userId: m.userId,
          role: m.role,
          tokenCount: tokens.length,
          platforms: tokens.map(t => t.platform),
          active: tokens.filter(t => t.isActive).length,
        });
      }
      res.json({ companyId: member.companyId, members: result });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch company tokens" });
    }
  });

  // ============ NOTIFICATIONS API ============

  // GET /api/notifications - Get current user's notifications
  app.get('/api/notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const view = req.query.view as string | undefined;
      let allowedTypes: string[] | undefined;
      if (view === 'home') {
        const { NOTIFICATIONS_TAB_ALLOWED_TYPES } = await import("@shared/notificationAllowlist");
        allowedTypes = [...NOTIFICATIONS_TAB_ALLOWED_TYPES];
      }
      const notifications = await storage.getNotifications(userId, limit, allowedTypes);
      res.json(notifications);
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ message: 'Failed to fetch notifications' });
    }
  });

  // GET /api/notifications/unread-count - Get unread notification count
  app.get('/api/notifications/unread-count', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const view = req.query.view as string | undefined;
      let allowedTypes: string[] | undefined;
      if (view === 'home') {
        const { NOTIFICATIONS_TAB_ALLOWED_TYPES } = await import("@shared/notificationAllowlist");
        allowedTypes = [...NOTIFICATIONS_TAB_ALLOWED_TYPES];
      }
      const count = await storage.getUnreadNotificationCount(userId, allowedTypes);
      res.json({ unreadCount: count });
    } catch (error: any) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ message: 'Failed to fetch unread count' });
    }
  });

  // POST /api/notifications/:id/read - Mark a notification as read
  app.post('/api/notifications/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const notificationId = parseInt(req.params.id);
      if (isNaN(notificationId)) {
        return res.status(400).json({ message: 'Invalid notification ID' });
      }
      const notification = await storage.markNotificationRead(notificationId, userId);
      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      res.json(notification);
    } catch (error: any) {
      console.error('Error marking notification read:', error);
      res.status(500).json({ message: 'Failed to mark notification as read' });
    }
  });

  // POST /api/notifications/read-all - Mark all notifications as read
  app.post('/api/notifications/read-all', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      await storage.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error marking all notifications read:', error);
      res.status(500).json({ message: 'Failed to mark all as read' });
    }
  });

  // DELETE /api/notifications/bulk - Delete specific notifications by IDs
  app.delete('/api/notifications/bulk', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { ids } = req.body;
      console.log('[notify-delete] bulk request', { userId, ids, bodyType: typeof req.body, hasIds: !!ids });
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'ids array is required' });
      }
      if (ids.length > 200) {
        return res.status(400).json({ message: 'Cannot delete more than 200 at once' });
      }
      const numericIds = ids.map(Number).filter((n: number) => !isNaN(n));
      console.log('[notify-delete] deleting', { userId, numericIds });
      const deleted = await storage.deleteNotificationsByIds(userId, numericIds);
      console.log('[notify-delete] result', { deleted, requestedCount: numericIds.length });
      res.json({ ok: true, deleted });
    } catch (error: any) {
      console.error('Error bulk deleting notifications:', error);
      res.status(500).json({ message: 'Failed to delete notifications' });
    }
  });

  // DELETE /api/notifications - Clear all notifications for current user
  app.delete('/api/notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      await storage.deleteAllNotifications(userId);
      res.json({ ok: true });
    } catch (error: any) {
      console.error('Error clearing notifications:', error);
      res.status(500).json({ message: 'Failed to clear notifications' });
    }
  });


  // ============ PLAID BANK CONNECTION API ============

  const exchangeTokenSchema = z.object({
    public_token: z.string().min(1),
    institution: z.object({ name: z.string().optional(), institution_id: z.string().optional() }).optional(),
    account: z.object({ id: z.string().optional(), mask: z.string().optional() }).optional(),
  });

  async function requireOwnerRole(req: any, res: any): Promise<{ userId: string; companyId: number } | null> {
    const userId = getUserId(req.user);
    const company = await storage.getUserCompany(userId);
    if (!company) {
      res.status(403).json({ message: 'No company found' });
      return null;
    }
    const roleResult = await storage.getUserRole(userId, company.id);
    if (!roleResult || roleResult.role !== 'OWNER') {
      res.status(404).json({ message: 'Not found' });
      return null;
    }
    return { userId, companyId: company.id };
  }

  app.post('/api/plaid/create-link-token', isAuthenticated, async (req: any, res) => {
    try {
      const ctx = await requireOwnerRole(req, res);
      if (!ctx) return;
      console.log('[PLAID] create-link-token called', { userId: ctx.userId, env: process.env.PLAID_ENV || 'sandbox' });
      if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
        return res.status(500).json({ message: 'Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.' });
      }
      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: String(ctx.userId) },
        client_name: 'EcoLogic',
        products: [Products.Auth, Products.Transactions],
        country_codes: [CountryCode.Us],
        language: 'en',
      });
      console.log('[PLAID] link token created successfully');
      res.json({ link_token: response.data.link_token });
    } catch (error: any) {
      const details = error?.response?.data || error.message;
      console.error('[PLAID] Error creating link token:', details);
      res.status(500).json({ message: 'Failed to create link token', error: typeof details === 'string' ? details : 'Internal error' });
    }
  });

  app.post('/api/plaid/exchange-public-token', isAuthenticated, async (req: any, res) => {
    try {
      const ctx = await requireOwnerRole(req, res);
      if (!ctx) return;
      console.log('[PLAID] exchange-public-token called', { userId: ctx.userId });
      const parsed = exchangeTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid request body', errors: parsed.error.flatten().fieldErrors });
      }
      const { public_token, institution, account } = parsed.data;
      if (!isEncryptionAvailable()) {
        return res.status(500).json({ message: 'Encryption is not configured. Cannot store bank tokens securely.' });
      }
      const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token });
      const accessToken = exchangeResponse.data.access_token;
      const itemId = exchangeResponse.data.item_id;
      const encryptedToken = encryptToken(accessToken);

      const existingAccount = await storage.getPlaidAccount(ctx.companyId, 'company', ctx.companyId);
      if (existingAccount) {
        await db.update(plaidAccounts)
          .set({
            plaidAccessToken: encryptedToken,
            plaidItemId: itemId,
            plaidAccountId: account?.id || null,
            institutionName: institution?.name || null,
            maskLast4: account?.mask || null,
            status: 'active',
            connectedAt: new Date(),
          })
          .where(eq(plaidAccounts.id, existingAccount.id));
      } else {
        await storage.createPlaidAccount({
          companyId: ctx.companyId,
          entityType: 'company',
          entityId: ctx.companyId,
          plaidAccessToken: encryptedToken,
          plaidItemId: itemId,
          plaidAccountId: account?.id || null,
          institutionName: institution?.name || null,
          maskLast4: account?.mask || null,
          status: 'active',
          connectedAt: new Date(),
        });
      }
      console.log('[PLAID] exchange successful, item saved');
      res.json({ success: true });
    } catch (error: any) {
      const details = error?.response?.data || error.message;
      console.error('[PLAID] Error exchanging token:', details);
      res.status(500).json({ message: 'Failed to connect bank account', error: typeof details === 'string' ? details : 'Internal error' });
    }
  });

  app.get('/api/plaid/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.json({ connected: false });
      }
      const roleResult = await storage.getUserRole(userId, company.id);
      if (!roleResult || roleResult.role !== 'OWNER') {
        return res.json({ connected: false });
      }
      const account = await storage.getPlaidAccount(company.id, 'company', company.id);
      console.log('[PLAID][status]', { userId, companyId: company.id, hasAccount: !!account, hasItemId: !!account?.plaidItemId, hasToken: !!account?.plaidAccessToken });
      if (account && account.plaidItemId && account.plaidAccessToken) {
        res.json({
          connected: true,
          connectedAt: account.connectedAt,
          institutionName: account.institutionName,
          maskLast4: account.maskLast4,
        });
      } else {
        res.json({ connected: false });
      }
    } catch (error: any) {
      console.error('[Plaid] Error fetching status:', error.message);
      res.status(500).json({ message: 'Failed to fetch bank status' });
    }
  });

  app.post('/api/plaid/disconnect', isAuthenticated, async (req: any, res) => {
    try {
      const ctx = await requireOwnerRole(req, res);
      if (!ctx) return;
      const account = await storage.getPlaidAccount(ctx.companyId, 'company', ctx.companyId);
      if (!account) {
        return res.json({ success: true });
      }
      if (account.plaidAccessToken && isEncryptionAvailable()) {
        try {
          const token = decryptToken(account.plaidAccessToken);
          await plaidClient.itemRemove({ access_token: token });
        } catch (e: any) {
          console.error('[Plaid] Error removing item from Plaid:', e.message);
        }
      }
      await storage.updatePlaidAccountStatus(account.id, 'disabled');
      await db.update(plaidAccounts)
        .set({
          plaidAccessToken: null,
          plaidItemId: null,
          plaidAccountId: null,
          connectedAt: null,
        })
        .where(eq(plaidAccounts.id, account.id));
      res.json({ success: true });
    } catch (error: any) {
      console.error('[Plaid] Error disconnecting:', error.message);
      res.status(500).json({ message: 'Failed to disconnect bank account' });
    }
  });

  // ============ BANK REFUND (ACH) API ============

  app.get('/api/refunds/bank/customer-destination/:customerId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const member = await storage.getCompanyMember(company.id, userId);
      if (!member) return res.status(403).json({ message: "Access denied" });
      const role = member.role.toUpperCase();
      if (role === 'TECHNICIAN') {
        return res.status(403).json({ message: "Access denied" });
      }

      const customerId = parseInt(req.params.customerId);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const customer = await storage.getCustomerSecure(customerId, company.id);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const dest = await storage.getCustomerPayoutDestination(company.id, customerId);
      res.json({
        hasDestination: !!dest,
        last4: dest?.last4 || null,
        bankName: dest?.bankName || null,
      });
    } catch (error: any) {
      console.error("[BankRefund] Error checking destination:", error.message);
      res.status(500).json({ message: "Failed to check bank destination" });
    }
  });

  app.post('/api/refunds/bank/send-link', isAuthenticated, async (req: any, res) => {
    try {
      const ctx = await requireOwnerRole(req, res);
      if (!ctx) return;

      const schema = z.object({ customerId: z.number().int().positive() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

      const customer = await storage.getCustomerSecure(parsed.data.customerId, ctx.companyId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      if (!customer.email) {
        return res.status(400).json({ message: "Customer has no email address on file" });
      }

      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

      await storage.createPayoutSetupToken({
        companyId: ctx.companyId,
        customerId: customer.id,
        token,
        expiresAt,
        usedAt: null,
      });

      const { getAppBaseUrl } = await import('./email');
      const baseUrl = getAppBaseUrl();
      if (!baseUrl) {
        return res.status(500).json({ message: "APP_BASE_URL is not configured" });
      }

      const setupUrl = `${baseUrl}/payout-setup/${token}`;

      const companyRecord = await storage.getCompany(ctx.companyId);
      const companyName = companyRecord?.name || 'Your contractor';

      const { Resend } = await import('resend');
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.error('[BankRefund] RESEND_API_KEY not configured');
        return res.status(500).json({ message: "Email service not configured", debugUrl: process.env.NODE_ENV !== 'production' ? setupUrl : undefined });
      }
      const resend = new Resend(resendApiKey);

      const fromEmail = getResendFrom();
      console.log('[email] FROM used:', fromEmail);
      console.log(`[BankRefund] Sending email to="${customer.email}"`);

      let emailSent = false;
      let emailError: string | null = null;

      try {
        const { data, error } = await resend.emails.send({
          from: fromEmail,
          reply_to: 'no-reply@ecologicc.com',
          to: [customer.email],
          subject: `${companyName} - Add your bank details for a refund`,
          html: `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #2563eb 0%, #059669 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">ECOLOGIC</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">${companyName}</p>
              </div>
              <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <h2 style="margin: 0 0 20px 0; color: #1f2937;">Bank Details Needed for Refund</h2>
                <p>Hello ${customer.firstName || 'there'},</p>
                <p>${companyName} would like to send you a refund to your bank account. Please add your bank details securely using the link below.</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${setupUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #059669 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Add Bank Details</a>
                </div>
                <p style="font-size: 14px; color: #6b7280;">This link expires in 72 hours. Your bank information is stored securely and never shared.</p>
                <p style="margin: 16px 0 0 0; font-size: 12px; word-break: break-all; color: #9ca3af;">${setupUrl}</p>
              </div>
              <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
                <p style="margin: 0;">Sent by ${companyName} via EcoLogic</p>
              </div>
            </body>
            </html>
          `,
        });

        if (error) {
          console.error(`[BankRefund] Resend API error:`, JSON.stringify(error));
          emailError = error.message || JSON.stringify(error);
        } else {
          emailSent = true;
          console.log(`[BankRefund] Email sent successfully. Resend ID: ${data?.id || '(no id)'} to=${customer.email}`);
        }
      } catch (sendErr: any) {
        console.error(`[BankRefund] Email send threw:`, sendErr.message, sendErr.stack);
        emailError = sendErr.message;
      }

      const isDev = process.env.NODE_ENV !== 'production';
      const responsePayload: any = {
        success: true,
        message: emailSent
          ? "Bank setup link sent to customer"
          : "Email delivery may have failed — use the link below to complete setup manually",
        emailSent,
      };
      if (isDev) {
        responsePayload.debugUrl = setupUrl;
      }
      if (emailError) {
        responsePayload.emailError = emailError;
      }

      console.log(`[BankRefund] Setup link generated for customer ${customer.id} (emailSent=${emailSent})`);
      res.json(responsePayload);
    } catch (error: any) {
      console.error("[BankRefund] Error sending setup link:", error.message);
      res.status(500).json({ message: "Failed to send setup link" });
    }
  });

  app.get('/api/stripe/publishable-key', async (_req: any, res) => {
    const key = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!key) return res.status(500).json({ message: "Stripe publishable key not configured" });
    res.json({ publishableKey: key });
  });

  app.get('/api/public/payout-setup/:token/info', async (req: any, res) => {
    try {
      const tokenRecord = await storage.getPayoutSetupTokenByToken(req.params.token);
      if (!tokenRecord) return res.status(404).json({ message: "Invalid or expired link" });
      if (tokenRecord.usedAt) return res.status(400).json({ message: "This link has already been used" });
      if (new Date() > tokenRecord.expiresAt) return res.status(400).json({ message: "This link has expired" });

      const customer = await storage.getCustomer(tokenRecord.customerId);
      const company = await storage.getCompany(tokenRecord.companyId);

      res.json({
        customerName: customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : 'Customer',
        companyName: company?.name || 'Company',
      });
    } catch (error: any) {
      console.error("[PayoutSetup] Error getting info:", error.message);
      res.status(500).json({ message: "Failed to load setup information" });
    }
  });

  app.post('/api/public/payout-setup/:token/complete', async (req: any, res) => {
    try {
      const tokenRecord = await storage.getPayoutSetupTokenByToken(req.params.token);
      if (!tokenRecord) return res.status(404).json({ message: "Invalid or expired link" });
      if (tokenRecord.usedAt) return res.status(400).json({ message: "This link has already been used" });
      if (new Date() > tokenRecord.expiresAt) return res.status(400).json({ message: "This link has expired" });

      const schema = z.object({
        bankToken: z.string().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

      if (!stripe) return res.status(500).json({ message: "Payment processing is not configured" });

      const existing = await storage.getCustomerPayoutDestination(tokenRecord.companyId, tokenRecord.customerId);

      let stripeCustomerId: string;
      if (existing?.stripeCustomerId) {
        stripeCustomerId = existing.stripeCustomerId;
      } else {
        const customer = await storage.getCustomer(tokenRecord.customerId);
        const stripeCustomer = await stripe.customers.create({
          name: customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : undefined,
          email: customer?.email || undefined,
          metadata: { ecologic_customer_id: String(tokenRecord.customerId), ecologic_company_id: String(tokenRecord.companyId) },
        });
        stripeCustomerId = stripeCustomer.id;
      }

      const bankAccount = await stripe.customers.createSource(stripeCustomerId, {
        source: parsed.data.bankToken,
      }) as any;

      if (existing) {
        await storage.deleteCustomerPayoutDestination(existing.id);
      }

      await storage.createCustomerPayoutDestination({
        companyId: tokenRecord.companyId,
        customerId: tokenRecord.customerId,
        stripeCustomerId,
        stripeBankAccountId: bankAccount.id,
        last4: bankAccount.last4 || null,
        bankName: bankAccount.bank_name || null,
      });

      await storage.markPayoutSetupTokenUsed(tokenRecord.id);

      console.log(`[PayoutSetup] Bank account saved for customer ${tokenRecord.customerId}, bank=${bankAccount.id}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[PayoutSetup] Error completing setup:", error.message);
      res.status(500).json({ message: error.message || "Failed to save bank details" });
    }
  });

  app.post('/api/refunds/bank/send', isAuthenticated, async (req: any, res) => {
    try {
      const ctx = await requireOwnerRole(req, res);
      if (!ctx) return;

      const schema = z.object({
        paymentId: z.number().int().positive(),
        amountCents: z.number().int().positive(),
        reason: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten().fieldErrors });

      const { paymentId, amountCents, reason } = parsed.data;

      if (!stripe) return res.status(500).json({ message: "Stripe is not configured" });

      const payment = await storage.getPaymentById(paymentId);
      if (!payment || payment.companyId !== ctx.companyId) {
        return res.status(404).json({ message: "Payment not found" });
      }

      const customerId = payment.customerId;
      if (!customerId) return res.status(400).json({ message: "No customer associated with this payment" });

      const paymentAmountCents = payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100);
      const alreadyRefunded = payment.refundedAmountCents || 0;
      const maxRefundable = paymentAmountCents - alreadyRefunded;
      if (amountCents > maxRefundable) {
        return res.status(400).json({ message: `Refund amount exceeds maximum refundable ($${(maxRefundable / 100).toFixed(2)})` });
      }

      const dest = await storage.getCustomerPayoutDestination(ctx.companyId, customerId);
      if (!dest || !dest.stripeCustomerId || !dest.stripeBankAccountId) {
        return res.status(400).json({ message: "Customer has no bank account on file. Send them a setup link first." });
      }

      const refund = await storage.createRefund({
        companyId: ctx.companyId,
        invoiceId: payment.invoiceId,
        paymentId: payment.id,
        customerId,
        amountCents,
        method: 'bank' as any,
        provider: 'stripe' as any,
        status: 'pending' as any,
        stripeRefundId: null,
        plaidTransferId: null,
        reason: reason || null,
        createdByUserId: ctx.userId,
      });

      let stripePayoutId: string | null = null;
      let bankRefundStatus: 'processing' | 'failed' = 'processing';
      let failureReason: string | null = null;

      try {
        const payout = await stripe.payouts.create({
          amount: amountCents,
          currency: 'usd',
          destination: dest.stripeBankAccountId,
          metadata: {
            ecologic_refund_id: String(refund.id),
            ecologic_customer_id: String(customerId),
            ecologic_company_id: String(ctx.companyId),
          },
        });
        stripePayoutId = payout.id;
      } catch (stripeErr: any) {
        console.error("[BankRefund] Stripe payout failed:", stripeErr.message);
        bankRefundStatus = 'failed';
        failureReason = stripeErr.message;
      }

      const bankRefund = await storage.createBankRefund({
        companyId: ctx.companyId,
        customerId,
        refundId: refund.id,
        relatedInvoiceId: payment.invoiceId,
        relatedJobId: null,
        amountCents,
        status: bankRefundStatus,
        stripePayoutId,
        stripeTransferId: null,
        failureReason,
      });

      if (bankRefundStatus === 'failed') {
        await storage.updateRefundStatus(refund.id, 'failed');
        return res.status(400).json({
          message: `Bank refund failed: ${failureReason}`,
          refundId: refund.id,
          bankRefundId: bankRefund.id,
          status: 'failed',
        });
      }

      await storage.updateRefundStatus(refund.id, 'pending', {
        stripeRefundId: stripePayoutId,
      } as any);

      console.log(`[BankRefund] Payout created: ${stripePayoutId} for refund ${refund.id}`);
      res.json({
        refundId: refund.id,
        bankRefundId: bankRefund.id,
        status: 'processing',
        message: 'Bank refund initiated. Transfers typically take 1-3 business days.',
      });
    } catch (error: any) {
      console.error("[BankRefund] Error sending refund:", error.message);
      res.status(500).json({ message: "Failed to send bank refund" });
    }
  });

  // ========== Schedule Events ==========

  app.get("/api/schedule-events", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(403).json({ message: "Not a company member" });

      const start = req.query.start ? new Date(req.query.start as string) : undefined;
      const end = req.query.end ? new Date(req.query.end as string) : undefined;

      const events = await storage.getScheduleEventsByCompany(member.companyId, start, end);

      const memberRole = member.role.toLowerCase();
      const filtered = events.filter(e => {
        if (e.visibility === "everyone") return true;
        if (e.visibility === "office_only") return ["owner", "supervisor", "dispatcher"].includes(memberRole);
        if (e.visibility === "owner_only") return memberRole === "owner";
        return true;
      });

      res.json(filtered);
    } catch (error: any) {
      console.error("[ScheduleEvents] Error fetching:", error.message);
      res.status(500).json({ message: "Failed to fetch schedule events" });
    }
  });

  app.post("/api/schedule-events", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(403).json({ message: "Not a company member" });
      const memberRole = member.role.toLowerCase();
      if (!["owner", "supervisor", "dispatcher"].includes(memberRole)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const parsed = insertScheduleEventSchema.parse({
        ...req.body,
        companyId: member.companyId,
        createdByUserId: userId,
      });

      const event = await storage.createScheduleEvent(parsed);
      res.status(201).json(event);
    } catch (error: any) {
      console.error("[ScheduleEvents] Error creating:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid event data. Please check your dates and try again." });
      }
      res.status(400).json({ message: error.message || "Failed to create event" });
    }
  });

  app.put("/api/schedule-events/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(403).json({ message: "Not a company member" });
      const memberRole = member.role.toLowerCase();
      if (!["owner", "supervisor", "dispatcher"].includes(memberRole)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const eventId = parseInt(req.params.id);
      const existing = await storage.getScheduleEvent(eventId);
      if (!existing || existing.companyId !== member.companyId) {
        return res.status(404).json({ message: "Event not found" });
      }

      const updated = await storage.updateScheduleEvent(eventId, req.body);
      res.json(updated);
    } catch (error: any) {
      console.error("[ScheduleEvents] Error updating:", error.message);
      res.status(500).json({ message: "Failed to update event" });
    }
  });

  app.delete("/api/schedule-events/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(403).json({ message: "Not a company member" });
      const memberRole = member.role.toLowerCase();
      if (!["owner", "supervisor", "dispatcher"].includes(memberRole)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const eventId = parseInt(req.params.id);
      const existing = await storage.getScheduleEvent(eventId);
      if (!existing || existing.companyId !== member.companyId) {
        return res.status(404).json({ message: "Event not found" });
      }

      await storage.deleteScheduleEvent(eventId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[ScheduleEvents] Error deleting:", error.message);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  // =====================
  // Payment Signature Routes
  // =====================

  app.get('/api/settings/payments', isAuthenticated, async (req: any, res) => {
    try {
      res.json({ requireSignatureAfterPayment: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get payment settings' });
    }
  });

  app.get('/api/payments/:paymentId/signature', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(404).json({ error: 'Company not found' });
      const paymentId = parseInt(req.params.paymentId, 10);
      if (isNaN(paymentId)) return res.status(400).json({ error: 'Invalid payment ID' });
      const payment = await storage.getPaymentById(paymentId);
      if (!payment || payment.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      const sig = await storage.getPaymentSignature(paymentId);
      res.json({ signature: sig || null });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get signature' });
    }
  });

  app.post('/api/payments/:paymentId/signature', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(404).json({ error: 'Company not found' });
      const paymentId = parseInt(req.params.paymentId, 10);
      if (isNaN(paymentId)) return res.status(400).json({ error: 'Invalid payment ID' });
      const payment = await storage.getPaymentById(paymentId);
      if (!payment || payment.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      const paidStatuses = ['paid', 'succeeded', 'completed'];
      if (!paidStatuses.includes((payment.status || '').toLowerCase())) {
        return res.status(400).json({ error: 'Signature can only be captured for paid payments' });
      }
      const existing = await storage.getPaymentSignature(paymentId);
      if (existing) {
        return res.json({ signature: existing });
      }
      const { signaturePngBase64, jobId, invoiceId } = req.body;
      if (!signaturePngBase64 || typeof signaturePngBase64 !== 'string') {
        return res.status(400).json({ error: 'Signature image is required' });
      }
      const sig = await storage.createPaymentSignature({
        companyId: member.companyId,
        paymentId,
        jobId: jobId || payment.jobId || null,
        invoiceId: invoiceId || payment.invoiceId || null,
        signedByName: '',
        signaturePngBase64,
      });

      sendReceiptForPayment(paymentId).catch(err =>
        console.error('[receipt] after signature error:', err?.message));

      res.json({ signature: { id: sig.id, signedAt: sig.signedAt } });
    } catch (error: any) {
      console.error('Error saving payment signature:', error);
      res.status(500).json({ error: 'Failed to save signature' });
    }
  });

  // GET /api/jobs/:jobId/payment-signatures - Get all payment signatures for a job
  app.get('/api/jobs/:jobId/payment-signatures', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const member = await storage.getCompanyMemberByUserId(userId);
      if (!member) return res.status(404).json({ error: 'Company not found' });

      const jobId = parseInt(req.params.jobId, 10);
      if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== member.companyId) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const sigs = await storage.getPaymentSignaturesByJobId(jobId);

      const enriched = await Promise.all(sigs.map(async (sig) => {
        let invoiceNumber: string | null = null;
        let paymentMethod: string | null = null;
        let amountCents: number | null = null;

        if (sig.paymentId) {
          const payment = await storage.getPaymentById(sig.paymentId);
          if (payment) {
            paymentMethod = payment.paymentMethod || null;
            amountCents = payment.amountCents || null;
          }
        }
        if (sig.invoiceId) {
          const invoice = await storage.getInvoice(sig.invoiceId);
          if (invoice) {
            invoiceNumber = invoice.invoiceNumber;
          }
        }

        return {
          id: sig.id,
          paymentId: sig.paymentId,
          invoiceId: sig.invoiceId,
          jobId: sig.jobId,
          signedAt: sig.signedAt,
          signedByName: sig.signedByName,
          signaturePngBase64: sig.signaturePngBase64,
          paymentMethod,
          amountCents,
          invoiceNumber,
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      console.error('Error fetching job payment signatures:', error);
      res.status(500).json({ error: 'Failed to fetch payment signatures' });
    }
  });

  const TRADE_PLACE_TYPES = new Set([
    'electrician', 'plumber', 'roofing_contractor', 'painter', 'general_contractor',
    'carpenter', 'locksmith', 'moving_company', 'storage',
    'home_goods_store', 'hardware_store',
  ]);

  const TRADE_KEYWORDS = [
    'plumb', 'hvac', 'heat', 'cool', 'air condition', 'electric', 'wiring',
    'general contract', 'roof', 'paint', 'carpet', 'floor', 'landscape',
    'lawn', 'mason', 'concrete', 'restor', 'water damage', 'mold',
    'excavat', 'septic', 'solar', 'window', 'door', 'pool', 'spa',
    'irrigat', 'fenc', 'pest control', 'exterminat', 'appliance',
    'handyman', 'remodel', 'renovat', 'drywall', 'insulation', 'siding',
    'gutter', 'demolit', 'paving', 'asphalt', 'welding', 'welder',
    'garage door', 'fire protect', 'sprinkler', 'plaster', 'tile',
    'cabinet', 'counter', 'deck', 'patio', 'tree', 'stump',
    'chimney', 'foundation', 'waterproof', 'drain', 'sewer',
    'construct', 'build', 'contractor', 'mechanical', 'service',
    'maintenance', 'repair', 'install',
  ];

  function isTradeByTypes(types: string[]): boolean {
    return types.some((t) => TRADE_PLACE_TYPES.has(t));
  }

  function isTradeByName(name: string): boolean {
    const lower = name.toLowerCase();
    return TRADE_KEYWORDS.some((kw) => lower.includes(kw));
  }

  app.get('/api/business-search', isAuthenticated, async (req: any, res) => {
    try {
      const q = (req.query.q as string || '').trim();
      if (q.length < 2) {
        return res.json([]);
      }
      const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        return res.json([]);
      }

      const autoUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&types=establishment&key=${apiKey}`;
      const autoRes = await fetch(autoUrl);
      const autoData = await autoRes.json();

      if (!autoData.predictions || autoData.predictions.length === 0) {
        return res.json([]);
      }

      const top = autoData.predictions.slice(0, 8);
      const detailed = await Promise.all(
        top.map(async (pred: any) => {
          try {
            const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(pred.place_id)}&fields=name,formatted_phone_number,website,address_components,types&key=${apiKey}`;
            const detRes = await fetch(detUrl);
            const detData = await detRes.json();
            const r = detData.result || {};
            const types: string[] = r.types || pred.types || [];
            const name = r.name || pred.structured_formatting?.main_text || '';
            const isTrade = isTradeByTypes(types) || isTradeByName(name) || isTradeByName(pred.description || '');
            if (!isTrade) return null;

            const city = r.address_components?.find((c: any) => c.types?.includes('locality'))?.long_name || '';
            const state = r.address_components?.find((c: any) => c.types?.includes('administrative_area_level_1'))?.short_name || '';
            return {
              name,
              phone: r.formatted_phone_number || null,
              email: null,
              website: r.website || null,
              city: city || null,
              state: state || null,
            };
          } catch {
            const name = pred.structured_formatting?.main_text || pred.description || '';
            if (!isTradeByName(name) && !isTradeByName(pred.description || '')) return null;
            return { name, phone: null, email: null, website: null, city: null, state: null };
          }
        })
      );

      const results = detailed.filter(Boolean).slice(0, 5);
      res.json(results);
    } catch (error: any) {
      console.error('[BusinessSearch] error:', error.message);
      res.json([]);
    }
  });

  // Google Places proxy routes for debugging and secure API key usage
  const googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const googlePlacesKeySource = process.env.GOOGLE_PLACES_API_KEY ? 'GOOGLE_PLACES_API_KEY' : (process.env.GOOGLE_MAPS_API_KEY ? 'GOOGLE_MAPS_API_KEY' : 'NONE');
  const googlePlacesKeySuffix = googlePlacesKey ? googlePlacesKey.slice(-4) : 'N/A';
  console.log(`[GooglePlaces] Using key source: ${googlePlacesKeySource}, keySuffix=${googlePlacesKeySuffix}`);

  app.get('/api/google/places/autocomplete', isAuthenticated, async (req: any, res) => {
    try {
      const q = (req.query.q as string || '').trim();
      console.log(`[GooglePlaces] autocomplete query length=${q.length}`);
      if (q.length < 3) {
        return res.json({ predictions: [], status: 'INVALID_REQUEST', note: 'Query too short (min 3 chars)' });
      }
      if (!googlePlacesKey) {
        console.error('[GooglePlaces] Missing Google API key (checked GOOGLE_PLACES_API_KEY and GOOGLE_MAPS_API_KEY)');
        return res.status(500).json({ error: 'Missing Google API key' });
      }
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&types=address&key=${googlePlacesKey}`;
      const response = await fetch(url);
      const data = await response.json();
      console.log(`[GooglePlaces] autocomplete response status=${response.status}, google_status=${data.status}, predictions=${data.predictions?.length ?? 0}`);
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.error(`[GooglePlaces] autocomplete error: google_status=${data.status}, error_message=${data.error_message || 'none'}`);
      }
      res.json(data);
    } catch (error: any) {
      console.error('[GooglePlaces] autocomplete fetch error:', error.message);
      if (error.response?.data) {
        console.error('[GooglePlaces] error response data:', error.response.data);
      }
      res.status(500).json({ error: 'Failed to fetch autocomplete suggestions' });
    }
  });

  app.get('/api/google/places/details', isAuthenticated, async (req: any, res) => {
    try {
      const placeId = (req.query.placeId as string || '').trim();
      console.log(`[GooglePlaces] details placeId length=${placeId.length}`);
      if (!placeId) {
        return res.status(400).json({ error: 'placeId is required' });
      }
      if (!googlePlacesKey) {
        console.error('[GooglePlaces] Missing Google API key (checked GOOGLE_PLACES_API_KEY and GOOGLE_MAPS_API_KEY)');
        return res.status(500).json({ error: 'Missing Google API key' });
      }
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=address_components,formatted_address,geometry,place_id&key=${googlePlacesKey}`;
      const response = await fetch(url);
      const data = await response.json();
      console.log(`[GooglePlaces] details response status=${response.status}, google_status=${data.status}`);
      if (data.status !== 'OK') {
        console.error(`[GooglePlaces] details error: google_status=${data.status}, error_message=${data.error_message || 'none'}`);
      }
      res.json(data);
    } catch (error: any) {
      console.error('[GooglePlaces] details fetch error:', error.message);
      if (error.response?.data) {
        console.error('[GooglePlaces] error response data:', error.response.data);
      }
      res.status(500).json({ error: 'Failed to fetch place details' });
    }
  });

  // POST /api/support - Submit a support request (contact, bug, feature)
  app.post('/api/support', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: 'User not found' });

      const { type, subject, body, urgency, stepsToReproduce, whyUseful, metadata } = req.body;

      if (!type || !subject || !body) {
        return res.status(400).json({ error: 'type, subject, and body are required' });
      }

      const validTypes = ['contact_support', 'bug_report', 'feature_request'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
      }

      const member = await storage.getCompanyMemberByUserId(userId);
      const companyId = member?.companyId || null;

      const request = await storage.createSupportRequest({
        type,
        subject,
        body,
        urgency: urgency || null,
        stepsToReproduce: stepsToReproduce || null,
        whyUseful: whyUseful || null,
        attachmentUrl: null,
        metadata: metadata || null,
        userId,
        companyId,
        status: 'new',
      });

      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown';

      sendSupportEmail({
        type,
        subject,
        body,
        urgency,
        stepsToReproduce,
        whyUseful,
        metadata,
        userEmail: user.email || '',
        userName,
      }).catch(err => console.error('[Support] Email send error:', err));

      console.log(`[Support] created id=${request.id} type=${type} userId=${userId}`);
      res.json({ success: true, id: request.id });
    } catch (error: any) {
      console.error('[Support] Error:', error);
      res.status(500).json({ error: 'Failed to submit support request' });
    }
  });

  // ============= Job Referral Routes =============

  const REFERRAL_SEND_ROLES = new Set(['OWNER', 'ADMIN']);
  const REFERRAL_VIEW_ROLES = new Set(['OWNER', 'ADMIN', 'SUPERVISOR']);

  app.post('/api/referrals/send', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_SEND_ROLES.has(role)) {
        return res.status(403).json({ error: 'Only Owner or Admin can send referrals' });
      }

      const { jobId, receiverCompanyId, recipientEmail, recipientPhone, referralType, referralValue, message, allowPriceChange } = req.body;

      if (!jobId || !referralType) {
        return res.status(400).json({ error: 'jobId and referralType are required' });
      }
      if (!['percent', 'flat'].includes(referralType)) {
        return res.status(400).json({ error: 'referralType must be "percent" or "flat"' });
      }

      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ error: 'Job not found or not owned by your company' });
      }

      let resolvedReceiverCompanyId = receiverCompanyId || null;
      let receiverPhone: string | null = null;

      if (resolvedReceiverCompanyId) {
        const receiverCompany = await storage.getCompany(resolvedReceiverCompanyId);
        if (!receiverCompany) {
          return res.status(404).json({ error: 'Receiver company not found' });
        }
        if (resolvedReceiverCompanyId === company.id) {
          return res.status(400).json({ error: 'Cannot send a referral to your own company' });
        }
        receiverPhone = receiverCompany.phone || null;
      }

      const crypto = await import('crypto');
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const baseUrl = process.env.APP_PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://app.ecologicc.com';
      const inviteUrl = `${baseUrl.replace(/\/$/, '')}/invite/referral/${inviteToken}`;

      const referral = await storage.createJobReferral({
        jobId,
        senderCompanyId: company.id,
        receiverCompanyId: resolvedReceiverCompanyId,
        referralType,
        referralValue: String(referralValue || 0),
        status: 'pending',
        message: message || null,
        allowPriceChange: !!allowPriceChange,
        inviteToken,
        inviteSentToPhone: recipientPhone || receiverPhone,
        inviteSentVia: 'share',
        inviteSentTo: recipientEmail || null,
      });

      await storage.updateJobReferral(referral.id, {
        inviteSentAt: new Date(),
        inviteExpiresAt,
      } as any);

      console.log(`[referrals] referral created id=${referral.id} jobId=${jobId} sender=${company.id} receiver=${receiverCompanyId} token=${inviteToken.slice(0,8)}...`);
      res.json({ success: true, referral, inviteUrl });
    } catch (error: any) {
      console.error('[referrals] Error sending referral:', error);
      res.status(500).json({ error: 'Failed to send referral' });
    }
  });

  app.post('/api/referrals/accept/:referralId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_SEND_ROLES.has(role)) {
        return res.status(403).json({ error: 'Only Owner or Admin can accept referrals' });
      }

      const referralId = parseInt(req.params.referralId, 10);
      if (isNaN(referralId)) return res.status(400).json({ error: 'Invalid referral ID' });

      const referral = await storage.getJobReferral(referralId);
      if (!referral) return res.status(404).json({ error: 'Referral not found' });

      if (referral.receiverCompanyId !== company.id) {
        return res.status(403).json({ error: 'This referral is not addressed to your company' });
      }

      if (referral.status !== 'pending') {
        return res.status(400).json({ error: `Referral is already ${referral.status}` });
      }

      await storage.updateJobReferral(referralId, {
        status: 'accepted',
        acceptedAt: new Date(),
      });

      const updatedJob = await storage.updateJob(referral.jobId, {
        companyId: company.id,
      } as any);

      console.log(`[referrals] job transferred to receiving contractor referralId=${referralId} jobId=${referral.jobId} newCompanyId=${company.id}`);
      res.json({ success: true, job: updatedJob });
    } catch (error: any) {
      console.error('[referrals] Error accepting referral:', error);
      res.status(500).json({ error: 'Failed to accept referral' });
    }
  });

  app.post('/api/referrals/decline/:referralId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_SEND_ROLES.has(role)) {
        return res.status(403).json({ error: 'Only Owner or Admin can decline referrals' });
      }

      const referralId = parseInt(req.params.referralId, 10);
      if (isNaN(referralId)) return res.status(400).json({ error: 'Invalid referral ID' });

      const referral = await storage.getJobReferral(referralId);
      if (!referral) return res.status(404).json({ error: 'Referral not found' });

      if (referral.receiverCompanyId !== company.id) {
        return res.status(403).json({ error: 'This referral is not addressed to your company' });
      }

      if (referral.status !== 'pending') {
        return res.status(400).json({ error: `Referral is already ${referral.status}` });
      }

      await storage.updateJobReferral(referralId, { status: 'declined' });

      console.log(`[referrals] referral declined id=${referralId} jobId=${referral.jobId}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[referrals] Error declining referral:', error);
      res.status(500).json({ error: 'Failed to decline referral' });
    }
  });

  app.get('/api/referrals/incoming', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_VIEW_ROLES.has(role)) {
        return res.status(403).json({ error: 'You do not have permission to view referrals' });
      }

      const referrals = await storage.getIncomingReferrals(company.id);

      const enriched = await Promise.all(referrals.map(async (r) => {
        const job = await storage.getJob(r.jobId);
        const senderCompany = await storage.getCompany(r.senderCompanyId);
        let customerName: string | null = null;
        if (job?.customerId) {
          const customer = await storage.getCustomer(job.customerId);
          if (customer) customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || null;
        }
        return {
          ...r,
          jobTitle: job?.title || null,
          jobStatus: job?.status || null,
          customerName,
          jobEstimatedCost: job?.estimatedCost || null,
          senderCompanyName: senderCompany?.name || null,
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      console.error('[referrals] Error fetching incoming referrals:', error);
      res.status(500).json({ error: 'Failed to fetch incoming referrals' });
    }
  });

  app.get('/api/referrals/outgoing', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_VIEW_ROLES.has(role)) {
        return res.status(403).json({ error: 'You do not have permission to view referrals' });
      }

      const referrals = await storage.getOutgoingReferrals(company.id);

      const enriched = await Promise.all(referrals.map(async (r) => {
        const job = await storage.getJob(r.jobId);
        const receiverCompany = await storage.getCompany(r.receiverCompanyId);
        let customerName: string | null = null;
        if (job?.customerId) {
          const customer = await storage.getCustomer(job.customerId);
          if (customer) customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || null;
        }
        return {
          ...r,
          jobTitle: job?.title || null,
          jobStatus: job?.status || null,
          customerName,
          jobEstimatedCost: job?.estimatedCost || null,
          receiverCompanyName: receiverCompany?.name || null,
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      console.error('[referrals] Error fetching outgoing referrals:', error);
      res.status(500).json({ error: 'Failed to fetch outgoing referrals' });
    }
  });

  // ============= Job Referral Invite Routes (token-based) =============

  app.get('/api/referrals/invite/:token', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { token } = req.params;
      console.log(`[referral-invite] GET token=${token.slice(0, 12)}... userId=${userId}`);
      const company = await storage.getUserCompany(userId);
      if (!company) {
        console.log(`[referral-invite] 404: user ${userId} has no company`);
        return res.status(404).json({ error: 'Company not found' });
      }

      const referral = await storage.getJobReferralByToken(token);
      if (!referral) {
        console.log(`[referral-invite] 404: token not found`);
        return res.status(404).json({ error: 'Invite not found' });
      }

      console.log(`[referral-invite] found referral #${referral.id}, status=${referral.status}, receiverCompanyId=${referral.receiverCompanyId}, userCompanyId=${company.id}`);

      if (referral.inviteExpiresAt && new Date(referral.inviteExpiresAt) < new Date()) {
        console.log(`[referral-invite] 410: expired at ${referral.inviteExpiresAt}`);
        return res.status(410).json({ error: 'This invite has expired', status: 'expired' });
      }

      if (referral.status !== 'pending') {
        console.log(`[referral-invite] 400: already ${referral.status}`);
        return res.status(400).json({ error: `This referral has already been ${referral.status}`, status: referral.status });
      }

      const normalizeEmail = (v?: string | null) => (v || '').trim().toLowerCase();
      const currentUser = await storage.getUser(userId);
      const emailMatches = !!referral.inviteSentTo && normalizeEmail(currentUser?.email) === normalizeEmail(referral.inviteSentTo);
      const companyMatches = !!referral.receiverCompanyId && referral.receiverCompanyId === company.id;
      console.log(`[JobOfferAccess] currentUserEmail=${currentUser?.email} inviteRecipientEmail=${referral.inviteSentTo} emailMatches=${emailMatches} companyMatches=${companyMatches}`);

      if (!emailMatches && !companyMatches) {
        console.log(`[referral-invite] 403: no email or company match`);
        return res.status(403).json({ error: 'This invite is not for your company' });
      }

      const job = await storage.getJob(referral.jobId);
      const senderCompany = await storage.getCompany(referral.senderCompanyId);
      let customerName: string | null = null;
      let customerAddress: string | null = null;
      let customerPhone: string | null = null;
      let customerEmail: string | null = null;
      if (job?.customerId) {
        const customer = await storage.getCustomer(job.customerId);
        if (customer) {
          customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || null;
          customerAddress = [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ') || null;
          customerPhone = customer.phone || null;
          customerEmail = customer.email || null;
        }
      }

      let inviteJobTotalCents: number | null = null;
      let inviteLineItemsData: { name: string; description: string | null; quantity: string; unitPriceCents: number; unit: string; lineTotalCents: number }[] = [];
      if (job) {
        const li = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, job.id));
        if (li.length > 0) {
          inviteJobTotalCents = 0;
          for (const item of li) {
            const qty = parseFloat(String(item.quantity || '1'));
            const unitPrice = item.unitPriceCents || 0;
            let lineTotal = Math.round(qty * unitPrice);
            if (item.taxable && item.taxRatePercentSnapshot) {
              const taxRate = parseFloat(String(item.taxRatePercentSnapshot));
              lineTotal += Math.round(lineTotal * taxRate / 100);
            }
            inviteJobTotalCents += lineTotal;
            inviteLineItemsData.push({
              name: item.name,
              description: item.description || null,
              quantity: String(item.quantity || '1'),
              unitPriceCents: unitPrice,
              unit: item.unit || 'each',
              lineTotalCents: lineTotal,
            });
          }
        } else {
          const est = parseFloat(String(job.estimatedCost || '0'));
          if (est > 0) inviteJobTotalCents = Math.round(est * 100);
        }
      }

      const inviteRefVal = parseFloat(String(referral.referralValue || '0'));
      let inviteReceiverShareCents: number | null = null;
      let inviteSenderShareCents: number | null = null;
      if (inviteJobTotalCents && inviteJobTotalCents > 0 && inviteRefVal > 0) {
        if (referral.referralType === 'percent') {
          inviteReceiverShareCents = Math.round(inviteJobTotalCents * inviteRefVal / 100);
          inviteSenderShareCents = inviteJobTotalCents - inviteReceiverShareCents;
        } else {
          inviteReceiverShareCents = Math.round(inviteRefVal * 100);
          inviteSenderShareCents = inviteJobTotalCents - inviteReceiverShareCents;
        }
      }

      console.log(`[referral-invite] payload: jobTotalCents=${inviteJobTotalCents} receiverShare=${inviteReceiverShareCents} senderShare=${inviteSenderShareCents} lineItems=${inviteLineItemsData.length}`);

      res.json({
        referralId: referral.id,
        status: referral.status,
        referralType: referral.referralType,
        referralValue: referral.referralValue,
        message: referral.message,
        allowPriceChange: referral.allowPriceChange,
        senderCompanyName: senderCompany?.name || null,
        senderCompanyCity: senderCompany?.city || null,
        senderCompanyState: senderCompany?.state || null,
        senderCompanyLogo: senderCompany?.logo || null,
        job: job ? {
          id: job.id,
          title: job.title,
          status: job.status,
          description: job.description,
          startDate: job.startDate,
          scheduledTime: job.scheduledTime,
          scheduledEndTime: job.scheduledEndTime,
          estimatedCost: referral.allowPriceChange ? job.estimatedCost : null,
          location: job.location,
          jobType: job.jobType,
          priority: job.priority,
          notes: job.notes,
        } : null,
        customerName,
        customerAddress,
        customerPhone,
        customerEmail,
        jobTotalCents: inviteJobTotalCents,
        receiverShareCents: inviteReceiverShareCents,
        senderShareCents: inviteSenderShareCents,
        lineItems: inviteLineItemsData.length > 0 ? inviteLineItemsData : null,
      });
    } catch (error: any) {
      console.error('[referrals] Error fetching invite:', error);
      res.status(500).json({ error: 'Failed to fetch invite details' });
    }
  });

  app.post('/api/referrals/invite/:token/accept', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_SEND_ROLES.has(role)) {
        return res.status(403).json({ error: 'Only Owner or Admin can accept referrals' });
      }

      const { token } = req.params;
      const referral = await storage.getJobReferralByToken(token);
      if (!referral) return res.status(404).json({ error: 'Invite not found' });

      if (referral.inviteExpiresAt && new Date(referral.inviteExpiresAt) < new Date()) {
        return res.status(410).json({ error: 'This invite has expired' });
      }

      if (referral.status !== 'pending') {
        return res.status(400).json({ error: `Referral is already ${referral.status}` });
      }

      const normalizeEmail = (v?: string | null) => (v || '').trim().toLowerCase();
      const currentUser = await storage.getUser(userId);
      const emailMatches = !!referral.inviteSentTo && normalizeEmail(currentUser?.email) === normalizeEmail(referral.inviteSentTo);
      const companyMatches = !!referral.receiverCompanyId && referral.receiverCompanyId === company.id;
      if (!emailMatches && !companyMatches) {
        return res.status(403).json({ error: 'This invite is not for your company' });
      }

      const jobLineItemsForTotal = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, referral.jobId));
      const jobTotalCents = jobLineItemsForTotal.reduce((sum: number, li: any) => sum + (li.totalCents || 0), 0);
      const job = await storage.getJob(referral.jobId);
      const fallbackTotalCents = jobTotalCents || Math.round((parseFloat(job?.estimatedCost || '0') || parseFloat(job?.actualCost || '0') || 0) * 100);
      const split = stripeConnectService.computeSubcontractSplit(referral, fallbackTotalCents);

      await storage.updateJobReferral(referral.id, {
        status: 'accepted',
        acceptedAt: new Date(),
        receiverCompanyId: company.id,
        jobTotalAtAcceptanceCents: fallbackTotalCents,
        contractorPayoutAmountCents: split.contractorPayoutCents,
        companyShareAmountCents: split.companyShareCents,
      } as any);

      console.log(`[referrals] snapshot stored: jobTotal=${fallbackTotalCents} contractorPayout=${split.contractorPayoutCents} companyShare=${split.companyShareCents}`);

      const updatedJob = await storage.updateJob(referral.jobId, {
        companyId: company.id,
      } as any);

      console.log(`[referrals] invite accepted via token referralId=${referral.id} jobId=${referral.jobId} newCompanyId=${company.id}`);
      res.json({ success: true, job: updatedJob });
    } catch (error: any) {
      console.error('[referrals] Error accepting invite:', error);
      res.status(500).json({ error: 'Failed to accept referral' });
    }
  });

  app.post('/api/referrals/invite/:token/decline', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_SEND_ROLES.has(role)) {
        return res.status(403).json({ error: 'Only Owner or Admin can decline referrals' });
      }

      const { token } = req.params;
      const referral = await storage.getJobReferralByToken(token);
      if (!referral) return res.status(404).json({ error: 'Invite not found' });

      if (referral.status !== 'pending') {
        return res.status(400).json({ error: `Referral is already ${referral.status}` });
      }

      const normalizeEmail = (v?: string | null) => (v || '').trim().toLowerCase();
      const currentUser = await storage.getUser(userId);
      const emailMatches = !!referral.inviteSentTo && normalizeEmail(currentUser?.email) === normalizeEmail(referral.inviteSentTo);
      const companyMatches = !!referral.receiverCompanyId && referral.receiverCompanyId === company.id;
      if (!emailMatches && !companyMatches) {
        return res.status(403).json({ error: 'This invite is not for your company' });
      }

      await storage.updateJobReferral(referral.id, { status: 'declined' });

      console.log(`[referrals] invite declined via token referralId=${referral.id} jobId=${referral.jobId}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[referrals] Error declining invite:', error);
      res.status(500).json({ error: 'Failed to decline referral' });
    }
  });

  // =====================
  // Job Offer Deep Link Endpoints (public GET, auth required for accept/decline)
  // =====================

  app.get('/api/job-offer/:jobId/:token', async (req, res) => {
    try {
      const jobId = parseInt(req.params.jobId, 10);
      const { token } = req.params;
      if (isNaN(jobId) || !token) {
        return res.status(400).json({ error: 'Invalid job offer link' });
      }

      const referral = await storage.getJobReferralByToken(token);
      if (!referral || referral.jobId !== jobId) {
        return res.status(403).json({ error: 'Invalid or expired job offer link', tokenValid: false });
      }

      if (referral.inviteExpiresAt && new Date(referral.inviteExpiresAt) < new Date()) {
        return res.status(410).json({ error: 'This job offer has expired', tokenValid: false });
      }

      if (referral.status !== 'pending') {
        return res.status(400).json({ error: `This job offer has already been ${referral.status}`, tokenValid: false });
      }

      const job = await storage.getJob(referral.jobId);
      const senderCompany = await storage.getCompany(referral.senderCompanyId);

      let customerName: string | null = null;
      let customerAddress: string | null = null;
      let customerPhone: string | null = null;
      let customerEmail: string | null = null;
      if (job?.customerId) {
        const customer = await storage.getCustomer(job.customerId);
        if (customer) {
          customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || null;
          customerAddress = [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ') || null;
          customerPhone = customer.phone || null;
          customerEmail = customer.email || null;
        }
      }

      let jobTotalCents: number | null = null;
      let jobLineItemsData: { name: string; description: string | null; quantity: string; unitPriceCents: number; unit: string; lineTotalCents: number }[] = [];
      if (job) {
        const lineItems = await db.select().from(jobLineItems).where(eq(jobLineItems.jobId, job.id));
        if (lineItems.length > 0) {
          jobTotalCents = 0;
          for (const item of lineItems) {
            const qty = parseFloat(String(item.quantity || '1'));
            const unitPrice = item.unitPriceCents || 0;
            let lineTotal = Math.round(qty * unitPrice);
            if (item.taxable && item.taxRatePercentSnapshot) {
              const taxRate = parseFloat(String(item.taxRatePercentSnapshot));
              lineTotal += Math.round(lineTotal * taxRate / 100);
            }
            jobTotalCents += lineTotal;
            jobLineItemsData.push({
              name: item.name,
              description: item.description || null,
              quantity: String(item.quantity || '1'),
              unitPriceCents: unitPrice,
              unit: item.unit || 'each',
              lineTotalCents: lineTotal,
            });
          }
        } else {
          const est = parseFloat(String(job.estimatedCost || '0'));
          if (est > 0) jobTotalCents = Math.round(est * 100);
        }
      }

      const refVal = parseFloat(String(referral.referralValue || '0'));
      let receiverShareCents: number | null = null;
      let senderShareCents: number | null = null;
      if (jobTotalCents && jobTotalCents > 0 && refVal > 0) {
        if (referral.referralType === 'percent') {
          receiverShareCents = Math.round(jobTotalCents * refVal / 100);
          senderShareCents = jobTotalCents - receiverShareCents;
        } else {
          receiverShareCents = Math.round(refVal * 100);
          senderShareCents = jobTotalCents - receiverShareCents;
        }
      }

      res.json({
        referralId: referral.id,
        jobId: referral.jobId,
        status: referral.status,
        referralType: referral.referralType,
        referralValue: referral.referralValue,
        message: referral.message,
        allowPriceChange: referral.allowPriceChange,
        senderCompanyName: senderCompany?.name || null,
        senderCompanyCity: senderCompany?.city || null,
        senderCompanyState: senderCompany?.state || null,
        senderCompanyLogo: senderCompany?.logo || null,
        tokenValid: true,
        job: job ? {
          id: job.id,
          title: job.title,
          status: job.status,
          description: job.description,
          startDate: job.startDate,
          scheduledTime: job.scheduledTime,
          scheduledEndTime: job.scheduledEndTime,
          estimatedCost: referral.allowPriceChange ? job.estimatedCost : null,
          location: job.location,
          jobType: job.jobType,
          priority: job.priority,
          notes: job.notes,
        } : null,
        customerName,
        customerAddress,
        customerPhone,
        customerEmail,
        jobTotalCents,
        receiverShareCents,
        senderShareCents,
        lineItems: jobLineItemsData.length > 0 ? jobLineItemsData : null,
      });
    } catch (error: any) {
      console.error('[job-offer] Error fetching:', error);
      res.status(500).json({ error: 'Failed to load job offer' });
    }
  });

  app.post('/api/job-offer/:jobId/accept', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_SEND_ROLES.has(role)) {
        return res.status(403).json({ error: 'Only Owner or Admin can accept job offers' });
      }

      const jobId = parseInt(req.params.jobId, 10);
      const { token } = req.body;
      if (isNaN(jobId) || !token) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      const referral = await storage.getJobReferralByToken(token);
      if (!referral || referral.jobId !== jobId) {
        return res.status(404).json({ error: 'Job offer not found' });
      }

      if (referral.inviteExpiresAt && new Date(referral.inviteExpiresAt) < new Date()) {
        return res.status(410).json({ error: 'This job offer has expired' });
      }

      if (referral.status !== 'pending') {
        return res.status(400).json({ error: `Job offer is already ${referral.status}` });
      }

      if (referral.receiverCompanyId !== company.id) {
        return res.status(403).json({ error: 'This job offer is not for your company' });
      }

      await storage.updateJobReferral(referral.id, {
        status: 'accepted',
        acceptedAt: new Date(),
      });

      const updatedJob = await storage.updateJob(referral.jobId, {
        companyId: company.id,
      } as any);

      console.log(`[job-offer] accepted referralId=${referral.id} jobId=${jobId} newCompanyId=${company.id}`);
      res.json({ success: true, job: updatedJob });
    } catch (error: any) {
      console.error('[job-offer] Error accepting:', error);
      res.status(500).json({ error: 'Failed to accept job offer' });
    }
  });

  app.post('/api/job-offer/:jobId/decline', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (!REFERRAL_SEND_ROLES.has(role)) {
        return res.status(403).json({ error: 'Only Owner or Admin can decline job offers' });
      }

      const jobId = parseInt(req.params.jobId, 10);
      const { token } = req.body;
      if (isNaN(jobId) || !token) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      const referral = await storage.getJobReferralByToken(token);
      if (!referral || referral.jobId !== jobId) {
        return res.status(404).json({ error: 'Job offer not found' });
      }

      if (referral.status !== 'pending') {
        return res.status(400).json({ error: `Job offer is already ${referral.status}` });
      }

      if (referral.receiverCompanyId !== company.id) {
        return res.status(403).json({ error: 'This job offer is not for your company' });
      }

      await storage.updateJobReferral(referral.id, { status: 'declined' });

      console.log(`[job-offer] declined referralId=${referral.id} jobId=${jobId}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[job-offer] Error declining:', error);
      res.status(500).json({ error: 'Failed to decline job offer' });
    }
  });

  // Server-side landing page for /job-offer/:jobId/:token (fallback if app not installed)
  app.get('/job-offer/:jobId/:token', async (req, res) => {
    const { jobId, token: inviteToken } = req.params;
    const schemeUrl = `ecologic://job-offer/${jobId}/${inviteToken}`;
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EcoLogic - Job Offer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 40px 32px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .logo { font-size: 28px; font-weight: 800; letter-spacing: 6px; text-transform: uppercase; color: #1e293b; margin-bottom: 8px; }
    .subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { color: #1e293b; font-size: 20px; margin-bottom: 8px; }
    p { color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .hint { color: #94a3b8; font-size: 12px; margin-top: 8px; }
    .buttons { display: flex; flex-direction: column; gap: 12px; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 24px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px; transition: transform 0.1s; }
    .btn:active { transform: scale(0.97); }
    .btn-apple { background: #000; color: white; }
    .btn-google { background: #1a73e8; color: white; }
    .btn-open { background: #059669; color: white; margin-top: 8px; }
    .divider { color: #94a3b8; font-size: 12px; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">ECOLOGIC</div>
    <div class="subtitle">Construction Management</div>
    <div class="icon">📋</div>
    <h2>Job Offer</h2>
    <p>You've received a job offer. Open or download EcoLogic to view details and respond.</p>
    <div class="buttons">
      <a class="btn btn-open" href="${schemeUrl}">Open in EcoLogic</a>
      <p class="hint">If nothing happens, install EcoLogic and try again.</p>
      <div class="divider">or download the app</div>
      <a class="btn btn-apple" href="https://apps.apple.com/app/ecologic/id6745136938">🍎 App Store</a>
      <a class="btn btn-google" href="https://play.google.com/store/apps/details?id=com.ecologic.app">▶ Google Play</a>
    </div>
  </div>
</body>
</html>`);
  });

  app.get('/api/companies/network', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const allCompanies = await storage.getNetworkCompanies(company.id);
      const payload = allCompanies.map(c => ({
        id: c.id,
        name: c.name,
        city: c.city || null,
        state: c.state || null,
        email: c.email || null,
        industry: c.industry || null,
      }));
      console.log('[network companies] count=' + payload.length, payload.map(c => ({ id: c.id, name: c.name, city: c.city, state: c.state })));
      res.json(payload);
    } catch (error: any) {
      console.error('[Network] Error fetching companies:', error);
      res.status(500).json({ error: 'Failed to fetch companies' });
    }
  });

  // WebSocket server
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: any, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }

    const res = new ServerResponse(req);
    res.assignSocket(socket);

    const sessionMw = getSessionMiddleware();
    sessionMw(req, res as any, () => {
      passport.initialize()(req, res as any, () => {
        passport.session()(req, res as any, () => {
          const user = req.user as any;
          const userId = user?.id || user?.claims?.sub;
          if (!userId) {
            console.log('[WS] upgrade rejected: no session user');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            (ws as any).userId = userId;
            wss.emit('connection', ws, req);
          });
        });
      });
    });
  });

  wss.on('connection', (ws: ExtendedWebSocket, req: any) => {
    const userId = ws.userId!;
    console.log(`[WS] authenticated connection: userId=${userId}`);
    ws.rooms = new Set();

    if (!wsClients.has(userId)) {
      wsClients.set(userId, new Set());
    }
    wsClients.get(userId)!.add(ws);
    ws.send(JSON.stringify({ type: 'auth_success', userId }));

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'auth') {
          // Already authenticated via session — ignore client auth messages
        }
        
        // Handle thread:join - user joins a conversation room
        else if (message.type === 'thread:join' && ws.userId) {
          try {
            const { conversationId } = message;
            if (!conversationId) {
              ws.send(JSON.stringify({ 
                type: 'thread:join:ack', 
                ok: false, 
                code: 'BAD_ARGS',
                requestId: message.requestId
              }));
              return;
            }
            
            const roomKey = conversationRoom(conversationId);
            
            // Add socket to room
            if (!wsRooms.has(roomKey)) {
              wsRooms.set(roomKey, new Set());
            }
            wsRooms.get(roomKey)!.add(ws);
            ws.rooms!.add(roomKey);
            
            console.log(`[WS:JOIN] User ${ws.userId} joined ${roomKey}, room now has ${wsRooms.get(roomKey)!.size} sockets`);
            
            // Send ACK
            ws.send(JSON.stringify({ 
              type: 'thread:join:ack', 
              ok: true, 
              room: roomKey,
              conversationId,
              requestId: message.requestId
            }));
          } catch (error) {
            console.error('[WS:JOIN] Error:', error);
            ws.send(JSON.stringify({ 
              type: 'thread:join:ack', 
              ok: false, 
              code: 'SERVER_ERROR',
              requestId: message.requestId
            }));
          }
        }
        
        // Handle thread:leave - user leaves a conversation room
        else if (message.type === 'thread:leave') {
          try {
            const { conversationId } = message;
            if (!conversationId) {
              ws.send(JSON.stringify({ 
                type: 'thread:leave:ack', 
                ok: false, 
                code: 'BAD_ARGS',
                requestId: message.requestId
              }));
              return;
            }
            
            const roomKey = conversationRoom(conversationId);
            
            // Remove socket from room
            if (wsRooms.has(roomKey)) {
              wsRooms.get(roomKey)!.delete(ws);
              const remainingCount = wsRooms.get(roomKey)!.size;
              console.log(`[WS:LEAVE] User ${ws.userId} left ${roomKey}, ${remainingCount} sockets remaining`);
              
              if (remainingCount === 0) {
                wsRooms.delete(roomKey);
                console.log(`[WS:LEAVE] Room ${roomKey} deleted (empty)`);
              }
            }
            ws.rooms!.delete(roomKey);
            
            // Send ACK
            ws.send(JSON.stringify({ 
              type: 'thread:leave:ack', 
              ok: true,
              conversationId,
              requestId: message.requestId
            }));
          } catch (error) {
            console.error('[WS:LEAVE] Error:', error);
            ws.send(JSON.stringify({ 
              type: 'thread:leave:ack', 
              ok: false, 
              code: 'SERVER_ERROR',
              requestId: message.requestId
            }));
          }
        }
        
        // Handle ping - health check
        else if (message.type === 'ping') {
          ws.send(JSON.stringify({ 
            type: 'pong', 
            ok: true, 
            ts: Date.now(), 
            echo: message.payload,
            requestId: message.requestId
          }));
        }
        
        // Handle message:send - send message with ACK
        else if (message.type === 'message:send' && ws.userId) {
          const t0 = Date.now();
          const { conversationId, body, recipientId, tempId } = message;
          
          if (!conversationId || !body?.trim()) {
            ws.send(JSON.stringify({ 
              type: 'message:ack', 
              ok: false, 
              code: 'INVALID_REQUEST',
              tempId
            }));
            return;
          }

          try {
            const roomKey = conversationRoom(conversationId);
            
            // Verify socket joined this room (auto-join if not for tolerance)
            const joined = ws.rooms?.has(roomKey);
            if (!joined) {
              console.log(`[WS:SEND] Socket not in room ${roomKey}, auto-joining`);
              if (!wsRooms.has(roomKey)) {
                wsRooms.set(roomKey, new Set());
              }
              wsRooms.get(roomKey)!.add(ws);
              ws.rooms!.add(roomKey);
            }
            
            // 1. Verify user is a participant
            const participant = await storage.getConversationParticipant(conversationId, ws.userId);
            if (!participant) {
              console.log(`[WS:SEND] User ${ws.userId} not a participant in conversation ${conversationId}`);
              ws.send(JSON.stringify({ 
                type: 'message:ack', 
                ok: false, 
                code: 'NOT_PARTICIPANT',
                tempId
              }));
              return;
            }

            // 2. Check if recipient is explicitly inactive (tolerant approach)
            if (recipientId) {
              const recipient = await db
                .select({ status: users.status })
                .from(users)
                .where(eq(users.id, recipientId))
                .limit(1);
              
              if (recipient.length > 0) {
                const { status } = recipient[0];
                // Only block if explicitly inactive (tolerant - missing status = active)
                const explicitlyInactive = 
                  status === 'INACTIVE' || 
                  status === 'DEACTIVATED' || 
                  status === 'REMOVED';
                
                if (explicitlyInactive) {
                  ws.send(JSON.stringify({ 
                    type: 'message:ack', 
                    ok: false, 
                    code: 'RECIPIENT_INACTIVE',
                    tempId: message.tempId
                  }));
                  return;
                }
              }
            }

            // 3. Persist the message
            const newMessage = await storage.createConversationMessage({
              conversationId,
              senderId: ws.userId,
              body: body.trim(),
            });

            // 4. Broadcast to all sockets in the room
            const roomSockets = wsRooms.get(roomKey);
            if (roomSockets) {
              const broadcastMsg = JSON.stringify({
                type: 'message:created',
                conversationId,
                message: { ...newMessage, tempId },
              });
              
              let broadcastCount = 0;
              roomSockets.forEach((socket) => {
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(broadcastMsg);
                  broadcastCount++;
                }
              });
              
              console.log(`[WS:SEND] Broadcast message ${newMessage.id} to ${broadcastCount}/${roomSockets.size} sockets in ${roomKey}`);
            } else {
              console.log(`[WS:SEND] Warning: Room ${roomKey} has no sockets`);
            }

            // 5. Create DM bell + push notification for recipients
            try {
              const sender = await storage.getUser(ws.userId);
              const senderCompany = await storage.getUserCompany(ws.userId);

              const otherParticipants = await db
                .select({ userId: conversationParticipants.userId })
                .from(conversationParticipants)
                .where(and(
                  eq(conversationParticipants.conversationId, conversationId),
                  sql`${conversationParticipants.userId} != ${ws.userId}`
                ));

              const wsRecipientUserIds = otherParticipants.map(p => p.userId);
              console.log("[dm] message created (ws)", { threadId: conversationId, senderUserId: ws.userId, recipientUserIds: wsRecipientUserIds });

              if (!sender || !senderCompany) {
                console.log("[dm] WARNING (ws): sender or senderCompany not found — skipping push", { senderFound: !!sender, companyFound: !!senderCompany, userId: ws.userId });
              }
              if (wsRecipientUserIds.length === 0) {
                console.log("[dm] WARNING (ws): recipientUserIds is empty — no one to notify", { threadId: conversationId, senderUserId: ws.userId });
              }

              if (sender && senderCompany && wsRecipientUserIds.length > 0) {
                const senderName = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.email || 'Someone';
                const messagePreview = body.trim().length > 80 ? body.trim().substring(0, 80) + '...' : body.trim();
                for (const recipientId of wsRecipientUserIds) {
                  await notifyUsers([recipientId], {
                    companyId: senderCompany.id,
                    type: 'dm_message',
                    title: 'New Message',
                    body: `${senderName}: ${messagePreview}`,
                    entityType: 'conversation',
                    entityId: conversationId,
                    linkUrl: `/messages/${conversationId}`,
                    meta: { conversationId, senderId: ws.userId, messageId: newMessage.id },
                    dedupMinutes: 1,
                  });
                }
              }
            } catch (notifErr) {
              console.error('[WS:SEND] DM notification error:', notifErr);
            }

            // 6. Send ACK to sender
            const dt = Date.now() - t0;
            console.log(`[WS:SEND] Message ${newMessage.id} sent successfully in ${dt}ms`);
            ws.send(JSON.stringify({ 
              type: 'message:ack', 
              ok: true, 
              message: newMessage,
              tempId,
              dt
            }));
            
          } catch (error: any) {
            const dt = Date.now() - t0;
            console.error(`[WS:SEND] Error after ${dt}ms:`, error?.message || error);
            ws.send(JSON.stringify({ 
              type: 'message:ack', 
              ok: false, 
              code: 'SERVER_ERROR',
              detail: error?.message?.slice(0, 200),
              tempId,
              dt
            }));
          }
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      if (ws.userId) console.log(`[WS] disconnected: userId=${ws.userId}`);
      
      // Remove this socket from all rooms
      if (ws.rooms) {
        ws.rooms.forEach(roomKey => {
          if (wsRooms.has(roomKey)) {
            wsRooms.get(roomKey)!.delete(ws);
            if (wsRooms.get(roomKey)!.size === 0) {
              wsRooms.delete(roomKey);
            }
          }
        });
      }
      
      // Remove this socket from the user's set
      if (ws.userId && wsClients.has(ws.userId)) {
        wsClients.get(ws.userId)!.delete(ws);
        if (wsClients.get(ws.userId)!.size === 0) {
          wsClients.delete(ws.userId);
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  // ===================== Subcontract Payout Audit =====================

  app.get('/api/subcontract-payouts/job/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (role !== 'OWNER' && role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only Owner or Admin can view payout details' });
      }

      const jobId = parseInt(req.params.jobId);
      if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

      const referral = await stripeConnectService.getAcceptedReferralForJob(jobId);
      const audits = await stripeConnectService.getPayoutAuditForJob(jobId);

      let subcontractorCompanyName: string | null = null;
      if (referral?.receiverCompanyId) {
        const subCo = await storage.getCompany(referral.receiverCompanyId);
        subcontractorCompanyName = subCo?.name || null;
      }

      res.json({
        hasSubcontract: !!referral,
        referral: referral ? {
          id: referral.id,
          referralType: referral.referralType,
          referralValue: referral.referralValue,
          jobTotalAtAcceptanceCents: referral.jobTotalAtAcceptanceCents,
          contractorPayoutAmountCents: referral.contractorPayoutAmountCents,
          companyShareAmountCents: referral.companyShareAmountCents,
          receiverCompanyId: referral.receiverCompanyId,
          subcontractorCompanyName,
          status: referral.status,
        } : null,
        payouts: audits.map(a => ({
          id: a.id,
          paymentId: a.paymentId,
          grossAmountCents: a.grossAmountCents,
          contractorPayoutAmountCents: a.contractorPayoutAmountCents,
          companyShareAmountCents: a.companyShareAmountCents,
          transferAmountCents: a.transferAmountCents,
          stripeTransferId: a.stripeTransferId,
          secondTransferAmountCents: a.secondTransferAmountCents,
          secondStripeTransferId: a.secondStripeTransferId,
          status: a.status,
          failureReason: a.failureReason,
          createdAt: a.createdAt,
        })),
      });
    } catch (error: any) {
      console.error('[SubPayAudit] Error:', error);
      res.status(500).json({ error: 'Failed to fetch payout details' });
    }
  });

  // ===================== Stripe Connect Onboarding =====================

  app.post('/api/stripe-connect/create-account', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (role !== 'OWNER') {
        return res.status(403).json({ error: 'Only the company owner can connect Stripe' });
      }

      if (company.stripeConnectAccountId) {
        return res.status(400).json({ error: 'Stripe Connect account already exists', accountId: company.stripeConnectAccountId });
      }

      const account = await stripeConnectService.createConnectedAccount(company.id, company.name, company.email);
      res.json({ success: true, accountId: account.id, status: 'pending_onboarding' });
    } catch (error: any) {
      console.error('[StripeConnect] Error creating account:', error);
      res.status(500).json({ error: 'Failed to create Stripe Connect account' });
    }
  });

  app.get('/api/stripe-connect/native-return', (_req: any, res) => {
    console.log('[StripeConnect] native-return page loaded');
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Setup Complete</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0fdf4;color:#166534}
.c{text-align:center;padding:32px 24px}
.check{font-size:48px;margin-bottom:16px}
h2{font-size:20px;font-weight:700;margin-bottom:8px}
p{font-size:15px;color:#475569;margin-bottom:24px;line-height:1.5}
.sub{font-size:13px;color:#94a3b8}
</style>
</head><body>
<div class="c">
<div class="check">\u2705</div>
<h2>Stripe Setup Complete</h2>
<p>You can close this window now.<br>Tap <strong>Done</strong> in the top-left corner to return to EcoLogic.</p>
<p class="sub">The app will update automatically.</p>
</div>
</body></html>`);
  });

  app.post('/api/stripe-connect/onboarding-link', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (role !== 'OWNER') {
        return res.status(403).json({ error: 'Only the company owner can manage Stripe Connect' });
      }

      if (!company.stripeConnectAccountId) {
        return res.status(400).json({ error: 'No Stripe Connect account exists. Create one first.' });
      }

      const baseUrl = process.env.APP_BASE_URL || `https://${req.get('host')}`;
      const returnUrl = `${baseUrl}/settings/stripe-connect?status=complete`;
      const refreshUrl = `${baseUrl}/settings/stripe-connect?status=refresh`;

      const link = await stripeConnectService.createOnboardingLink(company.stripeConnectAccountId, returnUrl, refreshUrl);
      res.json({ success: true, url: link.url, expiresAt: link.expires_at });
    } catch (error: any) {
      console.error('[StripeConnect] Error creating onboarding link:', error);
      res.status(500).json({ error: 'Failed to create onboarding link' });
    }
  });

  app.get('/api/stripe-connect/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      if (!company.stripeConnectAccountId) {
        return res.json({
          hasAccount: false,
          status: 'not_started',
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        });
      }

      res.json({
        hasAccount: true,
        accountId: company.stripeConnectAccountId,
        status: company.stripeConnectStatus || 'not_started',
        chargesEnabled: company.stripeConnectChargesEnabled || false,
        payoutsEnabled: company.stripeConnectPayoutsEnabled || false,
        detailsSubmitted: company.stripeConnectDetailsSubmitted || false,
        onboardedAt: company.stripeConnectOnboardedAt,
        lastCheckedAt: company.stripeConnectLastCheckedAt,
      });
    } catch (error: any) {
      console.error('[StripeConnect] Error fetching status:', error);
      res.status(500).json({ error: 'Failed to fetch Stripe Connect status' });
    }
  });

  app.post('/api/stripe-connect/sync', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (role !== 'OWNER') {
        return res.status(403).json({ error: 'Only the company owner can sync Stripe Connect status' });
      }

      if (!company.stripeConnectAccountId) {
        return res.status(400).json({ error: 'No Stripe Connect account to sync' });
      }

      const result = await stripeConnectService.syncAccountStatus(company.id, company.stripeConnectAccountId);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[StripeConnect] Error syncing status:', error);
      res.status(500).json({ error: 'Failed to sync Stripe Connect status' });
    }
  });

  app.post('/api/stripe-connect/ensure-ready', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      if (!company) return res.status(404).json({ error: 'Company not found' });

      const member = await storage.getCompanyMember(company.id, userId);
      const role = (member?.role || '').toUpperCase();
      if (role !== 'OWNER' && role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only the company owner can set up Stripe Connect', ownerOnly: true });
      }

      const isReady = company.stripeConnectAccountId &&
        company.stripeConnectChargesEnabled &&
        company.stripeConnectPayoutsEnabled &&
        company.stripeConnectDetailsSubmitted;

      if (isReady) {
        console.log(`[StripeConnect] ensure-ready: company ${company.id} is already ready`);
        return res.json({ ready: true, status: 'active' });
      }

      const baseUrl = process.env.APP_BASE_URL || `https://${req.get('host')}`;
      const isNative = req.body.native === true;
      const returnPath = req.body.returnPath || '/settings/stripe-connect';

      let returnUrl: string;
      let refreshUrl: string;

      if (isNative) {
        returnUrl = `${baseUrl}/api/stripe-connect/native-return`;
        refreshUrl = `${baseUrl}/api/stripe-connect/native-return`;
      } else {
        returnUrl = `${baseUrl}${returnPath}${returnPath.includes('?') ? '&' : '?'}stripe_connect_return=complete`;
        refreshUrl = `${baseUrl}${returnPath}${returnPath.includes('?') ? '&' : '?'}stripe_connect_return=refresh`;
      }

      if (!company.stripeConnectAccountId) {
        console.log(`[StripeConnect] ensure-ready: creating account for company ${company.id}`);
        const account = await stripeConnectService.createConnectedAccount(company.id, company.name, company.email);

        console.log(`[StripeConnect] ensure-ready: generating onboarding link for new account ${account.id}`);
        const link = await stripeConnectService.createOnboardingLink(account.id, returnUrl, refreshUrl);
        return res.json({ ready: false, status: 'not_connected', onboardingUrl: link.url, accountId: account.id });
      }

      let syncedStatus = company.stripeConnectStatus;
      try {
        const synced = await stripeConnectService.syncAccountStatus(company.id, company.stripeConnectAccountId);
        syncedStatus = synced.status;
        if (synced.chargesEnabled && synced.payoutsEnabled && synced.detailsSubmitted) {
          console.log(`[StripeConnect] ensure-ready: company ${company.id} became ready after sync`);
          return res.json({ ready: true, status: 'active' });
        }
      } catch (e: any) {
        console.warn(`[StripeConnect] ensure-ready: sync failed for company ${company.id}: ${e.message}`);
      }

      console.log(`[StripeConnect] ensure-ready: generating onboarding link for incomplete account ${company.stripeConnectAccountId}`);
      const link = await stripeConnectService.createOnboardingLink(company.stripeConnectAccountId, returnUrl, refreshUrl);
      return res.json({ ready: false, status: syncedStatus || 'setup_incomplete', onboardingUrl: link.url, accountId: company.stripeConnectAccountId });
    } catch (error: any) {
      console.error('[StripeConnect] Error in ensure-ready:', error);
      res.status(500).json({ error: 'Failed to check Stripe Connect readiness' });
    }
  });

  app.get('/api/stripe-connect/check-job-readiness/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      if (!jobId || isNaN(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

      const result = await stripeConnectService.checkBothPartiesConnected(jobId);
      res.json(result);
    } catch (error: any) {
      console.error('[StripeConnect] Error checking job readiness:', error);
      res.status(500).json({ error: 'Failed to check job payment readiness' });
    }
  });

  return httpServer;
}