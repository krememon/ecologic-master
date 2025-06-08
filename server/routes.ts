import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./new-storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertCompanySchema, insertClientSchema, insertSubcontractorSchema, insertJobSchema, insertInvoiceSchema, insertMessageSchema, type UserRole, type UserPermissions } from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

// Password hashing utilities
const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  if (!stored) return false;
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage_multer = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage_multer,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// WebSocket connection management
const userConnections = new Map<string, WebSocket[]>();
const userSubscriptions = new Map<string, any>();

// WebSocket helper functions
function broadcastToUser(userId: string, message: any) {
  const connections = userConnections.get(userId) || [];
  const data = JSON.stringify(message);
  
  connections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

async function sendPushNotification(userId: string, notification: any) {
  try {
    const subscription = userSubscriptions.get(userId);
    if (!subscription) {
      console.log('No push subscription found for user:', userId);
      return;
    }

    // Here you would integrate with a push service like Web Push API
    // For now, we'll log the notification
    console.log('Sending push notification to user:', userId);
    console.log('Notification:', notification);
    
    // In a real implementation, you would use libraries like 'web-push'
    // to send actual push notifications to the user's device
    
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

// Role-based permission middleware
const requirePermission = (permission: keyof UserPermissions) => {
  return async (req: any, res: any, next: any) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const userRole = await storage.getUserRole(userId, company.id);
      if (!userRole) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!userRole.permissions[permission]) {
        return res.status(403).json({ message: `Permission denied: ${permission}` });
      }

      req.userRole = userRole;
      req.company = company;
      next();
    } catch (error) {
      console.error("Permission check error:", error);
      res.status(500).json({ message: "Permission check failed" });
    }
  };
};

