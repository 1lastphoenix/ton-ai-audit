ALTER TABLE "pdf_exports" ALTER COLUMN "variant" SET DEFAULT 'internal';--> statement-breakpoint
CREATE UNIQUE INDEX "audit_runs_project_active_unique" ON "audit_runs" USING btree ("project_id") WHERE "audit_runs"."status" in ('queued', 'running');--> statement-breakpoint
WITH "ranked_active_working_copies" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "project_id", "base_revision_id", "owner_user_id"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS "active_rank"
  FROM "working_copies"
  WHERE "status" = 'active'
)
UPDATE "working_copies" AS "wc"
SET
  "status" = 'discarded',
  "updated_at" = now()
FROM "ranked_active_working_copies" AS "ranked"
WHERE "wc"."id" = "ranked"."id"
  AND "ranked"."active_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "working_copies_active_owner_base_unique" ON "working_copies" USING btree ("project_id","base_revision_id","owner_user_id") WHERE "working_copies"."status" = 'active';
