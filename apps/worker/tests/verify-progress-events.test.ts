import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditRunFindFirst: vi.fn(),
  dbUpdateSet: vi.fn(),
  dbInsertValues: vi.fn(),
  recordJobEvent: vi.fn(),
  loadRevisionFilesWithContent: vi.fn(),
  planSandboxVerification: vi.fn(),
  executeSandboxPlan: vi.fn(),
  summarizeSandboxResults: vi.fn(),
  putObject: vi.fn(),
  workerLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      auditRuns: {
        findFirst: mocks.auditRunFindFirst
      }
    },
    update: vi.fn(() => ({
      set: mocks.dbUpdateSet
    })),
    insert: vi.fn(() => ({
      values: mocks.dbInsertValues
    }))
  }
}));

vi.mock("../src/job-events", () => ({
  recordJobEvent: mocks.recordJobEvent
}));

vi.mock("../src/logger", () => ({
  workerLogger: mocks.workerLogger
}));

vi.mock("../src/revision-files", () => ({
  loadRevisionFilesWithContent: mocks.loadRevisionFilesWithContent
}));

vi.mock("../src/sandbox/adapters", () => ({
  planSandboxVerification: mocks.planSandboxVerification
}));

vi.mock("../src/sandbox/client", () => ({
  executeSandboxPlan: mocks.executeSandboxPlan,
  summarizeSandboxResults: mocks.summarizeSandboxResults
}));

vi.mock("../src/s3", () => ({
  putObject: mocks.putObject
}));

import { createVerifyProcessor } from "../src/processors/verify";

describe("verify processor progress events", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.auditRunFindFirst.mockResolvedValue({
      id: "audit-1",
      projectId: "project-1",
      status: "queued",
      startedAt: null
    });

    mocks.dbUpdateSet.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    mocks.dbInsertValues.mockResolvedValue(undefined);

    mocks.loadRevisionFilesWithContent.mockResolvedValue([
      {
        path: "contracts/main.tolk",
        content: "fun main() { throw(1); }"
      }
    ]);

    mocks.planSandboxVerification.mockReturnValue({
      adapter: "sandbox-runner",
      steps: [
        {
          id: "blueprint-build",
          action: "blueprint-build",
          command: "blueprint",
          args: ["build"],
          timeoutMs: 30_000,
          optional: false
        }
      ]
    });

    mocks.executeSandboxPlan.mockImplementation(async ({ onProgress }) => {
      await onProgress({
        type: "started",
        mode: "sandbox-runner",
        totalSteps: 1,
        steps: [
          {
            id: "blueprint-build",
            action: "blueprint-build",
            timeoutMs: 30_000,
            optional: false
          }
        ]
      });

      await onProgress({
        type: "step-started",
        step: {
          id: "blueprint-build",
          action: "blueprint-build",
          status: "running",
          timeoutMs: 30_000,
          optional: false
        },
        index: 0,
        totalSteps: 1
      });

      await onProgress({
        type: "step-finished",
        step: {
          id: "blueprint-build",
          action: "blueprint-build",
          status: "completed",
          timeoutMs: 30_000,
          optional: false,
          durationMs: 350
        },
        index: 0,
        totalSteps: 1
      });

      return {
        mode: "sandbox-runner",
        results: [
          {
            id: "blueprint-build",
            action: "blueprint-build",
            command: "blueprint",
            args: ["build"],
            status: "completed",
            durationMs: 350,
            stdout: "ok",
            stderr: ""
          }
        ]
      };
    });

    mocks.summarizeSandboxResults.mockReturnValue({
      completed: 1,
      failed: 0,
      skipped: 0,
      timeout: 0
    });

    mocks.putObject.mockResolvedValue(undefined);
  });

  it("emits structured verify progress and sandbox-step events", async () => {
    const enqueueJob = vi.fn().mockResolvedValue({ id: "audit-job-1" });
    const verify = createVerifyProcessor({ enqueueJob });

    const result = await verify({
      id: "verify-job-1",
      data: {
        projectId: "project-1",
        revisionId: "revision-1",
        auditRunId: "audit-1",
        profile: "deep",
        includeDocsFallbackFetch: true
      }
    } as never);

    expect(result).toEqual({
      auditRunId: "audit-1",
      diagnosticsCount: 1
    });

    const progressPhases = mocks.recordJobEvent.mock.calls
      .map((call) => call[0] as { event: string; payload?: { phase?: string } })
      .filter((event) => event.event === "progress")
      .map((event) => event.payload?.phase)
      .filter((phase): phase is string => Boolean(phase));

    expect(progressPhases).toEqual(
      expect.arrayContaining(["plan-ready", "sandbox-running", "sandbox-completed"])
    );

    const sandboxStepEvents = mocks.recordJobEvent.mock.calls
      .map((call) => call[0] as { event: string })
      .filter((event) => event.event === "sandbox-step");

    expect(sandboxStepEvents.length).toBeGreaterThan(0);
    expect(enqueueJob).toHaveBeenCalledWith(
      "audit",
      expect.objectContaining({
        projectId: "project-1",
        revisionId: "revision-1",
        auditRunId: "audit-1",
        profile: "deep"
      }),
      "audit:project-1:audit-1"
    );
  });
});