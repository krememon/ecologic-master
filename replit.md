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
