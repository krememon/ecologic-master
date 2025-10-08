# EcoLogic Construction Management Platform

## Overview

EcoLogic is a professional construction management platform designed for trade contractors. It provides unified job management, subcontractor coordination, client communication, invoicing, and AI-powered scheduling capabilities. The platform is built as a modern web application with PWA support and real-time features.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds  
- **UI Framework**: Tailwind CSS with shadcn/ui components
- **State Management**: TanStack Query (React Query) for server state
- **Routing**: Wouter for client-side routing
- **Forms**: React Hook Form with Zod validation
- **Styling**: CSS variables with dark mode support
- **Mobile Support**: PWA-enabled with responsive design

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript throughout
- **Database**: PostgreSQL with Drizzle ORM
- **Session Management**: express-session with PostgreSQL store
- **File Uploads**: Multer for handling multipart data
- **WebSockets**: Built-in WebSocket server for real-time features

### Authentication Strategy
- **Primary**: Replit Auth integration (OAuth-based)
- **Secondary**: Email/password authentication with bcrypt
- **Social Login**: Google, Facebook, Microsoft OAuth strategies
- **Session Storage**: PostgreSQL-backed sessions table

## Key Components

### Database Schema
- **Multi-tenant**: Company-based organization with member roles
- **Core Entities**: Users, Companies, Jobs, Clients, Subcontractors
- **Business Logic**: Invoices, Documents, Messages, Job Photos
- **Workflow**: Approval workflows with e-signature support
- **Session Management**: Dedicated sessions table for auth

### AI Integration
- **OpenAI GPT-4o**: Latest model for AI-powered features
- **Scope Analysis**: Automated project scoping and material estimation
- **Smart Scheduling**: AI-optimized resource allocation
- **Invoice Scanning**: OCR-based invoice data extraction
- **Weather Integration**: OpenWeather API for job planning

### Real-time Features
- **WebSocket Server**: Live messaging and notifications
- **Push Notifications**: Service worker-based browser notifications
- **Live Updates**: Real-time job status and assignment changes

### File Management
- **Photo Uploads**: Job progress documentation with metadata
- **Document Storage**: Contract and approval document handling
- **Cloud Storage**: Prepared for cloud storage integration

## Data Flow

### Authentication Flow
1. Users authenticate via Replit Auth or email/password
2. Session created and stored in PostgreSQL sessions table
3. User profile fetched with company association
4. Role-based permissions applied throughout application

### Job Management Flow
1. Jobs created with client association and location data
2. AI scope analyzer processes job requirements
3. Subcontractors assigned through AI scheduler optimization
4. Progress tracked via photo uploads and status updates
5. Invoices generated and payment tracking enabled

### Real-time Communication
1. WebSocket connection established on authentication
2. User subscribed to relevant channels (company, assigned jobs)
3. Events broadcast to connected clients (new messages, job updates)
4. Push notifications sent for offline users

## External Dependencies

### Core Infrastructure
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe database operations
- **express-session**: Session management
- **passport**: Authentication strategies

### UI and Styling
- **@radix-ui/react-***: Accessible component primitives
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Type-safe CSS variants

### AI and External Services
- **OpenAI**: AI-powered features (scheduling, scope analysis)
- **nodemailer**: Email notifications
- **multer**: File upload handling
- **ws**: WebSocket server implementation

### Development Tools
- **vite**: Build tool and dev server
- **typescript**: Type safety throughout
- **zod**: Runtime type validation
- **react-hook-form**: Form state management

## Deployment Strategy

### Replit Configuration
- **Environment**: Node.js 20 with PostgreSQL 16
- **Build Process**: Vite build followed by esbuild for server
- **Port Configuration**: Server runs on port 5000, exposed on port 80
- **Auto-scaling**: Configured for Replit's autoscale deployment

### Production Build
- **Frontend**: Static assets built to `dist/public`
- **Backend**: Server bundled to `dist/index.js`
- **Database**: Migrations managed via Drizzle Kit
- **Environment**: Production mode with optimized builds

