import { NextResponse } from "next/server";

import { createProjectSchema } from "@ton-audit/shared";

import { createProject } from "@/lib/server/domain";
import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const body = await parseJsonBody(request, createProjectSchema);

    const project = await createProject({
      ownerUserId: session.user.id,
      name: body.name,
      slug: body.slug
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}