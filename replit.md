# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform designed for trade contractors. Its primary purpose is to centralize job management, streamline subcontractor coordination, enhance client communication, and manage invoicing. The platform aims to modernize construction workflows, improve project oversight, and foster better stakeholder communication through a real-time, PWA-enabled web application. The business vision is to innovate construction project management by leveraging advanced technology and user-centric design to maximize efficiency and profitability for contractors.

## User Preferences
Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Quad authentication options (Email/Password + Replit + Google OAuth + Apple Sign-In)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title

## System Architecture
EcoLogic is a multi-tenant web application. The frontend is built with React 18 (TypeScript, Vite, Tailwind CSS with shadcn/ui, TanStack Query, Wouter, React Hook Form). The backend uses Node.js with Express.js (TypeScript) and PostgreSQL with Drizzle ORM.

**UI/UX**:
- Responsive design with PWA support and dark mode.
- Accessible components primarily from Radix UI, incorporating custom "EcoLogic" branding and logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google, Apple) with robust session management, including secure cookie handling and mobile bearer token authentication.
- **Data Management**: PostgreSQL with Drizzle ORM, providing multi-tenancy and role-based access control (RBAC).
- **Real-time Capabilities**: WebSocket server for real-time communication, authenticating via session cookies.
- **Push Notifications**: Supports iOS native push notifications directly via APNs HTTP/2, with device token management and server-side JWT signing.
- **Messaging System**: Features a comprehensive two-pane interface for 1:1 conversations with real-time delivery and read receipts.
- **File Management**: Handles job photos and documents, integrated with cloud storage. Documents can be attached to clients (customers) via `customerId` or to jobs via `jobId`, or left company-wide.
- **Document Visibility**: Implements role-based document visibility rules enforced at the API level.
- **Signature Requests**: Electronic signature system with RBAC, secure access tokens, and branded email notifications.
- **Employee Management**: Manages employee status and contact information.
- **Onboarding**: Invite code system for company onboarding, including owner registration, member joining, and industry-specific Price Book seeding.
- **Subscription Management**: Team size-based plan auto-selection, with subscription gating redirecting expired users to a paywall.
- **Timezone Handling**: Utilities for robust timezone conversion.
- **Estimates System**: Job-scoped estimate creation with line item editor, unique numbering, and RBAC.
- **Customer Management**: Manages customer data for estimate recipients.
- **Price Book (Service Catalog)**: Owner-only customizable reusable line item templates with full CRUD operations and RBAC.
- **Company Profile**: Owner-only feature for managing company identity and branding.
- **Tax Management**: Owner-only feature for creating custom tax rates applied to invoices.
- **Payment Collection**: Supports multi-method payment collection (Cash, Check, Card via Stripe) with idempotent processing and job-scoped RBAC. Includes checkout discount feature (flat $ or % off) with toggle UI, real-time total updates, validation, persisted in payment `meta` jsonb, and shown on emailed receipts.
- **Payment Receipt Emails**: Automatic receipt emails sent to customers post-payment, including partial payment details and PDF invoice attachments.
- **Refund System**: Manual refund recording (Cash, Check, Card, Other) with RBAC, updating invoice totals.
- **Payments Tracker**: Dashboard offering a real-time financial overview, filterable invoices, and support for partial payments.
- **Payment Signature Capture**: Configurable post-payment signature collection.
- **Invoice Sending**: Invoices can be sent via Email (Resend) or SMS (Twilio) with payment links.
- **Leads Management**: Dedicated section for tracking potential customers with RBAC.
- **Time Tracking**: Job-aware clock-in/out for technicians, with aggregated "Labor Today" for managers and auto clock-out.
- **Geo-Tracking**: GPS tracking tied to clock-in/clock-out. On clock-in, requests location permission (non-blocking). If granted, tracks movement via `watchPosition` with 50m distance filter, 60s heartbeat, accuracy ≤100m, batched to `POST /api/location/batch` every 30s. Live crew positions shown on Schedule map as avatar markers (circular photo or initials). Polling every 12s. RBAC: Owner sees all, Supervisor sees shared-job techs, Technician sees self. 10-min stale filter server-side. Service: `client/src/services/geoTracking.ts`. Tables: `employee_location_pings`, `user_live_locations`.
- **Timesheet Editing**: Manager-only timesheet editing with audit trails and RBAC.
- **Archival**: Automatic archival for estimates and jobs based on conversion or full payment status, with a restore option.
- **Schedule Month View**: Full monthly calendar grid on the Schedule page with job/estimate/event dot indicators, selected-day item list, swipe navigation, and smooth animated transitions.
- **Schedule Events**: Manager-created company calendar events (holidays, meetings) with RBAC-enforced visibility and CRUD.
- **Notifications System**: In-app notification system with various types, unread badges, and deep linking, targeting specific roles.
- **QuickBooks Online Integration**: Owner-only QBO integration for customer mapping and invoice/payment synchronization.
- **Bulk Email/SMS Campaigns**: Bulk promotional messaging to customers with multi-select, preview, and opt-in management.
- **Email Unsubscribe System**: Secure one-click unsubscribe for marketing emails.
- **Plaid Bank Connection**: Owner-only Plaid Link integration for connecting company bank accounts.
- **Security Hardening**: Cross-tenant data isolation, centralized RBAC, secure storage, rate limiting, and log sanitization.
- **Native Wrapper Google OAuth**: System-browser flow for Capacitor iOS/Android wrappers using deep links and one-time auth code exchange.
- **Stripe Payment Element**: In-app card payments using Stripe PaymentIntents, embedded directly without redirection, supporting partial payments.
- **Invoice Payment Recompute**: Invoice totals (`paidAmountCents`, `balanceDueCents`, `status`) are dynamically computed from payment records, serving as the single source of truth.
- **Contractor Network – Job Referrals**: Full contractor-to-contractor job referral system with 3-tab UI (Contractors/Incoming/Sent). Table: `job_referrals` with status tracking (pending/accepted/declined/completed), referral fee (percent or flat), optional price change permission, and invite token fields (`invite_token`, `invite_sent_to_phone`, `invite_sent_at`, `invite_expires_at`). RBAC: Owner/Admin can send/accept/decline; Supervisor can view; Technician has no access. Endpoints: `POST /api/referrals/send` (generates invite token + SMS via Telnyx), `POST /api/referrals/accept/:id`, `POST /api/referrals/decline/:id`, `GET /api/referrals/incoming`, `GET /api/referrals/outgoing`. Token-based invite endpoints: `GET /api/referrals/invite/:token`, `POST /api/referrals/invite/:token/accept`, `POST /api/referrals/invite/:token/decline`. Frontend: `JobOfferInvite.tsx` at `/referrals/invite/:token`.
- **Job Offer Deep Links**: Universal Links (iOS) and App Links (Android) for `/invite/referral/*` paths. AASA file includes invite paths. Fallback landing page at `GET /invite/referral/:token` shows "Get EcoLogic" with App Store/Play Store buttons (no job details exposed). `assetlinks.json` served at `/.well-known/assetlinks.json`.
- **Legal Pages**: Settings > Legal hub with Terms of Service and Privacy Policy sub-pages. Routes: `/settings/legal`, `/settings/legal/terms`, `/settings/legal/privacy`.
- **Support System**: Settings > Support hub with Contact Support, Report a Bug, Request a Feature, and FAQs. All submissions stored in `support_requests` table and emailed to `SUPPORT_INBOX_EMAIL`. Auto-captures device/platform/route metadata. Routes: `/settings/support`, `/settings/support/contact`, `/settings/support/bug`, `/settings/support/feature`, `/settings/support/faqs`. Endpoint: `POST /api/support`.

**Mobile App (React Native + Expo)**:
- Native iOS/Android app living in the `/mobile` directory.
- Uses `expo-secure-store` for session management and `react-navigation` for navigation.
- **Location Tracking**: Utilizes `expo-location` and `expo-task-manager` for background GPS tracking when clocked in.
- **Schedule Screen**: Features a list/map toggle for job visualization with real-time location polling.

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js, Replit Auth, Google OAuth, Apple Sign-In (`apple-signin-auth`)
- **Email**: Resend
- **SMS**: Twilio
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Payments**: Stripe
- **Bank Integration**: Plaid