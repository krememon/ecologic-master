import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./new-storage";
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
import Stripe from "stripe";

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required Stripe secret: STRIPE_SECRET_KEY');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-05-28.basil",
});

// Subscription plans configuration
const SUBSCRIPTION_PLANS = {
  starter: {
    name: 'Starter',
    maxUsers: 3,
    monthlyPrice: 29,
    features: ['Basic job management', 'Client communication', 'Up to 3 team members']
  },
  professional: {
    name: 'Professional', 
    maxUsers: 10,
    monthlyPrice: 79,
    features: ['Advanced scheduling', 'AI optimization', 'Up to 10 team members', 'Document management']
  },
  enterprise: {
    name: 'Enterprise',
    maxUsers: 50,
    monthlyPrice: 199,
    features: ['Unlimited features', 'Up to 50 team members', 'Priority support', 'Custom integrations']
  }
};

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

function broadcastToUser(userId: string, message: any) {
  // WebSocket broadcasting implementation
}

async function sendPushNotification(userId: string, notification: any) {
  // Push notification implementation
}

// Subscription access control middleware
async function requireActiveSubscription(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = getUserId(req.user);
  const company = await storage.getUserCompany(parseInt(userId));
  
  if (!company) {
    return res.status(403).json({ 
      message: "No company found",
      requiresSubscription: true,
      redirectTo: "/choose-plan"
    });
  }

  // Check if subscription is active
  const hasActiveSubscription = company.subscriptionStatus === 'active' || 
                                company.subscriptionStatus === 'trialing';
  
  // Check if trial is still valid
  const isValidTrial = company.trialEndsAt && new Date() < company.trialEndsAt;
  
  if (!hasActiveSubscription && !isValidTrial) {
    return res.status(403).json({ 
      message: "Active subscription required",
      requiresSubscription: true,
      redirectTo: "/choose-plan",
      subscriptionStatus: company.subscriptionStatus
    });
  }

  // Add company data to request for use in routes
  req.company = company;
  next();
}

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
      let company = await storage.getUserCompany(parseInt(user.id));
      
      // If no company exists, create a default one for business owners
      if (!company) {
        // Check if this is a business owner registration
        const isBusinessOwner = true; // Default to business owner for new users
        
        if (isBusinessOwner) {
          company = await storage.createCompany({
            name: "Your Company",
            logo: null,
            primaryColor: "#3B82F6",
            secondaryColor: "#1E40AF",
            ownerId: user.id
          });
        }
      }

      const responseData = {
        ...user,
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
      await storage.updateUser(parseInt(user.id), { password: hashedPassword });

      res.json({ message: "Password set successfully" });
    } catch (error) {
      console.error("Error setting password:", error);
      res.status(500).json({ message: "Failed to set password" });
    }
  });

  // Company routes
  app.get('/api/company', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      let company = await storage.getUserCompany(parseInt(user.claims.sub));
      
      // Add invite code for business owners
      if (company) {
        const isOwner = await storage.isBusinessOwner(user.claims.sub, company.id);
        const responseData = {
          ...company,
          inviteCode: isOwner ? company.id.toString() : undefined
        };
        res.json(responseData);
      } else {
        res.status(404).json({ message: "No company found" });
      }
    } catch (error) {
      console.error("Error fetching company:", error);
      res.status(500).json({ message: "Failed to fetch company" });
    }
  });

  app.post('/api/companies', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      const { name, logo, primaryColor, secondaryColor } = req.body;
      
      const company = await storage.createCompany({
        name,
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

  // Subscription Routes
  
  // Get available subscription plans
  app.get('/api/subscription/plans', async (req, res) => {
    try {
      res.json(SUBSCRIPTION_PLANS);
    } catch (error) {
      console.error("Error fetching subscription plans:", error);
      res.status(500).json({ message: "Failed to fetch plans" });
    }
  });

  // Get current subscription status
  app.get('/api/subscription/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(parseInt(userId));
      
      if (!company) {
        return res.json({ 
          hasCompany: false,
          requiresSubscription: true,
          redirectTo: "/choose-plan"
        });
      }

      const hasActiveSubscription = company.subscriptionStatus === 'active' || 
                                   company.subscriptionStatus === 'trialing';
      const isValidTrial = company.trialEndsAt && new Date() < company.trialEndsAt;

      res.json({
        hasCompany: true,
        subscriptionStatus: company.subscriptionStatus,
        subscriptionPlan: company.subscriptionPlan,
        maxUsers: company.maxUsers,
        hasActiveSubscription: hasActiveSubscription || isValidTrial,
        trialEndsAt: company.trialEndsAt,
        requiresSubscription: !hasActiveSubscription && !isValidTrial,
        redirectTo: !hasActiveSubscription && !isValidTrial ? "/choose-plan" : null
      });
    } catch (error) {
      console.error("Error fetching subscription status:", error);
      res.status(500).json({ message: "Failed to fetch subscription status" });
    }
  });

  // Create subscription with 7-day free trial
  app.post('/api/subscription/create', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { plan } = req.body;

      if (!SUBSCRIPTION_PLANS[plan as keyof typeof SUBSCRIPTION_PLANS]) {
        return res.status(400).json({ message: "Invalid subscription plan" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let company = await storage.getUserCompany(parseInt(userId));
      if (!company) {
        // Create company if it doesn't exist
        company = await storage.createCompany({
          name: "My Company",
          ownerId: user.id
        });
      }

      // Create or get Stripe customer
      let stripeCustomerId = user.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        });
        stripeCustomerId = customer.id;
        await storage.updateUser(parseInt(user.id), { stripeCustomerId });
      }

      const planConfig = SUBSCRIPTION_PLANS[plan as keyof typeof SUBSCRIPTION_PLANS];

      // Create price in Stripe if it doesn't exist
      const price = await stripe.prices.create({
        currency: 'usd',
        unit_amount: planConfig.monthlyPrice * 100, // Convert to cents
        recurring: { interval: 'month' },
        product_data: {
          name: `EcoLogic ${planConfig.name} Plan`,
        },
      });

      // Create subscription with 7-day free trial
      const subscription = await stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [{ price: price.id }],
        trial_period_days: 7,
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      });

      // Update company with subscription details
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);

      await storage.updateCompany(company.id, {
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: 'trialing',
        subscriptionPlan: plan,
        maxUsers: planConfig.maxUsers,
        trialEndsAt: trialEnd
      });

      const latestInvoice = subscription.latest_invoice;
      const clientSecret = latestInvoice && typeof latestInvoice === 'object' && latestInvoice.payment_intent && typeof latestInvoice.payment_intent === 'object' 
        ? latestInvoice.payment_intent.client_secret 
        : null;

      res.json({
        subscriptionId: subscription.id,
        clientSecret,
        trialEndsAt: trialEnd,
        status: subscription.status
      });
    } catch (error) {
      console.error("Error creating subscription:", error);
      res.status(500).json({ message: "Failed to create subscription" });
    }
  });

  // Update payment method
  app.post('/api/subscription/update-payment-method', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { paymentMethodId } = req.body;

      const user = await storage.getUser(userId);
      if (!user || !user.stripeCustomerId) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Attach payment method to customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: user.stripeCustomerId,
      });

      // Set as default payment method
      await stripe.customers.update(user.stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      res.json({ message: "Payment method updated successfully" });
    } catch (error) {
      console.error("Error updating payment method:", error);
      res.status(500).json({ message: "Failed to update payment method" });
    }
  });

  // Cancel subscription
  app.post('/api/subscription/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(parseInt(userId));
      
      if (!company || !company.stripeSubscriptionId) {
        return res.status(404).json({ message: "No active subscription found" });
      }

      // Check if user is company owner
      if (company.ownerId !== userId) {
        return res.status(403).json({ message: "Only the account owner can cancel subscription" });
      }

      // Cancel subscription at period end
      await stripe.subscriptions.update(company.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      res.json({ message: "Subscription will be canceled at the end of the current period" });
    } catch (error) {
      console.error("Error canceling subscription:", error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  // Reactivate canceled subscription
  app.post('/api/subscription/reactivate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(parseInt(userId));
      
      if (!company || !company.stripeSubscriptionId) {
        return res.status(404).json({ message: "No subscription found" });
      }

      // Check if user is company owner
      if (company.ownerId !== userId) {
        return res.status(403).json({ message: "Only the account owner can reactivate subscription" });
      }

      await stripe.subscriptions.update(company.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      res.json({ message: "Subscription reactivated successfully" });
    } catch (error) {
      console.error("Error reactivating subscription:", error);
      res.status(500).json({ message: "Failed to reactivate subscription" });
    }
  });

  // Client routes
  app.get('/api/clients', requireActiveSubscription, async (req: any, res) => {
    try {
      
      const user = req.user;
      const company = await storage.getUserCompany(parseInt(user.claims.sub));
      
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
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      const company = await storage.getUserCompany(parseInt(user.claims.sub));
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const client = await storage.createClient({
        ...req.body,
        companyId: company.id
      });
      
      res.status(201).json(client);
    } catch (error) {
      console.error("Error creating client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.patch('/api/clients/:id', async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = req.user;
      const company = await storage.getUserCompany(parseInt(user.claims.sub));
      
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
      const company = await storage.getUserCompany(parseInt(user.claims.sub));
      
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
      const company = await storage.getUserCompany(parseInt(userId));
      
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
      const company = await storage.getUserCompany(parseInt(userId));
      
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
      const company = await storage.getUserCompany(parseInt(userId));
      
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
      const company = await storage.getUserCompany(parseInt(userId));
      
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

  app.post('/api/jobs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(parseInt(userId));
      
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      
      const job = await storage.createJob({
        ...req.body,
        companyId: company.id
      });
      
      res.status(201).json(job);
    } catch (error) {
      console.error("Error creating job:", error);
      res.status(500).json({ message: "Failed to create job" });
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
        title: req.body.title || null,
        description: req.body.description || null,
        photoUrl: `/uploads/${fileName}`,
        location: req.body.location || null,
        phase: req.body.phase || null,
        weather: req.body.weather || null,
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

  // Payments routes
  app.get('/api/payments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const company = await storage.getUserCompany(parseInt(userId));
      
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
      const company = await storage.getUserCompany(parseInt(userId));
      
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
        const company = await storage.getUserCompany(parseInt(userId));
        
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

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received message:', message);
        
        // Echo the message back for now
        ws.send(JSON.stringify({ type: 'echo', data: message }));
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return httpServer;
}