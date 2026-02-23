import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/server/db";
import { getRedisConnection } from "@/lib/server/redis";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await getRedisConnection().ping();
    return NextResponse.json({
      ok: true,
      service: "web",
      now: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "web",
        error: error instanceof Error ? error.message : "Unknown readiness error"
      },
      { status: 503 }
    );
  }
}
