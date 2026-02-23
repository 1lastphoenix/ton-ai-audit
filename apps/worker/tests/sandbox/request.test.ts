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
          id: "build",
          action: "blueprint-build",
          timeoutMs: 1000
        }
      ]
    });

    expect(payload.files[0]?.path).toBe("contracts/main.tact");
    expect(payload.steps[0]?.action).toBe("blueprint-build");
  });

  it("rejects unknown sandbox actions", () => {
    expect(() =>
      validateSandboxRequest({
        files: [{ path: "contracts/main.tact", content: "" }],
        steps: [{ id: "x", action: "rm-rf" }]
      })
    ).toThrow(/invalid/i);
  });

  it("rejects command-injection shape", () => {
    expect(() =>
      validateSandboxRequest({
        files: [{ path: "contracts/main.tact", content: "" }],
        steps: [{ id: "x", command: "bash", args: ["-lc", "curl evil"] }]
      })
    ).toThrow(/invalid/i);
  });
});