### PWA Features
- **Service Worker**: Handles push notifications and offline caching
- **Manifest**: Configured for mobile app-like experience
- **Icons**: SVG-based scalable icons

## Changelog
- June 12, 2025. Initial setup
- June 12, 2025. Updated landing page with user's custom logo and Google OAuth integration
- June 12, 2025. Implemented comprehensive registration system with enhanced UX features and automatic login flow
- June 13, 2025. Completed account linking system allowing users to sign in with either Google or email/password using same email address
- June 13, 2025. Fixed Google OAuth authentication flow with proper session handling and error logging
- June 13, 2025. Enhanced Google OAuth with prompt=select_account, access_type=offline, and include_granted_scopes parameters
- June 13, 2025. Fixed Google OAuth callback route with enhanced error handling and proper token validation
- June 13, 2025. Integrated Google account linking functionality into Settings page with proper positioning below Employee Access section
- June 13, 2025. Fixed Google OAuth redirect URI configuration for Replit deployment domain
- June 13, 2025. Enhanced Google OAuth flow to properly handle new account creation and existing account linking with comprehensive error handling
- June 16, 2025. Implemented complete Stripe subscription system with access control:
  - Added subscription plans (Starter $29, Professional $79, Enterprise $199)
  - Created subscription-based access control middleware for all protected routes
  - Built ChoosePlan page with 7-day free trial and Stripe payment integration
  - Added billing management section to Settings page with plan management
  - Implemented subscription status checking and automatic redirect to plan selection
  - Added team size limits based on subscription plans
  - Created subscription hooks for frontend access control
- October 5, 2025. UI Improvements and Navigation Reorganization:
  - Renamed "AI Scheduling" to "Schedule" across all navigation components
  - Moved "Schedule" to second position in navigation (after Home, before Jobs)
  - Updated routing: /schedule is primary route, /scheduling and /ai-scheduling redirect for backward compatibility
  - Simplified "Today's Jobs" card to show only current day's jobs automatically
  - Removed date picker and navigation controls from "Today's Jobs" for streamlined UX
  - Today's Jobs displays formatted current date with empty state handling
  - Updated all translation files (en, es, fr, de, it, pt) with "schedule" navigation key
  - Spanish: "Horario", French: "Calendrier", German: "Zeitplan", Italian: "Programma", Portuguese: "Agenda"
- October 7, 2025. Implemented complete invite code system for company onboarding:
  - Added inviteCode field (unique, non-null) to companies table with organization fields
  - Created invite code utilities (generate with nanoid, normalize to uppercase)
  - Split registration into two flows: Owner (creates company) and Member (joins via code)
  - New endpoints: POST /api/register/owner, POST /api/register/member
  - New company endpoints: GET /api/company/info, POST /api/company/rotate-code
  - Updated permissions: org.view (Owner/Supervisor), org.manage (Owner only)
  - Built multi-step registration UI: user info → company setup (Owner) or join with code (Member)
  - SUPERVISOR has org.view (read-only company access), OWNER has org.manage (can rotate code)
- October 7, 2025. Built Employees roster management system:
  - Added users.view and users.manage permissions (Owner/Supervisor only)
  - Extended users table with status (active/inactive) and lastLoginAt fields
  - Created employee management API: GET /api/org/users (list), PATCH /api/org/users/:userId (update)
  - Built Employees page with search, role/status filters, inline role editing, status toggling
  - Implemented safety rails: Supervisor cannot modify Owner roles; cannot remove last Owner
  - Added Employees navigation link (visible only with users.view permission)
  - All queries scoped to organizationId for multi-tenant isolation
  - Auto-inclusion: new users joining via invite code automatically appear in roster
