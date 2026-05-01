/**
 * Dashboard Admin Auth Routes & Bootstrap
 * ────────────────────────────────────────
 * Dedicated login flow for dashboard admins.
 *
 * Endpoint (no auth gate — this IS the auth endpoint):
 *   POST /api/admin/dashboard/auth/login
 *     Accepts { email, password }.
 *     Verifies admin email is in DASHBOARD_ADMIN_EMAILS.
 *     Verifies password against user's stored hash.
 *     Creates the Passport session directly (no OTP step).
 *     Returns { ok: true } on success.
 *
 *   Customer app login/signup OTP flows are completely untouched.
 *
 * Startup bootstrap (bootstrapDashboardAdminPassword):
 *   If DASHBOARD_BOOTSTRAP_ADMIN_ENABLED=true, hashes
 *   DASHBOARD_BOOTSTRAP_ADMIN_PASSWORD and saves it to the admin user's
 *   record on startup.  Only overwrites an existing hash when
 *   DASHBOARD_BOOTSTRAP_ADMIN_OVERWRITE=true.
 *   The plaintext password is never logged.
 */

import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { isDashboardAdminEmail } from "./access";
import { pickCookieDomainForHost } from "../replitAuth";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

/**
 * Startup hook: seeds a password hash for the configured dashboard admin
 * if the bootstrap env vars are present.
 *
 * Env vars consumed (all optional — no effect when absent):
 *   DASHBOARD_BOOTSTRAP_ADMIN_ENABLED=true     must be exactly "true" to run
 *   DASHBOARD_BOOTSTRAP_ADMIN_EMAIL            the admin's email address
 *   DASHBOARD_BOOTSTRAP_ADMIN_PASSWORD         plaintext password to hash & save
 *   DASHBOARD_BOOTSTRAP_ADMIN_OVERWRITE=true   overwrite an existing hash
 *
 * Safe to call on every startup — it is idempotent by default.
 */
export async function bootstrapDashboardAdminPassword(): Promise<void> {
  if (process.env.DASHBOARD_BOOTSTRAP_ADMIN_ENABLED !== "true") return;

  const email = (process.env.DASHBOARD_BOOTSTRAP_ADMIN_EMAIL || "").toLowerCase().trim();
  const plaintext = (process.env.DASHBOARD_BOOTSTRAP_ADMIN_PASSWORD || "").trim();
  const overwrite = process.env.DASHBOARD_BOOTSTRAP_ADMIN_OVERWRITE === "true";

  if (!email || !plaintext) {
    console.warn(
      "[dashboard-auth] bootstrap skipped — DASHBOARD_BOOTSTRAP_ADMIN_EMAIL or DASHBOARD_BOOTSTRAP_ADMIN_PASSWORD not set"
    );
    return;
  }

  if (!isDashboardAdminEmail(email)) {
    console.warn(
      `[dashboard-auth] bootstrap skipped — ${email} is not in DASHBOARD_ADMIN_EMAILS`
    );
    return;
  }

  try {
    const user = await storage.getUserByEmail(email);
    if (!user) {
      console.warn(`[dashboard-auth] bootstrap skipped — no user found for ${email}`);
      return;
    }

    if (user.password && !overwrite) {
      console.log(
        `[dashboard-auth] bootstrap skipped — password hash already exists for ${email} (set DASHBOARD_BOOTSTRAP_ADMIN_OVERWRITE=true to force)`
      );
      return;
    }

    const hashed = await hashPassword(plaintext);
    await storage.updateUser(user.id, { password: hashed });

    console.log(`[dashboard-auth] bootstrap admin password hash set for ${email}`);
  } catch (err) {
    console.error("[dashboard-auth] bootstrap error:", err);
  }
}

