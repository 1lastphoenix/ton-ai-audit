import { NextResponse } from "next/server";

import { requireAdminSession, toApiErrorResponse } from "@/lib/server/api";
import { listDeadLetterJobs } from "@/lib/server/queues";

export async function GET(request: Request) {
  try {
    await requireAdminSession(request);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
    const jobs = await listDeadLetterJobs(Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20);

    return NextResponse.json({
      jobs
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
