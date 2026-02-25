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

import {
  applyDefaultServerApiMocks,
  resetServerApiMocks,
  serverApiMocks
} from "./fixtures/server-api-mocks";
import {
  resetServerDbMocks,
  serverDbMocks,
  configureDbSelectLimitChain
} from "./fixtures/server-db-mocks";
import {
  resetServerDomainMocks,
  serverDomainMocks
} from "./fixtures/server-domain-mocks";
import {
  GET as getWorkingCopyFileRoute,
  PATCH as patchWorkingCopyFileRoute
} from "../app/api/projects/[projectId]/working-copies/[workingCopyId]/file/route";

describe("working copy file route", () => {
  beforeEach(() => {
    resetServerApiMocks();
    resetServerDomainMocks();
    resetServerDbMocks();

    applyDefaultServerApiMocks("user-1");
    configureDbSelectLimitChain();

    serverDomainMocks.ensureProjectAccess.mockResolvedValue({ id: "project-1" });
    serverDomainMocks.ensureWorkingCopyAccess.mockResolvedValue({ id: "wc-1" });
    serverDomainMocks.findActiveAuditRun.mockResolvedValue(null);

    serverApiMocks.parseJsonBody.mockResolvedValue({
      path: "contracts/main.tolk",
      content: "fun main() {}",
      language: "tolk"
    });

    serverDomainMocks.saveWorkingCopyFile.mockResolvedValue({
      path: "contracts/main.tolk",
      content: "fun main() {}",
      language: "tolk"
    });
  });

  it("blocks PATCH writes while an audit is queued or running", async () => {
    serverDomainMocks.findActiveAuditRun.mockResolvedValueOnce({ id: "audit-1" });

    const response = await patchWorkingCopyFileRoute(
      new Request("http://localhost/file", { method: "PATCH" }),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Cannot modify files while an audit is running for this project.",
      activeAuditRunId: "audit-1"
    });
    expect(serverDomainMocks.saveWorkingCopyFile).not.toHaveBeenCalled();
  });

  it("validates GET query and returns 400 when file path is missing", async () => {
    const response = await getWorkingCopyFileRoute(new Request("http://localhost/file"), {
      params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing file path" });
  });

  it("returns 404 when the requested file does not exist", async () => {
    serverDbMocks.selectLimit.mockResolvedValueOnce([]);

    const response = await getWorkingCopyFileRoute(
      new Request("http://localhost/file?path=contracts/main.tolk"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "File not found" });
  });

  it("returns file payload for valid working-copy reads", async () => {
    const file = {
      path: "contracts/main.tolk",
      language: "tolk",
      content: "fun main() {}"
    };
    serverDbMocks.selectLimit.mockResolvedValueOnce([file]);

    const response = await getWorkingCopyFileRoute(
      new Request("http://localhost/file?path=contracts/main.tolk"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ file });
  });
});
