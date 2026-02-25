import { vi } from "vitest";

export const serverQueuesMocks = {
  enqueueJob: vi.fn(),
  getPdfJobs: vi.fn()
};

export const serverQueuesMockModule = {
  enqueueJob: serverQueuesMocks.enqueueJob,
  queues: {
    pdf: {
      getJobs: serverQueuesMocks.getPdfJobs
    }
  }
};

export function resetServerQueuesMocks() {
  serverQueuesMocks.enqueueJob.mockReset();
  serverQueuesMocks.getPdfJobs.mockReset();
}
