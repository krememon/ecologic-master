import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { storage } from "./storage";
import { User as SelectUser, InsertUser } from "@shared/schema";
import connectPg from "connect-pg-simple";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

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
  if (!process.env.SMTP_USER) return; // Skip if no email configured
  
  const resetUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/reset-password?token=${token}`;
  
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Reset your EcoLogic password",
    html: `
      <h2>Password Reset Request</h2>
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
  });
}

export function setupAuth(app: Express) {
  // Session configuration
  const PostgresSessionStore = connectPg(session);
  const sessionStore = new PostgresSessionStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: 7 * 24 * 60 * 60 * 1000, // 1 week
  });

  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
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
            let user = await storage.getUserByProvider("google", profile.id);
            
            if (!user) {
              // Check if user exists with same email
              user = await storage.getUserByEmail(profile.emails?.[0]?.value || "");
              
              if (user) {
                // Link Google account to existing user
                await storage.updateUser(user.id, {
                  provider: "google",
                  providerId: profile.id,
                });
              } else {
                // Create new user
                user = await storage.createUser({
                  email: profile.emails?.[0]?.value || "",
                  firstName: profile.name?.givenName || "",
                  lastName: profile.name?.familyName || "",
                  profileImageUrl: profile.photos?.[0]?.value || "",
                  provider: "google",
                  providerId: profile.id,
                  emailVerified: true, // Google emails are pre-verified
                });
              }
            }
            
            return done(null, user);
          } catch (error) {
            return done(error);
          }
        }
      )
    );
  }

  // Facebook Strategy
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(
      new FacebookStrategy(
        {
          clientID: process.env.FACEBOOK_APP_ID,
          clientSecret: process.env.FACEBOOK_APP_SECRET,
          callbackURL: "/api/auth/facebook/callback",
          profileFields: ["id", "emails", "name", "picture"],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            let user = await storage.getUserByProvider("facebook", profile.id);
            
            if (!user) {
              user = await storage.getUserByEmail(profile.emails?.[0]?.value || "");
              
              if (user) {
                await storage.updateUser(user.id, {
                  provider: "facebook",
                  providerId: profile.id,
                });
              } else {
                user = await storage.createUser({
                  email: profile.emails?.[0]?.value || "",
                  firstName: profile.name?.givenName || "",
                  lastName: profile.name?.familyName || "",
                  profileImageUrl: profile.photos?.[0]?.value || "",
                  provider: "facebook",
                  providerId: profile.id,
                  emailVerified: true,
                });
              }
            }
            
            return done(null, user);
          } catch (error) {
            return done(error);
          }
        }
      )
    );
  }

  // Microsoft Strategy
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
          callbackURL: "/api/auth/microsoft/callback",
          scope: ["user.read"],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            let user = await storage.getUserByProvider("microsoft", profile.id);
            
            if (!user) {
              user = await storage.getUserByEmail(profile.emails?.[0]?.value || "");
              
              if (user) {
                await storage.updateUser(user.id, {
                  provider: "microsoft",
                  providerId: profile.id,
                });
              } else {
                user = await storage.createUser({
                  email: profile.emails?.[0]?.value || "",
                  firstName: profile.name?.givenName || "",
                  lastName: profile.name?.familyName || "",
                  profileImageUrl: profile.photos?.[0]?.value || "",
                  provider: "microsoft",
                  providerId: profile.id,
                  emailVerified: true,
                });
              }
            }
            
            return done(null, user);
          } catch (error) {
            return done(error);
          }
        }
      )
    );
  }

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Auth Routes
  
  // Email/Password Registration
  app.post("/api/register", async (req, res) => {
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

  // Email/Password Login
  app.post("/api/login", (req, res, next) => {
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

  // Password Reset Request
  app.post("/api/forgot-password", async (req, res) => {
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

  // Password Reset
  app.post("/api/reset-password", async (req, res) => {
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