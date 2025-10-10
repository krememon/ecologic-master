import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { aiScopeAnalyzer } from "./ai-scope-analyzer";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import OpenAI from "openai";
import { aiScheduler } from "./ai-scheduler";
import { insertJobSchema, finalizeJobSchema, type UserRole, companyMembers, jobs, scheduleItems, clients, subcontractors, users, sessions } from "../shared/schema";
import { z } from "zod";
import { can, type Permission } from "../shared/permissions";
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
      return res.status(403).json({ message: "No company access" });
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
      let company = await storage.getUserCompany(user.id);
      
      // If no company exists, create a default one for business owners
      if (!company) {
        // Check if this is a business owner registration
        const isBusinessOwner = true; // Default to business owner for new users
        
        if (isBusinessOwner) {
          const { generateUniqueInviteCode } = await import("@shared/inviteCode");
          const inviteCode = await generateUniqueInviteCode(async (code) => {
            const existing = await storage.getCompanyByInviteCode(code);
            return !!existing;
          });
          
          company = await storage.createCompany({
            name: "Your Company",
            inviteCode,
            logo: null,
            primaryColor: "#3B82F6",
            secondaryColor: "#1E40AF",
            ownerId: user.id
          });
        }
      }

      // Get user's role in the company
      let role: UserRole = "TECHNICIAN"; // Default role
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
          secondaryColor: company.secondaryColor
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
        res.json(company);
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

  // WebSocket server
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    console.log('New WebSocket connection');
    let userId: string | null = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received message:', message);
        
        // Handle auth message to track this connection
        if (message.type === 'auth' && message.userId) {
          userId = message.userId;
          
          // Add this socket to the user's set
          if (!wsClients.has(userId)) {
            wsClients.set(userId, new Set());
          }
          wsClients.get(userId)!.add(ws);
          
          ws.send(JSON.stringify({ type: 'auth_success' }));
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      
      // Remove this socket from the user's set
      if (userId && wsClients.has(userId)) {
        wsClients.get(userId)!.delete(ws);
        if (wsClients.get(userId)!.size === 0) {
          wsClients.delete(userId);
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return httpServer;
}