CREATE TYPE "public"."project_lifecycle_state" AS ENUM('initializing', 'ready', 'deleted');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lifecycle_state" "project_lifecycle_state" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "projects_lifecycle_idx" ON "projects" USING btree ("lifecycle_state");