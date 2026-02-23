import { NextResponse } from "next/server";

import { workingCopyPatchFileSchema } from "@ton-audit/shared";

import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess, saveWorkingCopyFile } from "@/lib/server/domain";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; workingCopyId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { projectId, workingCopyId } = await context.params;

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await parseJsonBody(request, workingCopyPatchFileSchema);

    const file = await saveWorkingCopyFile({
      workingCopyId,
      path: body.path,
      content: body.content,
      language: body.language,
      isTestFile: body.isTestFile
    });

    return NextResponse.json({ file });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}