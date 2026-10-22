-- "Did I create this conversation?" for the member-insert policy. The conversation itself is hidden
-- from its creator until they're a member, so a plain subquery in the policy would always be false.
CREATE OR REPLACE FUNCTION app.is_creator(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM conversations c WHERE c.id = p_conversation_id
    AND c.created_by = nullif(current_setting('app.user_id', true), '')::uuid)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_creator(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_creator(uuid) TO glimpse_app;--> statement-breakpoint
-- Re-adding a former member records the epoch they rejoined at.
GRANT UPDATE (joined_epoch) ON conversation_members TO glimpse_app;
