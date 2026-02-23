import { describe, expect, it } from "vitest";

import { validateSandboxRequest } from "../../src/sandbox/request";

describe("validateSandboxRequest", () => {
  it("rejects traversal paths", () => {
    expect(() =>
      validateSandboxRequest({
        files: [{ path: "../secrets.env", content: "x" }],
        steps: []
      })
    ).toThrow(/unsafe/i);
  });

  it("rejects excessive file counts", () => {
    const files = Array.from({ length: 301 }, (_, index) => ({
      path: `contracts/f${index}.tact`,
      content: ""
    }));

    expect(() =>
      validateSandboxRequest({
        files,
        steps: []
      })
    ).toThrow(/max files/i);
  });

  it("accepts valid request", () => {
    const payload = validateSandboxRequest({
      files: [{ path: "contracts/main.tact", content: "" }],
      steps: [
        {
          name: "check",
          command: "node",
          args: ["--version"],
          timeoutMs: 1000
        }
      ]
    });

    expect(payload.files[0]?.path).toBe("contracts/main.tact");
    expect(payload.steps[0]?.name).toBe("check");
  });
});
