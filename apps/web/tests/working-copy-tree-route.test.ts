import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  toApiErrorResponse: vi.fn((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }),
  ensureProjectAccess: vi.fn(),
  ensureWorkingCopyAccess: vi.fn(),
  dbSelectWhere: vi.fn(),
  dbSelectFrom: vi.fn(),
  dbSelect: vi.fn()
}));

mocks.dbSelect.mockImplementation(() => ({
  from: mocks.dbSelectFrom
}));

mocks.dbSelectFrom.mockImplementation(() => ({
  where: mocks.dbSelectWhere
}));

vi.mock("@/lib/server/api", () => ({
  requireSession: mocks.requireSession,
  toApiErrorResponse: mocks.toApiErrorResponse
}));

vi.mock("@/lib/server/domain", () => ({
  ensureProjectAccess: mocks.ensureProjectAccess,
  ensureWorkingCopyAccess: mocks.ensureWorkingCopyAccess
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    select: mocks.dbSelect
  }
}));

vi.mock("@/lib/server/file-tree", async () => {
  return vi.importActual("../lib/server/file-tree");
});

import { GET as getWorkingCopyTreeRoute } from "../app/api/projects/[projectId]/working-copies/[workingCopyId]/tree/route";

describe("working copy tree route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.ensureProjectAccess.mockResolvedValue({ id: "project-1" });
    mocks.ensureWorkingCopyAccess.mockResolvedValue({ id: "wc-1" });
    mocks.dbSelectWhere.mockResolvedValue([]);
  });

  it("returns 404 when project access is denied", async () => {
    mocks.ensureProjectAccess.mockResolvedValueOnce(null);

    const response = await getWorkingCopyTreeRoute(
      new Request("http://localhost/tree"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Project not found" });
  });

  it("returns 404 when working copy does not exist", async () => {
    mocks.ensureWorkingCopyAccess.mockResolvedValueOnce(null);

    const response = await getWorkingCopyTreeRoute(
      new Request("http://localhost/tree"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Working copy not found" });
  });

  it("returns nested tree data built from working-copy file paths", async () => {
    mocks.dbSelectWhere.mockResolvedValueOnce([
      { path: "contracts/main.tolk" },
      { path: "contracts/lib/math.fc" },
      { path: "README.md" }
    ]);

    const response = await getWorkingCopyTreeRoute(
      new Request("http://localhost/tree"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tree: Array<{ path: string; type: "file" | "directory"; children?: Array<{ path: string }> }>;
    };

    expect(body.tree.map((node) => node.path)).toEqual(["contracts", "README.md"]);
    expect(body.tree[0]?.type).toBe("directory");
    expect(body.tree[0]?.children?.map((node) => node.path)).toEqual([
      "contracts/lib",
      "contracts/main.tolk"
    ]);
  });
});
