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
import { scrypt, randomBytes, timingSafeEqual, createHmac, createPrivateKey, createHash } from "crypto";
import { promisify } from "util";
import { generateUniqueInviteCode, normalizeCode } from "@shared/inviteCode";
import * as appleSignin from "apple-signin-auth";
import jwt from "jsonwebtoken";
import { randomBytes as cryptoRandomBytes } from "crypto";

const authCodeStore = new Map<string, { userId: number; expiresAt: number }>();
const nonceCodeStore = new Map<string, { code: string; expiresAt: number }>();

function generateAuthCode(): string {
  return cryptoRandomBytes(32).toString("hex");
}

function storeAuthCode(userId: number): string {
  const code = generateAuthCode();
  authCodeStore.set(code, { userId, expiresAt: Date.now() + 5 * 60 * 1000 });
  return code;
}

function storeAuthCodeForNonce(nonce: string, userId: number): string {
  const code = storeAuthCode(userId);
  nonceCodeStore.set(nonce, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  console.log("[auth-nonce] Stored code for nonce:", nonce.substring(0, 8) + "...");
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

const isSecure = process.env.NODE_ENV === "production" ||
  process.env.REPLIT_DEV_DOMAIN !== undefined ||
  process.env.REPL_SLUG !== undefined;

let _sessionMiddleware: ReturnType<typeof session> | null = null;

export function getSessionMiddleware() {
  if (_sessionMiddleware) return _sessionMiddleware;
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  _sessionMiddleware = session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'none' : 'lax',
      maxAge: sessionTtl,
    },
  });
  console.log(`[session] cookie secure=${isSecure}, sameSite=${isSecure ? 'none' : 'lax'}`);
  return _sessionMiddleware;
}

