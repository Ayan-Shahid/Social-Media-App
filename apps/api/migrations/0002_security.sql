-- Permissions for the app role, and the only way to reach credentials and sessions.
--
-- The app role gets the smallest set of privileges each table needs. On top of that, RLS policies
-- (in 0001) decide which ROWS it may touch. It gets NO privileges at all on user_credentials and
-- sessions: those are only reachable through the SECURITY DEFINER functions in the "auth" schema.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO glimpse_app;--> statement-breakpoint
GRANT SELECT, UPDATE (display_name, bio, avatar_media_id) ON users TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public_keys, key_backups, media TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON follows, post_likes, comment_likes, comments TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (caption), DELETE ON posts TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (last_message_at) ON conversations TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT ON messages TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO glimpse_app;--> statement-breakpoint

CREATE SCHEMA IF NOT EXISTS auth;--> statement-breakpoint
REVOKE ALL ON SCHEMA auth FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO glimpse_app;--> statement-breakpoint

-- Creates a user and their credentials. Returns the new user id.
CREATE OR REPLACE FUNCTION auth.register(p_username citext, p_email citext, p_password_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO users (username, display_name) VALUES (p_username, p_username::text) RETURNING id INTO v_id;
  INSERT INTO user_credentials (user_id, email, password_hash) VALUES (v_id, p_email, p_password_hash);
  RETURN v_id;
END $$;--> statement-breakpoint

-- Returns the user id and password hash for an email, so the API can verify a login.
CREATE OR REPLACE FUNCTION auth.find_login(p_email citext)
RETURNS TABLE (user_id uuid, password_hash text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.user_id, c.password_hash FROM user_credentials c WHERE c.email = p_email
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.create_session(p_token_hash text, p_user_id uuid, p_expires_at timestamptz, p_user_agent text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (p_token_hash, p_user_id, p_expires_at, left(coalesce(p_user_agent, ''), 300))
$$;--> statement-breakpoint

-- Returns the user for a valid, unexpired session token hash, or NULL.
CREATE OR REPLACE FUNCTION auth.resolve_session(p_token_hash text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.user_id FROM sessions s WHERE s.token_hash = p_token_hash AND s.expires_at > now()
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.delete_session(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM sessions WHERE token_hash = p_token_hash
$$;--> statement-breakpoint

-- Housekeeping: expired sessions and day-old idempotency records.
CREATE OR REPLACE FUNCTION auth.purge_expired()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM sessions WHERE expires_at < now();
  DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
$$;--> statement-breakpoint

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO glimpse_app;
