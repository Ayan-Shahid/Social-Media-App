CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_name_len" CHECK (char_length("collections"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_epoch" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "group_keys" (
	"conversation_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"wrapped_by" uuid NOT NULL,
	"wrapped_key" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_keys_conversation_id_epoch_user_id_pk" PRIMARY KEY("conversation_id","epoch","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hashtags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag" "citext" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hashtags_format" CHECK ("hashtags"."tag" ~ '^[[:alnum:]_]{1,50}$')
);
--> statement-breakpoint
ALTER TABLE "hashtags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"event_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('like', 'comment', 'follow', 'mention', 'repost'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"email" "citext",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_accounts_provider_provider_user_id_pk" PRIMARY KEY("provider","provider_user_id")
);
--> statement-breakpoint
ALTER TABLE "oauth_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_hashtags" (
	"post_id" uuid NOT NULL,
	"hashtag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_hashtags_post_id_hashtag_id_pk" PRIMARY KEY("post_id","hashtag_id")
);
--> statement-breakpoint
ALTER TABLE "post_hashtags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_media" (
	"post_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "post_media_post_id_position_pk" PRIMARY KEY("post_id","position"),
	CONSTRAINT "post_media_position" CHECK ("post_media"."position" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "post_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reposts" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reposts_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "reposts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_posts" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"collection_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_posts_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "saved_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "story_views" (
	"story_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_views_story_id_viewer_id_pk" PRIMARY KEY("story_id","viewer_id")
);
--> statement-breakpoint
ALTER TABLE "story_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_ordered";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_media_id_media_id_fk";
--> statement-breakpoint
DROP INDEX "conversations_user_b_idx";--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "user_a" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "user_b" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "file_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "mime" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "width" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "height" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "bytes" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "kind" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "current_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "needs_rotation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "key_backups" ADD COLUMN "kind" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "purpose" text DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "original_path" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "variants" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "epoch" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "kind" text DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_keys" ADD CONSTRAINT "group_keys_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_keys" ADD CONSTRAINT "group_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_keys" ADD CONSTRAINT "group_keys_wrapped_by_users_id_fk" FOREIGN KEY ("wrapped_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_hashtags" ADD CONSTRAINT "post_hashtags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_hashtags" ADD CONSTRAINT "post_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_owner_name_key" ON "collections" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hashtags_tag_key" ON "hashtags" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "mentions_user_idx" ON "mentions" USING btree ("mentioned_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_key" ON "notifications" USING btree ("event_id","recipient_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_idx" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("id") WHERE "outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "post_hashtags_tag_idx" ON "post_hashtags" USING btree ("hashtag_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_media_key" ON "post_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "reposts_post_idx" ON "reposts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "stories_author_idx" ON "stories" USING btree ("author_id","expires_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_kind_created_idx" ON "posts" USING btree ("kind","created_at");--> statement-breakpoint
-- Change the posts policy first: the old one references media_id, which is dropped below.
ALTER POLICY "posts_insert_self" ON "posts" TO glimpse_app WITH CHECK ("posts"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
-- Data migration (hand-written): keep existing posts and conversations working.
INSERT INTO "post_media" ("post_id", "media_id", "position") SELECT "id", "media_id", 0 FROM "posts";--> statement-breakpoint
UPDATE "conversations" SET "created_by" = "user_a" WHERE "created_by" IS NULL;--> statement-breakpoint
INSERT INTO "conversation_members" ("conversation_id", "user_id", "role")
  SELECT "id", "user_a", 'owner' FROM "conversations" WHERE "kind" = 'direct'
  UNION ALL SELECT "id", "user_b", 'member' FROM "conversations" WHERE "kind" = 'direct';--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "media_id";--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind" CHECK (("conversations"."kind" = 'direct' and "conversations"."user_a" < "conversations"."user_b") or ("conversations"."kind" = 'group' and "conversations"."user_a" is null and "conversations"."user_b" is null));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_title_len" CHECK ("conversations"."title" is null or char_length("conversations"."title") between 1 and 60);--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_status" CHECK ("media"."status" in ('processing', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_kind" CHECK ("posts"."kind" in ('post', 'short'));--> statement-breakpoint
DROP POLICY "conversations_insert_member" ON "conversations" CASCADE;--> statement-breakpoint
CREATE POLICY "conversations_insert" ON "conversations" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("conversations"."created_by" = nullif(current_setting('app.user_id', true), '')::uuid and ("conversations"."kind" = 'group' or nullif(current_setting('app.user_id', true), '')::uuid in ("conversations"."user_a", "conversations"."user_b")));--> statement-breakpoint
CREATE POLICY "collections_owner" ON "collections" AS PERMISSIVE FOR ALL TO "glimpse_app" USING ("collections"."owner_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("collections"."owner_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "members_select" ON "conversation_members" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (app.is_member("conversation_members"."conversation_id"));--> statement-breakpoint
CREATE POLICY "members_insert" ON "conversation_members" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK (app.is_member("conversation_members"."conversation_id") or exists (select 1 from conversations c where c.id = "conversation_members"."conversation_id" and c.created_by = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "members_update" ON "conversation_members" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING (app.is_member("conversation_members"."conversation_id")) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "group_keys_select_own" ON "group_keys" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING ("group_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "group_keys_insert" ON "group_keys" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("group_keys"."wrapped_by" = nullif(current_setting('app.user_id', true), '')::uuid and app.is_member("group_keys"."conversation_id"));--> statement-breakpoint
CREATE POLICY "hashtags_select" ON "hashtags" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "hashtags_insert" ON "hashtags" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "mentions_select" ON "mentions" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "mentions_insert_self" ON "mentions" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("mentions"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_select_self" ON "notifications" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING ("notifications"."recipient_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_update_self" ON "notifications" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING ("notifications"."recipient_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("notifications"."recipient_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_insert_self" ON "outbox" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("outbox"."actor_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "post_hashtags_select" ON "post_hashtags" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "post_hashtags_insert" ON "post_hashtags" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK (exists (select 1 from posts p where p.id = "post_hashtags"."post_id" and p.author_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "post_media_select" ON "post_media" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "post_media_insert" ON "post_media" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK (exists (select 1 from posts p where p.id = "post_media"."post_id" and p.author_id = nullif(current_setting('app.user_id', true), '')::uuid)
        and exists (select 1 from media m where m.id = "post_media"."media_id" and m.owner_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "reposts_select" ON "reposts" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "reposts_insert_self" ON "reposts" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("reposts"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "reposts_delete_self" ON "reposts" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("reposts"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "saved_posts_owner" ON "saved_posts" AS PERMISSIVE FOR ALL TO "glimpse_app" USING ("saved_posts"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("saved_posts"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "stories_select_active" ON "stories" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null and "stories"."expires_at" > now());--> statement-breakpoint
CREATE POLICY "stories_insert_self" ON "stories" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("stories"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid and exists (select 1 from media m where m.id = "stories"."media_id" and m.owner_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "stories_delete_self" ON "stories" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("stories"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "story_views_insert_self" ON "story_views" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("story_views"."viewer_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "story_views_select" ON "story_views" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING ("story_views"."viewer_id" = nullif(current_setting('app.user_id', true), '')::uuid or exists (select 1 from stories s where s.id = "story_views"."story_id" and s.author_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
ALTER POLICY "conversations_select_member" ON "conversations" TO glimpse_app USING (app.is_member("conversations"."id"));--> statement-breakpoint
ALTER POLICY "conversations_update_member" ON "conversations" TO glimpse_app USING (app.is_member("conversations"."id")) WITH CHECK (app.is_member("conversations"."id"));--> statement-breakpoint
ALTER POLICY "messages_select_member" ON "messages" TO glimpse_app USING (app.is_member("messages"."conversation_id"));--> statement-breakpoint
ALTER POLICY "messages_insert_member" ON "messages" TO glimpse_app WITH CHECK ("messages"."sender_id" = nullif(current_setting('app.user_id', true), '')::uuid and app.is_member("messages"."conversation_id"));--> statement-breakpoint