import { NextResponse } from "next/server";
import { z } from "zod";

import { jobStepSchema } from "@ton-audit/shared";

import { parseJsonBody, requireAdminSession, toApiErrorResponse } from "@/lib/server/api";
import { replayDeadLetterJob } from "@/lib/server/queues";

const replaySchema = z.object({
  queue: jobStepSchema,
  jobId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    await requireAdminSession(request);
    const body = await parseJsonBody(request, replaySchema);
    const replay = await replayDeadLetterJob(body.queue, body.jobId);

    return NextResponse.json({
      replay
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
