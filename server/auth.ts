import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
// Facebook and Microsoft strategies disabled - not configured
// import { Strategy as FacebookStrategy } from "passport-facebook";
// import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import connectPg from "connect-pg-simple";

// SECURITY: Rate limiters for auth endpoints to prevent brute force attacks
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { message: "Too many login attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registration attempts per hour
  message: { message: "Too many registration attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset requests per hour
  message: { message: "Too many password reset attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

// Log RESEND_FROM at startup
if (process.env.RESEND_FROM) {
  console.log("[email] Using RESEND_FROM =", process.env.RESEND_FROM);
} else {
  console.warn("[email] WARNING: RESEND_FROM is not set - email sending will fail");
}

function getResendFrom(): string {
  const from = process.env.RESEND_FROM;
  if (!from) {
    throw new Error("RESEND_FROM environment variable is not configured");
  }
  return from;
}

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

function generateToken() {
  return randomBytes(32).toString("hex");
}

// Email service setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendVerificationEmail(email: string, token: string) {
  if (!process.env.SMTP_USER) return; // Skip if no email configured
  
  const verificationUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/api/verify-email?token=${token}`;
  
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Verify your EcoLogic account",
    html: `
      <h2>Welcome to EcoLogic!</h2>
      <p>Please click the link below to verify your email address:</p>
      <a href="${verificationUrl}">Verify Email</a>
      <p>If you didn't create this account, please ignore this email.</p>
    `,
  });
}

async function sendPasswordResetEmail(email: string, token: string) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn("[password-reset] RESEND_API_KEY not configured, skipping email");
    return;
  }
  
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5000';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  
  console.log("[password-reset] APP_BASE_URL:", baseUrl);
  console.log("[password-reset] Reset URL:", resetUrl);
  
  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey);
  
  const { error } = await resend.emails.send({
    from: getResendFrom(),
    to: email,
    subject: "Reset your EcoLogic password",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: #1f2937;">Reset Your Password</h2>
        <p style="margin: 0 0 24px; color: #666; font-size: 16px;">You requested to reset your password. Click the button below to set a new password:</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #059669 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Reset Password</a>
        </div>
        <p style="margin: 0 0 16px; color: #666; font-size: 14px;">Or copy and paste this link:</p>
        <p style="margin: 0 0 24px; word-break: break-all; font-size: 12px; color: #999;">${resetUrl}</p>
        <p style="margin: 0; color: #999; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
  
  if (error) {
    console.error("[password-reset] Resend API error:", error);
    throw new Error("Failed to send password reset email");
  }
  
  console.log("[password-reset] Email sent successfully to:", email);
}

// Send signature request email to customer
export async function sendSignatureRequestEmail(
  customerEmail: string,
  customerName: string,
  documentName: string,
  companyName: string,
  accessToken: string,
  message?: string | null
): Promise<boolean> {
  if (!process.env.SMTP_USER) {
    console.log('[email] SMTP not configured, skipping signature request email');
    return true; // Return true to allow the flow to continue in dev
  }
  
  const signUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/sign/${accessToken}`;
  
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: customerEmail,
      subject: `Please sign: ${documentName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #f8fafc; border-radius: 8px; padding: 32px; text-align: center;">
            <h2 style="color: #1e293b; margin-bottom: 16px;">Signature Request</h2>
            <p style="color: #64748b; margin-bottom: 8px;">Hello ${customerName},</p>
            <p style="color: #475569; margin-bottom: 24px;">
              <strong>${companyName}</strong> has requested your signature on the following document:
            </p>
            <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
              <p style="color: #1e293b; font-weight: 600; margin: 0;">${documentName}</p>
            </div>
            ${message ? `
            <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 24px; border: 1px solid #e2e8f0; text-align: left;">
              <p style="color: #64748b; font-size: 12px; margin: 0 0 8px 0;">Message:</p>
              <p style="color: #475569; margin: 0; white-space: pre-wrap;">${message}</p>
            </div>
            ` : ''}
            <a href="${signUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
              Review & Sign Document
            </a>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
              If you have questions, please contact ${companyName} directly.
            </p>
          </div>
        </body>
        </html>
      `,
    });
    console.log(`[email] Signature request email sent to ${customerEmail}`);
    return true;
  } catch (error) {
    console.error('[email] Failed to send signature request email:', error);
    return false;
  }
}

