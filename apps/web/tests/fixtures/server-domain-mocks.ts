import { vi } from "vitest";

export class ActiveAuditRunConflictError extends Error {
  activeAuditRunId: string | null;

  constructor(activeAuditRunId: string | null) {
    super("An audit is already running for this project.");
    this.name = "ActiveAuditRunConflictError";
    this.activeAuditRunId = activeAuditRunId;
  }
}

export const serverDomainMocks = {
  ensureProjectAccess: vi.fn(),
  ensureProjectOwnerAccess: vi.fn(),
  ensureWorkingCopyAccess: vi.fn(),
  getLatestProjectState: vi.fn(),
  queryProjectAuditHistory: vi.fn(),
  getAuditComparison: vi.fn(),
  createProject: vi.fn(),
  createScaffoldRevision: vi.fn(),
  softDeleteProject: vi.fn(),
  findActiveAuditRun: vi.fn(),
  snapshotWorkingCopyAndCreateAuditRun: vi.fn(),
  saveWorkingCopyFile: vi.fn(),
  findAuditRunWithProject: vi.fn(),
  getPdfExportByAudit: vi.fn(),
  createPdfExport: vi.fn()
};

export const serverDomainMockModule = {
  ActiveAuditRunConflictError,
  ensureProjectAccess: serverDomainMocks.ensureProjectAccess,
  ensureProjectOwnerAccess: serverDomainMocks.ensureProjectOwnerAccess,
  ensureWorkingCopyAccess: serverDomainMocks.ensureWorkingCopyAccess,
  getLatestProjectState: serverDomainMocks.getLatestProjectState,
  queryProjectAuditHistory: serverDomainMocks.queryProjectAuditHistory,
  getAuditComparison: serverDomainMocks.getAuditComparison,
  createProject: serverDomainMocks.createProject,
  createScaffoldRevision: serverDomainMocks.createScaffoldRevision,
  softDeleteProject: serverDomainMocks.softDeleteProject,
  findActiveAuditRun: serverDomainMocks.findActiveAuditRun,
  snapshotWorkingCopyAndCreateAuditRun:
    serverDomainMocks.snapshotWorkingCopyAndCreateAuditRun,
  saveWorkingCopyFile: serverDomainMocks.saveWorkingCopyFile,
  findAuditRunWithProject: serverDomainMocks.findAuditRunWithProject,
  getPdfExportByAudit: serverDomainMocks.getPdfExportByAudit,
  createPdfExport: serverDomainMocks.createPdfExport
};

export function resetServerDomainMocks() {
  serverDomainMocks.ensureProjectAccess.mockReset();
  serverDomainMocks.ensureProjectOwnerAccess.mockReset();
  serverDomainMocks.ensureWorkingCopyAccess.mockReset();
  serverDomainMocks.getLatestProjectState.mockReset();
  serverDomainMocks.queryProjectAuditHistory.mockReset();
  serverDomainMocks.getAuditComparison.mockReset();
  serverDomainMocks.createProject.mockReset();
  serverDomainMocks.createScaffoldRevision.mockReset();
  serverDomainMocks.softDeleteProject.mockReset();
  serverDomainMocks.findActiveAuditRun.mockReset();
  serverDomainMocks.snapshotWorkingCopyAndCreateAuditRun.mockReset();
  serverDomainMocks.saveWorkingCopyFile.mockReset();
  serverDomainMocks.findAuditRunWithProject.mockReset();
  serverDomainMocks.getPdfExportByAudit.mockReset();
  serverDomainMocks.createPdfExport.mockReset();
}
