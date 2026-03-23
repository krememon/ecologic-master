import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Express, Response } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { getResendFrom } from "./email";
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

const authCodeStore = new Map<string, { userId: number; expiresAt: number }>();
const nonceCodeStore = new Map<string, { code: string; expiresAt: number }>();

function generateAuthCode(): string {
  return randomBytes(32).toString("hex");
}

function storeAuthCode(userId: number): string {
  const code = generateAuthCode();
  authCodeStore.set(code, { userId, expiresAt: Date.now() + 5 * 60 * 1000 });
  return code;
}

function storeAuthCodeForNonce(nonce: string, userId: number): string {
  const code = storeAuthCode(userId);
  nonceCodeStore.set(nonce, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  return code;
}

function consumeAuthCode(code: string): number | null {
  const entry = authCodeStore.get(code);
  if (!entry) return null;
  authCodeStore.delete(code);
  if (Date.now() > entry.expiresAt) return null;
  return entry.userId;
}

function pollAuthCode(nonce: string): string | null {
  const entry = nonceCodeStore.get(nonce);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    nonceCodeStore.delete(nonce);
    return null;
  }
  nonceCodeStore.delete(nonce);
  return entry.code;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of authCodeStore) {
    if (now > entry.expiresAt) authCodeStore.delete(code);
  }
  for (const [nonce, entry] of nonceCodeStore) {
    if (now > entry.expiresAt) nonceCodeStore.delete(nonce);
  }
}, 60 * 1000);

const scryptAsync = promisify(scrypt);

