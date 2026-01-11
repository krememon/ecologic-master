import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { conversationRoom } from "./wsRooms";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { sendSignatureRequestEmail, sendTestEmail, getAppBaseUrl } from "./email";
import { aiScopeAnalyzer } from "./ai-scope-analyzer";
import { scrypt, randomBytes, timingSafeEqual, createHash } from "crypto";

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
import { insertJobSchema, finalizeJobSchema, insertCustomerSchema, type UserRole, companyMembers, jobs, scheduleItems, clients, subcontractors, users, sessions, conversations, conversationParticipants, messages, signatureRequests } from "../shared/schema";
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
// Stripe removed

// Subscription plans removed

const scryptAsync = promisify(scrypt);

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

// Utility function to extract user ID consistently from different auth methods
function getUserId(user: any): string {
  if (user.claims && user.claims.sub) {
    return user.claims.sub;
  }
  return user.id || user.sub;
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
  // Ensure uploads directory exists
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
  }

  // Serve uploaded files
  app.use('/uploads', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  }, express.static('uploads'));

  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      
      console.log("Auth user endpoint - userId:", userId, "user object:", req.user);
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
          onboardingCompleted: company.onboardingCompleted ?? false
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
      console.log("Linked accounts endpoint - userId:", userId, "user object:", req.user);
      
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
      
      const { name, logo, phone, email, addressLine1, addressLine2, city, state, postalCode, country, licenseNumber, defaultFooterText } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Company name is required' });
      }
      
      const updatedCompany = await storage.updateCompany(member.companyId, {
        name: name.trim(),
        logo: logo || null,
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

  app.post('/api/companies', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
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
        ownerId: user.claims.sub
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
    console.log('server:POST /api/clients:entered', req.body);
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
      
      const jobs = await storage.getJobs(company.id);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ message: "Failed to fetch jobs" });
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
        // Create the job
        const [createdJob] = await tx
          .insert(jobs)
          .values({
            ...jobData,
            companyId: company.id,
            clientId,
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

  // Update job (PATCH)
  app.patch('/api/jobs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Validate request body with partial zod schema (all fields optional for updates)
      const updateJobSchema = insertJobSchema.partial();
      const validationResult = updateJobSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: validationResult.error.errors 
        });
      }
      
      const jobId = parseInt(req.params.id);
      const job = await storage.updateJob(jobId, validationResult.data);
      
      res.json(job);
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
      
      // Delete job (CASCADE will remove related schedule items, photos, etc.)
      await storage.deleteJob(jobId);
      
      res.status(204).send(); // No content response
    } catch (error) {
      console.error("Error deleting job:", error);
      res.status(500).json({ message: "Failed to delete job" });
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
      
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "userIds array is required" });
      }
      
      // Verify job exists and belongs to company
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Verify all users are in the company
      for (const uid of userIds) {
        const userMember = await storage.getCompanyMember(company.id, uid);
        if (!userMember) {
          return res.status(400).json({ message: `User ${uid} is not a member of this company` });
        }
      }
      
      const result = await storage.addJobCrewAssignments(jobId, userIds, company.id, userId);
      
      res.json({ ok: true, added: result.added });
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
      res.status(201).json(document);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // Bulk delete documents - MUST come before :documentId route to avoid matching "bulk" as an ID
  app.delete('/api/documents/bulk', isAuthenticated, async (req: any, res) => {
    try {
      console.log('[DELETE] Bulk delete request, body:', JSON.stringify(req.body));
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
      
      // Try to get the document first to delete the file
      try {
        const doc = await storage.getDocument(documentId);
        if (doc && doc.fileUrl) {
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
      
      await storage.deleteDocument(documentId);
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
      
      // Get the document to check its category and current status
      const doc = await storage.getDocument(documentId);
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
      
      const updatedDoc = await storage.updateDocumentStatus(documentId, status);
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
      
      // Get the document to verify it exists and belongs to company
      const doc = await storage.getDocument(documentId);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      if (doc.companyId !== company.id) {
        return res.status(403).json({ message: "Document not found" });
      }
      
      const updatedDoc = await storage.updateDocumentVisibility(documentId, visibility);
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

      const { title, notes, items, customerId, customerName, customerEmail, customerPhone, customerAddress, taxCents, assignedEmployeeIds, jobType } = req.body;

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
          sortOrder: item.sortOrder,
        });
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
          items: normalizedItems 
        },
        companyId,
        userId
      );

      console.log(`[Estimates] create estimateId=${estimate.id} jobId=${jobId} companyId=${companyId}`);
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

      const { title, notes, items, customerId, customerName, customerEmail, customerPhone, customerAddress, taxCents, assignedEmployeeIds, jobId, jobType } = req.body;

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
          taxCents: parsedTaxCents,
          assignedEmployeeIds: Array.isArray(assignedEmployeeIds) ? assignedEmployeeIds : [],
          jobType: jobType?.trim() || undefined,
          items: normalizedItems 
        },
        companyId,
        userId
      );

      console.log(`[Estimates] create standalone estimateId=${estimate.id} jobId=${validatedJobId || 'none'} companyId=${companyId}`);
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

      console.log(`[Estimates] get estimateId=${estimateId} jobId=${estimate.jobId} companyId=${company.id}`);
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
            quantity,
            unitPriceCents,
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

  // DELETE /api/estimates/:id - Delete estimate (draft only)
  app.delete('/api/estimates/:id', isAuthenticated, requirePerm('estimates.create'), async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // Verify estimate exists and belongs to company
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate || estimate.companyId !== companyId) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      // Only allow deletion of draft estimates
      if (estimate.status !== 'draft') {
        return res.status(400).json({ message: "Only draft estimates can be deleted" });
      }

      await storage.deleteEstimate(estimateId);
      console.log(`[Estimates] delete estimateId=${estimateId} jobId=${estimate.jobId} companyId=${companyId}`);
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

  // PATCH /api/estimates/:id/approve - Approve estimate with signature
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

      // Verify status is draft
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

      const approved = await storage.approveEstimate(estimateId, userId, signatureDataUrl);
      
      console.log(`[Estimates] approved estimateId=${estimateId} userId=${userId} totalCents=${estimate.totalCents}`);
      res.json(approved);
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

      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Header with company info
      let yPos = 50;
      
      // Company logo (if available)
      if (company.logo) {
        try {
          const logoPath = company.logo.startsWith('/') ? company.logo.substring(1) : company.logo;
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, yPos, { width: 80 });
            yPos += 60;
          }
        } catch (e) {
          console.log('Logo not found, skipping');
        }
      }

      // Company name
      doc.fontSize(20).font('Helvetica-Bold').text(company.name, 50, yPos);
      yPos += 25;

      // Company contact info
      doc.fontSize(10).font('Helvetica');
      if (company.addressLine1) {
        let addressLine = company.addressLine1;
        if (company.addressLine2) addressLine += ', ' + company.addressLine2;
        doc.text(addressLine, 50, yPos);
        yPos += 12;
      }
      if (company.city || company.state || company.postalCode) {
        const cityLine = [company.city, company.state, company.postalCode].filter(Boolean).join(', ');
        doc.text(cityLine, 50, yPos);
        yPos += 12;
      }
      if (company.phone) {
        doc.text(`Phone: ${company.phone}`, 50, yPos);
        yPos += 12;
      }
      if (company.email) {
        doc.text(`Email: ${company.email}`, 50, yPos);
        yPos += 12;
      }
      if (company.licenseNumber) {
        doc.text(`License: ${company.licenseNumber}`, 50, yPos);
        yPos += 12;
      }

      yPos += 20;

      // Estimate title and number
      doc.fontSize(16).font('Helvetica-Bold').text('ESTIMATE', 50, yPos);
      yPos += 20;
      doc.fontSize(12).font('Helvetica').text(`Estimate #: ${estimate.estimateNumber}`, 50, yPos);
      yPos += 15;
      
      // Service date
      const serviceDate = estimate.scheduledDate 
        ? new Date(estimate.scheduledDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : new Date(estimate.createdAt!).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.text(`Date: ${serviceDate}`, 50, yPos);
      yPos += 15;

      // Customer info
      if (customer || estimate.customerName) {
        yPos += 10;
        doc.fontSize(12).font('Helvetica-Bold').text('Bill To:', 50, yPos);
        yPos += 15;
        doc.fontSize(10).font('Helvetica');
        
        const custName = customer ? `${customer.firstName} ${customer.lastName}` : estimate.customerName;
        if (custName) {
          doc.text(custName, 50, yPos);
          yPos += 12;
        }
        
        const custEmail = customer?.email || (estimate as any).customerEmail;
        if (custEmail) {
          doc.text(custEmail, 50, yPos);
          yPos += 12;
        }
        
        const custPhone = customer?.phone || (estimate as any).customerPhone;
        if (custPhone) {
          doc.text(custPhone, 50, yPos);
          yPos += 12;
        }
        
        const custAddress = customer?.address || (estimate as any).customerAddress;
        if (custAddress) {
          doc.text(custAddress, 50, yPos);
          yPos += 12;
        }
      }

      yPos += 20;

      // Line items table header
      const tableTop = yPos;
      const colService = 50;
      const colQty = 330;
      const colPrice = 400;
      const colAmount = 480;
      
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Service/Item', colService, tableTop);
      doc.text('Qty', colQty, tableTop);
      doc.text('Unit Price', colPrice, tableTop);
      doc.text('Amount', colAmount, tableTop);
      
      yPos = tableTop + 15;
      doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
      yPos += 10;

      // Line items
      doc.fontSize(10).font('Helvetica');
      const items = estimate.items || [];
      for (const item of items) {
        // Check if we need a new page
        if (yPos > 700) {
          doc.addPage();
          yPos = 50;
        }
        
        const qty = parseFloat(String(item.quantity)) || 1;
        const unitPrice = (item.unitPriceCents || 0) / 100;
        const amount = qty * unitPrice;
        
        doc.text(item.name, colService, yPos, { width: 270 });
        doc.text(qty.toString(), colQty, yPos);
        doc.text(`$${unitPrice.toFixed(2)}`, colPrice, yPos);
        doc.text(`$${amount.toFixed(2)}`, colAmount, yPos);
        
        yPos += 15;
        if (item.description) {
          doc.fontSize(9).fillColor('#666666').text(item.description, colService + 10, yPos, { width: 260 });
          yPos += 12;
          doc.fontSize(10).fillColor('#000000');
        }
      }

      // Totals
      yPos += 20;
      doc.moveTo(350, yPos).lineTo(550, yPos).stroke();
      yPos += 10;
      
      const subtotal = (estimate.subtotalCents || 0) / 100;
      const tax = ((estimate as any).taxCents || 0) / 100;
      const total = (estimate.totalCents || 0) / 100;
      
      doc.font('Helvetica').text('Subtotal:', 400, yPos);
      doc.text(`$${subtotal.toFixed(2)}`, colAmount, yPos);
      yPos += 15;
      
      if (tax > 0) {
        doc.text('Tax:', 400, yPos);
        doc.text(`$${tax.toFixed(2)}`, colAmount, yPos);
        yPos += 15;
      }
      
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('Total:', 400, yPos);
      doc.text(`$${total.toFixed(2)}`, colAmount, yPos);
      yPos += 25;

      // Signature if approved
      if (estimate.status === 'approved' && estimate.signatureDataUrl) {
        yPos += 20;
        doc.fontSize(10).font('Helvetica-Bold').text('Customer Approval', 50, yPos);
        yPos += 15;
        doc.fontSize(9).font('Helvetica');
        const approvedDate = estimate.approvedAt 
          ? new Date(estimate.approvedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : 'N/A';
        doc.text(`Signed on ${approvedDate} for $${total.toFixed(2)}`, 50, yPos);
        yPos += 15;
        
        // Add signature image
        try {
          if (estimate.signatureDataUrl.startsWith('data:image')) {
            const base64Data = estimate.signatureDataUrl.split(',')[1];
            const signatureBuffer = Buffer.from(base64Data, 'base64');
            doc.image(signatureBuffer, 50, yPos, { width: 150 });
            yPos += 60;
          }
        } catch (e) {
          console.log('Could not render signature:', e);
        }
      }

      // Footer
      if (company.defaultFooterText) {
        // Position footer near bottom
        const footerY = Math.max(yPos + 30, 680);
        doc.fontSize(9).font('Helvetica').fillColor('#666666');
        doc.text(company.defaultFooterText, 50, footerY, { width: 500, align: 'center' });
      }

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
    try {
      const userId = getUserId(req.user);
      const companyId = req.companyId;
      const estimateId = parseInt(req.params.id);
      
      // RBAC check with owner fallback (same as PDF generation)
      const canShare = await canUserShareEstimate(userId, companyId);
      if (!canShare) {
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
      
      const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'noreply@resend.dev';
      const emailSubject = subject || `Estimate ${estimate.estimateNumber} from ${company?.name || 'Our Company'}`;
      const emailBody = message || `Please find attached the estimate for your review.`;

      await resend.emails.send({
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

      console.log(`[Estimates] Email sent estimateId=${estimateId} toEmail=${toEmail}`);
      res.json({ success: true, message: "Email sent successfully" });
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

  // Payments routes
  app.get('/api/payments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const payments = await storage.getPayments(company.id);
      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
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