import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => {
        return (selectQueue.shift() ?? []) as unknown[];
      })
    }))
  }));

  return {
    select,
    enqueueSelectResult(value: unknown) {
      selectQueue.push(value);
    },
    reset() {
      selectQueue.length = 0;
    }
  };
});

vi.mock("../lib/server/db", () => ({
  db: {
    select: mocks.select
  }
}));

vi.mock("../lib/server/s3", () => ({
  getObjectText: vi.fn(),
  putObject: vi.fn()
}));

vi.mock("@/lib/uuid", () => ({
  isUuid: () => true
}));

import { getAuditComparison } from "../lib/server/domain";

describe("getAuditComparison", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.select.mockClear();
  });

  it("normalizes comparison direction to older -> newer and computes lifecycle buckets", async () => {
    mocks.enqueueSelectResult([
      {
        id: "audit-new",
        projectId: "project-1",
        revisionId: "rev-new",
        status: "completed",
        createdAt: new Date("2026-01-02T10:00:00.000Z")
      },
      {
        id: "audit-old",
        projectId: "project-1",
        revisionId: "rev-old",
        status: "completed",
        createdAt: new Date("2026-01-01T10:00:00.000Z")
      }
    ]);

    mocks.enqueueSelectResult([
      {
        auditRunId: "audit-old",
        findingId: "finding-a",
        severity: "medium",
        payloadJson: { title: "A", severity: "medium", evidence: { filePath: "contracts/a.tolk", startLine: 1 } }
      },
      {
        auditRunId: "audit-old",
        findingId: "finding-b",
        severity: "high",
        payloadJson: { title: "B", severity: "high", evidence: { filePath: "contracts/b.tolk", startLine: 2 } }
      },
      {
        auditRunId: "audit-new",
        findingId: "finding-b",
        severity: "critical",
        payloadJson: { title: "B", severity: "critical", evidence: { filePath: "contracts/b.tolk", startLine: 2 } }
      },
      {
        auditRunId: "audit-new",
        findingId: "finding-c",
        severity: "low",
        payloadJson: { title: "C", severity: "low", evidence: { filePath: "contracts/c.tolk", startLine: 3 } }
      }
    ]);

    mocks.enqueueSelectResult([
      { path: "contracts/a.tolk" },
      { path: "contracts/shared.tolk" }
    ]);

    mocks.enqueueSelectResult([
      { path: "contracts/shared.tolk" },
      { path: "contracts/new.tolk" }
    ]);

    const result = await getAuditComparison({
      projectId: "project-1",
      fromAuditId: "audit-new",
      toAuditId: "audit-old"
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    expect(result.comparison.fromAudit.id).toBe("audit-old");
    expect(result.comparison.toAudit.id).toBe("audit-new");

    expect(result.comparison.summary.findings).toMatchObject({
      fromTotal: 2,
      toTotal: 2,
      newCount: 1,
      resolvedCount: 1,
      persistingCount: 1,
      severityChangedCount: 1
    });

    expect(result.comparison.summary.files).toMatchObject({
      addedCount: 1,
      removedCount: 1,
      unchangedCount: 1
    });

    expect(result.comparison.findings.newlyDetected.map((item) => item.findingId)).toEqual(["finding-c"]);
    expect(result.comparison.findings.resolved.map((item) => item.findingId)).toEqual(["finding-a"]);
    expect(result.comparison.findings.persisting[0]).toMatchObject({
      findingId: "finding-b",
      fromSeverity: "high",
      toSeverity: "critical"
    });
  });

  it("returns not-completed when either selected audit has non-terminal status", async () => {
    mocks.enqueueSelectResult([
      {
        id: "audit-1",
        projectId: "project-1",
        revisionId: "rev-1",
        status: "running",
        createdAt: new Date("2026-01-01T10:00:00.000Z")
      },
      {
        id: "audit-2",
        projectId: "project-1",
        revisionId: "rev-2",
        status: "completed",
        createdAt: new Date("2026-01-02T10:00:00.000Z")
      }
    ]);

    const result = await getAuditComparison({
      projectId: "project-1",
      fromAuditId: "audit-1",
      toAuditId: "audit-2"
    });

    expect(result).toEqual({
      kind: "not-completed",
      fromStatus: "running",
      toStatus: "completed"
    });
  });
});
