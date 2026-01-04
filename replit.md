# EcoLogic Construction Management Platform

## Overview
EcoLogic is a professional construction management platform for trade contractors, aiming to unify job management, subcontractor coordination, client communication, and invoicing. It features AI-powered scheduling and seeks to streamline construction workflows, enhance project oversight, and improve communication among all stakeholders. This modern, real-time, and PWA-enabled web application is designed to redefine construction project management through advanced technology and user-centric design.

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
- Accessible components primarily from Radix UI.
- Custom "EcoLogic" branding with a water drop and leaf logo.

**Technical Implementations**:
- **Authentication**: Supports Replit Auth, email/password, and social logins (Google) with robust session management and atomic session revocation.
- **Data Management**: PostgreSQL with Drizzle ORM for type-safe operations, implementing multi-tenancy and role-based access control (RBAC).
- **AI Integration**: Leverages OpenAI API (GPT-4o) for project scoping, material estimation, smart scheduling, and OCR-based invoice scanning. Integrates OpenWeather API for job planning.
- **Real-time Capabilities**: Utilizes a WebSocket server for live messaging, notifications, and instant job status updates, complemented by service worker-based push notifications. WebSocket communication includes room-based subscriptions, delivery acknowledgments, and client-side optimistic updates.
- **Messaging System**: Comprehensive two-pane messaging interface for direct 1:1 conversations using a server-side "get or create then redirect" pattern. Features instant navigation, deterministic conversation creation via pairKey upsert, real-time delivery via WebSocket with tempId reconciliation (prevents disappearing messages), read receipts, unread counts, searchable user lists with owner visibility (case-insensitive status filtering), day-based message grouping, and iMessage-style swipe-to-reveal timestamps (horizontal drag gesture reveals all timestamps on right side with smooth animations). Uses merge pattern instead of cache invalidation for optimistic updates. **iOS-Style Inbox**: Redesigned conversation list matches Apple Messages aesthetic with no avatars, tiny blue dot unread indicator, message previews (text or synthesized attachment labels like "Photo", "3 Photos", "2 Videos", "4 Attachments"), iOS-style time formatting (5:44 PM, Yesterday, M/D/YY), and comprehensive attachment preview synthesis that counts and categorizes all attachments by MIME type. **All-Coworkers View**: Inbox displays ALL active coworkers in company including owners (not just those with existing threads) via LEFT JOIN through companyMembers table with case-insensitive status filtering (UPPER(status) = 'ACTIVE'), with "Start a conversation" placeholder for users without messages. Clicking any coworker automatically creates thread via /api/messages/threads/ensure endpoint. **Store-and-Forward Delivery**: Production-ready message delivery that does NOT require both users to be online simultaneously. Both inbox (MessagesDirectory) and message thread (MessageThread) implement aggressive polling (refetchOnMount: "always", refetchOnWindowFocus: true, refetchOnReconnect: true, 5-second polling intervals, staleTime: 0) ensuring messages appear within 5 seconds even if recipient is offline, in different tab, or WebSocket is disconnected. Messages persist to database via atomic transactions before WebSocket notification, guaranteeing triple redundancy: (1) real-time WebSocket for instant delivery, (2) 5-second polling for missed events, (3) tab focus refetch when user returns. Backend has NO presence filtering—all queries fetch from database regardless of online status. **Guaranteed Delivery**: Atomic database transactions ensure message creation and conversation.updatedAt update happen together, driving instant iOS-style inbox resorting where conversations with new messages immediately move to the top. Database index on updatedAt desc ensures optimal sorting performance. **Data Integrity**: Three-layer protection ensures 1:1 conversation invariants: (1) Unique database constraint on (conversation_id, user_id) prevents duplicate participants, (2) Application-level validation in getOrCreateConversation enforces 2-participant limit, (3) PostgreSQL trigger automatically created at server startup rejects any insert exceeding 2 participants in 1:1 conversations.
- **Database Initialization**: Automated constraint enforcement system (server/db-init.ts) runs at startup to ensure critical database triggers exist in all environments. Creates PostgreSQL trigger to enforce 2-participant limit for 1:1 conversations, with persistent migration SQL files in database/migrations/ directory for reference.
- **File Management**: Handles job photos and documents, with provisions for cloud storage integration.
- **Document Visibility System**: Role-based document visibility with 5 levels: customer_internal (everyone), assigned_crew_only, office_only, internal, owner_only. Each role has specific allowed visibilities:
  - Owner: sees all documents (bypass)
  - Supervisor: customer_internal, assigned_crew_only, internal, office_only
  - Dispatcher: customer_internal, office_only, internal
  - Estimator: customer_internal, office_only
  - Technician: customer_internal, assigned_crew_only (limited to assigned jobs only)
  Backend enforces visibility at API level - restricted documents are completely hidden, not disabled.
- **Signature Requests**: Electronic signature system allowing users to send documents to customers for signature. Features:
  - RBAC enforcement: Owner, Supervisor, Dispatcher, Estimator can create/send requests; Technician cannot (hidden UI + 403 API response)
  - Document visibility filtering: Users only see signature requests for documents they can access
  - Automatic job inheritance: Signature requests inherit jobId from the selected document
  - Secure access tokens: Generated using randomBytes(32).toString('hex'), only returned once at creation for emailing
  - Status workflow: draft → sent → viewed → signed/declined/expired/canceled
  - "Send for Signature" action available from Documents page preview modal AND signature request detail view
  - Send action (POST /api/signature-requests/:id/send): Transitions draft→sent, records sentAt timestamp and sentByUserId, enforces RBAC and document visibility
  - Delete action only available for draft status (hidden not disabled for non-drafts)
  - Status pills show proper capitalization (Draft, Sent, Viewed, etc.)
  - Database table: signature_requests with documentId, customerName, customerEmail, message, status, accessToken, sentAt, sentByUserId
- **Employee Management**: Manages employee active/inactive status, session revocation, and contact information.
- **Onboarding**: Features an invite code system for company onboarding, supporting owner registration and new member joining, including a company rejoin flow.
- **Subscription Management**: Integrates Stripe for subscription plans, enabling role-based access control and plan-based feature limits.
- **Atomic Operations**: Critical workflows are implemented as atomic transactions.
- **Timezone Handling**: Robust timezone conversion utilities ensure correct date/time display and storage.
- **Development Tools**: Includes development-only debug endpoints for WebSocket and database state inspection.

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js strategies, Replit Auth, Google OAuth
- **AI**: OpenAI API
- **Weather**: OpenWeather API
- **Email**: Nodemailer
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI, Framer Motion
- **Development Tools**: Vite, TypeScript, Zod, React Hook Form
- **Payments**: Stripe