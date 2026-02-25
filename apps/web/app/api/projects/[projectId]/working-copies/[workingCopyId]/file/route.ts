import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { normalizePath, workingCopyFiles, workingCopyPatchFileSchema } from "@ton-audit/shared";

import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import {
  ensureProjectAccess,
  ensureWorkingCopyAccess,
  findActiveAuditRun,
  saveWorkingCopyFile
} from "@/lib/server/domain";
import { db } from "@/lib/server/db";

export async function GET(
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

    const workingCopy = await ensureWorkingCopyAccess(workingCopyId, session.user.id, projectId);
    if (!workingCopy) {
      return NextResponse.json({ error: "Working copy not found" }, { status: 404 });
    }

    const search = new URL(request.url).searchParams;
    const path = normalizePath(search.get("path") ?? "");
    if (!path) {
      return NextResponse.json({ error: "Missing file path" }, { status: 400 });
    }

    const [file] = await db
      .select({
        path: workingCopyFiles.path,
        language: workingCopyFiles.language,
        content: workingCopyFiles.content
      })
      .from(workingCopyFiles)
      .where(
        and(
          eq(workingCopyFiles.workingCopyId, workingCopyId),
          eq(workingCopyFiles.path, path)
        )
      )
      .limit(1);

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ file });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

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

    const workingCopy = await ensureWorkingCopyAccess(workingCopyId, session.user.id, projectId);
    if (!workingCopy) {
      return NextResponse.json({ error: "Working copy not found" }, { status: 404 });
    }

    const activeAuditRun = await findActiveAuditRun(projectId);
    if (activeAuditRun) {
      return NextResponse.json(
        {
          error: "Cannot modify files while an audit is running for this project.",
          activeAuditRunId: activeAuditRun.id
        },
        { status: 409 }
      );
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
