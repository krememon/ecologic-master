import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { conversationRoom } from "./wsRooms";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { notifyUsers, notifyJobCrew, notifyManagers, notifyOfficeStaff, notifyJobCrewAndManagers, notifyTechniciansOnly, notifyJobCrewAndOffice } from "./notificationService";
import { sendSignatureRequestEmail, sendTestEmail, getAppBaseUrl } from "./email";
import { aiScopeAnalyzer } from "./ai-scope-analyzer";
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
import { insertJobSchema, finalizeJobSchema, insertCustomerSchema, type UserRole, companyMembers, jobs, scheduleItems, clients, customers, subcontractors, users, sessions, conversations, conversationParticipants, messages, signatureRequests, jobLineItems, companyCounters, estimates, crewAssignments } from "../shared/schema";
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
import { eq, and, lt, gt, sql, desc } from "drizzle-orm";
import Stripe from "stripe";
import { invoices, payments } from "../shared/schema";

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
  // Push notification implementation
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

export async function registerRoutes(app: Express): Promise<Server> {
  // Note: uploads directory and static route handled in index.ts (before all middleware)

  // Redirect /auth to /login (no Replit auth screen)
  app.get('/auth', (req, res) => {
    res.redirect(302, '/login');
  });

  // SERVER-SIDE STRIPE RETURN HANDLER - Bulletproof redirect to /jobs
  // This ensures Stripe always lands on Jobs even if SPA routing fails
  app.get('/stripe/return', (req, res) => {
    console.log('[StripeReturn] Server-side hit:', req.originalUrl);
    console.log('[StripeReturn] Redirecting to /jobs');
    res.redirect(302, '/jobs');
  });

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
      
      console.log("Auth user endpoint - userId:", userId);
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
          trialEndsAt: company.trialEndsAt
        } : null
      };
      
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
      // Block Dispatchers and Estimators from viewing time settings
      if (role === 'DISPATCHER' || role === 'ESTIMATOR') {
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
      
      // Technicians only see their own data
      if (role === 'TECHNICIAN') {
        const logs = await storage.getUserTimeLogsToday(userId, member.companyId, today);
        const activeLogWithJob = await storage.getActiveTimeLogWithJob(userId, member.companyId);
        
        // Calculate total hours
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
          currentCategory: activeLogWithJob?.category || null,
        });
      }
      
      // Owner, Supervisor, Dispatcher see aggregate data
      const allLogs = await storage.getCompanyTimeLogsToday(member.companyId, today);
      
      // Get unique users currently clocked in
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
      
      return res.json({
        role: 'manager',
        totalHoursToday: Math.round(totalMinutes / 60 * 100) / 100,
        activeTechCount: clockedInUsers.size,
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
      
      // Only technicians can clock in
      if (member.role !== 'TECHNICIAN') {
        return res.status(403).json({ error: 'Only technicians can clock in' });
      }
      
      // Check if already clocked in
      const activeLog = await storage.getActiveTimeLog(userId, member.companyId);
      if (activeLog) {
        return res.status(400).json({ error: 'Already clocked in' });
      }
      
      const { jobId, category } = req.body;
      
      // Validate jobId if provided - tech must be assigned to the job
      if (jobId) {
        // Check crew assignments
        const assignments = await storage.getUserJobAssignments(userId);
        const isCrewAssigned = assignments.some(a => a.jobId === jobId);
        
        // Also check direct job.assignedTo field
        const job = await storage.getJob(jobId);
        const isDirectlyAssigned = job?.assignedTo === userId;
        
        if (!isCrewAssigned && !isDirectlyAssigned) {
          return res.status(403).json({ error: 'Not assigned to this job' });
        }
      }
      
      // Validate category if provided
      const validCategories = ['job', 'shop', 'drive', 'admin', 'break'];
      if (category && !validCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      
      const log = await storage.clockIn(userId, member.companyId, jobId, category);
      console.log('[Time] clocked in', { userId, logId: log.id, jobId, category });
      res.json({ success: true, clockedInAt: log.clockInAt, jobId: log.jobId, category: log.category });
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
      
      // Only technicians can switch jobs
      if (member.role !== 'TECHNICIAN') {
        return res.status(403).json({ error: 'Only technicians can switch jobs' });
      }
      
      const { jobId, category } = req.body;
      
      // Validate jobId if provided - tech must be assigned to the job
      if (jobId) {
        // Check crew assignments
        const assignments = await storage.getUserJobAssignments(userId);
        const isCrewAssigned = assignments.some(a => a.jobId === jobId);
        
        // Also check direct job.assignedTo field
        const job = await storage.getJob(jobId);
        const isDirectlyAssigned = job?.assignedTo === userId;
        
        if (!isCrewAssigned && !isDirectlyAssigned) {
          return res.status(403).json({ error: 'Not assigned to this job' });
        }
      }
      
      // Validate category if provided
      const validCategories = ['job', 'shop', 'drive', 'admin', 'break'];
      if (category && !validCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      
      const result = await storage.switchJob(userId, member.companyId, jobId, category);
      console.log('[Time] switched job', { userId, endedId: result.ended.id, startedId: result.started.id, jobId, category });
      res.json({ 
        success: true, 
        ended: { id: result.ended.id, clockOutAt: result.ended.clockOutAt },
        started: { id: result.started.id, clockInAt: result.started.clockInAt, jobId: result.started.jobId, category: result.started.category },
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
      
      // Only technicians can clock out
      if (member.role !== 'TECHNICIAN') {
        return res.status(403).json({ error: 'Only technicians can clock out' });
      }
      
      const log = await storage.clockOut(userId, member.companyId);
      if (!log) {
        return res.status(400).json({ error: 'No active session to clock out' });
      }
      
      // Calculate duration
      const startTime = new Date(log.clockInAt).getTime();
      const endTime = log.clockOutAt ? new Date(log.clockOutAt).getTime() : Date.now();
      const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
      
      console.log('[Time] clocked out', { userId, logId: log.id, durationMinutes });
      res.json({ 
        success: true, 
        clockedOutAt: log.clockOutAt,
        durationMinutes,
        jobId: log.jobId,
        category: log.category,
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

      // Estimators and Dispatchers cannot access timesheets
      if (role === 'ESTIMATOR' || role === 'DISPATCHER') {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get date range from query params
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required' });
      }

      // Technicians can only see their own entries - auto-close their own first
      if (role === 'TECHNICIAN') {
        await storage.autoCloseExpiredTimeEntries(userId, member.companyId);
        const entries = await storage.getTimeEntriesForUser(userId, member.companyId, startDate, endDate);
        return res.json({ role: 'technician', entries });
      }

      // Managers see all entries - auto-close all company entries first
      await storage.autoCloseExpiredTimeEntriesForCompany(member.companyId);
      const entries = await storage.getTimeEntriesForCompany(member.companyId, startDate, endDate);
      return res.json({ role: 'manager', entries });
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
      if (role === 'TECHNICIAN' || role === 'ESTIMATOR' || role === 'DISPATCHER') {
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
      
      res.json(result);
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
      
      const { name, logo, primaryColor, secondaryColor } = req.body;
      
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
        ownerId: userId
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

  // Subscription routes removed - app is now free to use
  // Legacy endpoint for backwards compatibility with onboarding flow
  app.post('/api/subscriptions/start-trial', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      console.log('[start-trial] User', userId, 'starting trial (free tier)');
      
      // Get user's company
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(400).json({ message: 'No company found. Please create a company first.' });
      }
      
      // Update subscription status to trialing
      await storage.updateCompany(company.id, {
        subscriptionStatus: 'trialing',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
      });
      
      console.log('[start-trial] Company', company.id, 'subscription status set to trialing');
      res.json({ ok: true, message: 'Trial started successfully' });
    } catch (error: any) {
      console.error('[start-trial] Error:', error);
      res.status(500).json({ message: 'Failed to start trial' });
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
      
      const updatedJob = await storage.updateJob(jobId, jobUpdateData);
      
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
      if (assignedEmployeeIds !== undefined) {
        const existingCrew = await storage.getJobCrewAssignments(jobId);
        const existingIds = existingCrew.map(c => c.userId);
        
        // Remove crew members not in the new list
        const toRemove = existingIds.filter(id => !assignedEmployeeIds.includes(id));
        if (toRemove.length > 0) {
          await storage.removeJobCrewAssignments(jobId, toRemove);
        }
        
        // Add new crew members
        const toAdd = assignedEmployeeIds.filter((id: string) => !existingIds.includes(id));
        if (toAdd.length > 0) {
          await storage.addJobCrewAssignments(jobId, toAdd, company.id, userId);
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

      // Notify crew of new assignments via PATCH
      if (assignedEmployeeIds !== undefined && Array.isArray(assignedEmployeeIds)) {
        // Fetch actual existing crew from database
        const existingCrewAssignments = await storage.getJobCrewAssignments(jobId);
        const existingCrewIds = existingCrewAssignments.map((c: any) => c.userId);
        const newlyAdded = assignedEmployeeIds.filter((id: string) => !existingCrewIds.includes(id));
        if (newlyAdded.length > 0) {
          const assigner = await storage.getUser(userId);
          const assignerName = assigner ? `${assigner.firstName || ''} ${assigner.lastName || ''}`.trim() || 'Someone' : 'Someone';
          await notifyTechniciansOnly(newlyAdded, company.id, {
            type: 'job_assigned',
            title: 'New Job Assignment',
            body: `${assignerName} assigned you to job: ${jobTitle}`,
            entityType: 'job',
            entityId: jobId,
            linkUrl: `/jobs/${jobId}`,
          });
        }
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
      const companyId = req.companyId; // Set by requirePerm middleware
      
      // Verify job exists and belongs to company
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
      
      // Delete job - related time_logs and leads will have jobId set to NULL
      // Other related records (schedule items, photos, etc.) will CASCADE delete
      await storage.deleteJob(jobId);
      
      res.status(204).send(); // No content response
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
      
      // Archive by setting status to 'archived'
      const archivedJob = await storage.updateJob(jobId, { status: 'archived' } as any);
      
      res.json(archivedJob);
    } catch (error) {
      console.error("Error archiving job:", error);
      res.status(500).json({ message: "Failed to archive job" });
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
      const allowedRoles = ['OWNER', 'SUPERVISOR', 'DISPATCHER'];
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

      const uploader = await storage.getUser(userId);
      const uploaderName = uploader ? `${uploader.firstName || ''} ${uploader.lastName || ''}`.trim() || 'Someone' : 'Someone';
      await notifyJobCrewAndManagers(jobId, company.id, {
        type: 'document_uploaded',
        title: 'Document Uploaded',
        body: `${uploaderName} uploaded "${file.originalname}" to ${job.title || `Job #${jobId}`}`,
        entityType: 'job',
        entityId: jobId,
        linkUrl: `/jobs/${jobId}`,
      });

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
      
      const { name, category, jobId, visibility } = req.body;
      
      // Get user role for permission check
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = member?.role || 'TECHNICIAN';
      
      // Role-based permission check: Can this role upload this category?
      if (!canUploadCategory(userRole, category)) {
        return res.status(403).json({ message: getPermissionErrorMessage('upload') });
      }
      
      // Check if this role requires a job for this category
      if (!jobId && requireJobForUpload(userRole, category)) {
        return res.status(403).json({ message: "Documents of this type must be attached to a job" });
      }
      
      // Technicians can only upload to jobs they are assigned to
      if (userRole.toUpperCase() === 'TECHNICIAN' && jobId) {
        const assignments = await storage.getJobCrewAssignments(parseInt(jobId));
        const isAssigned = assignments.some(a => a.userId === userId);
        if (!isAssigned) {
          return res.status(403).json({ message: "You can only upload to jobs you are assigned to" });
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
        name: name || req.file.originalname,
        type: req.file.mimetype,
        category: category || 'Other',
        visibility: visibility || 'internal',
        fileUrl: `/${filePath}`,
        fileSize: req.file.size,
        uploadedBy: userId,
      };
      
      const document = await storage.createDocument(documentData);

      if (jobId) {
        const uploader = await storage.getUser(userId);
        const uploaderName = uploader ? `${uploader.firstName || ''} ${uploader.lastName || ''}`.trim() || 'Someone' : 'Someone';
        const parsedJobId = parseInt(jobId);
        const job = await storage.getJob(parsedJobId);
        await notifyJobCrewAndManagers(parsedJobId, company.id, {
          type: 'document_uploaded',
          title: 'Document Uploaded',
          body: `${uploaderName} uploaded "${name || req.file.originalname}" to ${job?.title || `Job #${parsedJobId}`}`,
          entityType: 'job',
          entityId: parsedJobId,
          linkUrl: `/jobs/${parsedJobId}`,
        });
      }

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
    return ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(upperRole);
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
    return ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(upperRole);
  };
  
  // Helper to check if user can create invoices (includes TECHNICIAN with assignment check done separately)
  const canCreateInvoices = (role: string): boolean => {
    const upperRole = role.toUpperCase();
    return ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR', 'TECHNICIAN'].includes(upperRole);
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
      
      res.json({ invoice });
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
          message: "Add line items before generating an invoice.",
          code: "NO_LINE_ITEMS"
        });
      }

      // Validation: Job must have a customer
      if (!job.customerId && !job.clientId && !job.clientName) {
        return res.status(400).json({ 
          message: "Assign a customer before generating an invoice.",
          code: "NO_CUSTOMER"
        });
      }

      // Get customer info if available
      let customer = null;
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

      // Generate invoice number
      let invoiceNumber: string;
      try {
        const [counter] = await db
          .insert(companyCounters)
          .values({ companyId: company.id, estimateCounter: 0, invoiceCounter: 1 })
          .onConflictDoUpdate({
            target: companyCounters.companyId,
            set: { invoiceCounter: sql`${companyCounters.invoiceCounter} + 1` },
          })
          .returning();
        invoiceNumber = `INV-${String(counter.invoiceCounter).padStart(5, '0')}`;
      } catch (e) {
        // Fallback if counter fails
        const timestamp = Date.now().toString().slice(-6);
        invoiceNumber = `INV-${timestamp}`;
      }

      // Generate PDF
      const fileName = `Invoice_${invoiceNumber.replace(/-/g, '_')}.pdf`;
      const filePath = path.join('uploads', fileName);
      
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
      let subtotalCents = 0;
      for (const item of lineItems) {
        subtotalCents += item.lineTotalCents || 0;
      }
      const subtotal = subtotalCents / 100;
      const total = subtotal; // No tax for now, can be added later
      
      // Invoice date
      const invoiceDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // Customer info preparation
      const custName = customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : job.clientName || 'Customer';
      const custEmail = customer?.email || '';
      const custPhone = customer?.phone || '';
      const custAddress = customer?.address || job.location || '';

      // Table column positions
      const COL_SERVICE = MARGIN;
      const COL_QTY = 340;
      const COL_PRICE = 400;
      const COL_AMOUNT = 490;
      const TABLE_ROW_HEIGHT = 20;

      let yPos = MARGIN;

      // ========== HEADER ==========
      // LEFT SIDE: Logo + Company Info
      const leftColumnWidth = CONTENT_WIDTH - HEADER_BOX_WIDTH - 20;
      
      if (company.logo) {
        try {
          const logoPath = company.logo.startsWith('/') ? company.logo.substring(1) : company.logo;
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, MARGIN, yPos, { width: LOGO_SIZE, height: LOGO_SIZE });
            yPos += LOGO_SIZE + 8;
          }
        } catch (e) {
          console.log('Logo not found, skipping');
        }
      }
      
      // Company name
      doc.fontSize(16).font('Helvetica-Bold').fillColor(BLACK);
      doc.text(company.name, MARGIN, yPos, { width: leftColumnWidth });
      yPos += 20;
      
      // Company contact info
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
      
      // RIGHT SIDE: Invoice Info Box
      const boxX = PAGE_WIDTH - MARGIN - HEADER_BOX_WIDTH;
      const boxPadding = 12;
      const boxHeight = 85;
      const boxY = MARGIN;
      
      doc.rect(boxX, boxY, HEADER_BOX_WIDTH, boxHeight)
         .fillAndStroke(GRAY_LIGHT, GRAY_BORDER);
      
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

      // ========== BILL TO ==========
      doc.fontSize(10).font('Helvetica-Bold').fillColor(BLACK);
      doc.text('BILL TO', MARGIN, yPos);
      yPos += 15;
      
      doc.fontSize(11).font('Helvetica').fillColor(BLACK);
      doc.text(custName, MARGIN, yPos);
      yPos += 14;
      
      doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
      if (custAddress) {
        doc.text(custAddress, MARGIN, yPos);
        yPos += 12;
      }
      if (custPhone) {
        doc.text(custPhone, MARGIN, yPos);
        yPos += 12;
      }
      if (custEmail) {
        doc.text(custEmail, MARGIN, yPos);
        yPos += 12;
      }

      yPos += 20;

      // ========== JOB INFO ==========
      if (job.title) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(BLACK);
        doc.text('JOB:', MARGIN, yPos);
        doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
        doc.text(job.title, MARGIN + 35, yPos);
        yPos += 15;
      }

      yPos += 10;

      // ========== TABLE HEADER ==========
      doc.rect(MARGIN, yPos, CONTENT_WIDTH, 25).fillAndStroke(GRAY_LIGHT, GRAY_BORDER);
      yPos += 7;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(BLACK);
      doc.text('SERVICE', COL_SERVICE + 8, yPos);
      doc.text('QTY', COL_QTY, yPos, { width: 50, align: 'right' });
      doc.text('PRICE', COL_PRICE, yPos, { width: 70, align: 'right' });
      doc.text('AMOUNT', COL_AMOUNT, yPos, { width: 70, align: 'right' });
      yPos += 20;

      // ========== TABLE ROWS ==========
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        const isAlternate = i % 2 === 1;
        
        if (isAlternate) {
          doc.rect(MARGIN, yPos, CONTENT_WIDTH, TABLE_ROW_HEIGHT).fill(GRAY_LIGHT);
        }
        
        doc.fontSize(9).font('Helvetica').fillColor(BLACK);
        const itemName = item.name || 'Service';
        doc.text(itemName, COL_SERVICE + 8, yPos + 5, { width: COL_QTY - COL_SERVICE - 20 });
        
        const qty = parseFloat(item.quantity) || 1;
        const unitPrice = (item.unitPriceCents || 0) / 100;
        const lineTotal = (item.lineTotalCents || 0) / 100;
        
        doc.text(qty.toString(), COL_QTY, yPos + 5, { width: 50, align: 'right' });
        doc.text(`$${unitPrice.toFixed(2)}`, COL_PRICE, yPos + 5, { width: 70, align: 'right' });
        doc.text(`$${lineTotal.toFixed(2)}`, COL_AMOUNT, yPos + 5, { width: 70, align: 'right' });
        
        yPos += TABLE_ROW_HEIGHT;
      }

      // ========== TOTALS ==========
      yPos += 15;
      
      // Subtotal
      doc.fontSize(10).font('Helvetica').fillColor(GRAY_TEXT);
      doc.text('Subtotal:', COL_PRICE, yPos, { width: 70, align: 'right' });
      doc.text(`$${subtotal.toFixed(2)}`, COL_AMOUNT, yPos, { width: 70, align: 'right' });
      yPos += 15;
      
      // Total
      doc.fontSize(12).font('Helvetica-Bold').fillColor(BLACK);
      doc.text('TOTAL:', COL_PRICE, yPos, { width: 70, align: 'right' });
      doc.text(`$${total.toFixed(2)}`, COL_AMOUNT, yPos, { width: 70, align: 'right' });

      // ========== FOOTER ==========
      if (company.footerText) {
        doc.fontSize(9).font('Helvetica').fillColor(GRAY_TEXT);
        doc.text(company.footerText, MARGIN, PAGE_HEIGHT - MARGIN - 40, { 
          width: CONTENT_WIDTH, 
          align: 'center' 
        });
      }

      doc.end();

      // Wait for PDF to finish writing
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Generate PNG preview
      let previewImageUrl: string | null = null;
      try {
        const pdfBuffer = fs.readFileSync(filePath);
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
        
        const previewFileName = fileName.replace('.pdf', '_preview.png');
        const previewPath = path.join('uploads', previewFileName);
        const pngBuffer = canvas.toBuffer('image/png');
        fs.writeFileSync(previewPath, pngBuffer);
        
        previewImageUrl = `/uploads/${previewFileName}`;
      } catch (previewError) {
        console.error('[Invoice] Failed to generate preview:', previewError);
      }

      // Store as document linked to job
      const fileUrl = `/uploads/${fileName}`;
      const document = await storage.createDocument({
        companyId: company.id,
        jobId: jobId,
        name: fileName,
        type: 'invoice',
        category: 'Invoices',
        status: 'Approved',
        visibility: 'internal',
        fileUrl,
        uploadedBy: userId,
      });

      // Create or update invoice record for payment tracking (upsert to prevent duplicates)
      const today = new Date().toISOString().split('T')[0];
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Check if invoice already exists for this job
      const existingInvoice = await storage.getInvoiceByJobId(jobId, company.id);
      
      let invoice;
      if (existingInvoice) {
        // Update existing invoice
        invoice = await storage.updateInvoice(existingInvoice.id, {
          amount: total.toFixed(2),
          subtotalCents,
          taxCents: 0,
          totalCents: subtotalCents,
          pdfUrl: fileUrl,
          notes: `Generated from job: ${job.title}`,
          updatedAt: new Date(),
        });
        console.log(`[InvoiceGenerate] updated invoice`, { invoiceId: invoice.id, jobId });
      } else {
        // Create new invoice
        invoice = await storage.createInvoice({
          companyId: company.id,
          jobId: jobId,
          clientId: null,
          customerId: customer?.id || job.customerId || null,
          invoiceNumber: invoiceNumber,
          amount: total.toFixed(2),
          subtotalCents,
          taxCents: 0,
          totalCents: subtotalCents,
          status: 'pending',
          issueDate: today,
          dueDate: dueDate,
          pdfUrl: fileUrl,
          notes: `Generated from job: ${job.title}`,
        });
        console.log(`[InvoiceGenerate] saved invoice`, { invoiceId: invoice.id, jobId });
        
        // Auto-sync to QuickBooks (fire-and-forget)
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
      }

      console.log(`[Invoice] PDF generated jobId=${jobId} fileName=${fileName} docId=${document.id} invoiceId=${invoice.id}`);
      res.json({ 
        pdfUrl: fileUrl, 
        previewImageUrl,
        fileName, 
        documentId: document.id,
        invoiceId: invoice.id,
        invoiceNumber,
        amount: total.toFixed(2),
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

      // Must use proper email format like "Name <email@domain.com>"
      const fromEmail = process.env.RESEND_FROM_EMAIL;
      if (!fromEmail) {
        console.error("[InvoiceEmail] RESEND_FROM_EMAIL not configured");
        return res.status(503).json({ 
          success: false, 
          message: "Email sender not configured. Please set RESEND_FROM_EMAIL.",
          code: "EMAIL_NOT_CONFIGURED"
        });
      }
      
      const emailSubject = subject || `Invoice from ${company.name}`;
      const emailBody = message || `Please find attached the invoice for your review.`;

      console.log("[InvoiceEmail] calling Resend now", { 
        fromEmail, 
        toEmail, 
        subject: emailSubject,
        pdfSize: pdfBuffer.length 
      });

      // Send email using Resend
      const resend = new Resend(process.env.RESEND_API_KEY);
      
      const { data, error } = await resend.emails.send({
        from: fromEmail,
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
    return ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(upperRole);
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
      
      // RBAC: Only Owner, Supervisor, Dispatcher, Estimator can edit customers
      if (!['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(userRole)) {
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
    return ['OWNER', 'SUPERVISOR', 'DISPATCHER'].includes(upperRole);
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
        const smsEligible = !!(c.phone && c.smsOptIn === true && !c.smsUnsubscribedAt);
        
        let emailDisabledReason: string | null = null;
        let smsDisabledReason: string | null = null;
        
        if (!emailEligible) {
          if (!c.email) emailDisabledReason = "No email";
          else if (c.emailUnsubscribedAt) emailDisabledReason = "Unsubscribed";
          else if (!c.emailOptIn) emailDisabledReason = "Not opted in";
        }
        
        if (!smsEligible) {
          if (!c.phone) smsDisabledReason = "No phone";
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
      
      // Filter for SMS eligibility
      const smsEligible = selectedCustomers.filter(c => {
        if (!c.phone) return false;
        if (includeUnsubscribed && isAdmin) {
          // Admin override: include even if unsubscribed
          return true;
        }
        return c.smsOptIn === true && !c.smsUnsubscribedAt;
      });

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

          const result = await sendCampaignSms({
            to: customer.phone!,
            body: smsBody!,
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
                await storage.updateJob(invoice.jobId, { paymentStatus: jobPaymentStatus } as any);
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
    return ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(upperRole);
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

      const allEstimates = await storage.getEstimatesByCompany(company.id);
      console.log(`[Estimates] listAll userId=${userId} companyId=${company.id} count=${allEstimates.length}`);
      // Debug: log schedule fields for first estimate
      if (allEstimates.length > 0) {
        const first = allEstimates[0];
        console.log(`[Estimates] first estimate schedule:`, {
          id: first.id,
          status: first.status,
          convertedJobId: first.convertedJobId,
          scheduledDate: first.scheduledDate,
          scheduledTime: first.scheduledTime,
        });
      }
      res.json(allEstimates);
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

        // 4. Update estimate with convertedJobId
        await tx
          .update(estimates)
          .set({ convertedJobId: newJob.id })
          .where(eq(estimates.id, estimateId));

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
    return ['OWNER', 'SUPERVISOR', 'ESTIMATOR', 'ADMIN'].includes(upperRole);
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
      fromEmail: process.env.RESEND_FROM_EMAIL,
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

      // Send email using Resend
      const resend = new Resend(process.env.RESEND_API_KEY);
      
      // Must use proper email format like "Name <email@domain.com>"
      const fromEmail = process.env.RESEND_FROM_EMAIL;
      if (!fromEmail) {
        console.error("[ShareEmail] RESEND_FROM_EMAIL not configured");
        return res.status(503).json({ 
          success: false, 
          message: "Email sender not configured. Please set RESEND_FROM_EMAIL.",
          code: "EMAIL_NOT_CONFIGURED"
        });
      }
      
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
    return ['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(upperRole);
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
      
      // Get company info for branding
      const company = await storage.getCompany(invoice.companyId);
      
      // Return only the data needed for public payment page (no sensitive info)
      res.json({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalCents: invoice.totalCents,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        status: invoice.status,
        dueDate: invoice.dueDate,
        issueDate: invoice.issueDate,
        companyName: company?.name || 'Unknown Company',
        companyLogo: company?.logo || null,
        lineItems: invoice.lineItems,
      });
    } catch (error) {
      console.error("Error fetching public invoice:", error);
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });

  // POST /api/public/invoices/checkout - Create Stripe checkout for public invoice payment
  app.post('/api/public/invoices/checkout', async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Payment system not configured" });
      }
      
      const { invoiceId, returnBaseUrl } = req.body;
      
      if (!invoiceId || typeof invoiceId !== 'number') {
        return res.status(400).json({ message: "Invoice ID is required" });
      }
      
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      // Prevent payment if already paid
      if (invoice.status === 'paid') {
        return res.status(400).json({ message: "This invoice has already been paid" });
      }
      
      // Prevent payment if voided/cancelled
      if (invoice.status === 'void' || invoice.status === 'cancelled') {
        return res.status(400).json({ message: "This invoice is no longer valid" });
      }
      
      // Get amount in cents
      const amountInCents = invoice.totalCents || Math.round(parseFloat(invoice.amount) * 100) || 0;
      
      if (amountInCents <= 0) {
        return res.status(400).json({ message: "Invoice has no amount due" });
      }
      
      // Get company for description
      const company = await storage.getCompany(invoice.companyId);
      
      // Use provided returnBaseUrl or construct from APP_BASE_URL
      const appBaseUrl = returnBaseUrl || process.env.APP_BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
      
      console.log(`[PublicCheckout] Creating session for invoice ${invoice.id}, amount: ${amountInCents} cents`);
      
      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice ${invoice.invoiceNumber}`,
              description: company?.name ? `Payment to ${company.name}` : undefined,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        }],
        metadata: {
          invoiceId: invoice.id.toString(),
          invoiceNumber: invoice.invoiceNumber,
          companyId: invoice.companyId.toString(),
        },
        success_url: `${appBaseUrl}/stripe/return`,
        cancel_url: `${appBaseUrl}/invoice/${invoice.id}/pay`,
      });
      
      // Store session ID on invoice
      await storage.updateInvoice(invoiceId, {
        stripeCheckoutSessionId: session.id,
      });
      
      console.log(`[PublicCheckout] Created session ${session.id} for invoice ${invoice.id}`);
      res.json({ url: session.url });
    } catch (error) {
      console.error("Error creating public checkout session:", error);
      res.status(500).json({ message: "Failed to create payment session" });
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

      const allInvoices = await storage.getInvoices(company.id);

      let allRefunds: any[] = [];
      try {
        allRefunds = await storage.getRefundsByCompanyId(company.id);
      } catch (e) {}
      const settledStatuses = new Set(['succeeded', 'settled']);
      const pendingStatuses = new Set(['pending', 'posted']);
      const refundTotalsByInvoice: Record<number, number> = {};
      const pendingRefundTotalsByInvoice: Record<number, number> = {};
      for (const r of allRefunds) {
        if (r.invoiceId && settledStatuses.has(r.status)) {
          refundTotalsByInvoice[r.invoiceId] = (refundTotalsByInvoice[r.invoiceId] || 0) + r.amountCents;
        }
        if (r.invoiceId && pendingStatuses.has(r.status)) {
          pendingRefundTotalsByInvoice[r.invoiceId] = (pendingRefundTotalsByInvoice[r.invoiceId] || 0) + r.amountCents;
        }
      }

      const ledger = allInvoices
        .filter((inv: any) => {
          const s = (inv.status || '').toLowerCase();
          if (s === 'cancelled' || s === 'void' || s === 'draft') return false;
          const total = inv.totalCents || Math.round(parseFloat(inv.amount || '0') * 100);
          return total > 0;
        })
        .map((inv: any) => {
          const totalCents = inv.totalCents || Math.round(parseFloat(inv.amount || '0') * 100);
          const paidCents = inv.paidAmountCents || 0;
          const balanceCents = Math.max(totalCents - paidCents, 0);
          const refundedCents = refundTotalsByInvoice[inv.id] || 0;
          const pendingRefundedCents = pendingRefundTotalsByInvoice[inv.id] || 0;
          const netCollectedCents = Math.max(0, paidCents - refundedCents);

          const dbStatus = (inv.status || '').toLowerCase();
          let computedStatus: string;
          if (dbStatus === 'refunded' || dbStatus === 'partially_refunded') {
            computedStatus = dbStatus;
          } else if (balanceCents === 0 && totalCents > 0) {
            computedStatus = 'paid';
          } else if (paidCents > 0 && balanceCents > 0) {
            computedStatus = 'partial';
          } else {
            computedStatus = 'unpaid';
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

          const jobTitle = inv.job?.title || null;

          const lastActivityDate = inv.paidDate || inv.updatedAt || inv.createdAt;

          return {
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            customerId: inv.customerId,
            customerName,
            jobId: inv.jobId,
            jobTitle,
            totalCents,
            paidCents,
            balanceCents,
            refundedCents,
            pendingRefundedCents,
            netCollectedCents,
            status: computedStatus,
            dueDate: inv.dueDate,
            issueDate: inv.issueDate,
            createdAt: inv.createdAt,
            lastActivityDate,
          };
        });

      ledger.sort((a: any, b: any) => {
        const da = a.lastActivityDate ? new Date(a.lastActivityDate).getTime() : 0;
        const db2 = b.lastActivityDate ? new Date(b.lastActivityDate).getTime() : 0;
        return db2 - da;
      });

      res.json(ledger);
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
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
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

      const balanceDueCents = Math.max(0, invoiceTotalCents - totalPaymentsCents);
      const netCollectedCents = Math.max(0, totalPaymentsCents - totalRefundsCents);

      let computedStatus: string;
      if (totalPaymentsCents === 0) {
        computedStatus = 'unpaid';
      } else if (totalPaymentsCents < invoiceTotalCents) {
        computedStatus = 'partial';
      } else {
        if (totalRefundsCents === 0) {
          computedStatus = 'paid';
        } else if (totalRefundsCents >= totalPaymentsCents) {
          computedStatus = 'refunded';
        } else {
          computedStatus = 'partially_refunded';
        }
      }

      res.json({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceTotalCents,
        paidAmountCents: totalPaymentsCents,
        totalPaymentsCents,
        totalRefundsCents,
        pendingRefundsCents,
        netCollectedCents,
        balanceDueCents,
        invoiceStatus: computedStatus,
        customerName: customerName || "Unknown Customer",
        jobTitle,
        jobId: invoice.jobId,
        payments: enrichedPayments,
        refunds: invoiceRefunds,
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
      res.json(invoiceList);
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
      
      console.log("[Invoice API] invoiceId:", invoiceId, "invoice.customerId:", invoice.customerId, "job.customerId:", (invoice.job as any)?.customerId);
      console.log("[Invoice API] customer:", invoice.customer ? `${invoice.customer.firstName} ${invoice.customer.lastName} / ${invoice.customer.companyName}` : 'null');
      
      res.json(invoice);
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
          await storage.updateJob(invoice.jobId, { paymentStatus: 'paid' } as any);
          console.log(`[Invoice] Job ${invoice.jobId} paymentStatus updated to paid`);
        }
      }
      
      console.log(`[Invoice] Updated invoice`, { invoiceId, status, userId });
      res.json(updatedInvoice);
    } catch (error) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ message: "Failed to update invoice" });
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
        hasEmailFrom: !!process.env.EMAIL_FROM,
        hasAppBaseUrl: !!process.env.APP_BASE_URL
      });
      
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const member = await storage.getCompanyMember(company.id, userId);
      const userRole = (member?.role || 'TECHNICIAN').toUpperCase();
      
      // RBAC: Owner/Supervisor/Dispatcher/Estimator can send invoices
      if (!['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(userRole)) {
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
      
      // Validate EMAIL_FROM is an email, not a URL - fallback to Resend test sender
      const emailFromEnv = process.env.EMAIL_FROM || "";
      const isValidEmailFrom = emailFromEnv.includes('@') && !emailFromEnv.startsWith('http');
      const fromEmail = isValidEmailFrom ? emailFromEnv : "EcoLogic <onboarding@resend.dev>";
      
      // Build payment link using APP_BASE_URL (this is the public URL for links, not for email "from")
      const appBaseUrl = process.env.APP_BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
      const paymentLink = `${appBaseUrl}/invoice/${invoice.id}/pay`;
      
      console.log("[EmailSend] building email", { from: fromEmail, paymentLink, emailFromEnvValid: isValidEmailFrom });
      
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
      
      // RBAC: Owner/Supervisor/Dispatcher/Estimator can send invoices
      if (!['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(userRole)) {
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
      
      // RBAC: Only Owner/Supervisor can delete invoices
      if (userRole !== 'OWNER' && userRole !== 'SUPERVISOR') {
        return res.status(403).json({ message: "You do not have permission to delete invoices" });
      }
      
      const { invoiceIds } = req.body;
      
      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ message: "invoiceIds array is required" });
      }
      
      let deletedCount = 0;
      const deletedIds: number[] = [];
      
      for (const invoiceId of invoiceIds) {
        const invoice = await storage.getInvoice(invoiceId);
        
        // Skip if invoice doesn't exist or belongs to different company
        if (!invoice || invoice.companyId !== company.id) {
          continue;
        }
        
        await storage.deleteInvoice(invoiceId);
        deletedCount++;
        deletedIds.push(invoiceId);
      }
      
      console.log(`[Invoice] Bulk deleted ${deletedCount} invoices`, { userId, deletedIds });
      res.json({ success: true, deletedCount, deletedIds });
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

      // Create DM notification for recipients
      const sender = await storage.getUser(userId);
      const senderCompany = await storage.getUserCompany(userId);
      
      if (sender && senderCompany) {
        const senderName = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.email || 'Someone';
        const messagePreview = body.trim().length > 50 
          ? body.trim().substring(0, 50) + '...' 
          : body.trim();

        for (const { userId: recipientId } of participants) {
          try {
            await storage.createNotification({
              companyId: senderCompany.id,
              recipientUserId: recipientId,
              type: 'dm_message',
              title: senderName,
              body: messagePreview,
              entityType: 'conversation',
              entityId: conversationId,
              linkUrl: `/messages?conversation=${conversationId}`,
              meta: {
                conversationId,
                senderId: userId,
                messageId: message.id,
              },
            });
          } catch (notifError) {
            console.error('[DM notification] Failed to create notification:', notifError);
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
      
      // RBAC: Owner, Supervisor, Dispatcher, Estimator can record payments
      if (!['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to record payments" });
      }

      const { invoiceId, method, checkNumber, amountCents: requestedAmountCents, paymentMethod } = req.body;
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

      // Calculate new balance
      const newPaidAmountCents = currentPaidAmountCents + amountCents;
      const newBalanceDueCents = Math.max(0, invoiceTotalCents - newPaidAmountCents);
      const newStatus = newBalanceDueCents === 0 ? 'paid' : 'partial';

      // Create payment record
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
      });

      // Update invoice with new payment amounts and status
      await storage.updateInvoice(invoiceId, {
        status: newStatus,
        paidAmountCents: newPaidAmountCents,
        balanceDueCents: newBalanceDueCents,
        ...(newStatus === 'paid' ? {
          paidDate: new Date().toISOString().split('T')[0],
          paidAt: new Date(),
        } : {}),
      } as any);

      // Update job paymentStatus if invoice is associated with a job
      if (invoice.jobId) {
        const jobPaymentStatus = newStatus === 'paid' ? 'paid' : 'partial';
        await storage.updateJob(invoice.jobId, { paymentStatus: jobPaymentStatus } as any);
        console.log(`[Payment] Job ${invoice.jobId} paymentStatus updated to '${jobPaymentStatus}'`);
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

      // Send payment_collected notification to managers
      const payer = await storage.getUser(userId);
      const payerName = payer ? `${payer.firstName || ''} ${payer.lastName || ''}`.trim() || 'Someone' : 'Someone';
      await notifyManagers(company.id, {
        type: 'payment_collected',
        title: 'Payment Collected',
        body: `${payerName} collected a $${amountDollars} ${paymentMethodValue.toLowerCase()} payment`,
        entityType: 'invoice',
        entityId: invoiceId,
        linkUrl: invoice.jobId ? `/jobs/${invoice.jobId}` : undefined,
      });

      res.json({
        success: true,
        amountCents,
        method: paymentMethodValue.toLowerCase(),
        invoiceId,
        paymentId: payment.id,
        newStatus,
        balanceRemaining: newBalanceDueCents,
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
      
      if (!['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR'].includes(userRole)) {
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

      const newPaidAmountCents = currentPaidAmountCents + amountCents;
      const newBalanceDueCents = Math.max(0, invoiceTotalCents - newPaidAmountCents);
      const newStatus = newBalanceDueCents === 0 ? 'paid' : 'partial';

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

      await storage.updateInvoice(invoice.id, {
        status: newStatus,
        paidAmountCents: newPaidAmountCents,
        balanceDueCents: newBalanceDueCents,
        ...(newStatus === 'paid' ? {
          paidDate: new Date().toISOString().split('T')[0],
          paidAt: new Date(),
        } : {}),
      } as any);

      if (invoice.jobId) {
        const jobPaymentStatus = newStatus === 'paid' ? 'paid' : 'partial';
        await storage.updateJob(invoice.jobId, { paymentStatus: jobPaymentStatus } as any);
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
      await notifyManagers(company.id, {
        type: 'payment_collected',
        title: 'Payment Collected',
        body: `${payerName} collected a $${amountDollars} ${paymentMethodValue} payment`,
        entityType: 'invoice',
        entityId: invoice.id,
        linkUrl: invoice.jobId ? `/jobs/${invoice.jobId}` : undefined,
      });

      res.json({
        success: true,
        amountCents,
        method: paymentMethodValue,
        invoiceId: invoice.id,
        paymentId: payment.id,
        newStatus,
        balanceRemaining: newBalanceDueCents,
      });
    } catch (error: any) {
      console.error('Error recording customer payment:', error);
      res.status(500).json({ message: error.message || "Failed to record payment" });
    }
  });

  // POST /api/payments/checkout - Create a Stripe Checkout session for an invoice
  app.post('/api/payments/checkout', isAuthenticated, async (req: any, res) => {
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
      
      // RBAC: Owner, Supervisor, Dispatcher, Estimator, Technician can create payment links
      // Technician requires assignment check done after loading invoice
      if (!['OWNER', 'SUPERVISOR', 'DISPATCHER', 'ESTIMATOR', 'TECHNICIAN'].includes(userRole)) {
        return res.status(403).json({ message: "You do not have permission to create payment links" });
      }

      const { invoiceId, returnBaseUrl, amountCents: requestedAmountCents } = req.body;
      
      if (!invoiceId) {
        return res.status(400).json({ message: "Invoice ID is required" });
      }

      // Load invoice from DB
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice || invoice.companyId !== company.id) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // For technicians, verify they are assigned to the job linked to this invoice
      if (userRole === 'TECHNICIAN' && invoice.jobId) {
        const crewAssignments = await storage.getJobCrewAssignments(invoice.jobId);
        const isAssigned = crewAssignments.some(c => c.userId === userId);
        if (!isAssigned) {
          return res.status(403).json({ message: "You can only collect payments for jobs you are assigned to" });
        }
      }

      // Check if invoice is already paid
      if (invoice.status?.toLowerCase() === 'paid') {
        return res.status(400).json({ message: "This invoice has already been paid" });
      }

      // Calculate balance remaining
      const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100);
      const currentPaidAmountCents = invoice.paidAmountCents || 0;
      const currentBalanceDueCents = invoice.balanceDueCents || (invoiceTotalCents - currentPaidAmountCents);

      // Determine charge amount (support partial payments)
      let amountInCents: number;
      if (requestedAmountCents !== undefined && requestedAmountCents !== null) {
        const parsed = parseInt(String(requestedAmountCents), 10);
        if (isNaN(parsed) || parsed <= 0) {
          return res.status(400).json({ message: "Payment amount must be a positive number" });
        }
        if (parsed > currentBalanceDueCents) {
          return res.status(400).json({ message: "Payment amount cannot exceed balance due" });
        }
        amountInCents = parsed;
      } else {
        amountInCents = currentBalanceDueCents;
      }

      // Log request headers for debugging origin issues
      console.log(`[Checkout] req origin: ${req.headers.origin}`);
      console.log(`[Checkout] host: ${req.headers.host}`);
      console.log(`[Checkout] x-forwarded-host: ${req.headers["x-forwarded-host"]}`);
      console.log(`[Checkout] x-forwarded-proto: ${req.headers["x-forwarded-proto"]}`);
      console.log(`[Checkout] returnBaseUrl from frontend: ${returnBaseUrl}`);

      // Use the frontend-provided returnBaseUrl if valid, otherwise fall back to env/header
      let appBaseUrl: string;
      if (returnBaseUrl && typeof returnBaseUrl === 'string' && returnBaseUrl.startsWith('https://')) {
        appBaseUrl = returnBaseUrl;
      } else {
        // Fallback: build from request headers or env
        const proto = req.headers["x-forwarded-proto"] || 'https';
        const host = req.headers["x-forwarded-host"] || req.headers.host;
        if (host) {
          appBaseUrl = `${proto}://${host}`;
        } else {
          appBaseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
        }
      }

      const isPartialPayment = amountInCents < currentBalanceDueCents;
      const description = isPartialPayment 
        ? `Partial payment for invoice ${invoice.invoiceNumber}`
        : (invoice.notes || `Payment for invoice ${invoice.invoiceNumber}`);

      console.log(`[Stripe] Using appBaseUrl: ${appBaseUrl}`);
      console.log(`[Stripe] Charging amount: ${amountInCents} cents (balance: ${currentBalanceDueCents}, total: ${invoiceTotalCents})`);
      console.log(`[Stripe] Success URL: ${appBaseUrl}/stripe/return`);
      console.log(`[Stripe] Cancel URL: ${appBaseUrl}/stripe/return`);

      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Invoice ${invoice.invoiceNumber}`,
                description,
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          invoiceId: String(invoice.id),
          companyId: String(company.id),
          jobId: invoice.jobId ? String(invoice.jobId) : '',
          isPartialPayment: isPartialPayment ? 'true' : 'false',
        },
        success_url: `${appBaseUrl}/stripe/return`,
        cancel_url: `${appBaseUrl}/stripe/return`,
      });

      console.log(`[Stripe] Created checkout session ${session.id} for invoice ${invoice.id}`);
      
      res.json({ 
        url: session.url, 
        sessionId: session.id 
      });
    } catch (error: any) {
      console.error('Error creating Stripe checkout session:', error);
      res.status(500).json({ message: error.message || "Failed to create payment session" });
    }
  });

  // GET /api/payments/session/:sessionId - Get payment session status
  app.get('/api/payments/session/:sessionId', async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const { sessionId } = req.params;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      // If payment is successful, update invoice and job status
      if (session.payment_status === 'paid' && session.metadata?.invoiceId) {
        const invoiceId = parseInt(session.metadata.invoiceId);
        const invoice = await storage.getInvoice(invoiceId);
        
        if (invoice && invoice.status !== 'paid') {
          const invoiceTotalCents = invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100);
          const amountCents = session.amount_total || invoiceTotalCents;
          const prevPaidCents = invoice.paidAmountCents || 0;
          const newPaidAmountCents = Math.min(invoiceTotalCents, prevPaidCents + amountCents);
          const newBalanceDueCents = Math.max(0, invoiceTotalCents - newPaidAmountCents);
          const newStatus = newBalanceDueCents === 0 ? 'paid' : 'partial';

          await storage.updateInvoice(invoiceId, {
            status: newStatus,
            paidAmountCents: newPaidAmountCents,
            balanceDueCents: newBalanceDueCents,
            ...(newStatus === 'paid' ? {
              paidDate: new Date().toISOString().split('T')[0],
              paidAt: new Date(),
            } : {}),
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: session.payment_intent as string,
          } as any);
          console.log(`[Stripe] Invoice ${invoiceId} updated to '${newStatus}' from session check (paid: ${newPaidAmountCents}, balance: ${newBalanceDueCents})`);

          // Create payment record (idempotency: check by stripePaymentIntentId)
          const paymentIntentId = session.payment_intent as string;
          let existingPayment = null;
          if (paymentIntentId) {
            const allPayments = await storage.getPaymentsByInvoiceId(invoiceId);
            existingPayment = allPayments?.find((p: any) => p.stripePaymentIntentId === paymentIntentId) || null;
          }
          if (!existingPayment) {
            const stripePayment = await storage.createPayment({
              companyId: invoice.companyId,
              invoiceId: invoiceId,
              jobId: invoice.jobId || null,
              customerId: invoice.customerId || null,
              amount: (amountCents / 100).toFixed(2),
              amountCents: amountCents,
              paymentMethod: 'stripe',
              status: 'paid',
              stripePaymentIntentId: paymentIntentId,
              stripeCheckoutSessionId: session.id,
              paidDate: new Date(),
              notes: amountCents < invoiceTotalCents ? 'Partial card payment' : 'Online card payment',
            });
            console.log(`[Stripe] Payment record created for invoice ${invoiceId}`);

            // Sync payment to QuickBooks (non-blocking)
            syncPaymentToQbo(stripePayment.id, invoice.companyId).then(result => {
              if (result.success) {
                console.log(`[QB] Stripe payment ${stripePayment.id} synced: ${result.qboPaymentId}`);
              } else {
                console.log(`[QB] Stripe payment ${stripePayment.id} sync: ${result.error}`);
              }
            }).catch(err => console.error('[QB] Stripe payment sync error:', err));
          }

          // Update job paymentStatus
          if (invoice.jobId) {
            const jobPaymentStatus = newStatus === 'paid' ? 'paid' : 'partial';
            await storage.updateJob(invoice.jobId, { paymentStatus: jobPaymentStatus } as any);
            console.log(`[Stripe] Job ${invoice.jobId} paymentStatus updated to '${jobPaymentStatus}'`);
          }

          // Send notification to managers
          const amountDollars = (amountCents / 100).toFixed(2);
          await notifyManagers(invoice.companyId, {
            type: 'invoice_paid',
            title: 'Invoice Paid',
            body: `A $${amountDollars} card payment was received`,
            entityType: 'invoice',
            entityId: invoiceId,
            linkUrl: invoice.jobId ? `/jobs/${invoice.jobId}` : undefined,
          });
        }
      }

      res.json({
        status: session.status,
        paymentStatus: session.payment_status,
        invoiceId: session.metadata?.invoiceId,
      });
    } catch (error: any) {
      console.error('Error retrieving session:', error);
      res.status(500).json({ message: "Failed to retrieve session" });
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
      if (role === 'TECHNICIAN' || role === 'ESTIMATOR') {
        return res.status(403).json({ message: "You don't have permission to issue refunds" });
      }

      const paymentId = parseInt(req.params.id);
      const payment = await storage.getPaymentById(paymentId);
      if (!payment || payment.companyId !== company.id) {
        return res.status(404).json({ message: "Payment not found" });
      }

      const amountCents = payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100);
      const refundedAmountCents = payment.refundedAmountCents || 0;
      const maxRefundable = amountCents - refundedAmountCents;

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

      const existingRefunds = await storage.getRefundsByPaymentId(paymentId);

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
        existingRefunds,
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
      if (role === 'TECHNICIAN' || role === 'ESTIMATOR') {
        return res.status(403).json({ message: "You don't have permission to issue refunds" });
      }

      const refundSchema = z.object({
        paymentId: z.number().int().positive(),
        method: z.enum(['card', 'bank', 'cash', 'check']),
        amountCents: z.number().int().positive(),
        reason: z.string().optional(),
      });

      const parsed = refundSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid refund request", errors: parsed.error.flatten().fieldErrors });
      }
      const { paymentId, method, amountCents, reason } = parsed.data;

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
        provider,
        status: status as any,
        stripeRefundId,
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
              await storage.updateJob(invoice.jobId, { paymentStatus: jobPaymentStatus } as any);
            }
          }
        }
      }

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

      // Create notifications for each recipient
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
            },
          });
          notifications.push(notification);
        } catch (err) {
          console.error('[Announcement] Failed to create notification for', recipientId, err);
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

  // ============ NOTIFICATIONS API ============

  // GET /api/notifications - Get current user's notifications
  app.get('/api/notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const notifications = await storage.getNotifications(userId, limit);
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
      const count = await storage.getUnreadNotificationCount(userId);
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


  // WebSocket server
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: ExtendedWebSocket, req) => {
    console.log('New WebSocket connection');
    ws.rooms = new Set();

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received message:', message);
        
        // Handle auth message to track this connection
        if (message.type === 'auth' && message.userId) {
          ws.userId = message.userId;
          
          // Add this socket to the user's set
          if (!wsClients.has(ws.userId)) {
            wsClients.set(ws.userId, new Set());
          }
          const userSockets = wsClients.get(ws.userId);
          if (userSockets) {
            userSockets.add(ws);
          }
          
          ws.send(JSON.stringify({ type: 'auth_success' }));
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

            // 5. Send ACK to sender
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
      console.log('WebSocket connection closed');
      
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

  return httpServer;
}