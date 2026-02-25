import { randomUUID } from "node:crypto";

import { getRedisConnection } from "./redis";

const RATE_LIMIT_KEY_PREFIX = "rate-limit";

// Sliding-window limiter implemented atomically in Redis.
const SLIDING_WINDOW_RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local member = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, 0, now_ms - window_ms)
local current = redis.call("ZCARD", key)

if current >= max_requests then
  redis.call("PEXPIRE", key, window_ms)
  return 1
end

redis.call("ZADD", key, now_ms, member)
redis.call("PEXPIRE", key, window_ms)
return 0
`;

function normalizePositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

function toRedisRateLimitKey(key: string) {
  return `${RATE_LIMIT_KEY_PREFIX}:${key}`;
}

/**
 * Returns true if the request should be rate-limited (i.e. limit exceeded).
 *
 * @param key      Unique key (e.g. userId + endpoint).
 * @param limit    Max requests allowed per window.
 * @param windowMs Window duration in milliseconds.
 */
export async function isRateLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
  const redis = getRedisConnection();
  const normalizedLimit = normalizePositiveInteger(limit, 1);
  const normalizedWindowMs = normalizePositiveInteger(windowMs, 60_000);
  const nowMs = Date.now();
  const member = `${nowMs}:${randomUUID()}`;

  const result = await redis.eval(
    SLIDING_WINDOW_RATE_LIMIT_SCRIPT,
    1,
    toRedisRateLimitKey(key),
    String(nowMs),
    String(normalizedWindowMs),
    String(normalizedLimit),
    member
  );

  return Number(result) === 1;
}
