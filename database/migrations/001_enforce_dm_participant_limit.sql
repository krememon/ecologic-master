-- Migration: Enforce 2-participant limit for 1:1 conversations
-- Purpose: Prevent data corruption where 1:1 conversations end up with >2 participants
-- Created: 2025-11-05

-- Create function to enforce participant limit
CREATE OR REPLACE FUNCTION enforce_dm_participant_limit()
RETURNS TRIGGER AS $$
DECLARE
  is_group_chat BOOLEAN;
  current_count INTEGER;
BEGIN
  -- Get the conversation type
  SELECT is_group INTO is_group_chat
  FROM conversations
  WHERE id = NEW.conversation_id;
  
  -- If it's a group chat, allow any number of participants
  IF is_group_chat THEN
    RETURN NEW;
  END IF;
  
  -- For 1:1 conversations, count existing participants
  SELECT COUNT(*) INTO current_count
  FROM conversation_participants
  WHERE conversation_id = NEW.conversation_id;
  
  -- Reject if adding this participant would exceed 2
  IF current_count >= 2 THEN
    RAISE EXCEPTION '1:1 conversation % already has % participants; cannot add more', 
      NEW.conversation_id, current_count
      USING ERRCODE = 'check_violation';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS enforce_dm_participant_limit_trigger ON conversation_participants;
CREATE TRIGGER enforce_dm_participant_limit_trigger
  BEFORE INSERT ON conversation_participants
  FOR EACH ROW
  EXECUTE FUNCTION enforce_dm_participant_limit();

-- Verify trigger was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'enforce_dm_participant_limit_trigger'
  ) THEN
    RAISE EXCEPTION 'Trigger enforce_dm_participant_limit_trigger was not created successfully';
  END IF;
  
  RAISE NOTICE 'Migration completed successfully: enforce_dm_participant_limit_trigger created';
END $$;
