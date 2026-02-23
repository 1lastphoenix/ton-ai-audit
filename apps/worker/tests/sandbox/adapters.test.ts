import { describe, expect, it } from "vitest";

import { planSandboxVerification } from "../../src/sandbox/adapters";

describe("planSandboxVerification", () => {
  it("selects blueprint adapter when blueprint config exists", () => {
    const plan = planSandboxVerification([
      { path: "blueprint.config.ts", content: "export default {}" },
      { path: "contracts/main.tact", content: "" }
    ]);

    expect(plan.adapter).toBe("blueprint");
    expect(plan.bootstrapMode).toBe("none");
    expect(plan.steps.some((step) => step.id === "blueprint-build")).toBe(true);
    expect(plan.steps.some((step) => step.id === "blueprint-test")).toBe(true);
  });

  it("selects mixed adapter for multi-language non-blueprint uploads", () => {
    const plan = planSandboxVerification([
      { path: "contracts/main.tact", content: "" },
      { path: "contracts/math.fc", content: "" },
      { path: "contracts/utils.tolk", content: "" }
    ]);

    expect(plan.adapter).toBe("mixed");
    expect(plan.bootstrapMode).toBe("create-ton");
    expect(plan.languages).toEqual(expect.arrayContaining(["tact", "func", "tolk"]));
  });

  it("returns none when no supported files are present", () => {
    const plan = planSandboxVerification([{ path: "README.md", content: "" }]);

    expect(plan.adapter).toBe("none");
    expect(plan.unsupportedReasons.length).toBeGreaterThan(0);
    expect(plan.steps).toHaveLength(0);
  });
});
