-- v2 permissions. Same rule as before: smallest set of privileges per table, and RLS decides rows.

-- App role (every API request)
GRANT SELECT, INSERT ON post_media, hashtags, post_hashtags, mentions, story_views, group_keys TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON reposts, stories TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (name), DELETE ON collections TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (collection_id), DELETE ON saved_posts TO glimpse_app;--> statement-breakpoint
GRANT SELECT, UPDATE (read_at) ON notifications TO glimpse_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (left_at, role) ON conversation_members TO glimpse_app;--> statement-breakpoint
GRANT UPDATE (current_epoch, needs_rotation, title) ON conversations TO glimpse_app;--> statement-breakpoint
GRANT INSERT ON outbox TO glimpse_app;--> statement-breakpoint
GRANT USAGE ON SEQUENCE outbox_id_seq TO glimpse_app;--> statement-breakpoint

-- Worker role (background jobs). It bypasses RLS because it does system work for many users
-- (fan-out, notifications for other people, cleanup). It gets no access to credentials, sessions,
-- linked accounts or key backups, and only the writes its jobs need. See DECISIONS.md D13.
GRANT USAGE ON SCHEMA public TO glimpse_worker;--> statement-breakpoint
GRANT SELECT ON users, media, posts, post_media, reposts, follows, post_likes, comments, hashtags, post_hashtags,
  mentions, notifications, stories, conversations, conversation_members, outbox TO glimpse_worker;--> statement-breakpoint
GRANT INSERT ON notifications TO glimpse_worker;--> statement-breakpoint
GRANT UPDATE (status, error, variants, original_path, width, height, duration_ms, bytes, mime) ON media TO glimpse_worker;--> statement-breakpoint
GRANT UPDATE (published_at, attempts) ON outbox TO glimpse_worker;--> statement-breakpoint
GRANT DELETE ON outbox, stories TO glimpse_worker;--> statement-breakpoint
GRANT DELETE ON media TO glimpse_worker;--> statement-breakpoint

-- Sign in with Google: linked accounts are only reachable through these functions.
CREATE OR REPLACE FUNCTION auth.find_oauth(p_provider text, p_subject text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT user_id FROM oauth_accounts WHERE provider = p_provider AND provider_user_id = p_subject
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.find_user_by_email(p_email citext)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT user_id FROM user_credentials WHERE email = p_email
  UNION SELECT user_id FROM oauth_accounts WHERE email = p_email
  LIMIT 1
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.link_oauth(p_provider text, p_subject text, p_user_id uuid, p_email citext)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email) VALUES (p_provider, p_subject, p_user_id, p_email)
  ON CONFLICT (provider, provider_user_id) DO NOTHING
$$;--> statement-breakpoint

-- New account from a Google sign-in. Picks a free username based on the requested one.
CREATE OR REPLACE FUNCTION auth.register_oauth(p_username citext, p_display_name text, p_provider text, p_subject text, p_email citext)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_name citext := p_username; v_try int := 0;
BEGIN
  LOOP
    BEGIN
      INSERT INTO users (username, display_name) VALUES (v_name, left(coalesce(p_display_name, v_name::text), 60)) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 20 THEN RAISE; END IF;
      v_name := left(p_username::text, 24) || floor(random() * 100000)::int::text;
    END;
  END LOOP;
  INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email) VALUES (p_provider, p_subject, v_id, p_email);
  RETURN v_id;
END $$;--> statement-breakpoint

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO glimpse_app;