export function setupAuth(app: Express) {
  // Session configuration
  const PostgresSessionStore = connectPg(session);
  const sessionStore = new PostgresSessionStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: 7 * 24 * 60 * 60 * 1000, // 1 week
  });

  // Replit.dev uses HTTPS even in development, so secure must be true
  const isSecure = process.env.NODE_ENV === "production" || 
                   process.env.REPLIT_DEV_DOMAIN !== undefined ||
                   (process.env.REPL_SLUG !== undefined);
  
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'none' : 'lax', // 'none' required for cross-site cookies with secure
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
      path: '/',
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Local Strategy (Email/Password)
  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user || !user.password || !(await comparePasswords(password, user.password))) {
            return done(null, false, { message: "Invalid email or password" });
          }
          
          if (!user.emailVerified) {
            return done(null, false, { message: "Please verify your email before logging in" });
          }
          
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // Google Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: "/api/auth/google/callback",
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const googleId = profile.id;
            const email = profile.emails?.[0]?.value?.toLowerCase().trim();
            
            // Guard: Google must provide an email
            if (!email) {
              console.error("[google-auth] Google profile has no email");
              return done(null, false, { message: "Google account has no email" });
            }
            
            // Step 1: Try to find user by googleId
            let user = await storage.getUserByGoogleId(googleId);
            
            if (user) {
              // User already linked to this Google account
              console.log("[google-auth] Found user by googleId:", user.id);
              return done(null, user);
            }
            
            // Step 2: Try to find user by email
            user = await storage.getUserByEmail(email);
            
            if (user) {
              // Link Google account to existing user
              console.log("[google-auth] Linking googleId to existing user:", user.id);
              await storage.updateUser(user.id, {
                googleId,
                googleLinked: true,
              });
              // Refetch to get updated user
              user = await storage.getUser(user.id);
              return done(null, user!);
            }
            
            // Step 3: Create new user
            console.log("[google-auth] Creating new user for email:", email);
            user = await storage.createUser({
              email,
              firstName: profile.name?.givenName || "",
              lastName: profile.name?.familyName || "",
              profileImageUrl: profile.photos?.[0]?.value || "",
              googleId,
              googleLinked: true,
              emailVerified: true, // Google emails are pre-verified
            });
            
            return done(null, user);
          } catch (error) {
            console.error("[google-auth] Error:", error);
            return done(error);
          }
        }
      )
    );
  }

  // Facebook Strategy (disabled - not configured)
  // TODO: Implement facebookId column if Facebook OAuth is needed
  
  // Microsoft Strategy (disabled - not configured)
  // TODO: Implement microsoftId column if Microsoft OAuth is needed

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Auth Routes
  
  // Email/Password Registration (rate limited to prevent abuse)
  app.post("/api/register", registerRateLimiter, async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists with this email" });
      }
      
      const verificationToken = generateToken();
      const hashedPassword = await hashPassword(password);
      
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName: firstName || "",
        lastName: lastName || "",
        emailVerificationToken: verificationToken,
        emailVerified: false,
        provider: "email",
      });
      
      // Send verification email
      try {
        await sendVerificationEmail(email, verificationToken);
      } catch (error) {
        console.error("Failed to send verification email:", error);
      }
      
      res.status(201).json({
        message: "Registration successful. Please check your email to verify your account.",
        user: { id: user.id, email: user.email, emailVerified: user.emailVerified },
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // ============================================
  // NEW MULTI-STEP SIGNUP FLOW
  // ============================================

  // Rate limiter for signup code requests
  const signupCodeRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 3, // 3 code requests per minute per IP
    message: { message: "Too many code requests. Please wait a moment." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Step 1: Start signup - send verification code
  app.post("/api/auth/signup/start", signupCodeRateLimiter, async (req, res) => {
    try {
      const { firstName, lastName, email } = req.body;
      
      if (!firstName || !lastName || !email) {
        return res.status(400).json({ message: "First name, last name, and email are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({ message: "An account with this email already exists. Please log in instead." });
      }

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await hashPassword(code);
      const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      console.log("[signup-code] Generated 6-digit code for email:", normalizedEmail);

      // Create or update pending signup
      await storage.createOrUpdatePendingSignup({
        email: normalizedEmail,
        firstName,
        lastName,
        verificationCodeHash: codeHash,
        codeExpiresAt,
      });

      // Check email provider configuration
      if (!process.env.RESEND_API_KEY) {
        console.error("[signup-code] RESEND_API_KEY not configured");
        return res.status(500).json({ message: "Email provider not configured." });
      }

      // Send verification code email via Resend
      console.log("[signup-code] Attempting to send email to:", normalizedEmail);
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        const { error } = await resend.emails.send({
          from: getResendFrom(),
          to: normalizedEmail,
          subject: "Your EcoLogic Verification Code",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h2 style="margin: 0 0 24px; font-size: 24px; font-weight: 600;">Verify your email</h2>
              <p style="margin: 0 0 24px; color: #666; font-size: 16px;">Hi ${firstName}, use this code to verify your email address:</p>
              <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: monospace;">${code}</span>
              </div>
              <p style="margin: 0; color: #999; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
            </div>
          `,
        });
        
        if (error) {
          console.error("[signup-code] Resend API returned error:", error);
          return res.status(500).json({ message: "Failed to send verification email" });
        }
        
        console.log("[signup-code] Email sent successfully to:", normalizedEmail);
      } catch (emailError) {
        console.error("[signup-code] Email send failed:", emailError);
        return res.status(500).json({ message: "Failed to send verification email" });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Signup start error:", error);
      res.status(500).json({ message: "Failed to start signup. Please try again." });
    }
  });

  // Step 2: Verify email code
  app.post("/api/auth/signup/verify-email", async (req, res) => {
    try {
      const { email, code } = req.body;
      
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const pendingSignup = await storage.getPendingSignupByEmail(normalizedEmail);

      if (!pendingSignup) {
        return res.status(400).json({ message: "No pending signup found. Please start over." });
      }

      // DEV BYPASS: Accept "000000" in development with BYPASS_EMAIL_CODE=true
      const devBypassEnabled = process.env.NODE_ENV === "development" && process.env.BYPASS_EMAIL_CODE === "true";
      const isDevBypass = devBypassEnabled && code === "000000";
      
      if (isDevBypass) {
        console.log("[auth] DEV BYPASS enabled for email code verification - signup");
      }

      if (!isDevBypass) {
        // Check if code expired
        if (new Date() > pendingSignup.codeExpiresAt) {
          return res.status(400).json({ message: "Code expired. Please request a new one." });
        }

        // Check max attempts (5 attempts allowed)
        if ((pendingSignup.codeAttempts || 0) >= 5) {
          return res.status(400).json({ message: "Too many failed attempts. Please request a new code." });
        }

        // Verify code
        const isValid = await comparePasswords(code, pendingSignup.verificationCodeHash);
        if (!isValid) {
          await storage.incrementPendingSignupAttempts(normalizedEmail);
          return res.status(400).json({ message: "Invalid code. Please try again." });
        }
      }

      // Mark as verified
      await storage.markPendingSignupVerified(normalizedEmail);

      res.json({ ok: true });
    } catch (error) {
      console.error("Verify email error:", error);
      res.status(500).json({ message: "Verification failed. Please try again." });
    }
  });

  // Step 3: Set password and create account
  app.post("/api/auth/signup/set-password", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const pendingSignup = await storage.getPendingSignupByEmail(normalizedEmail);

      if (!pendingSignup) {
        return res.status(400).json({ message: "No pending signup found. Please start over." });
      }

      if (!pendingSignup.emailVerified) {
        return res.status(400).json({ message: "Email not verified. Please verify your email first." });
      }

      // Check if user already exists (race condition protection)
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        await storage.deletePendingSignup(normalizedEmail);
        return res.status(400).json({ message: "Account already exists. Please log in." });
      }

      // Create user account
      const hashedPassword = await hashPassword(password);
      const userId = `email_${Date.now()}_${randomBytes(4).toString("hex")}`;

      const user = await storage.createUser({
        id: userId,
        email: normalizedEmail,
        password: hashedPassword,
        firstName: pendingSignup.firstName,
        lastName: pendingSignup.lastName,
        emailVerified: true,
        provider: "email",
      });

      // Clean up pending signup
      await storage.deletePendingSignup(normalizedEmail);

      // Log the user in
      req.login(user, (err) => {
        if (err) {
          console.error("Login after signup error:", err);
          return res.status(500).json({ message: "Account created but login failed. Please log in manually." });
        }
        
        // Save session before responding to ensure cookie is set
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error after signup:", saveErr);
            return res.status(500).json({ message: "Account created but session failed. Please log in manually." });
          }
          
          console.log("[set-password] User logged in successfully:", user.id);
          res.json({ 
            ok: true, 
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            }
          });
        });
      });
    } catch (error) {
      console.error("Set password error:", error);
      res.status(500).json({ message: "Failed to create account. Please try again." });
    }
  });

  // Resend verification code
  app.post("/api/auth/signup/resend-code", signupCodeRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const pendingSignup = await storage.getPendingSignupByEmail(normalizedEmail);

      if (!pendingSignup) {
        return res.status(400).json({ message: "No pending signup found. Please start over." });
      }

      // Check cooldown (30 seconds)
      if (pendingSignup.lastCodeSentAt) {
        const timeSinceLastCode = Date.now() - new Date(pendingSignup.lastCodeSentAt).getTime();
        if (timeSinceLastCode < 30000) {
          const waitSeconds = Math.ceil((30000 - timeSinceLastCode) / 1000);
          return res.status(400).json({ message: `Please wait ${waitSeconds} seconds before requesting a new code.` });
        }
      }

      // Generate new code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await hashPassword(code);
      const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      console.log("[signup-resend] Generated new 6-digit code for email:", normalizedEmail);

      await storage.createOrUpdatePendingSignup({
        email: normalizedEmail,
        firstName: pendingSignup.firstName,
        lastName: pendingSignup.lastName,
        verificationCodeHash: codeHash,
        codeExpiresAt,
      });

      // Check email provider configuration
      if (!process.env.RESEND_API_KEY) {
        console.error("[signup-resend] RESEND_API_KEY not configured");
        return res.status(500).json({ message: "Email provider not configured." });
      }

      // Send email
      console.log("[signup-resend] Attempting to send email to:", normalizedEmail);
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        const { error } = await resend.emails.send({
          from: getResendFrom(),
          to: normalizedEmail,
          subject: "Your New EcoLogic Verification Code",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h2 style="margin: 0 0 24px; font-size: 24px; font-weight: 600;">New verification code</h2>
              <p style="margin: 0 0 24px; color: #666; font-size: 16px;">Here's your new code:</p>
              <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: monospace;">${code}</span>
              </div>
              <p style="margin: 0; color: #999; font-size: 14px;">This code expires in 10 minutes.</p>
            </div>
          `,
        });
        
        if (error) {
          console.error("[signup-resend] Resend API returned error:", error);
          return res.status(500).json({ message: "Failed to send verification email" });
        }
        
        console.log("[signup-resend] Email sent successfully to:", normalizedEmail);
      } catch (emailError) {
        console.error("[signup-resend] Email send failed:", emailError);
        return res.status(500).json({ message: "Failed to send verification email" });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Resend code error:", error);
      res.status(500).json({ message: "Failed to resend code. Please try again." });
    }
  });

  // Login Step 1: Start login - check if user exists
  app.post("/api/auth/login/start", authRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(normalizedEmail);
      
      if (!user) {
        return res.status(400).json({ message: "No account found with this email." });
      }

      if (!user.password) {
        return res.status(400).json({ message: "Please sign in with Google or your original sign-in method." });
      }

      // Create login challenge (expires in 15 minutes)
      await storage.createLoginChallenge({
        email: normalizedEmail,
        userId: user.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      res.json({ ok: true, firstName: user.firstName });
    } catch (error) {
      console.error("Login start error:", error);
      res.status(500).json({ message: "Unable to start sign in. Please try again." });
    }
  });

  // Login Step 2: Verify password and send code
  app.post("/api/auth/login/password", authRateLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      
      // Check for valid login challenge
      const challenge = await storage.getLoginChallenge(normalizedEmail);
      if (!challenge || new Date() > challenge.expiresAt) {
        return res.status(400).json({ message: "Session expired. Please start over." });
      }

      // Get user and verify password
      const user = await storage.getUserByEmail(normalizedEmail);
      if (!user || !user.password) {
        return res.status(400).json({ message: "Invalid credentials." });
      }

      const isValid = await comparePasswords(password, user.password);
      if (!isValid) {
        return res.status(400).json({ message: "Incorrect password." });
      }

      // Generate 6-digit MFA code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await hashPassword(code);
      const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      console.log("[login-code] Generated 6-digit code for email:", normalizedEmail);

      // Update challenge with password verified and code
      await storage.updateLoginChallenge(normalizedEmail, {
        passwordVerified: true,
        verificationCodeHash: codeHash,
        codeExpiresAt,
        lastCodeSentAt: new Date(),
        codeAttempts: 0,
      });

      // Check email provider configuration
      if (!process.env.RESEND_API_KEY) {
        console.error("[login-code] RESEND_API_KEY not configured");
        return res.status(500).json({ message: "Email provider not configured." });
      }

      // Send verification code email
      console.log("[login-code] Attempting to send email to:", normalizedEmail);
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        const { error } = await resend.emails.send({
          from: getResendFrom(),
          to: normalizedEmail,
          subject: "Your EcoLogic Sign-In Code",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h2 style="margin: 0 0 24px; font-size: 24px; font-weight: 600;">Sign-in verification</h2>
              <p style="margin: 0 0 24px; color: #666; font-size: 16px;">Enter this code to complete your sign-in:</p>
              <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: monospace;">${code}</span>
              </div>
              <p style="margin: 0; color: #999; font-size: 14px;">This code expires in 10 minutes. If you didn't try to sign in, please secure your account.</p>
            </div>
          `,
        });
        
        if (error) {
          console.error("[login-code] Resend API returned error:", error);
          return res.status(500).json({ message: "Failed to send verification email" });
        }
        
        console.log("[login-code] Email sent successfully to:", normalizedEmail);
      } catch (emailError) {
        console.error("[login-code] Email send failed:", emailError);
        return res.status(500).json({ message: "Failed to send verification email" });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Login password error:", error);
      res.status(500).json({ message: "Unable to verify password. Please try again." });
    }
  });

  // Login Step 3: Verify code and complete login
  app.post("/api/auth/login/verify-code", async (req, res) => {
    try {
      const { email, code } = req.body;
      
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const challenge = await storage.getLoginChallenge(normalizedEmail);

      if (!challenge) {
        return res.status(400).json({ message: "Session expired. Please start over." });
      }

      if (!challenge.passwordVerified) {
        return res.status(400).json({ message: "Please verify your password first." });
      }

      // DEV BYPASS: Accept "000000" in development with BYPASS_EMAIL_CODE=true
      const devBypassEnabled = process.env.NODE_ENV === "development" && process.env.BYPASS_EMAIL_CODE === "true";
      const isDevBypass = devBypassEnabled && code === "000000";
      
      if (isDevBypass) {
        console.log("[auth] DEV BYPASS enabled for email code verification - login");
      }

      if (!isDevBypass) {
        if (!challenge.verificationCodeHash || !challenge.codeExpiresAt) {
          return res.status(400).json({ message: "No verification code sent. Please try again." });
        }

        if (new Date() > challenge.codeExpiresAt) {
          return res.status(400).json({ message: "Code expired. Please request a new one." });
        }

        if ((challenge.codeAttempts || 0) >= 5) {
          return res.status(400).json({ message: "Too many failed attempts. Please request a new code." });
        }

        const isValid = await comparePasswords(code, challenge.verificationCodeHash);
        if (!isValid) {
          await storage.incrementLoginChallengeAttempts(normalizedEmail);
          return res.status(400).json({ message: "Invalid code. Please try again." });
        }
      }

      // Code is valid - log the user in
      const user = await storage.getUserByEmail(normalizedEmail);
      console.log("[auth] verify-code: found user:", user?.id, user?.email);
      if (!user) {
        return res.status(400).json({ message: "User not found." });
      }

      // Clean up the challenge
      await storage.deleteLoginChallenge(normalizedEmail);

      console.log("[auth] verify-code: calling req.login for user:", user.id);
      
      // Log in the user using passport
      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error("[auth] verify-code: req.login error:", loginErr);
          return res.status(500).json({ message: "Unable to complete sign in." });
        }
        
        console.log("[auth] verify-code: req.login success, session ID:", req.sessionID);
        console.log("[auth] verify-code: req.user after login:", req.user?.id);
        
        // Explicitly save session before responding
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("[auth] verify-code: session.save error:", saveErr);
            return res.status(500).json({ message: "Unable to complete sign in." });
          }
          
          console.log("[auth] verify-code: session saved successfully for user:", user.email);
          return res.json({
            ok: true,
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            },
          });
        });
      });
    } catch (error) {
      console.error("Login verify code error:", error);
      res.status(500).json({ message: "Verification failed. Please try again." });
    }
  });

  // Login: Resend code
  app.post("/api/auth/login/resend-code", authRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      console.log("[login-code] resend requested email=" + normalizedEmail);
      
      const challenge = await storage.getLoginChallenge(normalizedEmail);

      if (!challenge || !challenge.passwordVerified) {
        return res.status(400).json({ message: "Please verify your password first." });
      }

      // Check cooldown (30 seconds)
      if (challenge.lastCodeSentAt) {
        const timeSinceLastCode = Date.now() - new Date(challenge.lastCodeSentAt).getTime();
        if (timeSinceLastCode < 30000) {
          const waitSeconds = Math.ceil((30000 - timeSinceLastCode) / 1000);
          return res.status(400).json({ message: `Please wait ${waitSeconds} seconds.` });
        }
      }

      // Generate new code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await hashPassword(code);
      const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      console.log("[login-resend] Generated new 6-digit code for email:", normalizedEmail);

      await storage.updateLoginChallenge(normalizedEmail, {
        verificationCodeHash: codeHash,
        codeExpiresAt,
        lastCodeSentAt: new Date(),
        codeAttempts: 0,
      });

      // Check email provider configuration
      if (!process.env.RESEND_API_KEY) {
        console.error("[login-resend] RESEND_API_KEY not configured");
        return res.status(500).json({ message: "Email provider not configured." });
      }

      // Send new code email
      console.log("[login-resend] Attempting to send email to:", normalizedEmail);
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        const { error } = await resend.emails.send({
          from: getResendFrom(),
          to: normalizedEmail,
          subject: "Your New EcoLogic Sign-In Code",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h2 style="margin: 0 0 24px; font-size: 24px; font-weight: 600;">New sign-in code</h2>
              <p style="margin: 0 0 24px; color: #666; font-size: 16px;">Here's your new code:</p>
              <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: monospace;">${code}</span>
              </div>
              <p style="margin: 0; color: #999; font-size: 14px;">This code expires in 10 minutes.</p>
            </div>
          `,
        });
        
        if (error) {
          console.error("[login-resend] Resend API returned error:", error);
          return res.status(500).json({ message: "Failed to send verification email" });
        }
        
        console.log("[login-resend] Email sent successfully to:", normalizedEmail);
      } catch (emailError) {
        console.error("[login-resend] Email send failed:", emailError);
        return res.status(500).json({ message: "Failed to send verification email" });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Resend login code error:", error);
      res.status(500).json({ message: "Unable to resend code. Please try again." });
    }
  });

  // Legacy Email/Password Login (keeping for backward compatibility)
  app.post("/api/login", authRateLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Login failed" });
      }
      
      req.login(user, (err) => {
        if (err) return next(err);
        res.json({
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
          },
        });
      });
    })(req, res, next);
  });

  // Social Auth Routes
  app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  app.get("/api/auth/google/callback", passport.authenticate("google", { successRedirect: "/", failureRedirect: "/auth" }));

  app.get("/api/auth/facebook", passport.authenticate("facebook", { scope: ["email"] }));
  app.get("/api/auth/facebook/callback", passport.authenticate("facebook", { successRedirect: "/", failureRedirect: "/auth" }));

  app.get("/api/auth/microsoft", passport.authenticate("microsoft"));
  app.get("/api/auth/microsoft/callback", passport.authenticate("microsoft", { successRedirect: "/", failureRedirect: "/auth" }));

  // Email Verification
  app.get("/api/verify-email", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) {
        return res.status(400).json({ message: "Verification token is required" });
      }
      
      const user = await storage.verifyEmail(token as string);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired verification token" });
      }
      
      res.redirect("/?verified=true");
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({ message: "Email verification failed" });
    }
  });

  // Authenticated Password Reset Request (for logged-in users via Settings)
  app.post("/api/auth/request-password-reset", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const email = req.user.email?.toLowerCase().trim();
      if (!email) {
        return res.status(400).json({ message: "No email associated with account" });
      }
      
      const resetToken = generateToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      
      await storage.setResetPasswordToken(email, resetToken, expires);
      
      try {
        await sendPasswordResetEmail(email, resetToken);
      } catch (error) {
        console.error("[auth-password-reset] Failed to send reset email:", error);
        return res.status(500).json({ message: "Failed to send reset email" });
      }
      
      // Always return success to prevent email enumeration
      res.json({ ok: true });
    } catch (error) {
      console.error("[auth-password-reset] Error:", error);
      res.status(500).json({ message: "Password reset request failed" });
    }
  });

  // Password Reset Request (rate limited to prevent abuse)
  app.post("/api/forgot-password", passwordResetRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Don't reveal if email exists
        return res.json({ message: "If an account with that email exists, we've sent a password reset link." });
      }
      
      const resetToken = generateToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      
      await storage.setResetPasswordToken(email, resetToken, expires);
      
      try {
        await sendPasswordResetEmail(email, resetToken);
      } catch (error) {
        console.error("Failed to send reset email:", error);
      }
      
      res.json({ message: "If an account with that email exists, we've sent a password reset link." });
    } catch (error) {
      console.error("Password reset request error:", error);
      res.status(500).json({ message: "Password reset request failed" });
    }
  });

  // Password Reset (rate limited to prevent abuse)
  app.post("/api/reset-password", passwordResetRateLimiter, async (req, res) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ message: "Token and new password are required" });
      }
      
      const hashedPassword = await hashPassword(password);
      const user = await storage.resetPassword(token, hashedPassword);
      
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      
      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Password reset failed" });
    }
  });

  // Get Current User
  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    res.json({
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      profileImageUrl: req.user.profileImageUrl,
      emailVerified: req.user.emailVerified,
    });
  });

  // Logout
  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logout successful" });
    });
  });
}