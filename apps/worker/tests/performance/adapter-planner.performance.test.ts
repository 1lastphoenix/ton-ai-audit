import { describe, expect, it } from "vitest";

import { planSandboxVerification } from "../../src/sandbox/adapters";

describe("adapter planner performance", () => {
  it("plans large trees quickly", () => {
    const files = Array.from({ length: 2000 }, (_, index) => ({
      path: `contracts/contract_${index}.tact`,
      content: "contract Test {}"
    }));

    const start = performance.now();
    const plan = planSandboxVerification(files);
    const elapsed = performance.now() - start;

    expect(plan.adapter).toBe("tact");
    expect(elapsed).toBeLessThan(100);
  });
});
