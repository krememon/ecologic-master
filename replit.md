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

### October 15, 2025: Single-Endpoint Messaging Architecture
- **Feature**: Refactored messaging to use single POST /api/dm/open endpoint that handles find-or-create + fetch in one call
- **Problem Solved**: Eliminated "Loading conversation..." freeze bugs, race conditions, NaN URL errors, and multi-step API complexity
- **Database Migration**: Added `pair_key` column (NOT NULL, UNIQUE) to conversations table with backfill script that:
  - Generated SHA-256 pairKey for all existing 1:1 conversations
  - Detected and removed 3 duplicate conversations (kept oldest ones)
  - Ensured data integrity by making pair_key NOT NULL after backfill
- **Architecture Changes**:
  - **Single API Endpoint**: POST `/api/dm/open` with { userId, limit } request body
    - Validates target user exists in same company and is ACTIVE (403 if not)
    - Deterministically creates/finds conversation using pairKey-based upsert
    - Fetches last N messages in same call
    - Returns { conversation: {id}, otherUser: {...}, messages: [...] }
  - **Instant Client Navigation**: MessagesDirectory navigates to `/messages/u/:userId` via SPA routing
  - **Smart Component**: MessageThread component handles both `/messages/u/:userId` and `/messages/c/:conversationId` routes
    - Detects if param is userId or conversationId
    - If userId: calls POST /api/dm/open, then updates URL to `/messages/c/:conversationId`
    - If conversationId: uses existing fetch flow
    - Renders header + composer immediately (no blocking)
  - **Optimistic Updates**: Messages appear instantly when sent, marked as "Sending..." until confirmed
- **Server Implementation**:
  - Validates both users are in same company
  - Uses `storage.getOrCreateConversation()` with pairKey-based upsert (atomic, no race conditions)
  - Returns 403 for access denied scenarios with clear error messages
  - Never returns 404 for empty conversations (returns messages: [])
- **Benefits**:
  - **Instant Navigation**: Click employee → DM page renders immediately with header/composer
  - **Fast Message Load**: Single API call gets conversation + messages (≤500ms typical)
  - **Zero Race Conditions**: Server-side pairKey upsert handles concurrent requests safely
  - **Better Error Handling**: Clean 403 messages, inline retry buttons, no cryptic errors
  - **Optimistic UX**: Messages appear instantly, show "Sending..." then confirm
  - **No Redirects**: Pure SPA navigation, no 302s or page reloads
- **Technical Details**:
  - pairKey = SHA-256(companyId:sortedUserId1:sortedUserId2) ensures deterministic conversation lookup
  - Component uses intelligent route detection (userId vs conversationId)
  - Optimistic updates with pending/failed states for instant feedback
  - Composer disabled for inactive users with clear messaging
- **Result**: Messaging is instant, reliable, and dramatically simpler with single-endpoint architecture