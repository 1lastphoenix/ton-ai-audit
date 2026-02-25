import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/api", async () => {
  const fixture = await import("./fixtures/server-api-mocks");
  return fixture.serverApiMockModule;
});

vi.mock("@/lib/server/domain", async () => {
  const fixture = await import("./fixtures/server-domain-mocks");
  return fixture.serverDomainMockModule;
});

import {
  applyDefaultServerApiMocks,
  resetServerApiMocks,
  serverApiMocks
} from "./fixtures/server-api-mocks";
import {
  resetServerDomainMocks,
  serverDomainMocks
} from "./fixtures/server-domain-mocks";
import { POST as createProjectRoute } from "../app/api/projects/route";
import { DELETE as deleteProjectRoute } from "../app/api/projects/[projectId]/route";

describe("projects routes", () => {
  beforeEach(() => {
    resetServerApiMocks();
    resetServerDomainMocks();

    applyDefaultServerApiMocks("user-1");
    serverDomainMocks.createProject.mockResolvedValue({
      id: "project-1",
      slug: "audit-project"
    });
    serverDomainMocks.createScaffoldRevision.mockResolvedValue({ id: "revision-1" });
    serverDomainMocks.softDeleteProject.mockResolvedValue({
      id: "project-1",
      lifecycleState: "deleted"
    });
    serverDomainMocks.ensureProjectOwnerAccess.mockResolvedValue({ id: "project-1" });
  });

  it("creates scaffold projects and bootstraps an initial scaffold revision", async () => {
    serverApiMocks.parseJsonBody.mockResolvedValueOnce({
      name: "Audit Project",
      slug: "audit-project",
      initialization: {
        mode: "scaffold",
        language: "tolk"
      }
    });

    const response = await createProjectRoute(
      new Request("http://localhost/api/projects", {
        method: "POST"
      })
    );

    expect(response.status).toBe(201);
    expect(serverDomainMocks.createProject).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      name: "Audit Project",
      slug: "audit-project",
      lifecycleState: "ready"
    });
    expect(serverDomainMocks.createScaffoldRevision).toHaveBeenCalledWith({
      projectId: "project-1",
      createdByUserId: "user-1",
      projectName: "Audit Project"
    });
    await expect(response.json()).resolves.toEqual({
      project: { id: "project-1", slug: "audit-project" },
      revision: { id: "revision-1" }
    });
  });

  it("creates upload-initialized projects without scaffold revision", async () => {
    serverApiMocks.parseJsonBody.mockResolvedValueOnce({
      name: "Upload Project",
      slug: "upload-project",
      initialization: {
        mode: "upload"
      }
    });

    const response = await createProjectRoute(
      new Request("http://localhost/api/projects", {
        method: "POST"
      })
    );

    expect(response.status).toBe(201);
    expect(serverDomainMocks.createProject).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      name: "Upload Project",
      slug: "upload-project",
      lifecycleState: "initializing"
    });
    expect(serverDomainMocks.createScaffoldRevision).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      project: { id: "project-1", slug: "audit-project" }
    });
  });

  it("soft-deletes a newly created project when scaffold bootstrap fails", async () => {
    serverApiMocks.parseJsonBody.mockResolvedValueOnce({
      name: "Broken Scaffold",
      slug: "broken-scaffold",
      initialization: {
        mode: "scaffold",
        language: "tolk"
      }
    });
    serverDomainMocks.createScaffoldRevision.mockRejectedValueOnce(
      new Error("scaffold failed")
    );

    const response = await createProjectRoute(
      new Request("http://localhost/api/projects", {
        method: "POST"
      })
    );

    expect(serverDomainMocks.softDeleteProject).toHaveBeenCalledWith({
      projectId: "project-1"
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "scaffold failed" });
  });

  it("soft-deletes a project only when the current user is the owner", async () => {
    const response = await deleteProjectRoute(
      new Request("http://localhost/api/projects/project-1", {
        method: "DELETE"
      }),
      {
        params: Promise.resolve({ projectId: "project-1" })
      }
    );

    expect(response.status).toBe(200);
    expect(serverDomainMocks.softDeleteProject).toHaveBeenCalledWith({
      projectId: "project-1"
    });
    await expect(response.json()).resolves.toEqual({
      project: { id: "project-1", lifecycleState: "deleted" }
    });

    serverDomainMocks.ensureProjectOwnerAccess.mockResolvedValueOnce(null);

    const missingResponse = await deleteProjectRoute(
      new Request("http://localhost/api/projects/project-1", {
        method: "DELETE"
      }),
      {
        params: Promise.resolve({ projectId: "project-1" })
      }
    );

    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({
      error: "Project not found"
    });
  });
});
