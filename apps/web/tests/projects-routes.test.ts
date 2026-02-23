import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("projects routes", () => {
  it("supports initialization-aware project creation", () => {
    const routePath = path.resolve(process.cwd(), "app", "api", "projects", "route.ts");
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toMatch(/createProjectSchema/);
    expect(source).toMatch(/initialization/);
    expect(source).toMatch(/createScaffoldRevision/);
  });

  it("supports soft-delete endpoint for project cards", () => {
    const routePath = path.resolve(process.cwd(), "app", "api", "projects", "[projectId]", "route.ts");
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toMatch(/export async function DELETE/);
    expect(source).toMatch(/softDeleteProject/);
  });
});
