import { vi } from "vitest";

export const serverModelAllowlistMocks = {
  getAuditModelAllowlist: vi.fn(),
  assertAllowedModel: vi.fn()
};

export const serverModelAllowlistMockModule = {
  getAuditModelAllowlist: serverModelAllowlistMocks.getAuditModelAllowlist,
  assertAllowedModel: serverModelAllowlistMocks.assertAllowedModel
};

export function resetServerModelAllowlistMocks() {
  serverModelAllowlistMocks.getAuditModelAllowlist.mockReset();
  serverModelAllowlistMocks.assertAllowedModel.mockReset();
}