export function registerDashboardAuthRoutes(app: Express): void {
  /**
   * POST /api/admin/dashboard/auth/login
   * Body: { email: string; password: string }
   *
   * 1. Verifies the email is in DASHBOARD_ADMIN_EMAILS.
   * 2. Verifies the password against the user's stored hash.
   * 3. Creates a Passport session directly (no OTP step).
   * 4. Returns { ok: true } — frontend marks session active and loads dashboard.
   */
  app.post("/api/admin/dashboard/auth/login", async (req: Request, res: Response) => {
    try {
      const host = req.headers.host ?? "(none)";
      const origin = req.headers.origin ?? "(none)";
      const cookieDomain = pickCookieDomainForHost(host) ?? "(host-scoped)";
      console.log(
        `[dashboard-auth/login] host=${host} origin=${origin} cookieDomain=${cookieDomain}` +
          ` sessionID=${req.sessionID ?? "(none)"} alreadyAuthed=${typeof req.isAuthenticated === "function" ? req.isAuthenticated() : "n/a"}`
      );

      const { email, password } = req.body as { email?: string; password?: string };

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
      }

      const normalizedEmail = email.toLowerCase().trim();

      if (!isDashboardAdminEmail(normalizedEmail)) {
        console.log(`[dashboard-auth] login denied — not an admin email: ${normalizedEmail}`);
        return res.status(403).json({ message: "Access denied." });
      }

      const user = await storage.getUserByEmail(normalizedEmail);
      if (!user) {
        return res.status(400).json({ message: "Invalid email or password." });
      }

      if (!user.password) {
        return res.status(400).json({
          message: "No password is set for this account. Contact the administrator.",
        });
      }

      const isValid = await comparePasswords(password, user.password);
      if (!isValid) {
        return res.status(400).json({ message: "Invalid email or password." });
      }

      // Establish the Passport session by writing directly into req.session.passport,
      // bypassing passport.serializeUser entirely.
      //
      // Why not req.login(user, cb)?
      //   Passport v0.7 regenerates the session on logIn().  More critically, the project
      //   has two competing serializeUser registrations:
      //     • replitAuth.ts (first, FIFO): cb(null, user)  → stores WHOLE user object
      //     • auth.ts        (second):     done(null, user.id) → stores bare ID string
      //   The FIFO winner (replitAuth.ts) stores the plain DB user object.  On the NEXT
      //   request replitAuth.ts's deserializeUser → (stored, cb) => cb(null, stored) returns
      //   it verbatim.  But if auth.ts's serializer ever wins first (order is runtime-
      //   dependent) it stores just the string ID.  replitAuth.ts's deserializer then hands
      //   that raw string to req.user, breaking every req.user.id lookup.
      //
      // Fix: regenerate the session ourselves (session-fixation protection), then write
      //   req.session.passport.user = user (whole DB object).  replitAuth.ts's
      //   deserializer always returns it as-is, so req.user is the correct DB user.
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error("[dashboard-auth] session regenerate error:", regenErr);
          return res.status(500).json({ message: "Sign-in failed. Please try again." });
        }
        // Re-apply host-aware cookie Domain on the regenerated session so the
        // new Set-Cookie carries `Domain=.ecologicc.com` (matching the old one
        // and overwriting it in the browser cookie jar).
        const desiredDomain = pickCookieDomainForHost(req.headers.host);
        if (desiredDomain) {
          (req.session.cookie as any).domain = desiredDomain;
        }
        (req.session as any).passport = { user };
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("[dashboard-auth] session save error:", saveErr);
            return res.status(500).json({ message: "Session error. Please try again." });
          }

          // Defensively clear any LEGACY host-scoped `connect.sid` cookie that
          // older deployments may have left in the browser. Browsers key cookies
          // by (name, domain, path); a host-scoped cookie has a different jar
          // key from a Domain=.ecologicc.com cookie, so the new domain-scoped
          // Set-Cookie does NOT overwrite a pre-existing host-scoped one. Both
          // would coexist, and per RFC 6265 §5.4 the older one is often sent
          // first — which (post-regenerate) points at a destroyed session, so
          // /me returns 401 on the very next request.
          //
          // We append a clearing Set-Cookie (no Domain attribute → targets the
          // host-scoped jar entry) with Max-Age=0. Express-session's own
          // Set-Cookie for the new sessionID (with Domain=.ecologicc.com)
          // is appended separately at response.end(), so both ship together.
          const isSecure =
            (req as any).secure === true ||
            (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() === "https";
          const sameSite = isSecure ? "None" : "Lax";
          const secureAttr = isSecure ? "; Secure" : "";
          res.append(
            "Set-Cookie",
            `connect.sid=; Path=/; Max-Age=0; HttpOnly${secureAttr}; SameSite=${sameSite}`
          );

          console.log(
            `[dashboard-auth] admin signed in: ${normalizedEmail}` +
              ` newSessionID=${req.sessionID ?? "(none)"} cookieDomain=${desiredDomain ?? "(host-scoped)"}` +
              ` legacyHostScopedClear=true`
          );
          return res.json({ ok: true });
        });
      });
    } catch (err) {
      console.error("[dashboard-auth] login error:", err);
      return res.status(500).json({ message: "Sign-in failed. Please try again." });
    }
  });
}
