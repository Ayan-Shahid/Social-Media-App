CREATE TABLE "comment_likes" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_likes_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "comment_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_len" CHECK (char_length("comments"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_ordered" CHECK ("conversations"."user_a" < "conversations"."user_b")
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "idempotency_key_format" CHECK ("idempotency_keys"."key" ~ '^[A-Za-z0-9_-]{8,100}$')
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "key_backups" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"salt" text NOT NULL,
	"ops_limit" integer NOT NULL,
	"mem_limit" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "key_backups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"poster_file_name" text,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_kind" CHECK ("media"."kind" in ('image', 'video'))
);
--> statement-breakpoint
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_ciphertext_len" CHECK (char_length("messages"."ciphertext") <= 20000)
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_likes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "post_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_caption_len" CHECK (char_length("posts"."caption") <= 2200)
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" "citext" NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[a-zA-Z0-9_.]{3,30}$'),
	CONSTRAINT "users_bio_len" CHECK (char_length("users"."bio") <= 300),
	CONSTRAINT "users_display_name_len" CHECK (char_length("users"."display_name") <= 60)
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_backups" ADD CONSTRAINT "key_backups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_keys" ADD CONSTRAINT "public_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_post_created_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_pair_key" ON "conversations" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE INDEX "conversations_user_b_idx" ON "conversations" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "follows_followee_idx" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "idempotency_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_author_created_idx" ON "posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_credentials_email_key" ON "user_credentials" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "users_username_trgm" ON "users" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "comment_likes_select" ON "comment_likes" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "comment_likes_insert_self" ON "comment_likes" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("comment_likes"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comment_likes_delete_self" ON "comment_likes" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("comment_likes"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comments_select" ON "comments" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "comments_insert_self" ON "comments" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("comments"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comments_delete" ON "comments" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("comments"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid or exists (select 1 from posts p where p.id = "comments"."post_id" and p.author_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "conversations_select_member" ON "conversations" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid in ("conversations"."user_a", "conversations"."user_b"));--> statement-breakpoint
CREATE POLICY "conversations_insert_member" ON "conversations" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK (nullif(current_setting('app.user_id', true), '')::uuid in ("conversations"."user_a", "conversations"."user_b"));--> statement-breakpoint
CREATE POLICY "conversations_update_member" ON "conversations" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid in ("conversations"."user_a", "conversations"."user_b")) WITH CHECK (nullif(current_setting('app.user_id', true), '')::uuid in ("conversations"."user_a", "conversations"."user_b"));--> statement-breakpoint
CREATE POLICY "follows_select" ON "follows" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "follows_insert_self" ON "follows" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("follows"."follower_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "follows_delete_self" ON "follows" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("follows"."follower_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "idempotency_select_self" ON "idempotency_keys" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING ("idempotency_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "idempotency_insert_self" ON "idempotency_keys" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("idempotency_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "idempotency_update_self" ON "idempotency_keys" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING ("idempotency_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("idempotency_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "idempotency_delete_self" ON "idempotency_keys" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("idempotency_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "key_backups_select_self" ON "key_backups" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING ("key_backups"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "key_backups_insert_self" ON "key_backups" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("key_backups"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "media_select" ON "media" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "media_insert_self" ON "media" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("media"."owner_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "messages_select_member" ON "messages" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (exists (select 1 from conversations c where c.id = "messages"."conversation_id" and nullif(current_setting('app.user_id', true), '')::uuid in (c.user_a, c.user_b)));--> statement-breakpoint
CREATE POLICY "messages_insert_member" ON "messages" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("messages"."sender_id" = nullif(current_setting('app.user_id', true), '')::uuid and exists (select 1 from conversations c where c.id = "messages"."conversation_id" and nullif(current_setting('app.user_id', true), '')::uuid in (c.user_a, c.user_b)));--> statement-breakpoint
CREATE POLICY "post_likes_select" ON "post_likes" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "post_likes_insert_self" ON "post_likes" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("post_likes"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "post_likes_delete_self" ON "post_likes" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("post_likes"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "posts_select" ON "posts" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "posts_insert_self" ON "posts" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("posts"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid and exists (select 1 from media m where m.id = "posts"."media_id" and m.owner_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "posts_update_self" ON "posts" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING ("posts"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("posts"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "posts_delete_self" ON "posts" AS PERMISSIVE FOR DELETE TO "glimpse_app" USING ("posts"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "public_keys_select" ON "public_keys" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "public_keys_insert_self" ON "public_keys" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("public_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "users_select" ON "users" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null);--> statement-breakpoint
CREATE POLICY "users_update_self" ON "users" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING ("users"."id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("users"."id" = nullif(current_setting('app.user_id', true), '')::uuid);