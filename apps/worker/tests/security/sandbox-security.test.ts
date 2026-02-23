import { describe, expect, it } from "vitest";

import { validateSandboxRequest } from "../../src/sandbox/request";

describe("sandbox security", () => {
  it("rejects absolute paths", () => {
    expect(() =>
      validateSandboxRequest({
        files: [{ path: "/etc/passwd", content: "x" }],
        steps: []
      })
    ).toThrow(/unsafe/i);
  });

  it("rejects null-byte paths", () => {
    expect(() =>
      validateSandboxRequest({
        files: [{ path: "contracts/main.tact\u0000", content: "x" }],
        steps: []
      })
    ).toThrow(/unsafe/i);
  });
});
