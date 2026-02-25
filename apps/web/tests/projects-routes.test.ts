import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  checkRateLimit: vi.fn(),
  parseJsonBody: vi.fn(),
  toApiErrorResponse: vi.fn((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }),
  createProject: vi.fn(),
  createScaffoldRevision: vi.fn(),
  softDeleteProject: vi.fn(),
  ensureProjectOwnerAccess: vi.fn(),
  ensureProjectAccess: vi.fn(),
  getLatestProjectState: vi.fn()
}));

vi.mock("@/lib/server/api", () => ({
  requireSession: mocks.requireSession,
  checkRateLimit: mocks.checkRateLimit,
  parseJsonBody: mocks.parseJsonBody,
  toApiErrorResponse: mocks.toApiErrorResponse
}));

vi.mock("@/lib/server/domain", () => ({
  createProject: mocks.createProject,
  createScaffoldRevision: mocks.createScaffoldRevision,
  softDeleteProject: mocks.softDeleteProject,
  ensureProjectOwnerAccess: mocks.ensureProjectOwnerAccess,
  ensureProjectAccess: mocks.ensureProjectAccess,
  getLatestProjectState: mocks.getLatestProjectState
}));

import { POST as createProjectRoute } from "../app/api/projects/route";
import { DELETE as deleteProjectRoute } from "../app/api/projects/[projectId]/route";

describe("projects routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.checkRateLimit.mockResolvedValue(undefined);
    mocks.createProject.mockResolvedValue({ id: "project-1", slug: "audit-project" });
    mocks.createScaffoldRevision.mockResolvedValue({ id: "revision-1" });
    mocks.softDeleteProject.mockResolvedValue({ id: "project-1", lifecycleState: "deleted" });
    mocks.ensureProjectOwnerAccess.mockResolvedValue({ id: "project-1" });
  });

  it("creates scaffold projects and bootstraps an initial scaffold revision", async () => {
    mocks.parseJsonBody.mockResolvedValueOnce({
      name: "Audit Project",
      slug: "audit-project",
      initialization: {
        mode: "scaffold",
        language: "tolk"
      }
    });

    const response = await createProjectRoute(new Request("http://localhost/api/projects", {
      method: "POST"
    }));

    expect(response.status).toBe(201);
    expect(mocks.createProject).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      name: "Audit Project",
      slug: "audit-project",
      lifecycleState: "ready"
    });
    expect(mocks.createScaffoldRevision).toHaveBeenCalledWith({
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
    mocks.parseJsonBody.mockResolvedValueOnce({
      name: "Upload Project",
      slug: "upload-project",
      initialization: {
        mode: "upload"
      }
    });

    const response = await createProjectRoute(new Request("http://localhost/api/projects", {
      method: "POST"
    }));

    expect(response.status).toBe(201);
    expect(mocks.createProject).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      name: "Upload Project",
      slug: "upload-project",
      lifecycleState: "initializing"
    });
    expect(mocks.createScaffoldRevision).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      project: { id: "project-1", slug: "audit-project" }
    });
  });

  it("soft-deletes a newly created project when scaffold bootstrap fails", async () => {
    mocks.parseJsonBody.mockResolvedValueOnce({
      name: "Broken Scaffold",
      slug: "broken-scaffold",
      initialization: {
        mode: "scaffold",
        language: "tolk"
      }
    });
    mocks.createScaffoldRevision.mockRejectedValueOnce(new Error("scaffold failed"));

    const response = await createProjectRoute(new Request("http://localhost/api/projects", {
      method: "POST"
    }));

    expect(mocks.softDeleteProject).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "scaffold failed" });
  });

  it("soft-deletes a project only when the current user is the owner", async () => {
    const response = await deleteProjectRoute(new Request("http://localhost/api/projects/project-1", {
      method: "DELETE"
    }), {
      params: Promise.resolve({ projectId: "project-1" })
    });

    expect(response.status).toBe(200);
    expect(mocks.softDeleteProject).toHaveBeenCalledWith({ projectId: "project-1" });
    await expect(response.json()).resolves.toEqual({
      project: { id: "project-1", lifecycleState: "deleted" }
    });

    mocks.ensureProjectOwnerAccess.mockResolvedValueOnce(null);

    const missingResponse = await deleteProjectRoute(new Request("http://localhost/api/projects/project-1", {
      method: "DELETE"
    }), {
      params: Promise.resolve({ projectId: "project-1" })
    });

    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({ error: "Project not found" });
  });
});