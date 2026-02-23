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
});