- October 8, 2025. Transformed Employees page to visual card grid interface:
  - Extended users table with contact fields: phone, addressLine1, addressLine2, city, state, postalCode, country
  - Enhanced GET /api/org/users to return full contact information
  - Created GET /api/users/:id/jobs/summary endpoint for employee job statistics
  - Built EmployeeCard component with role/status badges, contact info, and collapsible jobs history
  - Built JobsHistory component showing job counts by status (scheduled, in progress, completed)
  - Replaced table layout with responsive card grid (1 col mobile → 2 sm → 3 xl → 4 2xl)
  - Added sort functionality: Name A-Z, Role hierarchy, Joined date (newest first)
  - Cards display email, phone, address when available with icon-based layout
  - Jobs history section lazy-loads and links to filtered job list per employee
  - Design matches Client cards styling with hover effects and smooth transitions
- October 8, 2025. Implemented secure Invite Team clipboard button:
  - Created InviteTeamButton component with one-click invite code copying
  - Fetches invite code from GET /api/company/info (org.view permission required)
  - Uses navigator.clipboard API with textarea fallback for older browsers
  - Button label changes to "Copied" for 2000ms, then reverts to "Invite Team"
  - Button disabled during copy operation to prevent double clicks
  - Toast notification confirms "Company code copied to clipboard"
  - Code never exposed in DOM or logs - kept only in memory
  - Re-fetches fresh code on every click (supports rotation workflow)
  - Owner/Supervisor only - returns null for other roles
- October 8, 2025. Settings page consolidation and RBAC enforcement:
  - Removed duplicate Profile navigation item, kept only Settings in sidebar
  - Added /profile to /settings redirect for backward compatibility
  - Enforced org.view permission on Settings page: Company card visible only to Owner/Supervisor
  - Added org.view permission to GET /api/company backend endpoint for API-level protection
  - Updated CompanyInviteCode messaging: "Owners and Supervisors can share this code"
  - Fallback message updated to include Supervisors: "Only Owners and Supervisors can view and share invite codes"
  - Full RBAC alignment between frontend conditional rendering and backend permission checks
- October 8, 2025. Implemented comprehensive phone number feature:
  - Created phone utilities: validatePhone, normalizePhone (E.164), formatPhone (US display), getRawPhoneValue
  - Added phone field to registration flow (both owner and member paths) with auto-formatting
  - Enhanced Profile card in Settings with phone input and update functionality
  - Updated Employee cards to display formatted phone with click-to-call (tel:) links
  - Backend endpoints normalize phone to E.164 format for data integrity
  - Phone validation on all endpoints (400 error for invalid format)
  - Supports clearing phone number (null/empty value)
  - End-to-end flow maintains phone normalization from registration through profile updates
- October 8, 2025. Built comprehensive employee deactivation/reactivation system with instant session revocation:
  - Added tokenVersion field (integer, default 0) to users table for session revocation tracking
  - Migrated user status values from lowercase to uppercase (ACTIVE/INACTIVE) across all systems
  - Built PATCH /api/org/users/:userId endpoint with last-Owner protection and RBAC enforcement
  - Enhanced authentication middleware to verify user status and tokenVersion on every request
  - Fixed OAuth security: All login paths (email/password, Google OAuth, password reset) now check INACTIVE status
  - Implemented atomic deactivation: sets status=INACTIVE, increments tokenVersion, deletes all sessions
  - Added WebSocket session revocation broadcasting - deactivated users receive instant logout events
  - Updated frontend to handle 401 responses with error codes (ACCOUNT_INACTIVE, SESSION_REVOKED)
  - WebSocket listener for user:session-revoked events forces client-side logout
  - All sessions include tokenVersion claim for multi-device revocation verification
  - Fixed UI case mismatch: EmployeeCard now correctly uses uppercase ACTIVE/INACTIVE for badge and menu display
  - React Query cache invalidation ensures UI updates without page refresh after status changes
  - Security pattern: Deactivated users instantly signed out on all devices and blocked from re-authentication

## User Preferences

Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Triple authentication options (Email/Password + Replit + Google OAuth)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title