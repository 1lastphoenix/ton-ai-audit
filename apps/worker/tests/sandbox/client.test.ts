import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

vi.mock("../../src/env", () => ({
  env: {
    SANDBOX_RUNNER_URL: "http://localhost:3003"
  }
}));

import { executeSandboxPlan } from "../../src/sandbox/client";

describe("executeSandboxPlan", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("retries without unsupported actions returned by sandbox-runner", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid step action: security-surface-scan" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            workspaceId: "workspace-1",
            mode: "local",
            results: [
              {
                id: "security-rules-scan",
                action: "security-rules-scan",
                command: "node",
                args: ["scripts/security-rules-scan.mjs"],
                status: "completed",
                exitCode: 0,
                stdout: "{}",
                stderr: "",
                durationMs: 10
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const result = await executeSandboxPlan({
      files: [{ path: "contracts/main.tolk", content: "fun main() {}" }],
      plan: {
        adapter: "tolk",
        languages: ["tolk"],
        reason: "test",
        bootstrapMode: "none",
        seedTemplate: null,
        unsupportedReasons: [],
        steps: [
          { id: "security-surface-scan", action: "security-surface-scan", timeoutMs: 1_000 },
          { id: "security-rules-scan", action: "security-rules-scan", timeoutMs: 1_000 }
        ]
      },
      projectId: "project-1",
      revisionId: "revision-1"
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const secondBody = JSON.parse(String(secondCallInit.body)) as { steps: Array<{ action: string }> };

    expect(secondBody.steps.map((step) => step.action)).toEqual(["security-rules-scan"]);
    expect(result.unsupportedActions).toEqual(["security-surface-scan"]);
    expect(result.results).toHaveLength(1);
  });

  it("returns empty results when all planned actions are unsupported", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid step action: security-surface-scan" }), {
        status: 400,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const result = await executeSandboxPlan({
      files: [{ path: "contracts/main.tolk", content: "fun main() {}" }],
      plan: {
        adapter: "tolk",
        languages: ["tolk"],
        reason: "test",
        bootstrapMode: "none",
        seedTemplate: null,
        unsupportedReasons: [],
        steps: [{ id: "security-surface-scan", action: "security-surface-scan", timeoutMs: 1_000 }]
      },
      projectId: "project-1",
      revisionId: "revision-1"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([]);
    expect(result.unsupportedActions).toEqual(["security-surface-scan"]);
  });
});
