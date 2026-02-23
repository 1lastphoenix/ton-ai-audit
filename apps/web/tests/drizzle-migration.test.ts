import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("drizzle migrations", () => {
  it("enables pgvector before creating vector columns", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "drizzle",
      "0000_polite_puck.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/create extension if not exists "?vector"?;/i);
  });

  it("uses a partial unique index for active project slugs", () => {
    const migrationsDir = path.resolve(process.cwd(), "drizzle");
    const migrationFiles = fs.readdirSync(migrationsDir).filter((filename) => filename.endsWith(".sql"));

    const migrationWithSlugIndex = migrationFiles.find((filename) => {
      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      return sql.includes("projects_owner_slug_active_unique");
    });

    expect(migrationWithSlugIndex).toBeDefined();

    const migrationSql = fs.readFileSync(
      path.join(migrationsDir, migrationWithSlugIndex as string),
      "utf8"
    );

    expect(migrationSql).toMatch(/drop constraint "projects_owner_slug_unique"/i);
    expect(migrationSql).toMatch(/create unique index "projects_owner_slug_active_unique"/i);
    expect(migrationSql).toMatch(/where "projects"\."deleted_at" is null/i);
  });
});
