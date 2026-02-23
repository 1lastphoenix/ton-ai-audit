import { describe, expect, it } from "vitest";

import { createProjectSchema, projectLifecycleStateSchema } from "@ton-audit/shared";

describe("project contracts", () => {
  it("accepts scaffold initialization payload", () => {
    const parsed = createProjectSchema.safeParse({
      name: "Audit project",
      slug: "audit-project",
      initialization: {
        mode: "scaffold",
        language: "tolk"
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts upload initialization payload", () => {
    const parsed = createProjectSchema.safeParse({
      name: "Audit project",
      slug: "audit-project",
      initialization: {
        mode: "upload"
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("requires initialization mode", () => {
    const parsed = createProjectSchema.safeParse({
      name: "Audit project",
      slug: "audit-project"
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps lifecycle states stable", () => {
    expect(projectLifecycleStateSchema.options).toEqual(
      expect.arrayContaining(["initializing", "ready", "deleted"])
    );
  });
});
