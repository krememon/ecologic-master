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

## User Preferences

Preferred communication style: Simple, everyday language.
Design preferences: Bold, uppercase "EcoLogic" branding with wide letter spacing
Authentication: Triple authentication options (Email/Password + Replit + Google OAuth)
Registration: Enhanced form with password strength meter and show/hide toggles
User Flow: Automatic login and dashboard redirect after account creation
Logo: Custom water drop with leaf logo positioned above EcoLogic title