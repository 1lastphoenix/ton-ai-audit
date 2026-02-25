CREATE TYPE "public"."audit_profile" AS ENUM('fast', 'deep');--> statement-breakpoint
CREATE TYPE "public"."pdf_export_variant" AS ENUM('client', 'internal');--> statement-breakpoint
ALTER TABLE "pdf_exports" DROP CONSTRAINT "pdf_exports_audit_run_unique";--> statement-breakpoint
ALTER TABLE "audit_runs" ADD COLUMN "profile" "audit_profile" DEFAULT 'deep' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD COLUMN "engine_version" text DEFAULT 'ton-audit-pro-v2' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD COLUMN "report_schema_version" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdf_exports" ADD COLUMN "variant" "pdf_export_variant" DEFAULT 'client' NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_runs_profile_idx" ON "audit_runs" USING btree ("profile");--> statement-breakpoint
CREATE INDEX "pdf_exports_audit_run_idx" ON "pdf_exports" USING btree ("audit_run_id");--> statement-breakpoint
ALTER TABLE "pdf_exports" ADD CONSTRAINT "pdf_exports_audit_variant_unique" UNIQUE("audit_run_id","variant");