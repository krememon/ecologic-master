import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertCompanySchema, insertClientSchema, insertSubcontractorSchema, insertJobSchema, insertInvoiceSchema, insertMessageSchema } from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Also get user's company
      let company = await storage.getUserCompany(userId);
      
      // If user exists but no company, create a default company
      if (!company) {
        company = await storage.createCompany({
          name: `${user.firstName || 'Your'} ${user.lastName || 'Company'}`,
          primaryColor: '#3B82F6',
          secondaryColor: '#1E40AF',
          ownerId: userId
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
            rating: 4.8,
            isAvailable: true,
            hourlyRate: 85,
            notes: "Specialist in eco-friendly water systems and conservation"
          });

          await storage.createSubcontractor({
            companyId: company.id,
            name: "Sarah Chen",
            email: "sarah@greenwiring.com",
            phone: "(555) 345-6789", 
            skills: ["Electrical", "Solar Installation", "Smart Systems", "Energy Efficiency"],
            rating: 4.9,
            isAvailable: true,
            hourlyRate: 95,
            notes: "Expert in renewable energy and smart building systems"
          });

          await storage.createSubcontractor({
            companyId: company.id,
            name: "Carlos Rodriguez",
            email: "carlos@ecobuild.com",
            phone: "(555) 456-7890",
            skills: ["HVAC", "Air Quality", "Ventilation", "Climate Control"],
            rating: 4.7,
            isAvailable: false,
            hourlyRate: 90,
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
            estimatedCost: 75000,
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
            estimatedCost: 120000,
            actualCost: 85000,
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
            estimatedCost: 35000,
            location: "Green Valley, CA",
            notes: "Drought-resistant landscaping with automated irrigation controls"
          });
        } catch (error) {
          console.log("Sample data creation failed (may already exist):", error.message);
        }
      }
      
      res.json({ ...user, company });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Company routes
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
      
      const subcontractorData = insertSubcontractorSchema.parse({
        ...req.body,
        companyId: company.id,
      });
      
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
      const subcontractorData = insertSubcontractorSchema.partial().parse(req.body);
      
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
      console.error("Error stack:", error.stack);
      res.status(500).json({ message: "Failed to create job", error: error.message });
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
      
      const stats = await storage.getDashboardStats(company.id);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
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
          userId = message.userId;
          
          // Add this connection to the user's connections
          if (!userConnections.has(userId)) {
            userConnections.set(userId, []);
          }
          userConnections.get(userId)!.push(ws);
          
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
