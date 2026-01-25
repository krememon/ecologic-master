# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform for trade contractors, designed to unify job management, subcontractor coordination, client communication, and invoicing. It aims to streamline construction workflows, enhance project oversight, and improve communication among all stakeholders through a modern, real-time, and PWA-enabled web application with AI-powered scheduling. The project's vision is to redefine construction project management using advanced technology and user-centric design.

## User Preferences
Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Triple authentication options (Email/Password + Replit + Google OAuth)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title

## System Architecture
EcoLogic is a multi-tenant web application built with React 18 (TypeScript, Vite, Tailwind CSS with shadcn/ui, TanStack Query, Wouter, React Hook Form) for the frontend and Node.js with Express.js (TypeScript) and PostgreSQL with Drizzle ORM for the backend.

**UI/UX**:
- Responsive design with PWA support and dark mode.
- Accessible components primarily from Radix UI, incorporating custom "EcoLogic" branding and logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google) with robust session management and atomic session revocation.
- **Data Management**: PostgreSQL with Drizzle ORM for type-safe operations, implementing multi-tenancy and role-based access control (RBAC).
- **AI Integration**: Leverages OpenAI API (GPT-4o) for project scoping, material estimation, smart scheduling, and OCR-based invoice scanning. Integrates OpenWeather API for job planning.
- **Real-time Capabilities**: Utilizes a WebSocket server for live messaging, notifications, and instant job status updates, complemented by service worker-based push notifications. Features include room-based subscriptions, delivery acknowledgments, and client-side optimistic updates.
- **Messaging System**: A comprehensive two-pane messaging interface with 1:1 conversations, instant navigation, real-time delivery via WebSocket, read receipts, unread counts, and day-based message grouping. It features an iOS-style inbox with message previews, attachment synthesis, and guaranteed delivery mechanisms ensuring messages are delivered even if recipients are offline. It also includes an "All-Coworkers View" for easy conversation initiation.
- **Database Initialization**: Automated constraint enforcement system runs at startup, creating PostgreSQL triggers to enforce business logic, such as the 2-participant limit for 1:1 conversations.
- **File Management**: Handles job photos and documents, with cloud storage integration.
- **Document Visibility System**: Implements a role-based document visibility model with five levels (customer_internal, assigned_crew_only, office_only, internal, owner_only), enforced at the API level.
- **Signature Requests**: An electronic signature system allowing users to send documents to customers for signing. Features RBAC enforcement, document visibility filtering, automatic job inheritance, secure access tokens, and a status workflow (draft → sent → viewed → signed/declined/expired/canceled). It includes branded HTML email notifications via Resend and a standalone public signing flow accessible without authentication.
- **Employee Management**: Manages employee active/inactive status, session revocation, and contact information.
- **Onboarding**: Features an invite code system for company onboarding, supporting owner registration, new member joining, and company rejoin flows. Includes industry selection onboarding for new owners that seeds the Price Book with industry-specific preset items (13 industries supported: Plumbing, HVAC, Electrical, Handyman, General Contractor, Home Cleaning, Carpet Cleaning, Landscaping & Lawn, Appliances, Pest Control, Window & Exterior Cleaning, Automotive, Other). Preset items are fully editable and deletable by the owner.
- **Subscription Management**: Integrates Stripe for subscription plans, enabling role-based access control and plan-based feature limits.
- **Atomic Operations**: Critical workflows are implemented as atomic transactions.
- **Timezone Handling**: Robust timezone conversion utilities ensure correct date/time display and storage.
- **Estimates System**: Provides job-scoped estimate creation with a line item editor. Features unique estimate numbers generated via atomic counters, monetary values stored in cents, RBAC for creation and management, and integration with the Job Details page. The Estimates tab includes filtering by job and status, a "Create Estimate" button, and displays estimate cards. Supports employee assignment to estimates via multi-select modal with search, stored in `assignedEmployeeIds` JSONB column. API endpoints include `POST /api/jobs/:jobId/estimates` (with assignedEmployeeIds) and `PATCH /api/estimates/:id/assignees` for updating assignments.
- **Customer Management**: Manages customer data for estimate recipients, including firstName, lastName, email, phone, and address. Features an iOS-style customer picker with search and an "Add Customer" modal, with RBAC applied to customer creation.
- **Estimate Builder**: Redesigned iOS-style sectioned form for creating estimates within the Job Details page, offering "list" and "create" view modes. It uses gray section headers and white information rows that open modals or slide-over panels for editing various estimate details, with RBAC controlling editability.
- **Price Book (Service Catalog)**: A customization feature accessible via `/customize` page (Owner only). The Customize page provides an iOS-style settings menu with a "Price book" option. The Price book (`/customize/price-book`) allows creating reusable line item templates for estimates with name, description, default price (stored in cents), unit type (each, hour, ft, sq_ft, job, day), and category. Features full CRUD operations with RBAC enforcement on both frontend and backend via `customize.manage` permission. The Customize menu item appears above Sign Out in the navigation for authorized users.
- **Company Profile**: Owner-only feature at `/customize/company-profile` for managing company identity and branding. Stores company name, logo (via file upload), phone, email, address fields, license number, and default footer text. This information appears on estimates, invoices, and customer documents. API endpoints: GET/PATCH `/api/company/profile`.
- **Tax Management**: Owner-only feature at `/customize/taxes` for creating custom tax rates to apply to invoices. Each tax has a name (2-40 chars) and percentage rate (0-20%, up to 3 decimal places like 8.625%). Features inline validation, duplicate name prevention (case-insensitive), and no success toasts. API endpoints: GET/POST/DELETE `/api/company/taxes`. Stored in `company_taxes` table with company-scoped unique constraint on name.
- **Line Item Tax Selection**: Job line items support per-item tax selection. When "Taxable" toggle is ON, a tax selector row appears. Users can tap to open a Tax Picker modal showing saved company taxes with checkmark selection. Tax data is stored per line item (taxId, taxRatePercentSnapshot, taxNameSnapshot) to preserve the rate at selection time even if the tax rate changes later. Toggling Taxable OFF clears the selected tax.
- **Payment Collection**: Multi-method payment collection on the Payment Review screen. Supports Cash, Check, and Card (Stripe) payments. Cash/Check flow: confirmation modal → processing screen → success screen showing paid amount → navigate to Jobs. Backend endpoint `POST /api/payments/manual` with idempotency (prevents double-charging). Card flow continues to use Stripe Checkout. RBAC enforced (Owner, Supervisor, Dispatcher, Estimator).

