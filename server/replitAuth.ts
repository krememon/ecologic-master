import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import nodemailer from "nodemailer";
import { storage } from "./storage";
import { db } from "./db";
import { companies, companyMembers } from "@shared/schema";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { generateUniqueInviteCode, normalizeCode } from "@shared/inviteCode";

const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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
    return true;
  }
  
  const signUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/sign/${accessToken}`;
  
  try {
    await emailTransporter.sendMail({
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

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

if (!process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Required for session to persist after Stripe redirect
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = tokens.claims();
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user as any);
  };

  // Setup Replit OAuth
  // Replit OAuth strategy removed

  // Setup Google OAuth
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.REPLIT_DOMAINS 
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}/auth/google/callback`
        : `http://localhost:5000/auth/google/callback`,
      passReqToCallback: true
    },
    async (req: any, accessToken: string, refreshToken: string, params: any, profile: any, done: any) => {
      try {
        console.log("Google OAuth strategy called with profile:", {
          id: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.name
        });

        const email = profile.emails?.[0]?.value;
        if (!email) {
          console.error("No email found in Google profile");
          return done(new Error("No email found in Google profile"), null);
        }

        // Normalize email for consistency
        const { normalizeEmail } = await import("@shared/emailUtils");
        const normalizedEmail = normalizeEmail(email);

        // Check if this is an account linking request
        const isLinking = req.session.linkingAccount?.action === 'link';
        console.log("Is account linking request:", isLinking);
        console.log("Session linking data:", req.session.linkingAccount);

        if (isLinking) {
          // Account linking flow
          const linkingData = req.session.linkingAccount;
          
          // Verify email matches the current user's email (normalized comparison)
          if (normalizedEmail !== normalizeEmail(linkingData.userEmail)) {
            console.error("Email mismatch during linking:", {
              googleEmail: email,
              userEmail: linkingData.userEmail
            });
            
            // Clear linking session data
            delete req.session.linkingAccount;
            
            // Pass error to be handled in callback route
            return done(null, null, { 
              error: 'email_mismatch',
              message: `Google account email (${email}) doesn't match your current account email (${linkingData.userEmail})`
            });
          }

          // Email matches - link the Google account
          try {
            const user = await storage.getUser(linkingData.userId);
            if (!user) {
              throw new Error("User not found during linking");
            }

            // Update user to mark Google as linked
            const updateData: any = {
              googleLinked: true,
              emailVerified: true
            };
            
            // Update profile info if not already set
            if (!user.profileImageUrl && profile.photos?.[0]?.value) {
              updateData.profileImageUrl = profile.photos[0].value;
            }
            if (!user.firstName && profile.name?.givenName) {
              updateData.firstName = profile.name.givenName;
            }
            if (!user.lastName && profile.name?.familyName) {
              updateData.lastName = profile.name.familyName;
            }

            const updatedUser = await storage.updateUser(user.id, updateData);
            console.log("Successfully linked Google account to user:", updatedUser.id);

            // Clear linking session data
            delete req.session.linkingAccount;

            // Pass success info to be handled in callback route
            return done(null, null, {
              success: 'google_linked',
              message: 'Google account successfully linked',
              userId: user.id
            });
          } catch (error) {
            console.error("Error linking Google account:", error);
            delete req.session.linkingAccount;
            return done(new Error("Failed to link Google account"), null);
          }
        }

        // Regular login flow (not linking)
        // Check if user already exists with this email (using normalized email)
        let user = await storage.getUserByEmail(normalizedEmail);
        console.log("Existing user found:", !!user);
        
        if (user) {
          // User exists with this email
          console.log("User found with email:", email, "Google linked:", user.googleLinked);
          
          // Check if this user already has Google linked
          if (user.googleLinked) {
            console.log("User already has Google linked, proceeding with login");
            // User already has Google linked, proceed normally
          } else {
            // User exists but doesn't have Google linked
            // Automatically link Google to their existing account and sign them in
            console.log("User exists with email/password, automatically linking Google account");
            
            // Set Google as linked for this user
            const linkData = {
              googleLinked: true,
              emailVerified: true
            };
            
            try {
              console.log("Auto-linking Google to existing user ID:", user.id);
              
              const updatedUser = await storage.updateUser(user.id, linkData);
              if (updatedUser) {
                user = updatedUser;
                console.log("Successfully auto-linked Google to existing account:", user.id);
              } else {
                console.warn("Auto-link update returned undefined, keeping original user");
                // Continue with original user - we'll still sign them in
              }
            } catch (linkError) {
              console.error("Error auto-linking Google to existing account:", linkError);
              // Continue anyway - we can still sign them in even if linking failed
            }
          }
          
          // Update user with Google data if needed (for already linked Google accounts)
          const updateData: any = {};
          
          if (!user.profileImageUrl && profile.photos?.[0]?.value) {
            updateData.profileImageUrl = profile.photos[0].value;
          }
          
          if (!user.firstName && profile.name?.givenName) {
            updateData.firstName = profile.name.givenName;
          }
          if (!user.lastName && profile.name?.familyName) {
            updateData.lastName = profile.name.familyName;
          }
          
          updateData.emailVerified = true;
          
          // Update user with Google data if there's anything to update
          if (Object.keys(updateData).length > 0) {
            console.log("Updating existing Google user with latest data:", updateData);
            try {
              console.log("Updating user ID:", user.id, "with data:", updateData);
              
              const updatedUser = await storage.updateUser(user.id, updateData);
              console.log("Update result:", updatedUser);
              
              if (updatedUser) {
                user = updatedUser; // Use the updated user
                console.log("Successfully updated existing Google user:", user.id);
              } else {
                console.warn("Update returned undefined, keeping original user");
              }
            } catch (updateError) {
              console.error("Error updating existing Google user:", updateError);
              // Continue with original user if update fails
            }
          }
        } else {
          // No user exists with this email - create new Google account
          console.log("No existing user found, creating new Google account for:", email);
          try {
            user = await storage.createUser({
              id: `google_${profile.id}`,
              email: normalizedEmail,
              firstName: profile.name?.givenName || '',
              lastName: profile.name?.familyName || '',
              profileImageUrl: profile.photos?.[0]?.value || null,
              emailVerified: true,
              googleLinked: true
            });
            console.log("Successfully created new Google user:", user.id);
          } catch (createError: any) {
            console.error("Error creating new Google user:", createError);
            // Handle unique constraint violation
            if (createError.code === '23505' || createError.message?.includes('unique constraint')) {
              return done(null, null, {
                error: 'email_in_use',
                message: 'This email is currently in use'
              });
            }
            return done(new Error("Failed to create user account"), null);
          }
        }

        // Ensure user object is valid
        if (!user || !user.id) {
          console.error("Invalid user object after Google OAuth:", user);
          return done(new Error("Failed to process user account"), null);
        }
        
        console.log("User for session:", { id: user.id, email: user.email });
        
        // Check if user is deactivated
        if (user.status === 'INACTIVE') {
          console.log("Google OAuth: User is deactivated");
          return done(null, null, {
            error: 'account_inactive',
            message: 'Your account is deactivated. Please contact your company Owner or Supervisor.'
          });
        }
        
        // Create consistent session user object
        const sessionUser = {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          provider: 'google',
          claims: {
            sub: user.id,
            email: user.email,
            first_name: user.firstName,
            token_version: user.tokenVersion || 0,
            last_name: user.lastName,
            profile_image_url: user.profileImageUrl
          }
        };
        
        console.log("Setting Google OAuth session user:", sessionUser);
        return done(null, sessionUser);
      } catch (error) {
        console.error("Google OAuth strategy error:", error);
        return done(error as Error, null);
      }
    }));
  }

  passport.serializeUser((user: any, cb) => cb(null, user));
  passport.deserializeUser((user: any, cb) => cb(null, user));

  // Replit authentication removed

  // Google authentication routes
  app.get("/auth/google", 
    passport.authenticate("google", { 
      scope: ["profile", "email"],
      prompt: "select_account",
      accessType: "offline",
      includeGrantedScopes: true
    })
  );

  app.get("/auth/google/callback", (req, res, next) => {
    console.log("Google OAuth callback received, processing...");
    
    passport.authenticate("google", { 
      failureRedirect: "/?error=google_auth_failed",
      session: true
    }, (err, user, info) => {
      if (err) {
        console.error("Google OAuth authentication error:", err);
        
        // Handle specific OAuth errors with user-friendly messages
        if (err.code === 'invalid_grant' || err.message?.includes('Malformed auth code')) {
          console.log("OAuth token expired or invalid, redirecting to retry");
          return res.redirect("/?error=token_expired&message=Please try signing in again");
        }
        
        if (err.message?.includes('Failed to create user account')) {
          return res.redirect("/?error=account_creation_failed&message=Unable to create your account. Please try again or contact support");
        }
        
        if (err.message?.includes('Failed to process user account')) {
          return res.redirect("/?error=account_processing_failed&message=There was an issue processing your account. Please try again");
        }
        
        // Generic error with helpful message
        return res.redirect("/?error=auth_error&message=Authentication failed. Please try again or use email/password login");
      }
      
      // Handle account linking responses
      if (info) {
        console.log("Google OAuth callback with info:", info);
        
        if (info.error === 'account_inactive') {
          console.log("Google OAuth: User is deactivated, blocking login");
          return res.redirect(`/?error=account_inactive&message=${encodeURIComponent(info.message || 'Your account is deactivated. Please contact your company Owner or Supervisor.')}`);
        }
        
        if (info.error === 'email_mismatch') {
          return res.redirect(`/settings?error=email_mismatch&message=${encodeURIComponent(info.message)}`);
        }
        
        if (info.success === 'google_linked') {
          return res.redirect(`/settings?success=google_linked&message=${encodeURIComponent(info.message)}`);
        }
      }
      
      if (!user) {
        console.error("Google OAuth authentication failed, no user returned:", info);
        return res.redirect("/?error=no_user");
      }
      
      // Regular login flow for new sessions
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("Login error after Google OAuth:", loginErr);
          return res.redirect("/?error=login_failed");
        }
        
        console.log("Google OAuth login successful, user:", user);
        
        // Ensure session is saved before redirect
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.redirect("/?error=session_failed");
          }
          console.log("Session saved successfully, redirecting to dashboard");
          res.redirect("/");
        });
      });
    })(req, res, next);
  });

  // Password reset routes
  app.post("/api/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if email exists for security
        return res.json({ message: "If an account with this email exists, you'll receive a password reset link." });
      }

      // Generate reset token
      const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await storage.setResetPasswordToken(email, resetToken, resetExpires);

      // For development, we'll return the token. In production, send email
      if (process.env.NODE_ENV === 'development') {
        return res.json({ 
          message: "Reset token generated", 
          resetToken,
          resetUrl: `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`
        });
      }

      // TODO: Send email with reset link in production
      res.json({ message: "If an account with this email exists, you'll receive a password reset link." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.resetPassword(token, hashedPassword);
      
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Check if user is deactivated
      if (user.status === 'INACTIVE') {
        return res.status(401).json({ 
          code: 'ACCOUNT_INACTIVE',
          message: "Your account is deactivated. Please contact your company Owner or Supervisor."
        });
      }

      // Auto-login after password reset
      const sessionUser = {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          profile_image_url: user.profileImageUrl,
          token_version: user.tokenVersion || 0
        },
        provider: 'email'
      };

      req.login(sessionUser as any, (err) => {
        if (err) {
          console.error("Auto-login error:", err);
          return res.json({ message: "Password reset successfully. Please log in." });
        }
        res.json({ message: "Password reset successfully. You're now logged in.", user: sessionUser });
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Owner Registration (creates company with invite code)
  app.post("/api/register/owner", async (req, res) => {
    try {
      const { email, password, firstName, lastName, phone, company: companyData } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      if (!companyData?.name) {
        return res.status(400).json({ message: "Company name is required" });
      }

      // Normalize email for consistency
      const { normalizeEmail } = await import("@shared/emailUtils");
      const normalizedEmail = normalizeEmail(email);

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(409).json({ 
          code: 'EMAIL_IN_USE',
          message: "This email is currently in use" 
        });
      }

      // Hash password
      const crypto = await import('crypto');
      const util = await import('util');
      const scryptAsync = util.promisify(crypto.scrypt);
      
      const salt = crypto.randomBytes(16).toString("hex");
      const buf = (await scryptAsync(password, salt, 64)) as Buffer;
      const hashedPassword = `${buf.toString("hex")}.${salt}`;

      // Normalize phone if provided
      const { normalizePhone } = await import("@shared/phoneUtils");
      const normalizedPhone = phone ? normalizePhone(phone) : null;

      // Create user with normalized email
      const userData = {
        id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email: normalizedEmail,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: normalizedPhone,
        profileImageUrl: null,
        password: hashedPassword,
        emailVerified: false,
        verificationToken: null,
        resetPasswordToken: null,
        resetPasswordExpires: null
      };

      let user;
      try {
        user = await storage.createUser(userData);
      } catch (createError: any) {
        // Handle unique constraint violation (23505 is Postgres unique violation code)
        if (createError.code === '23505' || createError.message?.includes('unique constraint')) {
          return res.status(409).json({ 
            code: 'EMAIL_IN_USE',
            message: "This email is currently in use" 
          });
        }
        throw createError;
      }
      
      // Generate unique invite code
      const inviteCode = await generateUniqueInviteCode(async (code) => {
        const existing = await storage.getCompanyByInviteCode(code);
        return !!existing;
      });

      // Create company with invite code
      const [newCompany] = await db.insert(companies).values({
        name: companyData.name,
        email: companyData.email || null,
        phone: companyData.phone || null,
        addressLine1: companyData.addressLine1 || null,
        addressLine2: companyData.addressLine2 || null,
        city: companyData.city || null,
        state: companyData.state || null,
        postalCode: companyData.postalCode || null,
        country: companyData.country || "US",
        inviteCode,
        logo: null,
        primaryColor: "#3B82F6",
        secondaryColor: "#1E40AF",
        ownerId: user.id
      }).returning();
      
      // Create OWNER role for user
      await db.insert(companyMembers).values({
        userId: user.id,
        companyId: newCompany.id,
        role: "OWNER",
        permissions: { canCreateJobs: true, canManageInvoices: true, canViewSchedule: true }
      });
      
      // Create session
      const sessionUser = {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          profile_image_url: user.profileImageUrl,
          token_version: user.tokenVersion || 0
        },
        provider: 'email'
      };

      req.login(sessionUser as any, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Registration successful but login failed" });
        }
        
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Registration successful but session failed" });
          }
          res.status(201).json({ 
            message: "Company created successfully", 
            user: sessionUser,
            orgId: newCompany.id 
          });
        });
      });

    } catch (error) {
      console.error("Owner registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Member Registration (join company with invite code)
  app.post("/api/register/member", async (req, res) => {
    try {
      const { email, password, firstName, lastName, phone, role, inviteCode } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      if (!inviteCode) {
        return res.status(400).json({ message: "Company code is required" });
      }

      if (!role || !["SUPERVISOR", "TECHNICIAN", "DISPATCHER", "ESTIMATOR"].includes(role)) {
        return res.status(400).json({ message: "Valid role is required" });
      }

      // Normalize email for consistency
      const { normalizeEmail } = await import("@shared/emailUtils");
      const normalizedEmail = normalizeEmail(email);

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(409).json({ 
          code: 'EMAIL_IN_USE',
          message: "This email is currently in use" 
        });
      }

      // Validate invite code
      const normalizedCode = normalizeCode(inviteCode);
      const company = await storage.getCompanyByInviteCode(normalizedCode);
      if (!company) {
        return res.status(400).json({ message: "Invalid or expired company code" });
      }

      // Hash password
      const crypto = await import('crypto');
      const util = await import('util');
      const scryptAsync = util.promisify(crypto.scrypt);
      
      const salt = crypto.randomBytes(16).toString("hex");
      const buf = (await scryptAsync(password, salt, 64)) as Buffer;
      const hashedPassword = `${buf.toString("hex")}.${salt}`;

      // Normalize phone if provided
      const { normalizePhone } = await import("@shared/phoneUtils");
      const normalizedPhone = phone ? normalizePhone(phone) : null;

      // Create user with normalized email
      const userData = {
        id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email: normalizedEmail,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: normalizedPhone,
        profileImageUrl: null,
        password: hashedPassword,
        emailVerified: false,
        verificationToken: null,
        resetPasswordToken: null,
        resetPasswordExpires: null
      };

      let user;
      try {
        user = await storage.createUser(userData);
      } catch (createError: any) {
        // Handle unique constraint violation (23505 is Postgres unique violation code)
        if (createError.code === '23505' || createError.message?.includes('unique constraint')) {
          return res.status(409).json({ 
            code: 'EMAIL_IN_USE',
            message: "This email is currently in use" 
          });
        }
        throw createError;
      }
      
      // Create role for user in company
      await db.insert(companyMembers).values({
        userId: user.id,
        companyId: company.id,
        role: role,
        permissions: { canCreateJobs: true, canManageInvoices: true, canViewSchedule: true }
      });
      
      // Rotate invite code after successful registration (security best practice)
      const { generateInviteCode } = await import("@shared/inviteCode");
      const newInviteCode = generateInviteCode();
      const updatedCompany = await storage.rotateInviteCode(company.id, newInviteCode);
      
      // Broadcast invite code rotation to company members
      const { broadcastToCompany } = await import("./routes");
      await broadcastToCompany(company.id, {
        type: 'invite_code_rotated',
        data: {
          companyId: company.id,
          version: updatedCompany.inviteCodeVersion
        }
      }, user.id); // Exclude the new user
      
      // Create session
      const sessionUser = {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          profile_image_url: user.profileImageUrl,
          token_version: user.tokenVersion || 0
        },
        provider: 'email'
      };

      req.login(sessionUser as any, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Registration successful but login failed" });
        }
        
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Registration successful but session failed" });
          }
          res.status(201).json({ 
            message: "Joined company successfully", 
            user: sessionUser,
            orgId: company.id 
          });
        });
      });

    } catch (error) {
      console.error("Member registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Email/Password Login
  app.post("/api/login/email", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Normalize email for lookup
      const { normalizeEmail } = await import("@shared/emailUtils");
      const normalizedEmail = normalizeEmail(email);

      const user = await storage.getUserByEmail(normalizedEmail);
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify password
      const crypto = await import('crypto');
      const util = await import('util');
      const scryptAsync = util.promisify(crypto.scrypt);

      const [hashed, salt] = user.password.split(".");
      const hashedBuf = Buffer.from(hashed, "hex");
      const suppliedBuf = (await scryptAsync(password, salt, 64)) as Buffer;
      
      if (!crypto.timingSafeEqual(hashedBuf, suppliedBuf)) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Check if user is deactivated
      if (user.status === 'INACTIVE') {
        return res.status(401).json({ 
          code: 'ACCOUNT_INACTIVE',
          message: "Your account is deactivated. Please contact your company Owner or Supervisor."
        });
      }

      // Create session with tokenVersion
      const sessionUser = {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          profile_image_url: user.profileImageUrl,
          token_version: user.tokenVersion || 0
        },
        provider: 'email'
      };

      req.login(sessionUser as any, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        
        // Save session explicitly
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Login successful but session failed" });
          }
          res.json({ message: "Login successful", user: sessionUser });
        });
      });

    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Email availability check for registration validation
  app.get("/api/auth/email-available", async (req, res) => {
    try {
      const { email } = req.query;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ available: false, message: "Email is required" });
      }

      const { normalizeEmail } = await import("@shared/emailUtils");
      const normalizedEmail = normalizeEmail(email);
      
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      
      res.json({ available: !existingUser });
    } catch (error) {
      console.error("Email availability check error:", error);
      res.status(500).json({ available: false, message: "Check failed" });
    }
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Debug environment variable
  console.log("BYPASS_AUTH environment variable:", process.env.BYPASS_AUTH);
  
  // Bypass authentication for development if BYPASS_AUTH is set
  if (process.env.BYPASS_AUTH === 'true') {
    console.log("🚀 Authentication bypassed for development");
    // Set a mock user for bypassed authentication
    req.user = {
      id: '43456086',
      email: 'pjpell077@gmail.com',
      firstName: 'Peter',
      lastName: 'Pellegrino',
      profileImageUrl: null,
      password: null,
      emailVerified: true,
      emailVerificationToken: null,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      googleLinked: false,
      stripeCustomerId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any; // Use 'as any' to bypass strict typing for the bypass user
    return next();
  }

  // Safe auth check - handle cases where Passport methods may not exist
  const hasPassport = typeof req.isAuthenticated === "function";
  const isAuthed = hasPassport ? req.isAuthenticated() : !!req.user;
  
  if (!isAuthed || !req.user) {
    console.log("Authentication failed: no session or user");
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = req.user as any;
  console.log("Authentication check - user:", { 
    id: user.id, 
    email: user.email, 
    provider: user.provider,
    hasExpiresAt: !!user.expires_at 
  });

  // Check user status and tokenVersion from database
  const userId = user.claims?.sub || user.id;
  const { storage } = await import('./storage');
  const dbUser = await storage.getUser(userId);
  
  if (!dbUser) {
    console.log("User not found in database");
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check if user is deactivated
  if (dbUser.status === 'INACTIVE') {
    console.log("User is deactivated");
    return res.status(401).json({ 
      code: 'ACCOUNT_INACTIVE',
      message: 'Your account has been deactivated. Contact your administrator.'
    });
  }

  // Check tokenVersion (for session invalidation)
  const sessionTokenVersion = user.claims?.token_version || 0;
  const dbTokenVersion = dbUser.tokenVersion || 0;
  
  if (sessionTokenVersion !== dbTokenVersion) {
    console.log("Token version mismatch - session revoked");
    return res.status(401).json({ 
      code: 'SESSION_REVOKED',
      message: 'Your session has ended. Please sign in again.'
    });
  }

  // For Google OAuth users (no expires_at) or email/password users
  if (!user.expires_at || user.provider === 'email') {
    console.log("Allowing access for Google OAuth or email user");
    return next();
  }

  // For OAuth users with token expiration, check token and refresh if needed
  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    console.log("Token expired and no refresh token available");
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    console.log("Token refresh failed:", error);
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
