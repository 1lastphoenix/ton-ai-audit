import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { dbSchema } from "@ton-audit/shared";

import { getEnv } from "./env";

type AppDb = ReturnType<typeof drizzle<typeof dbSchema>>;

const globalForDb = globalThis as unknown as {
  pool?: Pool;
  db?: AppDb;
};

export function getPool() {
  if (globalForDb.pool) {
    return globalForDb.pool;
  }

  const env = getEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL
  });

  if (env.NODE_ENV !== "production") {
    globalForDb.pool = pool;
  }

  return pool;
}

export function getDb() {
  if (globalForDb.db) {
    return globalForDb.db;
  }

  const instance = drizzle(getPool(), { schema: dbSchema });

  if (getEnv().NODE_ENV !== "production") {
    globalForDb.db = instance;
  }

  return instance;
}

function bindIfFunction<T extends object>(instance: T, value: unknown) {
  if (typeof value === "function") {
    return value.bind(instance);
  }

  return value;
}

export const pool = new Proxy({} as Pool, {
  get(_target, property) {
    const instance = getPool();
    const value = Reflect.get(instance, property, instance);
    return bindIfFunction(instance, value);
  }
});

export const db = new Proxy({} as AppDb, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance, property, instance);
    return bindIfFunction(instance, value);
  }
});
