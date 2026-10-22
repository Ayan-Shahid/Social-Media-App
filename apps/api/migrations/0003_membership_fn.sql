-- Helper used by the conversation policies. SECURITY DEFINER so a policy on conversation_members
-- can check membership without recursively applying itself.
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO glimpse_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_member(p_conversation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM conversation_members m
    WHERE m.conversation_id = p_conversation_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.left_at IS NULL
  );
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_member(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_member(uuid) TO glimpse_app;
