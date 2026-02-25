import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function parseStatements(sql: string) {
  return sql
    .split(/-->\s*statement-breakpoint\s*/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("drizzle migrations", () => {
  it("enables pgvector before creating vector columns", () => {
    const migrationPath = path.resolve(process.cwd(), "drizzle", "0000_polite_puck.sql");
    const sql = fs.readFileSync(migrationPath, "utf8");
    const statements = parseStatements(sql).map(normalizeSql);

    const extensionIndex = statements.findIndex((statement) =>
      statement.startsWith('create extension if not exists "vector"')
    );
    const firstVectorColumnIndex = statements.findIndex((statement) =>
      statement.includes("vector(1536)")
    );

    expect(extensionIndex).toBeGreaterThanOrEqual(0);
    expect(firstVectorColumnIndex).toBeGreaterThanOrEqual(0);
    expect(extensionIndex).toBeLessThan(firstVectorColumnIndex);
  });

  it("switches slug uniqueness to active (non-deleted) projects only", () => {
    const migrationPath = path.resolve(process.cwd(), "drizzle", "0002_reflective_jocasta.sql");
    const sql = fs.readFileSync(migrationPath, "utf8");
    const statements = parseStatements(sql).map(normalizeSql);

    const dropConstraint = statements.find((statement) =>
      statement.startsWith("alter table \"projects\" drop constraint \"projects_owner_slug_unique\"")
    );

    const createPartialIndex = statements.find((statement) =>
      statement.startsWith("create unique index \"projects_owner_slug_active_unique\"")
    );

    expect(dropConstraint).toBeDefined();
    expect(createPartialIndex).toBeDefined();
    expect(createPartialIndex).toContain('where "projects"."deleted_at" is null');
  });
});