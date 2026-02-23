import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { dbSchema } from "@ton-audit/shared";

import { env } from "./env";

const globalForDb = globalThis as unknown as {
  pool?: Pool;
};

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: env.DATABASE_URL
  });

if (env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema: dbSchema });
