import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eval: vi.fn(),
  getRedisConnection: vi.fn()
}));

vi.mock("../lib/server/redis", () => ({
  getRedisConnection: mocks.getRedisConnection
}));

import { checkRateLimit } from "../lib/server/api";
import { isRateLimited } from "../lib/server/rate-limit";

describe("rate limiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRedisConnection.mockReturnValue({
      eval: mocks.eval
    });
  });

  it("executes Redis sliding-window script with normalized arguments", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_730_000_000_000);
    mocks.eval.mockResolvedValue(0);

    const limited = await isRateLimited("user-1:create-project", 0, -100);

    expect(limited).toBe(false);
    expect(mocks.eval).toHaveBeenCalledTimes(1);

    const [script, keyCount, key, now, windowMs, limit, member] =
      mocks.eval.mock.calls[0] as [string, number, string, string, string, string, string];

    expect(script).toContain("ZREMRANGEBYSCORE");
    expect(script).toContain("ZADD");
    expect(keyCount).toBe(1);
    expect(key).toBe("rate-limit:user-1:create-project");
    expect(now).toBe("1730000000000");
    expect(windowMs).toBe("60000");
    expect(limit).toBe("1");
    expect(member.startsWith("1730000000000:")).toBe(true);

    nowSpy.mockRestore();
  });

  it("throws 429 when the request exceeds the limit", async () => {
    mocks.eval.mockResolvedValue(1);

    await expect(checkRateLimit("user-1", "export-pdf", 10, 60_000)).rejects.toMatchObject({
      message: "Too many requests. Please slow down.",
      statusCode: 429
    });
  });

  it("fails closed with 503 when Redis is unavailable", async () => {
    mocks.eval.mockRejectedValue(new Error("redis unavailable"));

    await expect(checkRateLimit("user-1", "run-audit", 10, 60_000)).rejects.toMatchObject({
      message: "Rate limiter unavailable. Please retry shortly.",
      statusCode: 503
    });
  });
});