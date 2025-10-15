# EcoLogic Construction Management Platform

## Overview

EcoLogic is a professional construction management platform designed for trade contractors. It provides unified job management, subcontractor coordination, client communication, invoicing, and AI-powered scheduling. The platform aims to streamline construction workflows, enhance project oversight, and improve communication among all stakeholders. It is a modern, real-time, and PWA-enabled web application.

## User Preferences

Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Triple authentication options (Email/Password + Replit + Google OAuth)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title

## System Architecture

EcoLogic is a multi-tenant web application built with a modern tech stack. The frontend uses React 18 with TypeScript, Vite, Tailwind CSS (with shadcn/ui), TanStack Query, Wouter, and React Hook Form. The backend is Node.js with Express.js, TypeScript, and PostgreSQL with Drizzle ORM.

Key architectural decisions and features include:

**UI/UX**:
- Responsive design with PWA support and dark mode.
- Accessible components primarily from Radix UI.
- Custom "EcoLogic" branding with a water drop and leaf logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google). Features robust session management with PostgreSQL-backed sessions and atomic session revocation. Enforces secure email uniqueness at both database and application levels.
- **Data Management**: PostgreSQL database with Drizzle ORM for type-safe operations. Implements multi-tenancy with company-based organization and role-based access control (RBAC).
- **AI Integration**: Leverages OpenAI API (GPT-4o) for project scoping, material estimation, smart scheduling, and OCR-based invoice scanning. Integrates OpenWeather API for job planning.
- **Real-time Capabilities**: Utilizes a WebSocket server for live messaging, notifications, and instant job status updates, complemented by service worker-based push notifications.
- **Messaging System**: Comprehensive two-pane messaging interface (Slack/WhatsApp-style) for direct 1:1 conversations between company members. Features real-time message delivery via WebSocket, conversation-based architecture with read receipts, unread counts, and searchable user lists. Built on a robust conversation-participant model with proper foreign key relationships.
- **File Management**: Handles job photos and documents, with provisions for cloud storage integration.
- **Employee Management**: Comprehensive system for managing employees, including active/inactive status with instant session revocation, and detailed contact information.
- **Onboarding**: Features an invite code system for seamless company onboarding, supporting both owner registration and new member joining, including a company rejoin flow for removed employees.
- **Subscription Management**: Integrates Stripe for subscription plans, enabling role-based access control and plan-based feature limits.
- **Atomic Operations**: Critical workflows like job creation and employee removal are implemented as atomic transactions to ensure data consistency.
- **Timezone Handling**: Robust timezone conversion utilities ensure all dates and times are displayed and stored correctly based on user's local time and UTC.

## External Dependencies

- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js strategies, Replit Auth, Google OAuth
- **AI**: OpenAI API
- **Email**: Nodemailer
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI
- **Development Tools**: Vite, TypeScript, Zod, React Hook Form
## Recent Changes

### October 15, 2025: Messaging System Implementation
- **Feature**: Implemented comprehensive two-pane messaging system for direct 1:1 conversations between company members
- **Architecture**:
  - Database: Created conversations, conversation_participants, and restructured messages tables with serial IDs
  - Backend: 7 new API endpoints (/api/messaging/users, /api/conversations, /api/conversations/:id/messages, etc.)
  - Storage: 9 new storage methods (getUserConversations, getOrCreateConversation, createConversationMessage, etc.)
  - WebSocket: Real-time message delivery notifications integrated with existing WebSocket server
- **Frontend**:
  - Two-pane UI: Left sidebar with searchable people list, right pane with chat thread
  - Features: Real-time updates, unread counts, read receipts, auto-scroll, proper empty states
  - UX: WhatsApp/Slack-style interface with avatar, timestamps, and message bubbles
- **Security**: Enforces company-scoped messaging (users can only message within their company)
- **Result**: Company members can now communicate directly through real-time 1:1 conversations

### October 15, 2025: Email Login Flow for Users Without Company Fixed
- **Problem**: Users with correct credentials but no company saw "Something went wrong" error during login
- **Root Cause**: Login handler didn't check company status after successful authentication; apiRequest error handling caught all errors generically
- **Solution**:
  - Updated handleEmailLogin to fetch user data after successful login
  - Added nested try/catch to distinguish between login errors and profile fetch errors
  - Validate user data structure before redirecting
  - Redirect to /join-company if user has no company, otherwise to home
  - Show specific error messages for different failure scenarios (invalid credentials, profile fetch failure, invalid data)
  - Keep user on login page with clear error message if profile fetch fails after successful login
- **Result**: Users without company can now login successfully and are automatically redirected to /join-company

### October 15, 2025: Join Company Redirect Logic Fixed
- **Problem**: Users with a company could visit /join-company and get stuck on a 404 page; back button after joining returned to join page
- **Root Cause**: No client-side guard to prevent users with company from accessing /join-company; navigation used push instead of replace
- **Solution**:
  - Added useAuth-based guard in JoinCompany page that auto-redirects users with company to home using `replace`
  - Updated success handler to use `setLocation("/", { replace: true })` instead of regular navigation
  - Added contextual loading states: "Redirecting to dashboard..." when user has company, "Loading..." during auth check
  - All redirects now use replace to prevent back-button from returning to join page
- **Result**: Users with company are immediately redirected from /join-company; after joining, back button cannot return to join page

### October 10, 2025: Join Company Flow Fixed
- **Problem**: Users couldn't enter their full 10-character invite codes due to hardcoded 6-character limit
- **Root Cause**: JoinCompany page had maxLength={6} and placeholder mentioned "6-character code"
- **Solution**:
  - Removed maxLength restriction from invite code input field
  - Updated placeholder text from "Enter 6-character code" to "Enter your company's invite code"
  - Added sign-out button for users who logged in with wrong account
  - Fixed LSP type errors in App.tsx by removing unnecessary subscription guard wrappers
- **Result**: Users can now properly enter their full 10-character invite codes and rejoin companies

### October 10, 2025: Auto-Company Creation Fixed
- **Problem**: Removed employees were automatically assigned a new "Your Company" when logging back in
- **Root Cause**: GET /api/auth/user endpoint had logic that auto-created companies for users without one
- **Solution**:
  - Removed auto-company creation logic from /api/auth/user endpoint
  - Endpoint now returns user with company: null and role: null when user has no company
  - Updated frontend Router to check user.company before rendering protected routes
  - If authenticated but no company → renders /join-company page exclusively
  - All protected routes only accessible after user has company membership
- **Result**: Removed employees must now use an invite code to join a company - no auto-creation
