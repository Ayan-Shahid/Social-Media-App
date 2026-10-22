CREATE TABLE "live_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'starting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "live_streams_status" CHECK ("live_streams"."status" in ('starting', 'live', 'ended')),
	CONSTRAINT "live_streams_title_len" CHECK (char_length("live_streams"."title") <= 100)
);
--> statement-breakpoint
ALTER TABLE "live_streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "live_id" uuid;--> statement-breakpoint
ALTER TABLE "live_streams" ADD CONSTRAINT "live_streams_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_streams_host_idx" ON "live_streams" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_streams_one_active" ON "live_streams" USING btree ("host_id") WHERE "live_streams"."status" <> 'ended';--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_live_id_live_streams_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."live_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('like', 'comment', 'follow', 'mention', 'repost', 'follow_request', 'follow_accept', 'live'));--> statement-breakpoint
CREATE POLICY "live_streams_select" ON "live_streams" AS PERMISSIVE FOR SELECT TO "glimpse_app" USING (nullif(current_setting('app.user_id', true), '')::uuid is not null and app.can_see("live_streams"."host_id"));--> statement-breakpoint
CREATE POLICY "live_streams_insert_self" ON "live_streams" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK ("live_streams"."host_id" = nullif(current_setting('app.user_id', true), '')::uuid and "live_streams"."status" = 'starting');--> statement-breakpoint
CREATE POLICY "live_streams_update_self" ON "live_streams" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING ("live_streams"."host_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("live_streams"."host_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (status, started_at, ended_at, peak_viewers) ON live_streams TO glimpse_app;--> statement-breakpoint
-- Worker: "x started a live video" notifications go to followers, and stale streams are closed.
GRANT SELECT, UPDATE (status, ended_at) ON live_streams TO glimpse_worker;
--> statement-breakpoint
GRANT SELECT ON mutes TO glimpse_worker;
