# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform designed for trade contractors to centralize job management, subcontractor coordination, client communication, and invoicing. It aims to modernize construction workflows, improve project oversight, and enhance stakeholder communication through a real-time, PWA-enabled web application. The project seeks to innovate construction project management using advanced technology and user-centric design.

## User Preferences
Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Triple authentication options (Email/Password + Replit + Google OAuth)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title

## System Architecture
EcoLogic is a multi-tenant web application utilizing React 18 (TypeScript, Vite, Tailwind CSS with shadcn/ui, TanStack Query, Wouter, React Hook Form) for the frontend and Node.js with Express.js (TypeScript) and PostgreSQL with Drizzle ORM for the backend.

**UI/UX**:
- Responsive design with PWA support and dark mode.
- Accessible components primarily from Radix UI, incorporating custom "EcoLogic" branding and logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google) with robust session management and atomic session revocation.
- **Data Management**: PostgreSQL with Drizzle ORM for type-safe operations, implementing multi-tenancy and role-based access control (RBAC).
- **Real-time Capabilities**: Utilizes a WebSocket server for live messaging, notifications, and instant job status updates, complemented by service worker-based push notifications.
- **Messaging System**: A comprehensive two-pane messaging interface with 1:1 conversations, real-time delivery, read receipts, and unread counts, featuring an iOS-style inbox with message previews and guaranteed delivery.
- **Database Initialization**: Automated constraint enforcement system using PostgreSQL triggers.
- **File Management**: Handles job photos and documents with cloud storage integration.
- **Document Visibility System**: Implements a role-based document visibility model with five levels (customer_internal, assigned_crew_only, office_only, internal, owner_only), enforced at the API level.
- **Signature Requests**: An electronic signature system for sending documents to customers, featuring RBAC enforcement, document visibility filtering, secure access tokens, status workflow, branded email notifications via Resend, and a standalone public signing flow.
- **Employee Management**: Manages employee status, session revocation, and contact information.
- **Onboarding**: Features an invite code system for company onboarding, supporting owner registration, new member joining, and company rejoin flows. Includes industry selection onboarding for new owners that seeds the Price Book with industry-specific preset items.
- **Subscription Management**: Integrates Stripe for subscription plans, enabling role-based access control and plan-based feature limits.
- **Atomic Operations**: Critical workflows are implemented as atomic transactions.
- **Timezone Handling**: Robust timezone conversion utilities.
- **Estimates System**: Provides job-scoped estimate creation with a line item editor, unique estimate numbers, monetary values stored in cents, and RBAC for management. Supports employee assignment to estimates.
- **Customer Management**: Manages customer data for estimate recipients, featuring an iOS-style customer picker with search and an "Add Customer" modal, with RBAC applied to customer creation.
- **Estimate Builder**: Redesigned iOS-style sectioned form for creating estimates within the Job Details page, offering "list" and "create" view modes with RBAC for editability.
- **Price Book (Service Catalog)**: An owner-only customization feature allowing creation of reusable line item templates for estimates with name, description, default price, unit type, and category. Features full CRUD operations with RBAC enforcement.
- **Company Profile**: Owner-only feature for managing company identity and branding (name, logo, contact info, license, footer text) which appears on estimates, invoices, and customer documents.
- **Tax Management**: Owner-only feature for creating custom tax rates (name, percentage) to apply to invoices, with inline validation and duplicate name prevention.
- **Line Item Tax Selection**: Job line items support per-item tax selection. When "Taxable" is ON, a tax selector appears, allowing users to pick from saved company taxes. Tax data is stored per line item to preserve the rate at selection time.
- **Payment Collection**: Multi-method payment collection (Cash, Check, Card via Stripe) on the Payment Review screen. Includes idempotent manual payment processing and RBAC enforcement.
- **Refund System**: Multi-method refund support (Card via Stripe, Bank via Plaid, Cash, Check) with RBAC enforcement. Features:
  - Card refunds process immediately via Stripe API
  - Bank (Plaid) refunds use pending-until-settled accounting: refund created with status 'pending', totals NOT updated until Plaid webhook confirms 'settled'
  - Cash/Check refunds apply immediately as 'succeeded'
  - Aggregation separates settled refunds (succeeded/settled) from pending refunds (pending/posted) for accurate Net Collected calculations
  - Plaid webhook endpoint (`/api/webhooks/plaid/refund`) with secret verification handles status transitions and applies totals atomically on settlement
  - Frontend shows "Pending refund: $X" inline note on invoice cards and detail pages without affecting displayed totals
  - Payment history distinguishes settled vs pending refund lines per payment
  - Failed/returned refunds marked accordingly without affecting totals
- **Payments Tracker**: Contractor-first payments dashboard with real-time financial overview. Features:
  - Scoreboard with This Month, Still Owed, Paid Today, and Overdue statistics
  - Filter tabs for All, Paid, Partial, Unpaid, and Overdue invoices
  - Receipt-style payment feed showing invoice cards with status badges and amounts
  - Partial payment support with paidAmountCents and balanceDueCents tracking on invoices
  - Record Payment modal with client/invoice selection and payment method options
  - Payment Details modal with timeline view showing payment history
  - Job paymentStatus syncs with invoice status (unpaid/partial/paid)
