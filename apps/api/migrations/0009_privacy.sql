CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_not_self" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "follow_requests" (
	"requester_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_requests_requester_id_target_id_pk" PRIMARY KEY("requester_id","target_id"),
	CONSTRAINT "follow_requests_not_self" CHECK ("follow_requests"."requester_id" <> "follow_requests"."target_id")
);
--> statement-breakpoint
ALTER TABLE "follow_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mutes" (
	"muter_id" uuid NOT NULL,
	"muted_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutes_muter_id_muted_id_pk" PRIMARY KEY("muter_id","muted_id"),
	CONSTRAINT "mutes_not_self" CHECK ("mutes"."muter_id" <> "mutes"."muted_id")
);
--> statement-breakpoint
ALTER TABLE "mutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- ---------- Privacy helpers (DECISIONS.md D15) ----------
-- SECURITY DEFINER: they need to see blocks in BOTH directions, while a user may only read their own.
-- They return yes/no only, so they leak nothing beyond what the policy decision reveals anyway.
CREATE OR REPLACE FUNCTION app.blocked_between(a uuid, b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a))
$$;--> statement-breakpoint
-- "Is there a block between me and this person?" Only ever about the caller, so it can't be used
-- to probe who blocked whom among other people. Used to show "user not found" on a blocker's profile.
CREATE OR REPLACE FUNCTION app.blocked_with(p_other uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.blocked_between(p_other, nullif(current_setting('app.user_id', true), '')::uuid)
$$;--> statement-breakpoint
-- The one definition of "can the current user see content by this author?"
CREATE OR REPLACE FUNCTION app.can_see(p_author uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (SELECT nullif(current_setting('app.user_id', true), '')::uuid AS id)
  SELECT p_author = me.id OR (
    NOT app.blocked_between(p_author, me.id)
    AND (NOT (SELECT u.is_private FROM users u WHERE u.id = p_author)
         OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = me.id AND f.followee_id = p_author))
  ) FROM me
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.can_follow(p_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT app.blocked_between(p_target, nullif(current_setting('app.user_id', true), '')::uuid)
    AND NOT coalesce((SELECT is_private FROM users WHERE id = p_target), true)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.can_request(p_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT app.blocked_between(p_target, nullif(current_setting('app.user_id', true), '')::uuid)
    AND coalesce((SELECT is_private FROM users WHERE id = p_target), false)
$$;--> statement-breakpoint
-- 1:1 chats only; groups aren't closed by a block between two of their members.
CREATE OR REPLACE FUNCTION app.direct_blocked(p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT c.kind = 'direct' AND app.blocked_between(c.user_a, c.user_b) FROM conversations c WHERE c.id = p_conversation), false)
$$;--> statement-breakpoint
-- Profile counters are public facts (Instagram shows a private account's post count), so they're
-- counted over ALL rows. Counting under the viewer's RLS would also poison the shared counter cache.
CREATE OR REPLACE FUNCTION app.profile_counts(p_user uuid)
RETURNS TABLE (posts int, followers int, following int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT count(*)::int FROM posts WHERE author_id = p_user),
         (SELECT count(*)::int FROM follows WHERE followee_id = p_user),
         (SELECT count(*)::int FROM follows WHERE follower_id = p_user)
$$;--> statement-breakpoint
-- Accepting creates a follow row whose follower is someone else, which the follows policy can't allow.
-- This function allows exactly that one case: a pending request to the current user.
CREATE OR REPLACE FUNCTION app.accept_follow_request(p_requester uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  DELETE FROM follow_requests WHERE requester_id = p_requester AND target_id = me;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO follows (follower_id, followee_id) VALUES (p_requester, me) ON CONFLICT DO NOTHING;
  RETURN true;
END $$;--> statement-breakpoint
-- Going public: every pending request becomes a follow (what Instagram does). Returns the new followers.
CREATE OR REPLACE FUNCTION app.accept_all_follow_requests()
RETURNS SETOF uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  RETURN QUERY WITH r AS (DELETE FROM follow_requests WHERE target_id = me RETURNING requester_id)
    INSERT INTO follows (follower_id, followee_id) SELECT requester_id, me FROM r ON CONFLICT DO NOTHING RETURNING follower_id;
END $$;--> statement-breakpoint
-- Block = one transaction: record it, and cut follows and requests in both directions.
CREATE OR REPLACE FUNCTION app.block_user(p_target uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF me IS NULL OR p_target = me THEN RAISE EXCEPTION 'invalid block'; END IF;
  INSERT INTO blocks (blocker_id, blocked_id) VALUES (me, p_target) ON CONFLICT DO NOTHING;
  DELETE FROM follows WHERE (follower_id = me AND followee_id = p_target) OR (follower_id = p_target AND followee_id = me);
  DELETE FROM follow_requests WHERE (requester_id = me AND target_id = p_target) OR (requester_id = p_target AND target_id = me);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.blocked_between(uuid, uuid), app.blocked_with(uuid), app.profile_counts(uuid), app.can_see(uuid), app.can_follow(uuid), app.can_request(uuid),
  app.direct_blocked(uuid), app.accept_follow_request(uuid), app.accept_all_follow_requests(), app.block_user(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.blocked_with(uuid), app.profile_counts(uuid), app.can_see(uuid), app.can_follow(uuid), app.can_request(uuid), app.direct_blocked(uuid),
  app.accept_follow_request(uuid), app.accept_all_follow_requests(), app.block_user(uuid) TO glimpse_app;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_muter_id_users_id_fk" FOREIGN KEY ("muter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_muted_id_users_id_fk" FOREIGN KEY ("muted_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "follow_requests_target_idx" ON "follow_requests" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE POLICY "blocks_select_own" ON "blocks" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING ("blocks"."blocker_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "blocks_delete_own" ON "blocks" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("blocks"."blocker_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "follow_requests_select" ON "follow_requests" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING ("follow_requests"."requester_id" = nullif(current_setting('app.user_id', true), '')::uuid or "follow_requests"."target_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "follow_requests_insert" ON "follow_requests" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("follow_requests"."requester_id" = nullif(current_setting('app.user_id', true), '')::uuid and app.can_request("follow_requests"."target_id"));--> statement-breakpoint
CREATE POLICY "follow_requests_delete" ON "follow_requests" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("follow_requests"."requester_id" = nullif(current_setting('app.user_id', true), '')::uuid or "follow_requests"."target_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mutes_own" ON "mutes" AS PERMISSIVE FOR ALL TO "glimpse_app" USING ("mutes"."muter_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("mutes"."muter_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "comments_select" ON "comments" TO glimpse_app USING (nullif(current_setting('app.user_id', true), '')::uuid is not null and exists (select 1 from posts p where p.id = "comments"."post_id"));--> statement-breakpoint
ALTER POLICY "comments_insert_self" ON "comments" TO glimpse_app WITH CHECK ("comments"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid and exists (select 1 from posts p where p.id = "comments"."post_id"));--> statement-breakpoint
ALTER POLICY "follows_insert_self" ON "follows" TO glimpse_app WITH CHECK ("follows"."follower_id" = nullif(current_setting('app.user_id', true), '')::uuid and app.can_follow("follows"."followee_id"));--> statement-breakpoint
ALTER POLICY "follows_delete_self" ON "follows" TO glimpse_app USING ("follows"."follower_id" = nullif(current_setting('app.user_id', true), '')::uuid or "follows"."followee_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "messages_insert_member" ON "messages" TO glimpse_app WITH CHECK ("messages"."sender_id" = nullif(current_setting('app.user_id', true), '')::uuid and app.is_member("messages"."conversation_id") and not app.direct_blocked("messages"."conversation_id"));--> statement-breakpoint
ALTER POLICY "post_likes_insert_self" ON "post_likes" TO glimpse_app WITH CHECK ("post_likes"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and exists (select 1 from posts p where p.id = "post_likes"."post_id"));--> statement-breakpoint
ALTER POLICY "posts_select" ON "posts" TO glimpse_app USING (nullif(current_setting('app.user_id', true), '')::uuid is not null and app.can_see("posts"."author_id"));--> statement-breakpoint
ALTER POLICY "reposts_insert_self" ON "reposts" TO glimpse_app WITH CHECK ("reposts"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and exists (select 1 from posts p where p.id = "reposts"."post_id"));--> statement-breakpoint
ALTER POLICY "saved_posts_owner" ON "saved_posts" TO glimpse_app USING ("saved_posts"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("saved_posts"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and exists (select 1 from posts p where p.id = "saved_posts"."post_id"));--> statement-breakpoint
ALTER POLICY "stories_select_active" ON "stories" TO glimpse_app USING (nullif(current_setting('app.user_id', true), '')::uuid is not null and "stories"."expires_at" > now() and app.can_see("stories"."author_id"));--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON follow_requests, mutes TO glimpse_app;--> statement-breakpoint
GRANT SELECT, DELETE ON blocks TO glimpse_app;--> statement-breakpoint
GRANT UPDATE (is_private) ON users TO glimpse_app;--> statement-breakpoint
-- Worker: skip notifications across a block; fan-out ignores mutes (they filter at read time).
GRANT SELECT ON blocks, follow_requests TO glimpse_worker;
