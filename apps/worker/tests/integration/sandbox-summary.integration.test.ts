import { describe, expect, it } from "vitest";

import { summarizeSandboxResults } from "../../src/sandbox/summary";

describe("sandbox integration summary", () => {
  it("aggregates result counters", () => {
    const summary = summarizeSandboxResults([
      {
        name: "a",
        command: "cmd",
        args: [],
        status: "completed",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 12
      },
      {
        name: "b",
        command: "cmd",
        args: [],
        status: "failed",
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 20
      },
      {
        name: "c",
        command: "cmd",
        args: [],
        status: "skipped",
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 2
      }
    ]);

    expect(summary).toEqual({
      completed: 1,
      failed: 1,
      skipped: 1,
      timeout: 0
    });
  });
});
