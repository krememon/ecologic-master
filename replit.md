# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform for trade contractors, aiming to centralize job management, subcontractor coordination, client communication, and invoicing. It modernizes construction workflows, improves project oversight, and enhances stakeholder communication through a real-time, PWA-enabled web application. The platform seeks to innovate construction project management using advanced technology and user-centric design to maximize efficiency and profitability for contractors.

## User Preferences
Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Quad authentication options (Email/Password + Replit + Google OAuth + Apple Sign-In)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title

## System Architecture
EcoLogic is a multi-tenant web application using React 18 (TypeScript, Vite, Tailwind CSS with shadcn/ui, TanStack Query, Wouter, React Hook Form) for the frontend and Node.js with Express.js (TypeScript) and PostgreSQL with Drizzle ORM for the backend.

**UI/UX**:
- Responsive design with PWA support and dark mode.
- Accessible components primarily from Radix UI, incorporating custom "EcoLogic" branding and logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google, Apple) with robust session management. Single session middleware in `replitAuth.ts` (no duplicate in `auth.ts`). Cookie: `secure=true`+`sameSite=none` on Replit/HTTPS, `lax` locally. Mobile auth via `Authorization: Bearer <sessionId>` middleware in `replitAuth.ts`. CORS middleware in `index.ts` for credentials. Apple Sign-In uses `apple-signin-auth` with server-side token exchange, nonce+state CSRF protection, and `response_mode=form_post`.
- **Data Management**: PostgreSQL with Drizzle ORM, implementing multi-tenancy and role-based access control (RBAC). Automated constraint enforcement.
- **Real-time Capabilities**: WebSocket server authenticates via session cookie on HTTP upgrade (no client-provided userId). Uses `noServer` mode with `getSessionMiddleware()` + passport pipeline. Frontend `useWebSocket` hook no longer sends auth message; backoff reconnect on auth failures.
- **Push Notifications**: iOS native push via direct APNs HTTP/2 with .p8 token-based auth. `push_tokens` table stores device tokens per user. Backend `server/apns.ts` sends via APNs HTTP/2 with JWT signing; `server/pushService.ts` wraps APNs calls. Push triggered centrally from `notificationService.ts` for all notification types. Frontend: manual "Enable Notifications" button in Settings page (no auto-prompt). Local notification test button for instant verification. Foreground pushes mirrored as local notifications. Endpoints: `POST /api/push/register`, `/api/push/unregister`, `/api/push/test`. Requires `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID`, `APNS_AUTH_KEY_P8` secrets + Push Notifications capability in Xcode. See `IOS_SETUP.md` for complete setup guide.
- **Messaging System**: Comprehensive two-pane interface with 1:1 conversations, real-time delivery, read receipts, and unread counts.
- **File Management**: Handles job photos and documents with cloud storage integration.
- **Document Visibility System**: Role-based document visibility (customer_internal, assigned_crew_only, office_only, internal, owner_only) enforced at the API level.
- **Signature Requests**: Electronic signature system with RBAC, secure access tokens, status workflow, and branded email notifications.
- **Employee Management**: Manages employee status and contact information.
- **Onboarding**: Invite code system for company onboarding, including owner registration, member joining, and industry-specific Price Book seeding.
- **Subscription Management**: Team size-based plan auto-selection during onboarding (Starter/Team/Pro/Scale). Config in `shared/subscriptionPlans.ts`. DEV mode uses `POST /api/subscriptions/dev-activate` to set `active` status with 7-day `currentPeriodEnd`. App gate in `App.tsx` checks `isSubscriptionActive()` (status + expiration); expired subscriptions redirect to `/paywall`. `/api/subscriptions/validate` endpoint stubbed with TODO markers for future Apple/Google receipt validation. Subscription gating prevents unsubscribed users from accessing the app.
- **Timezone Handling**: Robust timezone conversion utilities.
- **Estimates System**: Job-scoped estimate creation with line item editor, unique numbers, monetary values in cents, and RBAC.
- **Customer Management**: Manages customer data for estimate recipients with an iOS-style picker.
- **Price Book (Service Catalog)**: Owner-only customization for reusable line item templates with full CRUD operations and RBAC.
- **Company Profile**: Owner-only feature for managing company identity and branding.
- **Tax Management**: Owner-only feature for creating custom tax rates applied to invoices, with per-item tax selection.
- **Payment Collection**: Multi-method payment collection (Cash, Check, Card via Stripe) with idempotent processing and RBAC.
- **Payment Receipt Emails**: Automatic receipt email sent to customer after payment signature is saved (all methods: cash, check, card). Idempotent via `receiptEmailSentAt` column. Uses Resend with branded HTML template.
- **Refund System**: Manual refund recording (Cash, Check, Card, Other) with RBAC, updating invoice totals and payment ledger.
- **Payments Tracker**: Contractor-first dashboard with real-time financial overview, filterable invoices, receipt-style feed, and partial payment support.
- **Payment Signature Capture**: Configurable post-payment signature collection with `react-signature-canvas` and server-side de-duplication.
- **Invoice Sending**: Invoices can be sent via Email (Resend) or SMS (Twilio) with payment links.
- **Leads Management**: Dedicated section for tracking potential customers, linked to existing customers, with RBAC.
- **Time Tracking (Clock In/Out)**: Job-aware time tracking for technicians, with aggregated "Labor Today" for managers. Includes auto clock-out.
- **Timesheet Editing (Manager-Only)**: Managers can edit time entries with an audit trail and RBAC.
- **Archival**: Automatic archival for estimates (when converted) and jobs (when completed and paid).
- **Schedule Events (Company Calendar)**: Manager-created calendar events (holidays, meetings, reminders) with RBAC-enforced visibility and CRUD operations.
- **Notifications System**: In-app notification system with 28 types, unread badges, mark-as-read, and deep linking, role-targeted with deduplication. Includes `tech_clocked_in`/`tech_clocked_out` (managers only, excludes self), `job_starting_soon` (30-min scheduler via `server/jobScheduler.ts`), `invoice_paid` (OWNER only), `job_unassigned` (removed crew members), and DM push delivery via `notifyUsers`.
- **QuickBooks Online Integration**: Owner-only QBO integration via OAuth 2.0 for customer mapping, manual invoice sync, and automatic payment sync.
- **Bulk Email/SMS Campaigns**: Bulk promotional messaging to customers from the Clients page with multi-select, preview, opt-in management, and campaign tracking.
- **Email Unsubscribe System**: Secure one-click unsubscribe for marketing emails with HMAC-signed tokens and public endpoints.
- **Plaid Bank Connection**: Owner-only Plaid Link integration for connecting company bank accounts, with encrypted token storage.
- **Security Hardening**: Comprehensive cross-tenant data isolation, centralized RBAC, secure storage methods, rate limiting, log sanitization, and 404 responses for unauthorized access.
- **Native Wrapper Google OAuth**: System-browser flow for Capacitor iOS/Android wrappers using `@capacitor/browser` + `ecologic://` deep link scheme + one-time auth code exchange (`/api/auth/exchange-code`). Avoids Google's `disallowed_useragent` 403 in WKWebView. Web flow unchanged.
- **Stripe Payment Element (In-App Payments)**: Card payments use Stripe PaymentIntents with `@stripe/react-stripe-js` PaymentElement rendered inline — no redirect to checkout.stripe.com. `POST /api/payments/stripe/create-intent` (authenticated) and `POST /api/public/invoices/create-intent` (public) create PaymentIntents. `StripePaymentForm` component wraps Elements provider with `redirect: 'if_required'`. Webhook handles `payment_intent.succeeded` and `payment_intent.payment_failed` events. Works in web browser and iOS Capacitor wrapper without SFSafariViewController. AASA file at `/.well-known/apple-app-site-association` serves Universal Links for `/invoice/*/pay` and `/auth/*` paths. Payment link sharing copies the public invoice URL (`/invoice/{id}/pay`) to clipboard instead of creating Checkout Sessions. **No saved cards/Link**: PaymentIntents are created without `customer`, `customer_email`, or `setup_future_usage`; PaymentElement disables wallets and forces `paymentMethodOrder: ['card']`. If Link still appears, disable it in Stripe Dashboard → Settings → Payments → Link. Partial payments supported: user toggles partial, enters amount, new PaymentIntent is created with the exact amount. Elements re-mount via `key={clientSecret}` when amount changes.
- **Invoice Payment Recompute (Source of Truth)**: Invoice `paidAmountCents`, `balanceDueCents`, and `status` are computed from `SUM(payments.amountCents WHERE status IN paid/succeeded/completed)` — not incremental. Shared logic in `server/invoiceRecompute.ts` (`recomputeInvoiceTotalsFromPayments`, `persistRecomputedTotals`). Used by: webhook handlers (`payment_intent.succeeded`, `checkout.session.completed`), manual payment routes, and Stripe confirm endpoint. GET `/api/invoices` and `/api/invoices/:id` return `computedStatus`, `paidAmountCents`, `balanceDueCents` computed from payment records. GET `/api/payments/ledger` also computes `paidCents`/`balanceCents` from payment rows. `stripe_webhook_events` table logs all webhook receipts for debugging. Debug endpoints: `GET /api/debug/stripe/webhooks/recent` (owner-only, last 20 events), `GET /api/debug/invoice/:id/recompute` (owner-only, shows computed totals + payment rows).

