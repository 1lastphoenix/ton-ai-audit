import { vi } from "vitest";

export const serverDbMocks = {
  select: vi.fn(),
  selectFrom: vi.fn(),
  selectWhere: vi.fn(),
  selectLimit: vi.fn()
};

export const serverDbMockModule = {
  db: {
    select: serverDbMocks.select
  }
};

export function resetServerDbMocks() {
  serverDbMocks.select.mockReset();
  serverDbMocks.selectFrom.mockReset();
  serverDbMocks.selectWhere.mockReset();
  serverDbMocks.selectLimit.mockReset();
}

export function configureDbSelectWhereChain() {
  serverDbMocks.select.mockImplementation(() => ({
    from: serverDbMocks.selectFrom
  }));

  serverDbMocks.selectFrom.mockImplementation(() => ({
    where: serverDbMocks.selectWhere
  }));
}

export function configureDbSelectLimitChain() {
  configureDbSelectWhereChain();
  serverDbMocks.selectWhere.mockImplementation(() => ({
    limit: serverDbMocks.selectLimit
  }));
}