// Log RESEND_FROM at startup
if (process.env.RESEND_FROM) {
  console.log("[email] Using RESEND_FROM =", process.env.RESEND_FROM);
} else {
  console.warn("[email] WARNING: RESEND_FROM is not set - email sending will fail");
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

function sendDeepLinkRedirect(res: Response, deepLinkUrl: string) {
  console.log("[deep-link-redirect] Redirecting to:", deepLinkUrl);
  return res.redirect(302, deepLinkUrl);
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
  
  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey);
  
  const { error } = await resend.emails.send({
    from: getResendFrom(),
    reply_to: 'no-reply@ecologicc.com',
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
    const googleCallbackURL = `${process.env.APP_BASE_URL || 'http://localhost:5000'}/api/auth/google/callback`;
    console.log("[GoogleAuth] callbackURL:", googleCallbackURL);
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: googleCallbackURL,
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
              // If the googleId user is a deleted/anonymized account, unlink it and fall through
              if (user.email && user.email.includes('@deleted.local')) {
                console.log("[google-auth] Found deleted user with googleId, unlinking:", user.id);
                await storage.updateUser(user.id, { googleId: null, googleLinked: false });
                user = null;
              } else {
                console.log("[google-auth] Found user by googleId:", user.id);
                return done(null, user);
              }
            }
            
            // Step 2: Try to find user by email
            if (!user) {
              user = await storage.getUserByEmail(email);
            }
            
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
          reply_to: 'no-reply@ecologicc.com',
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
          reply_to: 'no-reply@ecologicc.com',
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
          reply_to: 'no-reply@ecologicc.com',
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

      // Code is valid - check for 2FA before logging in
      const user = await storage.getUserByEmail(normalizedEmail);
      console.log("[auth] verify-code: found user:", user?.id, user?.email);
      if (!user) {
        return res.status(400).json({ message: "User not found." });
      }

      // Clean up the challenge
      await storage.deleteLoginChallenge(normalizedEmail);

      // Check if 2FA is enabled
      if (user.twoFactorEnabled) {
        console.log("[auth] verify-code: 2FA required for user:", user.id);
        (req.session as any).twoFactorPendingUserId = user.id;
        return req.session.save((saveErr) => {
          if (saveErr) {
            console.error("[auth] verify-code: session.save error:", saveErr);
            return res.status(500).json({ message: "Unable to complete sign in." });
          }
          return res.json({
            ok: true,
            twoFactorRequired: true,
          });
        });
      }

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
          reply_to: 'no-reply@ecologicc.com',
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

        const isMobile = req.headers['x-client-type'] === 'mobile';
        res.json({
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
          },
          ...(isMobile ? { sessionId: req.sessionID } : {}),
        });
      });
    })(req, res, next);
  });

  app.get("/healthz", (_req, res) => res.send("ok"));

  // Social Auth Routes
  app.get("/api/auth/google", (req, res, next) => {
    const platform = req.query.platform as string || "web";
    const nonce = req.query.nonce as string || "";
    const returnTo = req.query.returnTo as string || "";

    console.log(`[auth/google][debug] host=${req.headers.host} x-fwd-host=${req.headers["x-forwarded-host"] || "-"} origin=${req.headers.origin || "-"} referer=${req.headers.referer || "-"} platform=${platform}`);

    let state: string;
    if (platform === "ios" && nonce) {
      state = `ios:${nonce}`;
    } else if (platform === "ios") {
      state = "ios";
    } else if (platform === "popup" && returnTo) {
      // Cross-domain popup (via trampoline): encode returnTo so the callback can
      // redirect the popup back to the opener's origin using the webAuthCode flow,
      // avoiding the postMessage cross-origin delivery failure.
      state = `popup:${Buffer.from(returnTo).toString("base64url")}`;
    } else if (platform === "popup") {
      state = "popup";
    } else if (returnTo) {
      state = `web:${Buffer.from(returnTo).toString("base64url")}`;
    } else {
      state = "web";
    }

    const productionBase = process.env.APP_BASE_URL;
    if (productionBase) {
      try {
        const prodHost = new URL(productionBase).host;
        const currentHost = req.headers.host || "";
        const isLocalhost = currentHost.includes("localhost") || currentHost.includes("127.0.0.1");
        if (!isLocalhost && currentHost !== prodHost) {
          const qs = new URLSearchParams();
          if (platform && platform !== "web") qs.set("platform", platform);
          if (nonce) qs.set("nonce", nonce);
          const proto = req.headers["x-forwarded-proto"] || "https";
          qs.set("returnTo", `${proto}://${currentHost}`);
          const target = `${productionBase}/api/auth/google?${qs.toString()}`;
          console.log(`[auth/google][debug] cross-domain → serving trampoline to ${prodHost} (returnTo=${proto}://${currentHost})`);
          res.setHeader("Content-Type", "text/html");
          const escapedTarget = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
.c{text-align:center;padding:2rem}.s{font-size:1.5rem;margin-bottom:1rem}
a{display:inline-block;margin-top:1rem;padding:12px 28px;background:#166534;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:1rem}
a:hover{background:#15803d}.sub{color:#64748b;font-size:0.875rem;margin-top:0.75rem}</style></head><body>
<div class="c">
<div class="s">&#x1F512;</div>
<p>Redirecting to Google Sign-In…</p>
<a id="fl" href="${escapedTarget}" target="_blank" rel="noopener" style="display:none">Open Google Sign-In</a>
<p class="sub" id="hint" style="display:none">If nothing happened, tap the button above.</p>
</div>
<script>
(function(){
  var target = ${JSON.stringify(target)};
  var done = false;
  try { window.top.location.href = target; done = true; } catch(e) {}
  if (!done) {
    try { var w = window.open(target, '_blank'); if (w) done = true; } catch(e2) {}
  }
  if (!done) {
    document.getElementById('fl').style.display = 'inline-block';
    document.getElementById('hint').style.display = 'block';
  }
  setTimeout(function(){
    document.getElementById('fl').style.display = 'inline-block';
    document.getElementById('hint').style.display = 'block';
  }, 2000);
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${escapedTarget}"></noscript>
</body></html>`);
        }
      } catch (_) {}
    }

    const callbackURL = `${productionBase || ""}/api/auth/google/callback`;
    console.log(`[auth/google][debug] starting OAuth: host=${req.headers.host} state=${state.substring(0, 12)} callbackURL=${callbackURL} platform=${platform} returnTo=${returnTo || "(none)"}`);
    passport.authenticate("google", {
      scope: ["profile", "email"],
      state,
      prompt: "select_account",
      accessType: "offline",
      includeGrantedScopes: true,
    })(req, res, next);
  });

  app.get("/api/auth/poll-code", (req, res) => {
    const nonce = req.query.nonce as string;
    if (!nonce) return res.status(400).json({ status: "error", message: "nonce required" });
    const code = pollAuthCode(nonce);
    if (code) {
      console.log("[poll-code] Code found for nonce:", nonce.substring(0, 8) + "...");
      return res.json({ status: "ready", code });
    }
    return res.json({ status: "pending" });
  });

  // Native iOS OAuth bridge page.
  // SFSafariViewController (Capacitor Browser plugin) cannot follow a server-side
  // 302 redirect to a custom URL scheme directly. Instead, we serve this HTTPS page
  // which immediately fires window.location = 'ecologic://auth/callback?...' via JS.
  // iOS intercepts the custom scheme, brings the app to the foreground, and fires
  // appUrlOpen. The app then calls Browser.close() and exchanges the code.
  app.get("/api/auth/google-complete", (req, res) => {
    const code  = (req.query.code  as string) || "";
    const error = (req.query.error as string) || "";

    // Build the deep link the JS will navigate to
    const deepLink = code
      ? `ecologic://auth/callback?code=${encodeURIComponent(code)}`
      : `ecologic://auth/callback?error=${encodeURIComponent(error || "unknown")}`;

    console.log(`[google-complete] Bridge page loaded — ${code ? "success" : "error"}, firing deep link`);

    res.setHeader("Content-Type", "text/html");
    return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signing in to EcoLogic…</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0fdf4;color:#166534}
.card{text-align:center;padding:2rem;max-width:320px}
.spinner{width:48px;height:48px;border:4px solid #bbf7d0;border-top-color:#16a34a;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1.25rem}
@keyframes spin{to{transform:rotate(360deg)}}
h2{font-size:1.1rem;font-weight:600;margin-bottom:.5rem}
p{font-size:.875rem;color:#4ade80;margin-bottom:1.5rem}
a{display:inline-block;padding:10px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem}
</style></head>
<body><div class="card">
<div class="spinner"></div>
<h2>Signing you in…</h2>
<p>Returning to EcoLogic</p>
<a href="${deepLink}" id="manual" style="display:none">Open EcoLogic</a>
</div>
<script>
(function(){
  var dl=${JSON.stringify(deepLink)};
  // Fire immediately — iOS intercepts ecologic:// and opens the app
  try{ window.location.href = dl; }catch(e){}
  // Show a manual fallback button after 2.5 s in case deep link didn't fire
  setTimeout(function(){
    var btn=document.getElementById('manual');
    if(btn){ btn.style.display='inline-block'; }
  }, 2500);
})();
</script>
</body></html>`);
  });

  // Helper: build the tiny HTML page that posts a message back to the popup opener.
  // Uses "*" as the postMessage targetOrigin so the message is delivered even when
  // the opener is on a different origin (cross-domain canvas/iframe scenario).
  // The optional authCode is a one-time webAuthCode the client exchanges for a Bearer token.
  function buildPopupResponseHtml(success: boolean, errorCode?: string, authCode?: string): string {
    const successPayload = authCode
      ? { type: "google-auth-success", webAuthCode: authCode }
      : { type: "google-auth-success" };
    const payload = success
      ? JSON.stringify(successPayload)
      : JSON.stringify({ type: "google-auth-error", error: errorCode || "unknown" });
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signing in…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4;color:#166534}.card{text-align:center;padding:2rem}.icon{font-size:2.5rem;margin-bottom:.75rem}p{margin:.25rem 0;font-size:1rem}</style>
</head><body><div class="card">
<div class="icon">${success ? "✓" : "✕"}</div>
<p>${success ? "<strong>Signed in!</strong>" : "<strong>Sign-in failed.</strong>"}</p>
<p style="color:#64748b;font-size:.875rem">${success ? "Returning to app…" : "You can close this window."}</p>
</div>
<script>
(function(){
  var msg=${payload};
  try{ if(window.opener){ window.opener.postMessage(msg,"*"); } }catch(e){}
  setTimeout(function(){ try{ window.close(); }catch(e){} },400);
})();
</script>
</body></html>`;
  }

  app.get("/api/auth/google/callback", (req, res, next) => {
    const rawState = (req.query.state as string) || "web";
    console.log("[auth/google/callback] hit, rawState:", rawState.substring(0, 20));
    passport.authenticate("google", async (err: any, user: any, info: any) => {
      const isIos = rawState === "ios" || rawState.startsWith("ios:");
      const isPopup = rawState === "popup" || rawState.startsWith("popup:");
      const nonce = rawState.startsWith("ios:") ? rawState.substring(4) : null;

      // Cross-domain popup: returnTo is base64url-encoded in the "popup:<b64>" state.
      // This fires when the popup went through the cross-domain trampoline.
      let popupReturnTo: string | null = null;
      if (rawState.startsWith("popup:")) {
        try {
          const decoded = Buffer.from(rawState.substring(6), "base64url").toString("utf8");
          const parsed = new URL(decoded);
          if (["http:", "https:"].includes(parsed.protocol)) popupReturnTo = decoded;
        } catch { /* ignore malformed */ }
      }

      // Decode optional returnTo (set when request came from a preview domain)
      let returnTo: string | null = null;
      if (rawState.startsWith("web:")) {
        try {
          returnTo = Buffer.from(rawState.substring(4), "base64url").toString("utf8");
          // Validate it looks like a proper origin URL
          const parsed = new URL(returnTo);
          if (!["http:", "https:"].includes(parsed.protocol)) returnTo = null;
        } catch {
          returnTo = null;
        }
      }

      console.log(`[auth/google/callback][debug] host=${req.headers.host} isIos=${isIos} isPopup=${isPopup} nonce=${nonce ? nonce.substring(0, 8) + "..." : "none"} returnTo=${returnTo || "(none)"} popupReturnTo=${popupReturnTo ? "set" : "(none)"} err=${!!err} user=${!!user}`);

      if (err) {
        console.error("[google-auth] Error:", err);
        if (isIos) {
          console.log("[google-auth] iOS: error — redirecting to bridge page");
          return res.redirect("/api/auth/google-complete?error=oauth_error");
        }
        if (isPopup) {
          console.log("[google-auth] Popup: error, sending postMessage error");
          return res.send(buildPopupResponseHtml(false, "oauth_error"));
        }
        if (returnTo) return res.redirect(`${returnTo}/?error=oauth_failed`);
        if (err.code === 'invalid_grant' || err.message?.includes('Malformed auth code')) {
          return res.redirect("/?error=token_expired&message=Please try signing in again");
        }
        if (err.message?.includes('Failed to create user account')) {
          return res.redirect("/?error=account_creation_failed&message=Unable to create your account");
        }
        return res.redirect("/auth?error=oauth_failed");
      }

      if (info) {
        if (info.error === 'account_inactive') {
          if (isIos) return res.redirect("/api/auth/google-complete?error=account_inactive");
          if (isPopup) return res.send(buildPopupResponseHtml(false, "account_inactive"));
          if (returnTo) return res.redirect(`${returnTo}/?error=account_inactive`);
          return res.redirect(`/?error=account_inactive&message=${encodeURIComponent(info.message || 'Your account is deactivated.')}`);
        }
        if (info.error === 'email_mismatch') {
          if (isPopup) return res.send(buildPopupResponseHtml(false, "email_mismatch"));
          return res.redirect(`/settings?error=email_mismatch&message=${encodeURIComponent(info.message)}`);
        }
        if (info.success === 'google_linked') {
          if (isPopup) return res.send(buildPopupResponseHtml(true));
          return res.redirect(`/settings?success=google_linked&message=${encodeURIComponent(info.message)}`);
        }
      }

      if (!user) {
        console.error("[google-auth] No user returned, info:", info);
        if (isIos) return res.redirect("/api/auth/google-complete?error=oauth_cancelled");
        if (isPopup) {
          console.log("[google-auth] Popup: no user, sending postMessage error");
          return res.send(buildPopupResponseHtml(false, "oauth_cancelled"));
        }
        if (returnTo) return res.redirect(`${returnTo}/?error=oauth_cancelled`);
        return res.redirect("/auth?error=oauth_cancelled");
      }

      if (isIos) {
        const fullUser = await storage.getUser(user.id);
        if (fullUser?.twoFactorEnabled) {
          console.log("[google-auth] iOS: 2FA not supported in native wrapper");
          return res.redirect("/api/auth/google-complete?error=2fa_not_supported");
        }
        // If the native app provided a nonce, store the code against it so the
        // background poll (setInterval in startGoogleAuthNative) can retrieve it.
        // This is the primary completion mechanism because iOS 13+ SFSafariViewController
        // shows an OS dialog for custom URL scheme redirects; polling avoids that entirely.
        // The code is ALSO stored by storeAuthCode for direct exchange via deep link fallback.
        const code = nonce
          ? storeAuthCodeForNonce(nonce, user.id)
          : storeAuthCode(user.id);
        console.log(`[google-auth] iOS: code stored${nonce ? " (nonce=" + nonce.substring(0, 8) + "…)" : ""}, redirecting to bridge page`);
        return res.redirect(`/api/auth/google-complete?code=${encodeURIComponent(code)}`);
      }

      // Popup flow: log user in, save session, then return postMessage HTML (same-domain)
      // OR redirect popup back to opener's origin with a webAuthCode (cross-domain).
      if (isPopup) {
        const fullUser = await storage.getUser(user.id);
        if (fullUser?.twoFactorEnabled) {
          console.log("[google-auth] Popup: 2FA required, sending error to opener");
          return res.send(buildPopupResponseHtml(false, "2fa_required"));
        }

        // Cross-domain popup (came via trampoline): the popup is on the production domain
        // but the opener/main window is on a different origin (dev URL, custom domain, etc.).
        // postMessage won't reach the opener because targetOrigin won't match.
        // Instead, redirect the popup to the opener's origin with a one-time webAuthCode.
        // The app at the opener's origin will exchange it for a Bearer token, store it in
        // localStorage, and close the popup. The main window gets the storage event and
        // refetches auth using the Bearer token — same path as the Replit preview iframe flow.
        if (popupReturnTo) {
          // The opener is on a different origin (dev/picard/custom domain).
          // We MUST NOT redirect the popup to that origin because:
          //   • picard.replit.dev requires Replit workspace context — a standalone popup gets a blank page
          //   • custom domains may also fail to serve the app in a popup redirect context
          // Instead, keep the popup on the production domain and send a completion page that
          // postMessages the webAuthCode to the opener using "*" (cross-origin delivery).
          // The opener exchanges the code for a Bearer token.
          const code = storeAuthCode(user.id);
          return req.login(user, (loginErr) => {
            if (loginErr) {
              console.error("[google-auth] Popup/cross-domain: login error:", loginErr);
              return res.send(buildPopupResponseHtml(false, "login_failed"));
            }
            req.session.save(() => {
              console.log(`[google-auth] Popup/cross-domain: sending webAuthCode via postMessage to opener`);
              return res.send(buildPopupResponseHtml(true, undefined, code));
            });
          });
        }

        // Same-domain popup: postMessage flow works because opener and popup share the origin.
        return req.login(user, (loginErr) => {
          if (loginErr) {
            console.error("[google-auth] Popup: login error:", loginErr);
            return res.send(buildPopupResponseHtml(false, "login_failed"));
          }
          req.session.save((saveErr) => {
            if (saveErr) console.error("[google-auth] Popup: session save warning:", saveErr);
            console.log(`[google-auth] Popup: login success, posting message to opener, user=${user?.email || user?.id}`);
            return res.send(buildPopupResponseHtml(true));
          });
        });
      }

      // Preview cross-domain flow: redirect back to the originating preview domain
      // with a one-time webAuthCode the client will exchange for a Bearer token.
      if (returnTo) {
        const code = storeAuthCode(user.id);
        const redirectUrl = `${returnTo}/?webAuthCode=${encodeURIComponent(code)}`;
        console.log("[google-auth] preview returnTo flow: redirecting to", returnTo, "with webAuthCode");
        // We still need to create a session on the production domain so the exchange-code
        // endpoint has a valid session to log the user into (req.login creates it).
        return req.login(user, (loginErr) => {
          if (loginErr) {
            console.error("[google-auth] Login error (returnTo):", loginErr);
            return res.redirect(`${returnTo}/?error=login_failed`);
          }
          return res.redirect(redirectUrl);
        });
      }
      
      // Standard web flow: Check if 2FA is enabled for this user
      const fullUser = await storage.getUser(user.id);
      if (fullUser?.twoFactorEnabled) {
        (req.session as any).twoFactorPendingUserId = user.id;
        return req.session.save((saveErr) => {
          if (saveErr) {
            console.error("[google-auth] Session save error:", saveErr);
            return res.redirect("/auth?error=session_error");
          }
          return res.redirect("/two-factor");
        });
      }
      
      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error("[google-auth] Login error:", loginErr);
          return res.redirect("/auth?error=login_failed");
        }
        console.log(`[auth/google/callback][debug] login success, user=${user?.email || user?.id}, redirecting to /`);
        req.session.save((saveErr) => {
          if (saveErr) console.error("[google-auth] Session save warning:", saveErr);
          return res.redirect("/");
        });
      });
    })(req, res, next);
  });

  // Auth code exchange endpoint for native app deep-link flow
  // Handle preflight for cross-origin exchange-code requests (preview → production)
  app.options("/api/auth/exchange-code", (req, res) => {
    const origin = req.headers.origin || "";
    if (origin.endsWith(".replit.dev") || origin.endsWith(".picard.replit.dev")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    }
    res.sendStatus(204);
  });

  app.post("/api/auth/exchange-code", async (req, res) => {
    // Allow cross-origin requests from Replit preview domains
    const origin = req.headers.origin || "";
    if (origin.endsWith(".replit.dev") || origin.endsWith(".picard.replit.dev")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Auth code is required" });
      }

      const userId = consumeAuthCode(code);
      if (!userId) {
        console.log(`[google-auth] exchange-code: invalid or expired (code=${code.substring(0, 8)}…)`);
        return res.status(401).json({ message: "Invalid or expired auth code" });
      }
      console.log(`[google-auth] exchange-code: consumed, userId=${userId}`);

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error("[exchange-code] Login error:", loginErr);
          return res.status(500).json({ message: "Login failed" });
        }
        const sid = req.sessionID;
        // Force-save the session to the PostgreSQL store BEFORE returning the
        // sessionId. Without this, the session may not be persisted yet when
        // the native app immediately uses Bearer sid for /api/auth/user.
        req.session.save((saveErr) => {
          if (saveErr) console.error("[exchange-code] Session save warning:", saveErr);
          console.log(`[exchange-code] Session saved (sid=${sid.substring(0, 8)}…), user=${user.email || user.id}`);
          return res.json({
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            },
            sessionId: sid,
          });
        });
      });
    } catch (error) {
      console.error("[exchange-code] Error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

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
  app.get("/api/user", async (req, res) => {
    // Check if there's a pending 2FA verification
    const pendingUserId = (req.session as any).twoFactorPendingUserId;
    if (pendingUserId) {
      return res.json({
        authenticated: false,
        twoFactorRequired: true,
      });
    }
    
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    // Get fresh user data for 2FA status
    const user = await storage.getUser(req.user.id);
    
    res.json({
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      profileImageUrl: req.user.profileImageUrl,
      emailVerified: req.user.emailVerified,
      twoFactorEnabled: user?.twoFactorEnabled || false,
    });
  });

  // Logout
  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logout successful" });
    });
  });

  // ============================================
  // TWO-FACTOR AUTHENTICATION (2FA) ROUTES
  // ============================================

  // Start 2FA setup - generate secret and QR code
  app.post("/api/auth/2fa/setup/start", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(req.user.id);
      if (!user?.email) {
        return res.status(400).json({ message: "Email required for 2FA setup" });
      }

      if (user.twoFactorEnabled) {
        return res.status(400).json({ message: "2FA is already enabled" });
      }

      const { generateSecret, generateQRCode } = await import("./services/totp");
      
      const { secret, otpauthUrl } = generateSecret(user.email, "EcoLogic");
      const qrCodeDataUrl = await generateQRCode(otpauthUrl);

      // Store secret temporarily in session
      (req.session as any).pending2FASecret = secret;

      res.json({
        qrCodeDataUrl,
        manualKey: secret,
        otpauthUrl,
      });
    } catch (error) {
      console.error("[2fa-setup-start] Error:", error);
      res.status(500).json({ message: "Failed to start 2FA setup" });
    }
  });

  // Confirm 2FA setup - verify code and enable 2FA
  app.post("/api/auth/2fa/setup/confirm", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { code } = req.body;
      if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      const pendingSecret = (req.session as any).pending2FASecret;
      if (!pendingSecret) {
        return res.status(400).json({ message: "No pending 2FA setup. Please start over." });
      }

      const { verifyToken, encrypt, generateBackupCodes, hashBackupCode } = await import("./services/totp");
      
      if (!verifyToken(pendingSecret, code)) {
        return res.status(400).json({ message: "Invalid verification code. Please try again." });
      }

      // Generate backup codes
      const backupCodes = generateBackupCodes(8);
      const hashedBackupCodes = backupCodes.map(hashBackupCode);

      // Encrypt and store
      const encryptedSecret = encrypt(pendingSecret);
      const encryptedBackupCodes = encrypt(JSON.stringify(hashedBackupCodes));

      await storage.enable2FA(req.user.id, encryptedSecret, encryptedBackupCodes);

      // Clear pending secret
      delete (req.session as any).pending2FASecret;

      res.json({
        ok: true,
        backupCodes,
      });
    } catch (error) {
      console.error("[2fa-setup-confirm] Error:", error);
      res.status(500).json({ message: "Failed to enable 2FA" });
    }
  });

  // Verify 2FA code (for login)
  app.post("/api/auth/2fa/verify", async (req, res) => {
    try {
      const pendingUserId = (req.session as any).twoFactorPendingUserId;
      if (!pendingUserId) {
        return res.status(400).json({ message: "No pending 2FA verification" });
      }

      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Verification code required" });
      }

      const user = await storage.getUser(pendingUserId);
      if (!user || !user.twoFactorEnabled || !user.twoFactorSecretEnc) {
        return res.status(400).json({ message: "2FA not configured" });
      }

      const { decrypt, verifyToken, verifyBackupCode } = await import("./services/totp");
      
      const secret = decrypt(user.twoFactorSecretEnc);
      const normalizedCode = code.replace(/\s/g, "");

      // Check if it's a TOTP code (6 digits)
      if (/^\d{6}$/.test(normalizedCode)) {
        if (!verifyToken(secret, normalizedCode)) {
          return res.status(400).json({ message: "Invalid verification code" });
        }
      } else {
        // Try as backup code
        if (!user.twoFactorBackupCodesEnc) {
          return res.status(400).json({ message: "Invalid verification code" });
        }

        const hashedCodes: string[] = JSON.parse(decrypt(user.twoFactorBackupCodesEnc));
        const result = verifyBackupCode(normalizedCode, hashedCodes);

        if (!result.valid) {
          return res.status(400).json({ message: "Invalid backup code" });
        }

        // Remove used backup code
        hashedCodes.splice(result.index, 1);
        const { encrypt } = await import("./services/totp");
        await storage.updateBackupCodes(user.id, encrypt(JSON.stringify(hashedCodes)));
      }

      // Complete login
      delete (req.session as any).twoFactorPendingUserId;
      
      await new Promise<void>((resolve, reject) => {
        req.login(user, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({ ok: true });
    } catch (error) {
      console.error("[2fa-verify] Error:", error);
      res.status(500).json({ message: "2FA verification failed" });
    }
  });

  // Disable 2FA
  app.post("/api/auth/2fa/disable", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Verification code required" });
      }

      const user = await storage.getUser(req.user.id);
      if (!user?.twoFactorEnabled || !user.twoFactorSecretEnc) {
        return res.status(400).json({ message: "2FA is not enabled" });
      }

      const { decrypt, verifyToken, verifyBackupCode } = await import("./services/totp");
      
      const secret = decrypt(user.twoFactorSecretEnc);
      const normalizedCode = code.replace(/\s/g, "");

      let isValid = false;
      if (/^\d{6}$/.test(normalizedCode)) {
        isValid = verifyToken(secret, normalizedCode);
      } else if (user.twoFactorBackupCodesEnc) {
        const hashedCodes: string[] = JSON.parse(decrypt(user.twoFactorBackupCodesEnc));
        isValid = verifyBackupCode(normalizedCode, hashedCodes).valid;
      }

      if (!isValid) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      await storage.disable2FA(user.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("[2fa-disable] Error:", error);
      res.status(500).json({ message: "Failed to disable 2FA" });
    }
  });

  // Regenerate backup codes
  app.post("/api/auth/2fa/backup/regenerate", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { code } = req.body;
      if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      const user = await storage.getUser(req.user.id);
      if (!user?.twoFactorEnabled || !user.twoFactorSecretEnc) {
        return res.status(400).json({ message: "2FA is not enabled" });
      }

      const { decrypt, verifyToken, generateBackupCodes, hashBackupCode, encrypt } = await import("./services/totp");
      
      const secret = decrypt(user.twoFactorSecretEnc);
      if (!verifyToken(secret, code)) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      const backupCodes = generateBackupCodes(8);
      const hashedBackupCodes = backupCodes.map(hashBackupCode);
      const encryptedBackupCodes = encrypt(JSON.stringify(hashedBackupCodes));

      await storage.updateBackupCodes(user.id, encryptedBackupCodes);

      res.json({
        ok: true,
        backupCodes,
      });
    } catch (error) {
      console.error("[2fa-backup-regenerate] Error:", error);
      res.status(500).json({ message: "Failed to regenerate backup codes" });
    }
  });

  // Get 2FA status
  app.get("/api/auth/2fa/status", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(req.user.id);
      res.json({
        enabled: user?.twoFactorEnabled || false,
        enabledAt: user?.twoFactorEnabledAt || null,
      });
    } catch (error) {
      console.error("[2fa-status] Error:", error);
      res.status(500).json({ message: "Failed to get 2FA status" });
    }
  });
}