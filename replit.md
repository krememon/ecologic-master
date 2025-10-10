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

## Recent Changes

### October 8, 2025: Platform-wide Email Uniqueness Enforcement
- Created normalizeEmail utility (trim + lowercase) for consistent email handling
- Added case-insensitive unique database index on users.email using LOWER(TRIM(email))
- Built GET /api/auth/email-available endpoint for real-time email availability checking
- Updated all auth endpoints (registration, login, Google OAuth, profile update) to normalize emails
- All endpoints return 409 with EMAIL_IN_USE code when duplicate email detected
- Registration forms show inline error "This email is currently in use" with 500ms debounced check
- Settings page email change shows same inline error with debounced availability check
- Email input fields get red border when duplicate detected; no success toasts for duplicates
- Google OAuth auto-links to existing accounts when email matches (normalized comparison)
- PATCH /api/auth/user normalizes email, checks for duplicates, returns 409 before attempting update

### October 8, 2025: Enhanced Registration Flow Protection
- Continue button disabled when email availability is 'checking' or 'taken'
- Button text changes to "Checking..." during email validation
- Form validation includes emailAvailability state check
- handleUserInfoSubmit blocks navigation when email is taken or being checked
- Users cannot proceed to Company Setup or Join Company steps with duplicate email
- Clear visual feedback: disabled button + inline error + red border on email input

### October 9, 2025: Atomic Job Creation with Schedule Validation
- Refactored job creation wizard to use single atomic endpoint POST /api/jobs/finalize
- Created finalizeJobSchema in shared/schema.ts with discriminated union for client handling
- Updated ClientSuggestions to return {id, name} for proper client ID tracking
- Step 2 validation ensures clientId is captured for existing clients
- Backend creates job and schedule in Drizzle transaction for atomicity
- Proper 400 error responses with field-specific error codes (INVALID_TIME_RANGE, MISSING_CLIENT, etc.)
- Frontend shows user-friendly error messages based on error codes
- On success, navigates to job detail page (no success toast)
- Frontend and backend validate end > start times with inline error messages
- Eliminated separate API calls for client/job/schedule creation

### October 9, 2025: Schedule Date-Range Filtering
- Enhanced GET /api/schedule-items to accept optional start/end query params for date range filtering
- Implemented SQL overlap logic: `WHERE startDateTime < :end AND endDateTime > :start` for efficient filtering
- Created shared/timezoneUtils.ts with overlap checking utilities and date boundary conversion functions
- Updated AIScheduling.tsx to compute viewport range based on selected day/week and pass as query parameters
- Modal title dynamically shows "Week of [date]" or specific date based on selection
- Added client-side filtering as safety net to ensure only overlapping jobs display when day is selected
- Query keys include date range for proper cache management: `/api/schedule-items?start=${start}&end=${end}`
- Jobs.tsx invalidates all schedule queries using predicate matching to handle queries with different date ranges
- "All Planned Jobs" modal now shows only jobs overlapping current calendar viewport (day or week view)

### October 9, 2025: Job Deletion with CASCADE and RBAC
- Added CASCADE delete to all foreign keys referencing jobs.id in database schema (scheduleItems, jobAssignments, jobPhotos, invoices, payments, documents, messages)
- Added "jobs.delete" permission to OWNER, SUPERVISOR, and DISPATCHER roles
- Enhanced DELETE /api/jobs/:id route with RBAC using requirePerm("jobs.delete") middleware
- Route now validates job exists, belongs to company, and returns proper error codes (404 for JOB_NOT_FOUND, 403 for FORBIDDEN)
- Frontend deleteJobMutation invalidates all schedule queries using predicate to remove ghost events from Schedule view
- Job deletion now works without 500 errors and automatically removes all related schedule items, photos, and other dependencies

### October 9, 2025: Schedule Overlay Header Cleanup
- Removed "Viewing from [date]" text from schedule overlay modal header
- Header now displays only "All Planned Jobs" title with calendar icon
- Close (X) button remains functional and properly aligned
- Cleaner, simpler UI without redundant date information

