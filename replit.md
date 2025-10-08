# EcoLogic Construction Management Platform

## Overview

EcoLogic is a professional construction management platform for trade contractors, offering unified job management, subcontractor coordination, client communication, invoicing, and AI-powered scheduling. It aims to streamline construction workflows, enhance project oversight, and improve communication across all stakeholders. The platform is a modern, real-time, PWA-enabled web application.

## User Preferences

Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Triple authentication options (Email/Password + Replit + Google OAuth)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title

## System Architecture

EcoLogic is built as a multi-tenant web application using a modern tech stack. The frontend utilizes React 18 with TypeScript, Vite, Tailwind CSS (with shadcn/ui), TanStack Query, Wouter, and React Hook Form. The backend is powered by Node.js with Express.js, TypeScript, and PostgreSQL with Drizzle ORM. Authentication supports Replit Auth, email/password, and social logins (Google, Facebook, Microsoft).

Key architectural decisions include:
- **UI/UX**: Responsive design, PWA support, dark mode, accessible components from Radix UI.
- **Data Management**: PostgreSQL database with Drizzle ORM for type-safe operations. Multi-tenant design with company-based organization and role-based access control.
- **AI Integration**: OpenAI GPT-4o for features like project scoping, material estimation, smart scheduling, and OCR-based invoice scanning. OpenWeather API for job planning.
- **Real-time Capabilities**: WebSocket server for live messaging, notifications, and instant job status updates. Service worker-based push notifications.
- **File Management**: Handling of job photos, documents, and prepared for cloud storage integration.
- **Authentication**: Robust session management with PostgreSQL-backed sessions and atomic session revocation. Secure email uniqueness enforcement at the database and application levels.
- **Employee Management**: Comprehensive system for managing employees, including status (active/inactive) with instant session revocation, and detailed contact information.
- **Onboarding**: Invite code system for seamless company onboarding, supporting both owner registration and member joining.
- **Subscription Management**: Integrated Stripe for subscription plans, enabling role-based access control and plan-based feature limits.

## External Dependencies

- **Database**: PostgreSQL (via Neon serverless for connectivity)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js strategies, Replit Auth, Google OAuth
- **AI**: OpenAI API
- **Email**: Nodemailer
- **File Uploads**: Multer
- **WebSockets**: `ws` library
- **UI Libraries**: Tailwind CSS, shadcn/ui, Radix UI
- **Development Tools**: Vite, TypeScript, Zod, React Hook Form