import { NextResponse } from "next/server";

import { and, eq, gt } from "drizzle-orm";

import { jobEvents } from "@ton-audit/shared";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    await requireSession(request);
    const { jobId } = await context.params;

    const encoder = new TextEncoder();
    let lastTimestamp = new Date(0);

    const stream = new ReadableStream({
      async start(controller) {
        const interval = setInterval(async () => {
          const events = await db
            .select()
            .from(jobEvents)
            .where(and(eq(jobEvents.jobId, jobId), gt(jobEvents.createdAt, lastTimestamp)))
            .orderBy(jobEvents.createdAt);

          if (!events.length) {
            return;
          }

          lastTimestamp = events[events.length - 1]!.createdAt;

          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        }, 2_000);

        request.signal.addEventListener("abort", () => {
          clearInterval(interval);
          controller.close();
        });
      }
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}