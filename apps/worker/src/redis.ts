import IORedis, { type RedisOptions } from "ioredis";

import { env } from "./env";

const redisUrl = new URL(env.REDIS_URL);

export const bullMqConnectionOptions: RedisOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false
};

export function createRedisConnection(overrides?: RedisOptions) {
  return new IORedis({
    ...bullMqConnectionOptions,
    ...overrides
  });
}

export const redisConnection = createRedisConnection();
