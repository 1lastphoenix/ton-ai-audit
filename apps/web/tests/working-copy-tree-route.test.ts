import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/api", async () => {
  const fixture = await import("./fixtures/server-api-mocks");
  return fixture.serverApiMockModule;
});

vi.mock("@/lib/server/domain", async () => {
  const fixture = await import("./fixtures/server-domain-mocks");
  return fixture.serverDomainMockModule;
});

vi.mock("@/lib/server/db", async () => {
  const fixture = await import("./fixtures/server-db-mocks");
  return fixture.serverDbMockModule;
});

vi.mock("@/lib/server/file-tree", async () => {
  return vi.importActual("../lib/server/file-tree");
});

import {
  applyDefaultServerApiMocks,
  resetServerApiMocks
} from "./fixtures/server-api-mocks";
import {
  configureDbSelectWhereChain,
  resetServerDbMocks,
  serverDbMocks
} from "./fixtures/server-db-mocks";
import {
  resetServerDomainMocks,
  serverDomainMocks
} from "./fixtures/server-domain-mocks";
import { GET as getWorkingCopyTreeRoute } from "../app/api/projects/[projectId]/working-copies/[workingCopyId]/tree/route";

describe("working copy tree route", () => {
  beforeEach(() => {
    resetServerApiMocks();
    resetServerDomainMocks();
    resetServerDbMocks();

    applyDefaultServerApiMocks("user-1");
    configureDbSelectWhereChain();

    serverDomainMocks.ensureProjectAccess.mockResolvedValue({ id: "project-1" });
    serverDomainMocks.ensureWorkingCopyAccess.mockResolvedValue({ id: "wc-1" });
    serverDbMocks.selectWhere.mockResolvedValue([]);
  });

  it("returns 404 when project access is denied", async () => {
    serverDomainMocks.ensureProjectAccess.mockResolvedValueOnce(null);

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
    serverDomainMocks.ensureWorkingCopyAccess.mockResolvedValueOnce(null);

    const response = await getWorkingCopyTreeRoute(
      new Request("http://localhost/tree"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Working copy not found"
    });
  });

  it("returns nested tree data built from working-copy file paths", async () => {
    serverDbMocks.selectWhere.mockResolvedValueOnce([
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
      tree: Array<{
        path: string;
        type: "file" | "directory";
        children?: Array<{ path: string }>;
      }>;
    };

    expect(body.tree.map((node) => node.path)).toEqual(["contracts", "README.md"]);
    expect(body.tree[0]?.type).toBe("directory");
    expect(body.tree[0]?.children?.map((node) => node.path)).toEqual([
      "contracts/lib",
      "contracts/main.tolk"
    ]);
  });
});
