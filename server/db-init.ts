import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * Database initialization - ensures critical constraints exist
 * This runs at server startup to apply migrations that can't be expressed in Drizzle schema
 */
export async function initializeDatabase() {
  try {
    console.log('[db-init] Checking database constraints...');
    
    // Check if the trigger exists
    const triggerExists = await db.execute(sql`
      SELECT 1 FROM pg_trigger 
      WHERE tgname = 'enforce_dm_participant_limit_trigger'
      LIMIT 1
    `);
    
    if (triggerExists.rows.length === 0) {
      console.log('[db-init] Creating enforce_dm_participant_limit trigger...');
      
      // Create the function
      await db.execute(sql`
        CREATE OR REPLACE FUNCTION enforce_dm_participant_limit()
        RETURNS TRIGGER AS $$
        DECLARE
          is_group_chat BOOLEAN;
          current_count INTEGER;
        BEGIN
          SELECT is_group INTO is_group_chat
          FROM conversations
          WHERE id = NEW.conversation_id;
          
          IF is_group_chat THEN
            RETURN NEW;
          END IF;
          
          SELECT COUNT(*) INTO current_count
          FROM conversation_participants
          WHERE conversation_id = NEW.conversation_id;
          
          IF current_count >= 2 THEN
            RAISE EXCEPTION '1:1 conversation % already has % participants; cannot add more', 
              NEW.conversation_id, current_count
              USING ERRCODE = 'check_violation';
          END IF;
          
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      
      // Create the trigger
      await db.execute(sql`
        DROP TRIGGER IF EXISTS enforce_dm_participant_limit_trigger ON conversation_participants;
      `);
      
      await db.execute(sql`
        CREATE TRIGGER enforce_dm_participant_limit_trigger
          BEFORE INSERT ON conversation_participants
          FOR EACH ROW
          EXECUTE FUNCTION enforce_dm_participant_limit();
      `);
      
      console.log('[db-init] ✅ Trigger enforce_dm_participant_limit_trigger created successfully');
    } else {
      console.log('[db-init] ✅ Trigger enforce_dm_participant_limit_trigger already exists');
    }
    
    // ── pending_new_email columns (email-change confirmation flow) ──
    // The Drizzle schema declares users.pendingNewEmail / pendingNewEmailToken /
    // pendingNewEmailExpires, but they were never pushed to the production
    // database. Every SELECT against users (Drizzle generates an explicit
    // column list) currently fails with:
    //   error: column "pending_new_email" does not exist  (SQLSTATE 42703)
    // breaking signup start, dashboard admin login, and the Google OAuth
    // callback (getUserByEmail / getUserByGoogleId). Add the columns
    // idempotently here so the next deploy self-heals without a separate
    // `npm run db:push` against prod.
    console.log('[db-init] Ensuring users.pending_new_email* columns exist…');
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS pending_new_email varchar,
        ADD COLUMN IF NOT EXISTS pending_new_email_token varchar,
        ADD COLUMN IF NOT EXISTS pending_new_email_expires timestamp
    `);
    console.log('[db-init] ✅ users.pending_new_email* columns ensured');

    console.log('[db-init] Database initialization complete');
  } catch (error) {
    console.error('[db-init] ERROR during database initialization:', error);
    throw error;
  }
}
