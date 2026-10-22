ALTER TABLE "media" DROP CONSTRAINT "media_status";--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_status" CHECK ("media"."status" in ('uploading', 'processing', 'ready', 'failed'));--> statement-breakpoint
CREATE POLICY "media_complete_own" ON "media" AS PERMISSIVE FOR UPDATE TO "glimpse_app" USING ("media"."owner_id" = nullif(current_setting('app.user_id', true), '')::uuid and "media"."status" = 'uploading') WITH CHECK ("media"."owner_id" = nullif(current_setting('app.user_id', true), '')::uuid and "media"."status" in ('processing', 'failed'));--> statement-breakpoint
-- Only the columns "complete upload" needs; the worker sets everything else.
GRANT UPDATE (status, error, original_path) ON media TO glimpse_app;
