# Database Migrations

This directory contains raw SQL migrations that cannot be expressed in Drizzle schema (e.g., triggers, functions, complex constraints).

## How to Apply Migrations

### Development Database
Run migrations manually using the SQL execution tool or psql:
```bash
psql $DATABASE_URL < database/migrations/001_enforce_dm_participant_limit.sql
```

### Production Database
Apply migrations through the Replit database management interface or your deployment pipeline.

## Migration Files

### 001_enforce_dm_participant_limit.sql
**Purpose**: Enforce 2-participant limit for 1:1 conversations to prevent data corruption.

**What it does**:
- Creates a PostgreSQL trigger that fires BEFORE INSERT on `conversation_participants`
- Checks if the conversation is a 1:1 DM (is_group = false)
- Counts existing participants  
- Rejects the insert if it would cause more than 2 participants

**Why it's needed**:
- Drizzle schema doesn't support triggers
- Application-level validation can be bypassed by direct DB access
- Provides defense-in-depth data integrity enforcement

**Testing**:
Try to add a 3rd participant to a 1:1 conversation - it should fail with:
```
ERROR: 1:1 conversation X already has 2 participants; cannot add more
```

## Important Notes

- These migrations are **not** managed by Drizzle's migration system
- They must be applied manually to each environment
- Always test migrations on development database first
- Keep this README updated when adding new migrations
