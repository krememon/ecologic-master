# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform designed for trade contractors to centralize job management, streamline subcontractor coordination, enhance client communication, and manage invoicing. The platform aims to modernize construction workflows, improve project oversight, and foster better stakeholder communication through a real-time, PWA-enabled web application. The business vision is to innovate construction project management by leveraging advanced technology and user-centric design to maximize efficiency and profitability for contractors.

## User Preferences
Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Black Screen Fix: Global fetch interceptor in main.tsx auto-attaches Bearer token to all same-origin fetch calls. HTML/CSS base layer ensures background color is always visible before React mounts.
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
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google, Apple) with session management and secure cookie handling.
- **Data Management**: PostgreSQL with Drizzle ORM, providing multi-tenancy and role-based access control (RBAC).
- **Real-time Capabilities**: WebSocket server for real-time communication.
- **Push Notifications**: Supports iOS native push notifications via APNs HTTP/2.
- **Messaging System**: Comprehensive two-pane interface for 1:1 conversations with real-time delivery and read receipts.
- **File Management**: Folder-based file cabinet system for document organization, upload, and management.
- **Document Visibility**: Role-based document visibility rules enforced at the API level.
- **Signature Requests**: Electronic signature system with RBAC, secure access tokens, and branded email notifications.
- **Employee Management**: Manages employee status and contact information.
- **Onboarding**: Invite code system for company onboarding, including owner registration, member joining, and industry-specific Price Book seeding.
- **Subscription Management**: Team size-based plan auto-selection and subscription gating.
- **Estimates System**: Job-scoped estimate creation with line item editor, unique numbering, and RBAC.
- **Customer Management**: Manages customer data for estimate recipients.
- **Price Book (Service Catalog)**: Owner-only customizable reusable line item templates with full CRUD operations and RBAC.
- **Company Profile**: Owner-only feature for managing company identity and branding.
- **Tax Management**: Owner-only feature for creating custom tax rates applied to invoices.
- **Payment Collection**: Supports multi-method payment collection (Cash, Check, Card via Stripe) with idempotent processing, job-scoped RBAC, and discount features.
- **Payment Receipt Emails**: Automatic receipt emails sent to customers post-payment with PDF invoice attachments.
- **Refund System**: Manual refund recording with RBAC, updating invoice totals.
- **Payments Tracker**: Dashboard offering a real-time financial overview with filterable invoices and support for partial payments.
- **Payment Signature Capture**: Configurable post-payment signature collection.
- **Invoice Sending**: Invoices can be sent via Email (Resend) or SMS (Twilio) with payment links.
- **Leads Management**: Dedicated section for tracking potential customers with RBAC.
- **Time Tracking**: Job-aware clock-in/out for technicians, aggregated "Labor Today" for managers, and auto clock-out.
- **Geo-Tracking**: GPS tracking tied to clock-in/clock-out, with live crew positions shown on the Schedule map.
- **Timesheet Editing**: Manager-only timesheet editing with audit trails and RBAC.
- **Archival**: Automatic archival for estimates and jobs with a restore option.
- **Schedule Month View**: Full monthly calendar grid with job/estimate/event indicators and navigation.
- **Schedule Events**: Manager-created company calendar events with RBAC-enforced visibility and CRUD.
- **Notifications System**: In-app notification system with various types, unread badges, and deep linking.
- **QuickBooks Online Integration**: Owner-only QBO integration for customer mapping and invoice/payment synchronization.
- **Bulk Email/SMS Campaigns**: Bulk promotional messaging to customers with multi-select, preview, and opt-in management.
- **Email Unsubscribe System**: Secure one-click unsubscribe for marketing emails.
- **Plaid Bank Connection**: Owner-only Plaid Link integration for connecting company bank accounts.
- **Stripe Connect**: Full subcontractor payout infrastructure with dual-transfer architecture, where EcoLogic acts as a payment router. Includes onboarding gate and owner-facing payout audit UI.
- **Security Hardening**: Cross-tenant data isolation, centralized RBAC, secure storage, rate limiting, and log sanitization.
- **Native Wrapper Google OAuth**: System-browser flow for Capacitor iOS/Android wrappers using deep links.
- **Stripe Payment Element**: In-app card payments using Stripe PaymentIntents, embedded directly without redirection.
- **Invoice Payment Recompute**: Invoice totals are dynamically computed from payment records for accuracy.
- **Contractor Network – Job Referrals**: Contractor-to-contractor job referral system with status tracking, referral fees, and invite mechanisms.
- **Job Offer Deep Links**: Universal Links (iOS) and App Links (Android) for job offer paths, with fallback landing pages.
- **Legal Pages**: Settings hub with Terms of Service and Privacy Policy.
- **Support System**: Settings hub for contacting support, reporting bugs, requesting features, and FAQs.
- **Developer Tools**: Private admin console at `/dev-tools` for `pjpell077@gmail.com` only. Tabs: Billing Admin (free-access override, bypass subscription, plan override, seat limit, trial extension, restore default), Companies (search, status, notes, pause/demo toggle), Users (search, role change, activate/deactivate, onboarding reset, sub bypass), Audit Logs (all admin actions with before/after values), Session, Jobs, Payments, Integrations, Inspector. Backend: `server/devAuth.ts` allowlist + `requireDev` middleware on all `/api/dev/*` routes. Billing resolver at `server/billingResolver.ts` — `getEffectiveBillingAccess(company)` — priority: override_free_access → override_bypass → stripe → trial → blocked. Admin override columns stored directly on companies table (`admin_free_access`, `admin_bypass_subscription`, etc). Audit log table `admin_audit_logs`.

**Mobile App (React Native + Expo)**:
- Native iOS/Android app with `expo-secure-store` for session management.
- **Location Tracking**: Utilizes `expo-location` and `expo-task-manager` for background GPS tracking.
- **Schedule Screen**: Features a list/map toggle for job visualization with real-time location polling.

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js, Replit Auth, Google OAuth, Apple Sign-In (`apple-signin-auth`)
- **Email**: Resend
- **SMS**: Telnyx, Twilio
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Payments**: Stripe
- **Bank Integration**: Plaid