export function getSession() {
  return getSessionMiddleware();
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

  app.use(async (req: any, _res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    // Note: do NOT gate on !req.cookies?.['connect.sid'].
    // Capacitor WebViews always carry a connect.sid cookie from the initial
    // unauthenticated page load. If we skip Bearer auth whenever that cookie
    // is present, native Google sign-in can never authenticate.
    // The user-setting middleware below guards with !req.user, so a valid
    // Passport cookie session still takes priority.
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const sessionId = authHeader.slice(7);
      if (sessionId) {
        try {
          const { pool: dbPool } = await import('./db');
          const result = await dbPool.query(
            'SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()',
            [sessionId]
          );
          if (result.rows.length > 0) {
            const sess = result.rows[0].sess;
            if (sess?.passport?.user) {
              const passportUser = sess.passport.user;
              const resolvedUserId = typeof passportUser === 'object' && passportUser?.id
                ? passportUser.id
                : passportUser;
              (req as any)._mobileSessionUserId = resolvedUserId;
              (req as any)._mobileSessionId = sessionId;
              console.log('[MobileAuth] Bearer resolved userId:', resolvedUserId);
            } else {
              console.warn('[MobileAuth] Bearer session found but no passport.user in sess');
            }
          } else {
            console.warn('[MobileAuth] Bearer sessionId not found or expired in DB');
          }
        } catch (err: any) {
          console.error('[MobileAuth] Bearer lookup error:', err?.message);
        }
      }
    }
    next();
  });

  app.use(passport.initialize());
  app.use(passport.session());

  app.use((req: any, _res: any, next: any) => {
    if (!req.user && (req as any)._mobileSessionUserId) {
      const userId = (req as any)._mobileSessionUserId;
      storage.getUser(userId).then((user: any) => {
        if (user) {
          req.user = user;
        }
        next();
      }).catch(() => next());
      return;
    }
    next();
  });

  app.get('/api/auth/debug-session', (req: any, res) => {
    res.json({
      hasSessionID: !!req.sessionID,
      hasUser: !!req.user,
      userId: req.user?.id || req.user?.claims?.sub || null,
      cookiePresent: !!req.headers.cookie,
      origin: req.headers.origin || null,
      host: req.headers.host || null,
      cookieConfig: { secure: isSecure, sameSite: isSecure ? 'none' : 'lax' },
    });
  });

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
  // Prefer the canonical branded domain (APP_PUBLIC_BASE_URL) so Google's consent screen
  // shows app.ecologicc.com rather than the Replit deployment URL.
  const googleAuthBase = process.env.APP_PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:5000';
  const googleCallbackUrl = `${googleAuthBase}/api/auth/google/callback`;
  console.log("[GoogleAuth] callbackURL:", googleCallbackUrl);

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: googleCallbackUrl,
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
        if (user.status?.toUpperCase() === 'INACTIVE') {
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

  // Google auth routes are registered in auth.ts (loaded below via setupMfaAuth).
  // Legacy path aliases:
  app.get("/auth/google", (req, res) => {
    const qs = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    res.redirect(302, `/api/auth/google${qs}`);
  });
  app.get("/auth/google/callback", (req, res) => {
    const qs = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    res.redirect(302, `/api/auth/google/callback${qs}`);
  });

  // Apple Sign-In routes
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY) {
    // Canonical base URL: prefer ECOLOGIC_PUBLIC_URL (always the branded production domain),
    // then APP_PUBLIC_BASE_URL, then APP_BASE_URL as last resort.
    // NEVER derive from the request host at startup — Apple requires a fixed, registered redirect_uri.
    const canonicalBaseUrl = (
      process.env.ECOLOGIC_PUBLIC_URL ||
      process.env.APP_PUBLIC_BASE_URL ||
      process.env.APP_BASE_URL ||
      'https://app.ecologicc.com'
    ).replace(/\/$/, '');

    // Validate APPLE_REDIRECT_URI: reject dev/workspace URLs (picard.replit.dev, replit.dev, localhost).
    // These are ephemeral and not registered with Apple, so using them causes auth failures.
    const rawAppleRedirectUri = process.env.APPLE_REDIRECT_URI || '';
    const isDevUrl = rawAppleRedirectUri && (
      rawAppleRedirectUri.includes('picard.replit.dev') ||
      rawAppleRedirectUri.includes('.replit.dev') ||
      rawAppleRedirectUri.includes('repl.co') ||
      rawAppleRedirectUri.includes('localhost')
    );

    if (isDevUrl) {
      console.warn(`[AppleAuth] ⚠️  APPLE_REDIRECT_URI is set to a dev/workspace URL (${rawAppleRedirectUri}). Overriding with canonical URL. Please update the APPLE_REDIRECT_URI secret to https://app.ecologicc.com/api/auth/apple/callback and register it in Apple Developer Console.`);
    }

    const appleRedirectUri = (rawAppleRedirectUri && !isDevUrl)
      ? rawAppleRedirectUri
      : `${canonicalBaseUrl}/api/auth/apple/callback`;

    console.log(`[AppleAuth] canonicalBaseUrl=${canonicalBaseUrl} appleRedirectUri=${appleRedirectUri}`);

    function getApplePrivateKey(): string {
      let raw = (process.env.APPLE_PRIVATE_KEY || '').trim();
      raw = raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

      if (!raw.includes('-----BEGIN PRIVATE KEY-----') || !raw.includes('-----END PRIVATE KEY-----')) {
        throw new Error('[AppleAuth] APPLE_PRIVATE_KEY is missing BEGIN/END markers');
      }

      const header = '-----BEGIN PRIVATE KEY-----';
      const footer = '-----END PRIVATE KEY-----';
      const body = raw
        .replace(header, '')
        .replace(footer, '')
        .replace(/\s+/g, '');
      const wrapped = body.match(/.{1,64}/g)?.join('\n') || body;
      const key = `${header}\n${wrapped}\n${footer}\n`;

      const lineCount = key.split('\n').length;
      const decodedLen = Buffer.from(body, 'base64').length;
      console.log(`[AppleAuth] Private key: ${key.length} chars, ${lineCount} lines, base64Body=${body.length}, decodedBytes=${decodedLen}`);
      return key;
    }

    const applePrivateKeyPem = getApplePrivateKey();
    let appleSigningKey: any;
    try {
      appleSigningKey = createPrivateKey({ key: applePrivateKeyPem, format: 'pem' });
      console.log(`[AppleAuth] createPrivateKey succeeded: true (KeyObject)`);
    } catch (e: any) {
      console.error(`[AppleAuth] createPrivateKey failed: ${e.message}`);
      console.error(`[AppleAuth] The APPLE_PRIVATE_KEY secret may be corrupted or truncated. Please re-paste the full contents of your Apple .p8 key file.`);
      appleSigningKey = null;
    }

    function buildAppleClientSecret(): string {
      if (!appleSigningKey) {
        throw new Error("Apple private key is not available — APPLE_PRIVATE_KEY secret needs to be re-pasted from the original .p8 file");
      }
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: process.env.APPLE_TEAM_ID,
        iat: now,
        exp: now + 300,
        aud: "https://appleid.apple.com",
        sub: process.env.APPLE_CLIENT_ID,
      };
      const token = jwt.sign(payload, appleSigningKey, {
        algorithm: "ES256",
        header: { kid: process.env.APPLE_KEY_ID!, alg: "ES256" },
      });
      console.log(`[AppleAuth] client_secret generated, length=${token.length}`);
      return token;
    }

    function signAppleState(data: string): string {
      const secret = process.env.SESSION_SECRET || 'fallback';
      return createHmac('sha256', secret).update(data).digest('hex');
    }

    app.get("/api/auth/apple/start", (req, res) => {
      try {
        const state = randomBytes(16).toString('hex');
        const nonce = randomBytes(16).toString('hex');
        const createdAt = Date.now().toString();

        const payload = `${state}:${nonce}:${createdAt}`;
        const sig = signAppleState(payload);

        res.cookie('apple_auth', `${payload}:${sig}`, {
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          maxAge: 10 * 60 * 1000,
          path: '/api/auth/apple/callback',
        });

        const nonceHash = createHash('sha256').update(nonce).digest('hex');

        const params = new URLSearchParams({
          response_type: 'code id_token',
          response_mode: 'form_post',
          client_id: process.env.APPLE_CLIENT_ID!,
          redirect_uri: appleRedirectUri,
          state,
          nonce: nonceHash,
          scope: 'openid name email',
        });

        const url = `https://appleid.apple.com/auth/authorize?${params.toString()}`;

        console.log(`[AppleAuth] start: redirect_uri=${appleRedirectUri} host=${req.get('host')} origin=${req.get('origin') || '-'}`);
        res.json({ url });
      } catch (error) {
        console.error("[AppleAuth] Start error:", error);
        res.status(500).json({ error: "Failed to start Apple Sign-In" });
      }
    });

    app.post("/api/auth/apple/callback", async (req, res) => {
      try {
        const { code, state, id_token: rawIdToken, user: userDataStr } = req.body;

        const appleCookie = req.cookies?.apple_auth;
        console.log(`[AppleAuth] callback cookie present: ${!!appleCookie}`);
        if (!appleCookie) {
          console.error("[AppleAuth] No apple_auth cookie found");
          return res.redirect("/?error=apple_auth_failed&message=Session+expired");
        }

        const parts = appleCookie.split(':');
        if (parts.length !== 4) {
          console.error("[AppleAuth] Malformed cookie");
          return res.redirect("/?error=apple_auth_failed&message=Invalid+session");
        }

        const [savedState, savedNonce, savedCreatedAt, savedSig] = parts;
        const expectedSig = signAppleState(`${savedState}:${savedNonce}:${savedCreatedAt}`);

        if (savedSig !== expectedSig) {
          console.error("[AppleAuth] Cookie signature mismatch");
          return res.redirect("/?error=apple_auth_failed&message=Invalid+session");
        }

        console.log(`[AppleAuth] callback state match: ${savedState === state}`);
        if (savedState !== state) {
          console.error("[AppleAuth] State mismatch");
          return res.redirect("/?error=apple_auth_failed&message=Invalid+state");
        }

        if (Date.now() - parseInt(savedCreatedAt) > 10 * 60 * 1000) {
          console.error("[AppleAuth] Session expired");
          return res.redirect("/?error=apple_auth_failed&message=Session+expired");
        }

        res.clearCookie('apple_auth', { path: '/api/auth/apple/callback' });

        const clientSecret = buildAppleClientSecret();

        const tokenParams = new URLSearchParams({
          client_id: process.env.APPLE_CLIENT_ID!,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: appleRedirectUri,
        });

        const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenParams.toString(),
        });

        if (!tokenRes.ok) {
          const errBody = await tokenRes.text();
          console.error(`[AppleAuth] Token exchange failed: status=${tokenRes.status}, body=${errBody}`);
          return res.redirect("/?error=apple_auth_failed&message=" + encodeURIComponent("Apple token exchange failed"));
        }

        const tokenResponse = await tokenRes.json();
        console.log("[AppleAuth] Token exchange success");

        const expectedNonceHash = createHash('sha256').update(savedNonce).digest('hex');
        const claims = await appleSignin.verifyIdToken(tokenResponse.id_token, {
          audience: process.env.APPLE_CLIENT_ID,
          nonce: expectedNonceHash,
        });

        const appleSub = claims.sub;
        const appleEmail = claims.email || null;
        const appleIsPrivateEmail = claims.is_private_email === 'true' || claims.is_private_email === true;

        let appleUserName: { firstName?: string; lastName?: string } = {};
        if (userDataStr) {
          try {
            const parsed = typeof userDataStr === 'string' ? JSON.parse(userDataStr) : userDataStr;
            appleUserName.firstName = parsed?.name?.firstName || '';
            appleUserName.lastName = parsed?.name?.lastName || '';
          } catch {}
        }

        delete (req.session as any).appleAuth;

        let user = await storage.getUserByAppleSub(appleSub);

        if (user) {
          console.log("[AppleAuth] Existing user found by appleSub:", user.id);
        } else if (appleEmail) {
          const { normalizeEmail } = await import("@shared/emailUtils");
          const normalizedEmail = normalizeEmail(appleEmail);
          const existingUser = await storage.getUserByEmail(normalizedEmail);
          
          if (existingUser) {
            if (!existingUser.appleSub) {
              user = await storage.updateUser(existingUser.id, {
                appleSub,
                appleEmail: normalizedEmail,
                appleIsPrivateEmail,
                emailVerified: true,
              });
              console.log("[AppleAuth] Linked Apple to existing email user:", user.id);
            } else if (existingUser.appleSub !== appleSub) {
              console.error("[AppleAuth] Email already linked to different Apple account");
              return res.redirect("/?error=apple_auth_failed&message=" + encodeURIComponent("This email is already linked to a different Apple account. Please sign in with your original Apple ID or use email/password."));
            } else {
              user = existingUser;
              console.log("[AppleAuth] User matched by email, appleSub already set:", user.id);
            }
          } else {
            user = await storage.createUser({
              id: `apple_${appleSub}`,
              email: normalizedEmail,
              firstName: appleUserName.firstName || '',
              lastName: appleUserName.lastName || '',
              emailVerified: true,
              appleSub,
              appleEmail: normalizedEmail,
              appleIsPrivateEmail,
            });
            console.log("[AppleAuth] Created new user:", user.id);
          }
        } else {
          console.log("[AppleAuth] No email from Apple and no existing appleSub match");
          return res.redirect("/?error=apple_auth_failed&message=" + encodeURIComponent("Apple did not provide an email address. Please try again or sign in with email/password."));
        }

        if (user.status?.toUpperCase() === 'INACTIVE') {
          console.log("[AppleAuth] User is deactivated:", user.id);
          return res.redirect("/?error=account_inactive&message=" + encodeURIComponent("Your account is deactivated. Please contact your company Owner or Supervisor."));
        }

        const sessionUser = {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          provider: 'apple',
          claims: {
            sub: user.id,
            email: user.email,
            first_name: user.firstName,
            token_version: user.tokenVersion || 0,
            last_name: user.lastName,
            profile_image_url: user.profileImageUrl
          }
        };

        req.logIn(sessionUser, (loginErr) => {
          if (loginErr) {
            console.error("[AppleAuth] Login error:", loginErr);
            return res.redirect(`${canonicalBaseUrl}/?error=login_failed`);
          }

          req.session.save((saveErr) => {
            if (saveErr) {
              console.error("[AppleAuth] Session save error:", saveErr);
              return res.redirect(`${canonicalBaseUrl}/?error=session_failed`);
            }
            console.log(`[AppleAuth] Login successful, redirecting to ${canonicalBaseUrl}/`);
            res.redirect(`${canonicalBaseUrl}/`);
          });
        });
      } catch (error: any) {
        console.error("[AppleAuth] Callback error message:", error?.message);
        console.error("[AppleAuth] Callback error stack:", error?.stack);
        if (error?.response) {
          console.error("[AppleAuth] Apple token HTTP status:", error.response.status);
          console.error("[AppleAuth] Apple token response data:", error.response.data);
        }

        if (process.env.NODE_ENV === "development") {
          return res.status(500).json({
            error: "apple_auth_failed",
            message: error?.message,
            stack: error?.stack,
            appleStatus: error?.response?.status,
            appleData: error?.response?.data,
          });
        }

        res.redirect("/?error=apple_auth_failed&message=" + encodeURIComponent("Apple Sign-In failed. Please try again."));
      }
    });
    
    console.log("[AppleAuth] Apple Sign-In routes registered");
  } else {
    console.log("[AppleAuth] Apple Sign-In not configured (missing env vars)");
  }

  // Note: /api/forgot-password is handled by auth.ts (uses Resend to send actual email)

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
      if (user.status?.toUpperCase() === 'INACTIVE') {
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

      if (!role || !["SUPERVISOR", "TECHNICIAN"].includes(role)) {
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

      // ── Provider-aware login gate ───────────────────────────────────────────
      // If the account exists but was created via Google or Apple (no password
      // set), surface a clear "use the right provider" message instead of the
      // generic "Invalid email or password" which misleads the user into
      // thinking no account exists at all.
      if (!user) {
        console.log(`[login/email] no account found — email=${normalizedEmail}`);
        return res.status(401).json({ message: "No account found with this email." });
      }

      if (!user.password) {
        // Determine which provider owns this account
        const hasGoogle = !!user.googleId;
        const hasApple  = !!user.appleSub;

        console.log(
          `[login/email] account exists but has no password — email=${normalizedEmail}` +
          ` googleId=${hasGoogle} appleSub=${hasApple}`
        );

        if (hasGoogle) {
          return res.status(401).json({
            code: "PROVIDER_GOOGLE",
            message: "This account was created with Google. Please continue with Google.",
          });
        }

        if (hasApple) {
          return res.status(401).json({
            code: "PROVIDER_APPLE",
            message: "This account was created with Apple. Please continue with Apple.",
          });
        }

        // Account exists, no password, no known provider — generic fallback
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
      if (user.status?.toUpperCase() === 'INACTIVE') {
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
  
  // Import and setup auth.ts routes (MFA login/signup wizard endpoints)
  const { setupAuth: setupMfaAuth } = await import("./auth");
  setupMfaAuth(app);
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (process.env.BYPASS_AUTH === 'true') {
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
    } as any;
    return next();
  }

  const hasPassport = typeof req.isAuthenticated === "function";
  const isAuthed = hasPassport ? req.isAuthenticated() : !!req.user;
  const _authHdr = req.headers['authorization'] || '';
  const _hasAuthorization = _authHdr.startsWith('Bearer ');
  const _usingMobileAuth = _hasAuthorization && !!((req as any)._mobileSessionUserId);
  if (req.path === '/api/auth/user') {
    console.log(`[auth/user][server] hasAuthorization=${_hasAuthorization} usingMobileAuth=${_usingMobileAuth} hasCookie=${!!req.headers.cookie} host=${req.headers.host} origin=${req.headers.origin || '-'} mobileUserId=${(req as any)._mobileSessionUserId || 'none'}`);
  }

  if (!isAuthed || !req.user) {
    if (process.env.AUTH_DEBUG === 'true' || req.path === '/api/auth/user') {
      console.log("[auth] 401:", {
        path: req.path,
        hasCookie: !!req.headers.cookie,
        hasBearer: _hasAuthorization,
        bearerPrefix: _authHdr ? _authHdr.substring(0, 16) : '(none)',
        hasSessionID: !!req.sessionID,
        mobileUserId: (req as any)._mobileSessionUserId || null,
        secure: req.secure,
        proto: req.headers['x-forwarded-proto'],
        origin: req.headers.origin || '-',
        host: req.headers.host,
      });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" });
  }

  const user = req.user as any;

  // Check user status and tokenVersion from database
  const userId = user.claims?.sub || user.id;
  const { storage } = await import('./storage');
  const dbUser = await storage.getUser(userId);
  
  if (!dbUser) {
    console.log("User not found in database");
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check if user is deactivated
  if (dbUser.status?.toUpperCase() === 'INACTIVE') {
    console.log("User is deactivated");
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(401).json({ 
      code: 'ACCOUNT_INACTIVE',
      message: 'Your account has been deactivated. Contact your administrator.'
    });
  }

  // Check tokenVersion (for session invalidation).
  // Only perform the check when the session explicitly carries a token_version in its
  // claims object.  Sessions created via the auth.ts Google-OAuth or email/password
  // paths store the raw DB user (no claims key), so token_version is undefined there.
  // In that case we skip the check: the session was just created by a fresh login and
  // the primary invalidation mechanism (deleting session rows on removal) already handles
  // stale-session revocation.  Comparing undefined-derived 0 to a positive tokenVersion
  // would falsely revoke every valid Google-OAuth session for users whose tokenVersion
  // was ever incremented.
  const sessionTokenVersion = user.claims?.token_version;
  if (sessionTokenVersion !== undefined) {
    const dbTokenVersion = dbUser.tokenVersion || 0;
    if (sessionTokenVersion !== dbTokenVersion) {
      console.log(`[auth] Token version mismatch — session revoked (session=${sessionTokenVersion} db=${dbTokenVersion} userId=${userId})`);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      return res.status(401).json({ 
        code: 'SESSION_REVOKED',
        message: 'Your session has ended. Please sign in again.'
      });
    }
  }

  if (!user.expires_at || user.provider === 'email') {
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
