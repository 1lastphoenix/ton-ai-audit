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
    lazyConnect: false
  };

  const connection = new IORedis(redisOptions);

  if (getEnv().NODE_ENV !== "production") {
    globalForRedis.redisConnection = connection;
  }

  return connection;
}
