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
- **Onboarding**: Features an invite code system for company onboarding, supporting owner registration, new member joining, and company rejoin flows.
- **Subscription Management**: Integrates Stripe for subscription plans, enabling role-based access control and plan-based feature limits.
- **Atomic Operations**: Critical workflows are implemented as atomic transactions.
- **Timezone Handling**: Robust timezone conversion utilities ensure correct date/time display and storage.
- **Estimates System**: Provides job-scoped estimate creation with a line item editor. Features unique estimate numbers generated via atomic counters, monetary values stored in cents, RBAC for creation and management, and integration with the Job Details page. The Estimates tab includes filtering by job and status, a "Create Estimate" button, and displays estimate cards.
- **Customer Management**: Manages customer data for estimate recipients, including firstName, lastName, email, phone, and address. Features an iOS-style customer picker with search and an "Add Customer" modal, with RBAC applied to customer creation.
- **Estimate Builder**: Redesigned iOS-style sectioned form for creating estimates within the Job Details page, offering "list" and "create" view modes. It uses gray section headers and white information rows that open modals or slide-over panels for editing various estimate details, with RBAC controlling editability.

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js strategies, Replit Auth, Google OAuth
- **AI**: OpenAI API
- **Weather**: OpenWeather API
- **Email**: Nodemailer, Resend
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Development Tools**: Vite, TypeScript, Zod, React Hook Form
- **Payments**: Stripe