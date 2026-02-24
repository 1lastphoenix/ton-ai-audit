import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("audits routes", () => {
  it("exposes project audit history route with access checks", () => {
    const routePath = path.resolve(process.cwd(), "app", "api", "projects", "[projectId]", "audits", "route.ts");
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toMatch(/export async function GET/);
    expect(source).toContain("requireSession");
    expect(source).toContain("ensureProjectAccess");
    expect(source).toContain("queryProjectAuditHistory");
    expect(source).toContain("status: 404");
  });

  it("exposes compare route with query validation and completed-only guard", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "audits",
      "compare",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toMatch(/export async function GET/);
    expect(source).toContain("fromAuditId");
    expect(source).toContain("toAuditId");
    expect(source).toContain("getAuditComparison");
    expect(source).toContain("status: 400");
    expect(source).toContain("status: 409");
  });
});