- **Invoice Sending**: Invoices can be sent via Email (Resend) or SMS (Twilio). The Send Invoice modal has an Email/Text segmented toggle. Email mode sends branded HTML emails. Text mode sends SMS via Twilio with invoice details and a payment link. Requires Twilio credentials stored as Replit Secrets (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER). Phone numbers are normalized to E.164 format for sending. Note: Twilio integration was configured manually with user-provided credentials (not via Replit integration system).

- **Leads Management**: A dedicated section for tracking potential customers before conversion. Leads are linked to existing customers via `customerId` (required), with customer selection using the same iOS-style picker as Jobs. Features include customer data (from linked customer record), description (required), notes (optional), source tracking, status workflow (new → contacted → qualified → proposal → won/lost), and timestamps. The leads list displays customer name from the joined customer record. RBAC enforced: Owner, Supervisor, Dispatcher, and Estimator can view and manage leads; Technicians cannot see the Leads tab. API endpoints: GET/POST/PATCH/DELETE `/api/leads`. Stored in `leads` table with company-scoped data isolation and customer references.

- **Time Tracking (Clock In/Out)**: A "Time Today" section on the homepage for labor visibility and time tracking. Technicians can clock in/out via prominent action button, see their hours logged today, and have a visual active indicator when clocked in. Owner/Supervisor/Dispatcher see aggregate "Labor Today" data including total hours logged and number of active techs. RBAC: Technicians can only clock in/out and see their own data; managers see aggregate company data only. No payroll complexity. API endpoints: GET `/api/time/today` (role-aware response), POST `/api/time/clock-in`, POST `/api/time/clock-out`. Stored in `time_logs` table with company_id, user_id, clock_in_at, clock_out_at, date fields.

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js strategies, Replit Auth, Google OAuth
- **AI**: OpenAI API
- **Weather**: OpenWeather API
- **Email**: Nodemailer, Resend
- **SMS**: Twilio (for invoice text messages)
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Development Tools**: Vite, TypeScript, Zod, React Hook Form
- **Payments**: Stripe