-- Merged like/repost notifications (DECISIONS.md D21): one row per post per day, updated as likes arrive,
-- instead of one row per like. actor_count = how many; recent_actors = the latest three, newest first.
ALTER TABLE "notifications" ADD COLUMN "actor_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "recent_actors" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "bucket" date;--> statement-breakpoint
UPDATE "notifications" SET "recent_actors" = ARRAY["actor_id"];--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_merge_key" ON "notifications" ("recipient_id", "type", "post_id", "bucket") WHERE "bucket" IS NOT NULL;--> statement-breakpoint
GRANT UPDATE ("actor_id", "actor_count", "recent_actors", "created_at", "read_at", "event_id") ON "notifications" TO glimpse_worker;--> statement-breakpoint
-- Exactly-once for merged notifications: the worker marks the event in the same transaction as the merge.
ALTER TABLE "outbox" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
GRANT UPDATE ("notified_at") ON "outbox" TO glimpse_worker;--> statement-breakpoint
-- Upload cleanup in two phases (DECISIONS.md D14): mark 'deleting', delete the files later, then the row.
ALTER TABLE "media" ADD COLUMN "deleting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" DROP CONSTRAINT "media_status";--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_status" CHECK ("media"."status" in ('uploading', 'processing', 'ready', 'failed', 'deleting'));--> statement-breakpoint
GRANT UPDATE ("deleting_since") ON "media" TO glimpse_worker;--> statement-breakpoint
-- Only media that's ready can go into a post (checked again at insert time, not just by the route).
DROP POLICY "post_media_insert" ON "post_media";--> statement-breakpoint
CREATE POLICY "post_media_insert" ON "post_media" AS PERMISSIVE FOR INSERT TO "glimpse_app" WITH CHECK (exists (select 1 from posts p where p.id = "post_media"."post_id" and p.author_id = nullif(current_setting('app.user_id', true), '')::uuid)
        and exists (select 1 from media m where m.id = "post_media"."media_id" and m.owner_id = nullif(current_setting('app.user_id', true), '')::uuid and m.status = 'ready'));
