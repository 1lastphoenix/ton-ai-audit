import { vi } from "vitest";

export const serverS3Mocks = {
  getObjectSignedUrl: vi.fn()
};

export const serverS3MockModule = {
  getObjectSignedUrl: serverS3Mocks.getObjectSignedUrl
};

export function resetServerS3Mocks() {
  serverS3Mocks.getObjectSignedUrl.mockReset();
}
