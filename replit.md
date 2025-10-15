# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform for trade contractors, offering unified job management, subcontractor coordination, client communication, invoicing, and AI-powered scheduling. The platform aims to streamline construction workflows, enhance project oversight, and improve communication among all stakeholders. It is a modern, real-time, and PWA-enabled web application with ambitions to redefine construction project management through advanced technology and user-centric design.

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
- Accessible components primarily from Radix UI.
- Custom "EcoLogic" branding with a water drop and leaf logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google) with robust session management and atomic session revocation.
- **Data Management**: PostgreSQL with Drizzle ORM for type-safe operations, implementing multi-tenancy and role-based access control (RBAC).
- **AI Integration**: Leverages OpenAI API (GPT-4o) for project scoping, material estimation, smart scheduling, and OCR-based invoice scanning. Integrates OpenWeather API for job planning.
- **Real-time Capabilities**: Utilizes a WebSocket server for live messaging, notifications, and instant job status updates, complemented by service worker-based push notifications.
- **Messaging System**: Comprehensive two-pane messaging interface for direct 1:1 conversations using a server-side "get or create then redirect" pattern. Features instant navigation with 302 redirects, deterministic conversation creation via pairKey upsert, real-time delivery via WebSocket, read receipts, unread counts, and searchable user lists. Eliminates client-side conversation creation complexity and race conditions.
- **File Management**: Handles job photos and documents, with provisions for cloud storage integration.
- **Employee Management**: Manages employee active/inactive status, session revocation, and contact information.
- **Onboarding**: Features an invite code system for company onboarding, supporting owner registration and new member joining, including a company rejoin flow.
- **Subscription Management**: Integrates Stripe for subscription plans, enabling role-based access control and plan-based feature limits.
- **Atomic Operations**: Critical workflows are implemented as atomic transactions.
- **Timezone Handling**: Robust timezone conversion utilities ensure correct date/time display and storage.

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

### October 15, 2025: Server-Side "Get or Create Then Redirect" Messaging Architecture
- **Feature**: Refactored messaging navigation to use server-side conversation creation with 302 redirects, eliminating all client-side conversation creation logic
- **Problem Solved**: Eliminated "Loading conversation..." freeze bugs, race conditions, NaN URL errors, and complex client-side state management
- **Architecture Changes**:
  - **New Server Route**: Added GET `/messages/u/:userId` that validates user, deterministically creates/finds conversation, and redirects to canonical route
  - **Instant Client Navigation**: MessagesDirectory now navigates directly to `/messages/u/${userId}` via `window.location.href` (browser navigation, not SPA routing) with zero preliminary API calls
  - **302 Redirect Flow**: Server responds with redirect to `/messages/c/${conversationId}` after validating user and creating/finding conversation
  - **Simplified MessageThread**: Removed ~100 lines of code including all `isNewConversation` logic, `createConversationMutation`, and `companyUsers` query
- **Server Route Implementation**:
  - Validates target user exists in same company and is ACTIVE
  - Uses existing `storage.getOrCreateConversation()` method with pairKey-based upsert
  - Returns 302 redirect to canonical conversation URL
  - Error redirects with query params for user feedback (err=user_not_found, err=no_company, err=server_error)
- **Benefits**:
  - **Instant Navigation**: No API call before navigation, immediate screen change (sub-150ms perceived latency maintained)
  - **Zero Race Conditions**: Server-side pairKey upsert handles concurrent requests safely with ON CONFLICT DO NOTHING
  - **No NaN Bugs**: Always navigate with real conversationId after server processes request
  - **Simpler Client Code**: MessageThread component simplified from complex state machine to straightforward conversation viewer
  - **Better UX**: Never see "Loading forever", "Unable to load conversation", or "Creating conversation..." on valid navigation
  - **Canonical URLs**: All conversations accessible via clean `/messages/c/:conversationId` URLs
- **Technical Details**:
  - pairKey = SHA-256(companyId:sortedUserId1:sortedUserId2) ensures deterministic conversation lookup
  - Browser automatically follows 302 redirects, no client-side handling needed
  - MessageThread always receives real conversationId, eliminating all "new conversation" code paths
  - Composer always enabled immediately (unless other user is inactive)
- **Result**: Messaging navigation is now instant, reliable, and dramatically simpler to maintain