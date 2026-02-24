import { NextResponse } from "next/server";

import { createProjectSchema } from "@ton-audit/shared";

import { createProject, createScaffoldRevision, softDeleteProject } from "@/lib/server/domain";
import { checkRateLimit, parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    // 5 project creations per minute per user.
    checkRateLimit(session.user.id, "create-project", 5, 60_000);
    const body = await parseJsonBody(request, createProjectSchema);

    const project = await createProject({
      ownerUserId: session.user.id,
      name: body.name,
      slug: body.slug,
      lifecycleState: body.initialization.mode === "upload" ? "initializing" : "ready"
    });

    if (body.initialization.mode === "scaffold") {
      try {
        const revision = await createScaffoldRevision({
          projectId: project.id,
          createdByUserId: session.user.id,
          projectName: body.name
        });

        return NextResponse.json({ project, revision }, { status: 201 });
      } catch (error) {
        await softDeleteProject({ projectId: project.id });
        throw error;
      }
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
