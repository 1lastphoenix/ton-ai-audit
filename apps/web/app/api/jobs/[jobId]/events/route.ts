import { NextResponse } from "next/server";

import { and, eq, gt } from "drizzle-orm";

import { jobEvents } from "@ton-audit/shared";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { ensureProjectAccess } from "@/lib/server/domain";
import { canReadJobEvents } from "@/lib/server/job-events-auth";

// Maximum time a single SSE connection is kept open (10 minutes).
const MAX_STREAM_LIFETIME_MS = 10 * 60 * 1000;
// Interval between DB polls.
const POLL_INTERVAL_MS = 2_000;
// Interval between SSE heartbeat comment lines (keeps proxies alive).
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { jobId } = await context.params;
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId query parameter is required" }, { status: 400 });
    }

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const [eventScope] = await db
      .select({ projectId: jobEvents.projectId })
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .orderBy(jobEvents.createdAt)
      .limit(1);

    if (
      eventScope &&
      !canReadJobEvents({
        requestedProjectId: projectId,
        eventProjectId: eventScope.projectId
      })
    ) {
      return NextResponse.json({ error: "Job not found for project scope" }, { status: 404 });
    }

    const encoder = new TextEncoder();
    let lastTimestamp = new Date(0);
    const deliveredEventIdSet = new Set<string>();
    let pollingInFlight = false;

    const rememberEventId = (eventId: string) => {
      if (deliveredEventIdSet.has(eventId)) {
        return false;
      }
      deliveredEventIdSet.add(eventId);
      return true;
    };

    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        let pollInterval: ReturnType<typeof setInterval> | undefined;
        let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
        let lifetimeTimeout: ReturnType<typeof setTimeout> | undefined;

        const close = () => {
          if (streamClosed) return;
          streamClosed = true;
          clearInterval(pollInterval);
          clearInterval(heartbeatInterval);
          clearTimeout(lifetimeTimeout);
          controller.close();
        };

        const pollEvents = async () => {
          if (pollingInFlight || streamClosed) {
            return;
          }
          pollingInFlight = true;

          try {
            const events = await db
              .select()
              .from(jobEvents)
              .where(
                and(
                  eq(jobEvents.jobId, jobId),
                  eq(jobEvents.projectId, projectId),
                  gt(jobEvents.createdAt, lastTimestamp)
                )
              )
              .orderBy(jobEvents.createdAt);

            if (!events.length) {
              return;
            }

            lastTimestamp = events[events.length - 1]!.createdAt;

            for (const event of events) {
              if (!rememberEventId(event.id)) {
                continue;
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          } catch (error) {
            console.error("[job-events] DB poll error:", {
              jobId,
              projectId,
              error: error instanceof Error ? error.message : String(error)
            });
            // Keep the stream open and let the next poll retry.
          } finally {
            pollingInFlight = false;
          }
        };

        pollInterval = setInterval(() => {
          void pollEvents();
        }, POLL_INTERVAL_MS);

        // Heartbeat: keeps reverse proxies and load balancers from closing idle connections.
        heartbeatInterval = setInterval(() => {
          if (!streamClosed) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        }, HEARTBEAT_INTERVAL_MS);

        // Hard cap: close the stream after MAX_STREAM_LIFETIME_MS regardless.
        lifetimeTimeout = setTimeout(() => {
          close();
        }, MAX_STREAM_LIFETIME_MS);

        void pollEvents();

        request.signal.addEventListener("abort", () => {
          close();
        }, { once: true });
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
