# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform for trade contractors, aiming to centralize job management, subcontractor coordination, client communication, and invoicing. It modernizes construction workflows, improves project oversight, and enhances stakeholder communication through a real-time, PWA-enabled web application. The platform seeks to innovate construction project management using advanced technology and user-centric design to maximize efficiency and profitability for contractors.

## User Preferences
Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Triple authentication options (Email/Password + Replit + Google OAuth)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title

## System Architecture
EcoLogic is a multi-tenant web application using React 18 (TypeScript, Vite, Tailwind CSS with shadcn/ui, TanStack Query, Wouter, React Hook Form) for the frontend and Node.js with Express.js (TypeScript) and PostgreSQL with Drizzle ORM for the backend.

**UI/UX**:
- Responsive design with PWA support and dark mode.
- Accessible components primarily from Radix UI, incorporating custom "EcoLogic" branding and logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google) with robust session management.
- **Data Management**: PostgreSQL with Drizzle ORM, implementing multi-tenancy and role-based access control (RBAC). Automated constraint enforcement.
- **Real-time Capabilities**: WebSocket server for live messaging, notifications, and job status updates, complemented by service worker push notifications.
- **Messaging System**: Comprehensive two-pane interface with 1:1 conversations, real-time delivery, read receipts, and unread counts.
- **File Management**: Handles job photos and documents with cloud storage integration.
- **Document Visibility System**: Role-based document visibility (customer_internal, assigned_crew_only, office_only, internal, owner_only) enforced at the API level.
- **Signature Requests**: Electronic signature system with RBAC, secure access tokens, status workflow, and branded email notifications.
- **Employee Management**: Manages employee status and contact information.
- **Onboarding**: Invite code system for company onboarding, including owner registration, member joining, and industry-specific Price Book seeding.
- **Subscription Management**: Integrates Stripe for subscription plans, enabling RBAC and plan-based feature limits.
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
- **Notifications System**: In-app notification system with 13 types, unread badges, mark-as-read, and deep linking, role-targeted with deduplication.
- **QuickBooks Online Integration**: Owner-only QBO integration via OAuth 2.0 for customer mapping, manual invoice sync, and automatic payment sync.
- **Bulk Email/SMS Campaigns**: Bulk promotional messaging to customers from the Clients page with multi-select, preview, opt-in management, and campaign tracking.
- **Email Unsubscribe System**: Secure one-click unsubscribe for marketing emails with HMAC-signed tokens and public endpoints.
- **Plaid Bank Connection**: Owner-only Plaid Link integration for connecting company bank accounts, with encrypted token storage.
- **Security Hardening**: Comprehensive cross-tenant data isolation, centralized RBAC, secure storage methods, rate limiting, log sanitization, and 404 responses for unauthorized access.

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js, Replit Auth, Google OAuth
- **Email**: Resend
- **SMS**: Twilio
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Payments**: Stripe
- **Bank Integration**: Plaid