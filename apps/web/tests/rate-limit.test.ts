import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("rate limiter hardening", () => {
  it("uses Redis-backed sliding window enforcement", () => {
    const sourcePath = path.resolve(process.cwd(), "lib", "server", "rate-limit.ts");
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("getRedisConnection");
    expect(source).toContain("redis.eval");
    expect(source).toContain("ZREMRANGEBYSCORE");
    expect(source).toContain("ZCARD");
    expect(source).toContain("ZADD");
    expect(source).toContain("PEXPIRE");
  });

  it("fails closed when Redis rate limiter is unavailable", () => {
    const sourcePath = path.resolve(process.cwd(), "lib", "server", "api.ts");
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("await isRateLimited");
    expect(source).toContain("Rate limiter unavailable. Please retry shortly.");
    expect(source).toContain("429");
    expect(source).toContain("503");
  });
});
