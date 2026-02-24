/**
 * Sliding-window in-memory rate limiter.
 *
 * Suitable for single-process deployments. For multi-instance deployments
 * replace with a Redis-backed limiter (e.g., @upstash/ratelimit).
 */

type WindowEntry = {
  count: number;
  windowStart: number;
};

const windows = new Map<string, WindowEntry>();

// Clean up stale entries every 5 minutes to prevent unbounded memory growth.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (now - entry.windowStart > CLEANUP_INTERVAL_MS) {
      windows.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Returns true if the request should be rate-limited (i.e. limit exceeded).
 *
 * @param key      Unique key (e.g. userId + endpoint).
 * @param limit    Max requests allowed per window.
 * @param windowMs Window duration in milliseconds.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= limit) {
    return true;
  }

  entry.count += 1;
  return false;
}