## Mobile App (React Native + Expo)
EcoLogic Mobile lives in `/mobile` and is a native iOS/Android app built with Expo (TypeScript).
- **Auth**: Uses `POST /api/login` with `X-Client-Type: mobile` header to get a `sessionId`, stored in `expo-secure-store`
- **Session Handling**: Backend middleware accepts `Authorization: Bearer <sessionId>` and loads the session from the PostgreSQL session store; active tracking session persisted in SecureStore for app restart resilience
- **Navigation**: React Navigation with AuthStack (Login) and AppTabs (Schedule, Jobs, Clock)
- **Location Tracking**: `expo-location` + `expo-task-manager` for background GPS pings while clocked in (Highest accuracy, 10s interval, 10m distance filter)
- **Schedule Screen**: List/Map toggle with `react-native-maps` map view and FlatList view, polling `GET /api/location/live` every 10s with RBAC markers
- **Backend Endpoints**: `POST /api/location/ping` (auth + session ownership, upserts `user_live_locations`, accepts `accuracy`/`accuracy_m`/`altitude` and `capturedAt`/`captured_at`), `GET /api/location/live` (uses `user_live_locations` table, RBAC: Owner sees all, others see only self), `GET /api/schedule/live-locations` (legacy)
- **DB Tables**: `employee_location_pings` stores lat/lng/accuracy/altitude/heading/speed/capturedAt tied to time_logs; `user_live_locations` stores current position per user for fast live queries
- **Location Permissions**: Warning banner with "Open Settings" button when background location is denied
- **To run**: Clone, `cd mobile && npm install`, `npx expo run:ios` or `npx expo run:android` (requires Xcode/Android Studio)

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js, Replit Auth, Google OAuth, Apple Sign-In (apple-signin-auth)
- **Email**: Resend
- **SMS**: Twilio
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Payments**: Stripe
- **Bank Integration**: Plaid