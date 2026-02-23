import { notFound } from "next/navigation";

import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { ensureProjectAccess, getLatestProjectState } from "@/lib/server/domain";
import { getAuditModelAllowlist } from "@/lib/server/model-allowlist";
import { requireServerSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function ProjectPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await requireServerSession();
  const { projectId } = await props.params;

  const project = await ensureProjectAccess(projectId, session.user.id);
  if (!project || project.lifecycleState !== "ready") {
    notFound();
  }

  const latest = await getLatestProjectState(project.id);
  const modelAllowlist = await getAuditModelAllowlist();

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-[1500px] px-2 py-2 lg:px-3 lg:py-3">
        <ProjectWorkspace
          projectId={project.id}
          projectName={project.name}
          initialRevisionId={latest.latestRevision?.id ?? null}
          initialAuditId={latest.latestAudit?.id ?? null}
          modelAllowlist={modelAllowlist}
        />
      </div>
    </main>
  );
}
