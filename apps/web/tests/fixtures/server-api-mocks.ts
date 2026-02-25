import { vi } from "vitest";

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown";
}

export const serverApiMocks = {
  requireSession: vi.fn(),
  checkRateLimit: vi.fn(),
  parseJsonBody: vi.fn(),
  toApiErrorResponse: vi.fn((error: unknown) =>
    Response.json({ error: toErrorMessage(error) }, { status: 500 })
  )
};

export const serverApiMockModule = {
  requireSession: serverApiMocks.requireSession,
  checkRateLimit: serverApiMocks.checkRateLimit,
  parseJsonBody: serverApiMocks.parseJsonBody,
  toApiErrorResponse: serverApiMocks.toApiErrorResponse
};

export function resetServerApiMocks() {
  serverApiMocks.requireSession.mockReset();
  serverApiMocks.checkRateLimit.mockReset();
  serverApiMocks.parseJsonBody.mockReset();
  serverApiMocks.toApiErrorResponse.mockReset();
  serverApiMocks.toApiErrorResponse.mockImplementation((error: unknown) =>
    Response.json({ error: toErrorMessage(error) }, { status: 500 })
  );
}

export function applyDefaultServerApiMocks(userId = "user-1") {
  serverApiMocks.requireSession.mockResolvedValue({ user: { id: userId } });
  serverApiMocks.checkRateLimit.mockResolvedValue(undefined);
}
