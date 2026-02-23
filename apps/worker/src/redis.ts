import IORedis, { type RedisOptions } from "ioredis";

import { env } from "./env";

const redisUrl = new URL(env.REDIS_URL);

const redisOptions: RedisOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false
};

export const redisConnection = new IORedis(redisOptions);