// Business owner only middleware
const requireOwner = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const company = await storage.getUserCompany(userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    const isOwner = await storage.isBusinessOwner(userId, company.id);
    if (!isOwner) {
      return res.status(403).json({ message: "Business owner access required" });
    }

    req.company = company;
    next();
  } catch (error) {
    console.error("Owner check error:", error);
    res.status(500).json({ message: "Owner check failed" });
  }
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Serve uploaded files
  app.use('/uploads', (req, res, next) => {
    // Add proper headers for images
    res.header('Cache-Control', 'public, max-age=86400'); // 1 day cache
    next();
  }, express.static(uploadsDir));

  // Email authentication routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { firstName, lastName, companyName, email, password, role, companyInviteCode } = req.body;
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists with this email" });
      }
      
      // Hash password
      const hashedPassword = await hashPassword(password);
      
      // Generate unique user ID
      const userId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      
      // Create user
      const user = await storage.createUser({
        id: userId,
        firstName,
        lastName,
        email,
        password: hashedPassword,
        emailVerified: false,
      });
      
      if (role === 'owner') {
        // Business owner registration - create new company
        if (!companyName) {
          return res.status(400).json({ message: "Company name is required for business owners" });
        }
        
        const company = await storage.createCompany({
          name: companyName,
          ownerId: user.id,
          primaryColor: "#3B82F6",
          secondaryColor: "#1E40AF",
        });
        
        // Add owner as company member with full permissions
        await storage.addWorkerToCompany(company.id, user.email, 'owner');
        
      } else if (role === 'worker') {
        // Employee registration - join existing company
        if (!companyInviteCode) {
          return res.status(400).json({ message: "Company invite code is required for employees" });
        }
        
        // For now, use company ID as invite code (in production, you'd want a more secure system)
        const companyId = parseInt(companyInviteCode);
        if (isNaN(companyId)) {
          return res.status(400).json({ message: "Invalid company invite code" });
        }
        
        try {
          await storage.addWorkerToCompany(companyId, user.email, 'worker');
        } catch (error) {
          console.error("Failed to add worker to company:", error);
          return res.status(400).json({ message: "Invalid company invite code or company not found" });
        }
      } else {
        return res.status(400).json({ message: "Role must be either 'owner' or 'worker'" });
      }
      
      // Create session
      req.login(user, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Failed to create session" });
        }
        res.status(201).json(user);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Check password
      if (!user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const isValid = await comparePasswords(password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Create session
      req.login(user, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Failed to create session" });
        }
        res.json(user);
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to sign in" });
    }
  });

  // Auth routes
  app.get('/api/auth/user', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Also get user's company
      let company = await storage.getUserCompany(parseInt(user.id));
      
      // If user exists but no company, create a default company
      if (!company) {
        company = await storage.createCompany({
          name: `${user.firstName || 'Your'} ${user.lastName || 'Company'}`,
          primaryColor: '#3B82F6',
          secondaryColor: '#1E40AF',
          ownerId: user.id
        });

        // Create sample data for demonstration
        try {
          // Create sample clients
          const client1 = await storage.createClient({
            companyId: company.id,
            name: "Green Valley Resort",
            email: "contact@greenvalleyresort.com",
            phone: "(555) 123-4567",
            address: "123 Mountain View Drive, Green Valley, CA 90210",
            notes: "Eco-friendly resort project focusing on sustainable construction"
          });

          const client2 = await storage.createClient({
            companyId: company.id,
            name: "Sunrise Apartments",
            email: "manager@sunriseapts.com", 
            phone: "(555) 987-6543",
            address: "456 Oak Street, Sunrise City, CA 90211",
            notes: "Multi-unit residential development with energy-efficient systems"
          });

          // Create sample subcontractors
          await storage.createSubcontractor({
            companyId: company.id,
            name: "Mike Thompson",
            email: "mike@watersystems.com",
            phone: "(555) 234-5678",
            skills: ["Plumbing", "Water Systems", "Pipe Installation", "Leak Detection"],
            rating: "4.8",
            isAvailable: true,
            hourlyRate: "85",
            notes: "Specialist in eco-friendly water systems and conservation"
          });

          await storage.createSubcontractor({
            companyId: company.id,
            name: "Sarah Chen",
            email: "sarah@greenwiring.com",
            phone: "(555) 345-6789", 
            skills: ["Electrical", "Solar Installation", "Smart Systems", "Energy Efficiency"],
            rating: "4.9",
            isAvailable: true,
            hourlyRate: "95",
            notes: "Expert in renewable energy and smart building systems"
          });

          await storage.createSubcontractor({
            companyId: company.id,
            name: "Carlos Rodriguez",
            email: "carlos@ecobuild.com",
            phone: "(555) 456-7890",
            skills: ["HVAC", "Air Quality", "Ventilation", "Climate Control"],
            rating: "4.7",
            isAvailable: false,
            hourlyRate: "90",
            notes: "Specializes in energy-efficient heating and cooling systems"
          });

          // Create sample jobs
          await storage.createJob({
            companyId: company.id,
            clientId: client1.id,
            title: "Resort Water Treatment System Installation",
            description: "Install eco-friendly water treatment and recycling system for the resort's spa and pool facilities",
            status: "planning",
            priority: "high",
            startDate: "2024-07-15",
            endDate: "2024-08-30", 
            estimatedCost: "75000",
            location: "Green Valley, CA",
            notes: "Focus on sustainable water management and conservation technologies"
          });

          await storage.createJob({
            companyId: company.id,
            clientId: client2.id,
            title: "Apartment Smart Energy Systems",
            description: "Install solar panels, smart thermostats, and energy monitoring systems across all units",
            status: "in_progress",
            priority: "medium",
            startDate: "2024-06-01",
            endDate: "2024-09-15",
            estimatedCost: "120000",
            actualCost: "85000",
            location: "Sunrise City, CA", 
            notes: "Comprehensive energy efficiency upgrade for 24-unit building"
          });

          await storage.createJob({
            companyId: company.id,
            clientId: client1.id,
            title: "Resort Landscaping Water Conservation",
            description: "Design and install drip irrigation system and native plant landscaping",
            status: "planning",
            priority: "low",
            estimatedCost: "35000",
            location: "Green Valley, CA",
            notes: "Drought-resistant landscaping with automated irrigation controls"
          });
        } catch (error) {
          console.log("Sample data creation failed (may already exist):", error instanceof Error ? error.message : error);
        }
      }
      
      res.json({ ...user, company });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Profile picture upload route
  app.post('/api/auth/user/profile-image', isAuthenticated, upload.single('profileImage'), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      // Create the URL for the uploaded image
      const imageUrl = `/uploads/${req.file.filename}`;
      
      // Update user profile with new image URL
      const updatedUser = await storage.upsertUser({
        id: userId,
        profileImageUrl: imageUrl,
      });

      res.json({ 
        message: "Profile picture updated successfully",
        profileImageUrl: imageUrl,
        user: updatedUser
      });
    } catch (error) {
      console.error("Error uploading profile picture:", error);
      
      // Clean up uploaded file if there was an error
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error("Error cleaning up file:", unlinkError);
        }
      }
      
      res.status(500).json({ message: "Failed to upload profile picture" });
    }
  });

  // Company routes
  app.get('/api/company', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let company = await storage.getUserCompany(userId);
      
      // If no company exists, create one for business owners
      if (!company) {
        const user = await storage.getUser(userId);
        company = await storage.createCompany({
          name: `${user?.firstName || 'Your'} ${user?.lastName || 'Company'}`,
          primaryColor: '#3B82F6',
          secondaryColor: '#1E40AF',
          ownerId: userId
        });
      }
      
      // Add invite code for business owners
      const isOwner = await storage.isBusinessOwner(userId, company.id);
      const responseData = {
        ...company,
        inviteCode: isOwner ? company.id.toString() : undefined
      };
      
      res.json(responseData);
    } catch (error) {
      console.error("Error fetching company:", error);
      res.status(500).json({ message: "Failed to fetch company" });
    }
  });

  app.post('/api/companies', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const companyData = insertCompanySchema.parse({
        ...req.body,
        ownerId: userId,
      });
      
      const company = await storage.createCompany(companyData);
      res.json(company);
    } catch (error) {
      console.error("Error creating company:", error);
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  app.put('/api/companies/:id', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = parseInt(req.params.id);
      const companyData = insertCompanySchema.partial().parse(req.body);
      
      const company = await storage.updateCompany(companyId, companyData);
      res.json(company);
    } catch (error) {
      console.error("Error updating company:", error);
      res.status(500).json({ message: "Failed to update company" });
    }
  });

  // Client routes
  app.get('/api/clients', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let company = await storage.getUserCompany(userId);
      
      // If no company exists, create one
      if (!company) {
        const user = await storage.getUser(userId);
        company = await storage.createCompany({
          name: `${user?.firstName || 'Your'} ${user?.lastName || 'Company'}`,
          primaryColor: '#3B82F6',
          secondaryColor: '#1E40AF',
          ownerId: userId
        });
      }
      
      const clients = await storage.getClients(company.id);
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.post('/api/clients', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const clientData = insertClientSchema.parse({
        ...req.body,
        companyId: company.id,
      });
      
      const client = await storage.createClient(clientData);
      res.json(client);
    } catch (error) {
      console.error("Error creating client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.put('/api/clients/:id', isAuthenticated, async (req: any, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const clientData = insertClientSchema.partial().parse(req.body);
      
      const client = await storage.updateClient(clientId, clientData);
      res.json(client);
    } catch (error) {
      console.error("Error updating client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  app.delete('/api/clients/:id', isAuthenticated, async (req: any, res) => {
    try {
      const clientId = parseInt(req.params.id);
      await storage.deleteClient(clientId);
      res.json({ message: "Client deleted successfully" });
    } catch (error) {
      console.error("Error deleting client:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  // Subcontractor routes
  app.get('/api/subcontractors', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      // Convert numeric fields to strings for schema validation
      const processedBody = {
        ...req.body,
        companyId: company.id,
        hourlyRate: req.body.hourlyRate ? String(req.body.hourlyRate) : undefined,
        rating: req.body.rating ? String(req.body.rating) : undefined,
      };
      
      const subcontractorData = insertSubcontractorSchema.parse(processedBody);
      
      const subcontractor = await storage.createSubcontractor(subcontractorData);
      res.json(subcontractor);
    } catch (error) {
      console.error("Error creating subcontractor:", error);
      res.status(500).json({ message: "Failed to create subcontractor" });
    }
  });

  app.put('/api/subcontractors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const subcontractorId = parseInt(req.params.id);
      
      // Convert numeric fields to strings for schema validation
      const processedBody = {
        ...req.body,
        hourlyRate: req.body.hourlyRate ? String(req.body.hourlyRate) : undefined,
        rating: req.body.rating ? String(req.body.rating) : undefined,
      };
      
      const subcontractorData = insertSubcontractorSchema.partial().parse(processedBody);
      
      const subcontractor = await storage.updateSubcontractor(subcontractorId, subcontractorData);
      res.json(subcontractor);
    } catch (error) {
      console.error("Error updating subcontractor:", error);
      res.status(500).json({ message: "Failed to update subcontractor" });
    }
  });

  app.delete('/api/subcontractors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const subcontractorId = parseInt(req.params.id);
      await storage.deleteSubcontractor(subcontractorId);
      res.json({ message: "Subcontractor deleted successfully" });
    } catch (error) {
      console.error("Error deleting subcontractor:", error);
      res.status(500).json({ message: "Failed to delete subcontractor" });
    }
  });

  // Job routes
  app.get('/api/jobs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      console.log("Fetching jobs for user:", userId);
      
      let company = await storage.getUserCompany(userId);
      console.log("Found company for jobs:", company);
      
      // If no company exists, create one
      if (!company) {
        const user = await storage.getUser(userId);
        console.log("Creating company for jobs for user:", user);
        company = await storage.createCompany({
          name: `${user?.firstName || 'Your'} ${user?.lastName || 'Company'}`,
          primaryColor: '#3B82F6',
          secondaryColor: '#1E40AF',
          ownerId: userId
        });
        console.log("Created company for jobs:", company);
      }
      
      const jobs = await storage.getJobs(company.id);
      console.log("Retrieved jobs:", jobs);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  app.post('/api/jobs', isAuthenticated, async (req: any, res) => {
    try {
      console.log("Creating job - Request body:", req.body);
      const userId = req.user.claims.sub;
      console.log("User ID:", userId);
      
      let company = await storage.getUserCompany(userId);
      console.log("Found company:", company);
      
      // If no company exists, create one
      if (!company) {
        const user = await storage.getUser(userId);
        console.log("Creating company for user:", user);
        company = await storage.createCompany({
          name: `${user?.firstName || 'Your'} ${user?.lastName || 'Company'}`,
          primaryColor: '#3B82F6',
          secondaryColor: '#1E40AF',
          ownerId: userId
        });
        console.log("Created company:", company);
      }
      
      const jobData = insertJobSchema.parse({
        ...req.body,
        companyId: company.id,
      });
      console.log("Parsed job data:", jobData);
      
      const job = await storage.createJob(jobData);
      console.log("Created job:", job);
      res.json(job);
    } catch (error) {
      console.error("Error creating job:", error);
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      res.status(500).json({ message: "Failed to create job", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put('/api/jobs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.id);
      const jobData = insertJobSchema.partial().parse(req.body);
      
      const job = await storage.updateJob(jobId, jobData);
      res.json(job);
    } catch (error) {
      console.error("Error updating job:", error);
      res.status(500).json({ message: "Failed to update job" });
    }
  });

  app.delete('/api/jobs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.id);
      await storage.deleteJob(jobId);
      res.json({ message: "Job deleted successfully" });
    } catch (error) {
      console.error("Error deleting job:", error);
      res.status(500).json({ message: "Failed to delete job" });
    }
  });

  // Invoice routes
  app.get('/api/invoices', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const invoices = await storage.getInvoices(company.id);
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.post('/api/invoices', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const invoiceData = insertInvoiceSchema.parse({
        ...req.body,
        companyId: company.id,
      });
      
      const invoice = await storage.createInvoice(invoiceData);
      res.json(invoice);
    } catch (error) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  app.put('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const invoiceData = insertInvoiceSchema.partial().parse(req.body);
      
      const invoice = await storage.updateInvoice(invoiceId, invoiceData);
      res.json(invoice);
    } catch (error) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ message: "Failed to update invoice" });
    }
  });

  app.delete('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      await storage.deleteInvoice(invoiceId);
      res.json({ message: "Invoice deleted successfully" });
    } catch (error) {
      console.error("Error deleting invoice:", error);
      res.status(500).json({ message: "Failed to delete invoice" });
    }
  });

  // Dashboard stats route
  app.get('/api/dashboard/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let company = await storage.getUserCompany(userId);
      
      // If no company exists, create one
      if (!company) {
        const user = await storage.getUser(userId);
        company = await storage.createCompany({
          name: `${user?.firstName || 'Your'} ${user?.lastName || 'Company'}`,
          primaryColor: '#3B82F6',
          secondaryColor: '#1E40AF',
          ownerId: userId
        });
      }
      
      // Debug: Check invoice amounts
      const invoices = await storage.getInvoices(company.id);
      console.log("Invoices for company", company.id, ":", invoices);
      
      // Calculate invoice total manually
      const totalInvoiceAmount = invoices.reduce((sum, invoice) => {
        return sum + parseFloat(invoice.amount || '0');
      }, 0);
      console.log("Manual total calculation:", totalInvoiceAmount);
      
      const stats = await storage.getDashboardStats(company.id);
      console.log("Dashboard stats for company", company.id, ":", stats);
      
      // Override the outstanding invoices with the correct calculation
      stats.outstandingInvoices = totalInvoiceAmount;
      
      // Prevent caching to ensure fresh data
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Job Photo endpoints
  app.get('/api/jobs/:jobId/photos', isAuthenticated, async (req, res) => {
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
      const userId = req.user?.claims?.sub || req.user?.id;
      
      if (!req.file) {
        return res.status(400).json({ message: "No photo file provided" });
      }

      const photoUrl = `/uploads/${req.file.filename}`;
      const { title, description, phase, weather, location } = req.body;

      const photo = await storage.createJobPhoto({
        jobId,
        uploadedBy: userId,
        title,
        description,
        photoUrl,
        location,
        phase,
        weather,
        isPublic: true,
      });

      // Broadcast to WebSocket clients
      broadcastToUser(userId, {
        type: 'job_photo_uploaded',
        jobId,
        photo,
      });

      res.status(201).json(photo);
    } catch (error) {
      console.error("Error uploading job photo:", error);
      res.status(500).json({ message: "Failed to upload photo" });
    }
  });

  app.delete('/api/jobs/photos/:photoId', isAuthenticated, async (req, res) => {
    try {
      const photoId = parseInt(req.params.photoId);
      await storage.deleteJobPhoto(photoId);
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting job photo:", error);
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  // Weather integration routes
  app.get('/api/weather/current/:location', isAuthenticated, async (req, res) => {
    try {
      const { location } = req.params;
      const { weatherService } = await import('./weather-service');
      const weatherData = await weatherService.getWeatherData(location);
      res.json(weatherData);
    } catch (error) {
      console.error("Error fetching weather data:", error);
      res.status(500).json({ message: "Failed to fetch weather data" });
    }
  });

  app.post('/api/weather/analyze-job/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found or access denied" });
      }

      if (!job.location || !job.startDate) {
        return res.status(400).json({ message: "Job must have location and start date for weather analysis" });
      }

      const { weatherService } = await import('./weather-service');
      const weatherData = await weatherService.getWeatherData(job.location);
      
      const endDate = job.endDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const analysis = weatherService.analyzeWeatherForJob(
        weatherData.forecast,
        job.startDate,
        endDate,
        'construction'
      );

      analysis.jobId = jobId;
      analysis.location = job.location;

      res.json({
        weather: weatherData,
        analysis,
      });
    } catch (error) {
      console.error("Error analyzing weather for job:", error);
      res.status(500).json({ message: "Failed to analyze weather for job" });
    }
  });

  // AI Scope Analysis routes
  app.post('/api/ai/analyze-scope', isAuthenticated, async (req: any, res) => {
    try {
      const { jobDescription, jobType, location, budget } = req.body;
      
      if (!jobDescription) {
        return res.status(400).json({ message: "Job description is required" });
      }

      const { aiScopeAnalyzer } = await import('./ai-scope-analyzer');
      const analysis = await aiScopeAnalyzer.analyzeJobScope(
        jobDescription,
        jobType,
        location,
        budget
      );

      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing job scope:", error);
      res.status(500).json({ message: "Failed to analyze job scope" });
    }
  });

  app.post('/api/ai/quick-estimate', isAuthenticated, async (req: any, res) => {
    try {
      const { jobDescription } = req.body;
      
      if (!jobDescription) {
        return res.status(400).json({ message: "Job description is required" });
      }

      const { aiScopeAnalyzer } = await import('./ai-scope-analyzer');
      const estimate = await aiScopeAnalyzer.generateQuickEstimate(jobDescription);

      res.json(estimate);
    } catch (error) {
      console.error("Error generating quick estimate:", error);
      res.status(500).json({ message: "Failed to generate estimate" });
    }
  });

  app.post('/api/ai/analyze-job-scope/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const job = await storage.getJob(jobId);
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found or access denied" });
      }

      if (!job.description) {
        return res.status(400).json({ message: "Job must have a description for scope analysis" });
      }

      const { aiScopeAnalyzer } = await import('./ai-scope-analyzer');
      const analysis = await aiScopeAnalyzer.analyzeJobScope(
        job.description,
        job.title,
        job.location,
        job.estimatedCost ? Number(job.estimatedCost) : undefined
      );

      analysis.jobId = jobId;

      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing job scope:", error);
      res.status(500).json({ message: "Failed to analyze job scope" });
    }
  });

  // E-signature Approval Workflow routes
  app.get('/api/approvals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const workflows = await storage.getApprovalWorkflows(company.id);
      res.json(workflows);
    } catch (error) {
      console.error("Error fetching approval workflows:", error);
      res.status(500).json({ message: "Failed to fetch approval workflows" });
    }
  });

  app.post('/api/approvals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const workflowData = {
        ...req.body,
        companyId: company.id,
        createdBy: userId,
      };

      const workflow = await storage.createApprovalWorkflow(workflowData);
      
      // Create audit history
      await storage.createApprovalHistory({
        workflowId: workflow.id,
        action: 'created',
        description: `Approval workflow "${workflow.title}" created`,
        performedBy: userId,
      });

      res.status(201).json(workflow);
    } catch (error) {
      console.error("Error creating approval workflow:", error);
      res.status(500).json({ message: "Failed to create approval workflow" });
    }
  });

  app.get('/api/approvals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const workflowId = parseInt(req.params.id);
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const workflow = await storage.getApprovalWorkflow(workflowId);
      if (!workflow || workflow.companyId !== company.id) {
        return res.status(404).json({ message: "Approval workflow not found" });
      }

      const signatures = await storage.getApprovalSignatures(workflowId);
      const history = await storage.getApprovalHistory(workflowId);

      res.json({
        ...workflow,
        signatures,
        history,
      });
    } catch (error) {
      console.error("Error fetching approval workflow:", error);
      res.status(500).json({ message: "Failed to fetch approval workflow" });
    }
  });

  app.post('/api/approvals/:id/signatures', isAuthenticated, async (req: any, res) => {
    try {
      const workflowId = parseInt(req.params.id);
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const workflow = await storage.getApprovalWorkflow(workflowId);
      if (!workflow || workflow.companyId !== company.id) {
        return res.status(404).json({ message: "Approval workflow not found" });
      }

      // Generate unique access token for signature
      const accessToken = require('crypto').randomBytes(32).toString('hex');
      
      const signatureData = {
        ...req.body,
        workflowId,
        accessToken,
      };

      const signature = await storage.createApprovalSignature(signatureData);
      
      // Create audit history
      await storage.createApprovalHistory({
        workflowId,
        action: 'sent',
        description: `Signature request sent to ${signature.signerEmail}`,
        performedBy: userId,
        performedByEmail: req.user.claims.email,
      });

      res.status(201).json(signature);
    } catch (error) {
      console.error("Error creating signature request:", error);
      res.status(500).json({ message: "Failed to create signature request" });
    }
  });

  // Public signature endpoint (no authentication required)
  app.get('/api/sign/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const signature = await storage.getApprovalSignatureByToken(token);
      
      if (!signature) {
        return res.status(404).json({ message: "Invalid or expired signature link" });
      }

      const workflow = await storage.getApprovalWorkflow(signature.workflowId);
      if (!workflow) {
        return res.status(404).json({ message: "Approval workflow not found" });
      }

      // Check if workflow is expired
      if (workflow.expiresAt && new Date() > new Date(workflow.expiresAt)) {
        return res.status(410).json({ message: "This approval request has expired" });
      }

      // Create view history
      await storage.createApprovalHistory({
        workflowId: workflow.id,
        action: 'viewed',
        description: `Signature page viewed by ${signature.signerEmail}`,
        performedByEmail: signature.signerEmail,
        metadata: {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        },
      });

      res.json({
        workflow: {
          id: workflow.id,
          title: workflow.title,
          description: workflow.description,
          type: workflow.type,
          documentUrl: workflow.documentUrl,
          documentType: workflow.documentType,
        },
        signature: {
          id: signature.id,
          signerName: signature.signerName,
          signerEmail: signature.signerEmail,
          signerType: signature.signerType,
          status: signature.status,
        },
      });
    } catch (error) {
      console.error("Error fetching signature request:", error);
      res.status(500).json({ message: "Failed to fetch signature request" });
    }
  });

  app.post('/api/sign/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const { signatureData, comments, action } = req.body; // action: 'sign' or 'decline'
      
      const signature = await storage.getApprovalSignatureByToken(token);
      if (!signature) {
        return res.status(404).json({ message: "Invalid or expired signature link" });
      }

      const workflow = await storage.getApprovalWorkflow(signature.workflowId);
      if (!workflow) {
        return res.status(404).json({ message: "Approval workflow not found" });
      }

      // Check if workflow is expired
      if (workflow.expiresAt && new Date() > new Date(workflow.expiresAt)) {
        return res.status(410).json({ message: "This approval request has expired" });
      }

      // Check if already signed/declined
      if (signature.status !== 'pending') {
        return res.status(400).json({ message: "This request has already been processed" });
      }

      const updateData: any = {
        status: action === 'sign' ? 'signed' : 'declined',
        signedAt: new Date(),
        comments,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      };

      if (action === 'sign' && signatureData) {
        updateData.signatureData = signatureData;
      }

      const updatedSignature = await storage.updateApprovalSignature(signature.id, updateData);

      // Create audit history
      await storage.createApprovalHistory({
        workflowId: workflow.id,
        action: action === 'sign' ? 'signed' : 'declined',
        description: `${signature.signerEmail} ${action === 'sign' ? 'signed' : 'declined'} the approval request`,
        performedByEmail: signature.signerEmail,
        metadata: {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          comments,
        },
      });

      // Check if all signatures are completed to update workflow status
      const allSignatures = await storage.getApprovalSignatures(workflow.id);
      const pendingSignatures = allSignatures.filter(s => s.status === 'pending');
      const declinedSignatures = allSignatures.filter(s => s.status === 'declined');

      let newWorkflowStatus = workflow.status;
      if (declinedSignatures.length > 0) {
        newWorkflowStatus = 'rejected';
      } else if (pendingSignatures.length === 0) {
        newWorkflowStatus = 'approved';
      }

      if (newWorkflowStatus !== workflow.status) {
        await storage.updateApprovalWorkflow(workflow.id, { status: newWorkflowStatus });
        
        await storage.createApprovalHistory({
          workflowId: workflow.id,
          action: newWorkflowStatus,
          description: `Approval workflow ${newWorkflowStatus}`,
        });
      }

      res.json({
        success: true,
        message: action === 'sign' ? 'Document signed successfully' : 'Document declined',
        signature: updatedSignature,
      });
    } catch (error) {
      console.error("Error processing signature:", error);
      res.status(500).json({ message: "Failed to process signature" });
    }
  });

  // Company member management routes
  app.get('/api/company/members', isAuthenticated, requireOwner, async (req: any, res) => {
    try {
      const company = req.company;
      const workers = await storage.getCompanyWorkers(company.id);
      res.json(workers);
    } catch (error) {
      console.error("Error fetching company workers:", error);
      res.status(500).json({ message: "Failed to fetch company workers" });
    }
  });

  app.post('/api/company/members', isAuthenticated, requireOwner, async (req: any, res) => {
    try {
      const company = req.company;
      const { email, role } = req.body;
      
      if (!email || !role) {
        return res.status(400).json({ message: "Email and role are required" });
      }
      
      if (!['owner', 'worker'].includes(role)) {
        return res.status(400).json({ message: "Role must be 'owner' or 'worker'" });
      }
      
      await storage.addWorkerToCompany(company.id, email, role);
      res.json({ message: "Worker added successfully" });
    } catch (error) {
      console.error("Error adding worker:", error);
      if (error.message.includes("User not found")) {
        res.status(404).json({ message: "No user found with that email address" });
      } else if (error.message.includes("already a member")) {
        res.status(400).json({ message: "User is already a member of this company" });
      } else {
        res.status(500).json({ message: "Failed to add worker" });
      }
    }
  });

  app.delete('/api/company/members/:userId', isAuthenticated, requireOwner, async (req: any, res) => {
    try {
      const company = req.company;
      const userId = req.params.userId;
      
      await storage.removeWorkerFromCompany(company.id, userId);
      res.json({ message: "Worker removed successfully" });
    } catch (error) {
      console.error("Error removing worker:", error);
      res.status(500).json({ message: "Failed to remove worker" });
    }
  });

  app.put('/api/company/members/:userId/permissions', isAuthenticated, requireOwner, async (req: any, res) => {
    try {
      const company = req.company;
      const userId = req.params.userId;
      const { permissions } = req.body;
      
      if (!permissions) {
        return res.status(400).json({ message: "Permissions are required" });
      }
      
      await storage.updateWorkerPermissions(company.id, userId, permissions);
      res.json({ message: "Permissions updated successfully" });
    } catch (error) {
      console.error("Error updating permissions:", error);
      res.status(500).json({ message: "Failed to update permissions" });
    }
  });

  app.get('/api/user/role', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const userRole = await storage.getUserRole(userId, company.id);
      const isOwner = await storage.isBusinessOwner(userId, company.id);
      
      res.json({
        role: userRole?.role || 'worker',
        permissions: userRole?.permissions || {},
        isOwner,
        companyId: company.id,
        companyName: company.name
      });
    } catch (error) {
      console.error("Error fetching user role:", error);
      res.status(500).json({ message: "Failed to fetch user role" });
    }
  });

  // AI Scheduling routes
  app.post('/api/ai/optimize-job-schedule/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const jobId = parseInt(req.params.jobId);
      const job = await storage.getJob(jobId);
      
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found or access denied" });
      }
      
      const { aiScheduler } = await import('./ai-scheduler');
      const optimization = await aiScheduler.optimizeJobScheduling(jobId);
      
      res.json(optimization);
    } catch (error) {
      console.error("Error optimizing job schedule:", error);
      res.status(500).json({ message: "Failed to optimize job schedule" });
    }
  });

  app.get('/api/ai/resource-allocation', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const { aiScheduler } = await import('./ai-scheduler');
      const allocation = await aiScheduler.generateResourceAllocation(company.id);
      
      res.json(allocation);
    } catch (error) {
      console.error("Error generating resource allocation:", error);
      res.status(500).json({ message: "Failed to generate resource allocation" });
    }
  });

  app.post('/api/ai/predict-timeline/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const jobId = parseInt(req.params.jobId);
      const job = await storage.getJob(jobId);
      
      if (!job || job.companyId !== company.id) {
        return res.status(404).json({ message: "Job not found or access denied" });
      }
      
      const { aiScheduler } = await import('./ai-scheduler');
      const timeline = await aiScheduler.predictProjectTimeline(jobId);
      
      res.json(timeline);
    } catch (error) {
      console.error("Error predicting timeline:", error);
      res.status(500).json({ message: "Failed to predict timeline" });
    }
  });

  // Document routes
  app.get('/api/documents', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const documents = await storage.getDocuments(company.id);
      res.json(documents);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  // Message routes
  app.get('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const messages = await storage.getMessages(company.id);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const company = await storage.getUserCompany(userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const messageData = {
        ...req.body,
        senderId: userId,
        companyId: company.id,
      };
      
      const message = await storage.createMessage(messageData);
      
      // Send real-time notification to recipients
      if (req.body.recipientId && req.body.recipientId !== userId) {
        // Broadcast to WebSocket clients
        broadcastToUser(req.body.recipientId, {
          type: 'new_message',
          data: {
            id: message.id,
            content: message.content,
            senderName: req.user.claims.first_name || 'Someone',
            timestamp: message.createdAt
          }
        });
        
        // Send push notification
        await sendPushNotification(req.body.recipientId, {
          title: 'New Message',
          body: `${req.user.claims.first_name || 'Someone'} sent you a message`,
          icon: '/manifest-icon-192.png',
          badge: '/manifest-icon-192.png',
          tag: 'message',
          data: {
            messageId: message.id,
            url: '/messages'
          }
        });
      }
      
      res.json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(500).json({ message: "Failed to create message" });
    }
  });

  app.patch('/api/messages/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const messageId = parseInt(req.params.id);
      await storage.markMessageAsRead(messageId);
      res.json({ message: "Message marked as read" });
    } catch (error) {
      console.error("Error marking message as read:", error);
      res.status(500).json({ message: "Failed to mark message as read" });
    }
  });

  // Push notification routes
  app.post('/api/notifications/subscribe', isAuthenticated, async (req: any, res) => {
    try {
      const { subscription } = req.body;
      const userId = req.user.claims.sub;
      
      // Store the subscription for this user
      userSubscriptions.set(userId, subscription);
      
      console.log('Push subscription registered for user:', userId);
      console.log('Subscription details:', subscription);
      
      res.json({ success: true, message: "Subscription registered" });
    } catch (error) {
      console.error("Error registering push subscription:", error);
      res.status(500).json({ message: "Failed to register subscription" });
    }
  });

  app.post('/api/notifications/unsubscribe', isAuthenticated, async (req: any, res) => {
    try {
      const { endpoint } = req.body;
      const userId = req.user.claims.sub;
      
      // Remove the subscription for this user
      userSubscriptions.delete(userId);
      
      console.log('Push subscription removed for user:', userId);
      console.log('Endpoint:', endpoint);
      
      res.json({ success: true, message: "Subscription removed" });
    } catch (error) {
      console.error("Error removing push subscription:", error);
      res.status(500).json({ message: "Failed to remove subscription" });
    }
  });

  app.post('/api/notifications/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Send test notification
      await sendPushNotification(userId, {
        title: 'Test Notification',
        body: 'This is a test notification from your app',
        icon: '/manifest-icon-192.png'
      });
      
      console.log('Test notification sent to user:', userId);
      
      res.json({ success: true, message: "Test notification sent" });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });

  const httpServer = createServer(app);
  
  // Setup WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');
    
    let userId: string | null = null;
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'auth' && message.userId) {
          userId = String(message.userId);
          
          // Add this connection to the user's connections
          if (userId && !userConnections.has(userId)) {
            userConnections.set(userId, []);
          }
          if (userId) {
            userConnections.get(userId)!.push(ws);
          }
          
          console.log('WebSocket authenticated for user:', userId);
          
          ws.send(JSON.stringify({ type: 'auth_success' }));
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
    
    ws.on('close', () => {
      if (userId) {
        // Remove this connection from the user's connections
        const connections = userConnections.get(userId) || [];
        const index = connections.indexOf(ws);
        if (index > -1) {
          connections.splice(index, 1);
        }
        
        // Clean up empty connection arrays
        if (connections.length === 0) {
          userConnections.delete(userId);
        }
        
        console.log('WebSocket disconnected for user:', userId);
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return httpServer;
}