- **Invoice Sending**: Invoices can be sent via Email (Resend) or SMS (Twilio) with a segmented toggle in the Send Invoice modal. Email mode sends branded HTML emails; Text mode sends SMS via Twilio with invoice details and a payment link.
- **Leads Management**: A dedicated section for tracking potential customers, linked to existing customers. Features customer data, description, notes, source tracking, status workflow, and timestamps. RBAC enforced to restrict access to managers.
- **Time Tracking (Clock In/Out)**: A "Time Today" section on the homepage for job-aware time tracking. Technicians can clock in/out to specific jobs or non-job categories, view their logged hours, and switch jobs. Owners/Supervisors/Dispatchers see aggregate "Labor Today" data.
- **Auto Clock-Out**: Configurable company setting to automatically close forgotten time entries at a set time, showing an "Auto-closed" tag on Timesheets.
- **Timesheet Editing (Manager-Only)**: Managers (Owner, Supervisor) can edit time entries to correct mistakes, with audit trail and RBAC enforcement. Edited entries display a blue "Edited" tag.
- **Notifications System**: In-app notification system with 13 types (job_assigned, job_rescheduled, payment_collected, invoice_paid, estimate_approved, invoice_overdue, dm_message, announcement, etc.), featuring a bell icon with unread badge, slide-over inbox, mark-as-read functionality, click-to-navigate deep linking, and per-type icons. Notifications are role-targeted with configurable deduplication windows (60min default, 24h for overdue). Periodic overdue invoice checker runs every 6 hours. Document-related notifications are excluded.
- **QuickBooks Online Integration**: Owner-only feature for connecting to QuickBooks Online (Sandbox/Production) via OAuth 2.0. Features secure token storage, automatic token refresh, disconnect functionality, customer mapping (search by DisplayName/email or create), manual invoice sync with "Sync to QB" button on Payment Review page (idempotent), and automatic payment sync (cash/check/card/Stripe) with waiting-state handling when invoice not yet synced. Payment sync includes: atomic compare-and-set locking to prevent duplicate QBO payments, QBO-side de-duplication via PaymentRefNum lookup, DepositToAccountRef to Undeposited Funds or Bank account, and comprehensive [QB-PAY] logging for debugging.
- **Bulk Email/SMS Campaigns**: A feature enabling managers (Owner, Supervisor, Dispatcher) to send bulk promotional messages to customers from the Clients page. Features:
  - Multi-select mode on Clients page with "Send Email/Text" bulk action button
  - CampaignModal component with channel selection (Email, SMS, or Both)
  - Preview functionality showing eligible recipient counts based on opt-in status
  - Customer opt-in management via Communication Preferences on ClientDetail page
  - Automatic SMS unsubscribe handling via STOP keyword webhook (`/api/webhooks/sms`)
  - Campaign tracking with `campaigns` and `campaign_recipients` tables for audit trail
  - Rate limiting to 500 recipients per send to prevent abuse
  - Email via Resend and SMS via Twilio with centralized messaging service
- **Email Unsubscribe System**: Secure one-click unsubscribe for marketing emails. Features:
  - HMAC-signed unsubscribe tokens with 180-day expiry (`server/services/unsubscribe.ts`)
  - Public unsubscribe endpoints: `GET /api/public/unsubscribe/email` and `/api/public/unsubscribe/sms`
  - Per-recipient unique unsubscribe URLs generated at send time
  - List-Unsubscribe and List-Unsubscribe-Post headers for email client compatibility
  - Clickable unsubscribe link in email footer with simple HTML confirmation page
  - Automatic filtering of opted-out recipients (emailOptIn/smsOptIn + unsubscribedAt checks)
  - Token verification includes company ownership check for cross-tenant security
- **Plaid Bank Connection**: Owner-only Plaid Link integration for connecting company bank accounts. Features sandbox-first setup, encrypted token storage (AES-256-GCM via ENCRYPTION_KEY), link token creation, public token exchange, connection status, and disconnect with Plaid item removal. RBAC enforced server-side (Owner only). UI card in Settings page showing connection status with institution name and last-4 mask.
- **Security Hardening**: Comprehensive cross-tenant data isolation to prevent IDOR vulnerabilities. Features:
  - Centralized security infrastructure (`server/security/permissions.ts`, `server/security/middleware.ts`) for consistent RBAC and UserContext handling
  - Company-scoped secure storage methods (`getJobSecure`, `getInvoiceSecure`, `getDocumentSecure`, `getCustomerSecure`, `getEstimateSecure`, `getClientSecure`) that enforce company ownership verification via AND clauses
  - Document routes secured with company verification to prevent cross-tenant access
  - Rate limiting on auth endpoints (login: 5/15min, register: 5/hour, password reset: 3/hour) using express-rate-limit
  - Log sanitization to prevent sensitive data exposure (passwords, tokens, secrets)
  - 404 responses for unauthorized resource access (not 403) to prevent information leakage
  - Security isolation test suite (`server/security/isolation-test.ts`) for verifying cross-tenant protection

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js strategies, Replit Auth, Google OAuth
- **Email**: Nodemailer, Resend
- **SMS**: Twilio
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Development Tools**: Vite, TypeScript, Zod, React Hook Form
- **Payments**: Stripe