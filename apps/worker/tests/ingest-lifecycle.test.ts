import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadFindFirst: vi.fn(),
  revisionFindFirst: vi.fn(),
  updateSet: vi.fn(),
  recordJobEvent: vi.fn(),
  getObjectBuffer: vi.fn(),
  clearRevisionFiles: vi.fn(),
  upsertRevisionFile: vi.fn(),
  updateCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>
}));

vi.mock("../src/env", () => ({
  env: {
    UPLOAD_MAX_FILES: 500,
    UPLOAD_MAX_BYTES: 10_000_000,
    AUDIT_MODEL_ALLOWLIST: ["google/gemini-2.5-flash"]
  }
}));

vi.mock("../src/db", async () => {
  const shared = await import("@ton-audit/shared");

  return {
    db: {
      query: {
        uploads: {
          findFirst: mocks.uploadFindFirst
        },
        revisions: {
          findFirst: mocks.revisionFindFirst
        },
        auditRuns: {
          findFirst: vi.fn()
        },
        systemSettings: {
          findFirst: vi.fn()
        }
      },
      update: vi.fn((table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          mocks.updateCalls.push({ table, values });
          return {
            where: mocks.updateSet
          };
        }
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([])
        }))
      }))
    },
    __tables: {
      uploads: shared.uploads,
      projects: shared.projects
    }
  };
});

vi.mock("../src/job-events", () => ({
  recordJobEvent: mocks.recordJobEvent
}));

vi.mock("../src/s3", () => ({
  getObjectBuffer: mocks.getObjectBuffer
}));

vi.mock("../src/revision-files", () => ({
  clearRevisionFiles: mocks.clearRevisionFiles,
  upsertRevisionFile: mocks.upsertRevisionFile
}));

import { projects } from "@ton-audit/shared";
import { createIngestProcessor } from "../src/processors/ingest";

describe("ingest lifecycle failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateCalls.length = 0;

    mocks.uploadFindFirst.mockResolvedValue({
      id: "upload-1",
      projectId: "project-1",
      revisionId: "revision-1",
      s3Key: "uploads/project-1/source.zip",
      type: "single",
      originalFilename: "source.tolk",
      metadata: null
    });

    mocks.revisionFindFirst.mockResolvedValue({
      id: "revision-1",
      projectId: "project-1"
    });

    mocks.updateSet.mockResolvedValue(undefined);
    mocks.getObjectBuffer.mockResolvedValue(null);
  });

  it("restores project lifecycle to ready (without deleting) when ingest fails", async () => {
    const enqueueJob = vi.fn();
    const ingest = createIngestProcessor({ enqueueJob });

    await expect(
      ingest({
        id: "ingest-job-1",
        data: {
          projectId: "project-1",
          uploadId: "upload-1",
          revisionId: "revision-1",
          requestedByUserId: "user-1"
        }
      } as never)
    ).rejects.toThrow("Upload payload not found in object storage");

    const projectUpdates = mocks.updateCalls.filter((call) => call.table === projects);
    expect(projectUpdates.length).toBeGreaterThan(0);

    const failureProjectUpdate = projectUpdates.at(-1);
    expect(failureProjectUpdate?.values).toMatchObject({
      lifecycleState: "ready",
      deletedAt: null
    });

    expect(failureProjectUpdate?.values.lifecycleState).not.toBe("deleted");
  });
});