### October 9, 2025: Job Details Panel Reorganization
- Simplified Job Details header to show only: Title, Status badge, Edit/Delete icons, and Close button
- Moved Client Name, Address, and Created Date from header into Job Information card
- Job Information card now displays fields in order: Client, Address, Priority, Created
- Address field is clickable link to Google Maps with proper title attribute for accessibility
- Removed redundant City/ZIP row (consolidated into Address field)
- Implemented accessible definition list (`<dl>`) structure with `<dt>` for labels and `<dd>` for values
- Each row uses `grid-cols-[auto_1fr]` layout: label takes minimal space, value takes remaining width
- Labels have `whitespace-nowrap` to prevent wrapping; values truncate with ellipsis when too long
- Row dividers using `divide-y` for visual separation between fields
- All values show full text on hover via `title` attributes
- Created date displays in "MMM d, yyyy" format with full datetime in tooltip

### October 9, 2025: Photo Upload Success Toast Removed
- Removed "Photo uploaded successfully" success toast notification from job photo uploads
- Visual feedback now provided through inline indicators: button shows "Uploading..." text when active
- Upload button is disabled during upload process
- Progress bar displays for uploads when job has no photos yet
- Thumbnail and photo counter update immediately upon successful upload
- Error toasts remain functional for upload failures
- Cleaner, less intrusive upload experience with visual state changes instead of popup notifications

### October 10, 2025: Service Worker Fix - App Loading Issue Resolved
- **Problem**: App not loading due to service worker MIME type error
- **Root Cause**: Service worker file (sw.js) was in wrong location - Vite's root is configured to "client" directory
- **Solution**: Moved sw.js from root public/ to client/public/ directory
- **Result**: Vite now correctly serves sw.js with Content-Type: application/javascript
- **Technical Details**: In development mode, Vite looks for public files in client/public/ (relative to its configured root)
- App now loads correctly without service worker registration errors

### October 10, 2025: White Screen Fix - Timezone API Corrections
- **Problem**: App showed white screen after timezone conversion implementation
- **Root Cause**: Used incorrect date-fns-tz v3 API function names in timezone utilities
- **Errors**: 
  - Used `zonedTimeToUtc` (doesn't exist in v3) instead of `fromZonedTime`
  - Used `utcToZonedTime` (doesn't exist in v3) instead of `toZonedTime`
  - Missing error handling caused crashes on invalid dates
- **Solution**: 
  - Updated to correct date-fns-tz v3 API: `fromZonedTime`, `formatInTimeZone`, `toZonedTime`
  - Added comprehensive try-catch error handling in all timezone functions
  - Functions now return empty string instead of throwing on invalid input
  - Added fallback to `toLocaleString()` if formatting fails
  - Made `getUserTimezone()` fall back to 'UTC' if determination fails
  - All date parsing validates with `isValid()` from date-fns
- **Result**: App loads successfully without white screen, robust date handling prevents future crashes

### October 10, 2025: Timezone Conversion and Location Display Fixes
- **Timezone Utilities**: Created client/src/utils/timezone.ts with utilities for timezone handling:
  - `getUserTimezone()`: Gets user's IANA timezone from browser (e.g., "America/New_York")
  - `datetimeLocalToUTC()`: Converts datetime-local input values to UTC ISO strings using date-fns-tz
  - `formatInLocalTimezone()`: Converts UTC timestamps back to user's local timezone for display
- **Job Creation**: Updated JobWizard to convert datetime-local picker values to UTC before API submission
  - Picker values treated as local time in user's timezone
  - Converted to UTC using zonedTimeToUtc before sending to backend
  - Backend receives and stores proper UTC timestamps
- **Schedule Display**: Updated AIScheduling.tsx to display times in user's local timezone
  - All schedule times formatted using `formatInLocalTimezone()` with "MMM d, yyyy h:mm a" format
  - Times correctly display in user's timezone (e.g., 10:00 AM shows as 10:00 AM, not shifted)
  - ScheduleItem interface updated to match actual API response fields (startDateTime/endDateTime)
- **Location Fallback**: Implemented proper location display priority
  - Added jobAddress field to GET /api/schedule-items API response (from jobs.address)
  - Frontend displays: schedule.location → job.address → "No location specified"
  - Both date-filtered and legacy API paths return enriched data with jobAddress
- **Cleanup**: Removed broken EditScheduleDialog component and legacy schedule editing functionality
  - Removed outdated ScheduleItem interface fields (startTime, endTime, date)
  - Cleaned up unused mutation and handler functions
  - Schedule management now exclusively through Job Wizard workflow