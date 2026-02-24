import IORedis, { type RedisOptions } from "ioredis";

import { getEnv } from "./env";

const globalForRedis = globalThis as unknown as {
  redisConnection?: IORedis;
};

export function getRedisConnection() {
  if (globalForRedis.redisConnection) {
    return globalForRedis.redisConnection;
  }

  const redisUrl = new URL(getEnv().REDIS_URL);

  const redisOptions: RedisOptions = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    // Reconnect with exponential backoff, capped at 3 s.
    retryStrategy: (times) => Math.min(times * 100, 3_000),
    // Abort commands that have been waiting too long.
    commandTimeout: 10_000,
    // TCP keepalive so idle connections are not silently dropped by firewalls.
    keepAlive: 30_000
  };

  const connection = new IORedis(redisOptions);

  connection.on("error", (err) => {
    console.error("[redis] Connection error:", err.message);
  });

  globalForRedis.redisConnection = connection;

  return connection;
}
