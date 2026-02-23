import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { ensureProjectAccess, getLatestProjectState } from "@/lib/server/domain";
import { env } from "@/lib/server/env";
import { requireServerSession } from "@/lib/server/session";

export default async function ProjectPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await requireServerSession();
  const { projectId } = await props.params;

  const project = await ensureProjectAccess(projectId, session.user.id);
  if (!project) {
    notFound();
  }

  const latest = await getLatestProjectState(project.id);

  return (
    <main className="min-h-screen bg-[#0b0f15] text-zinc-100">
      <div className="mx-auto grid max-w-[1500px] gap-4 px-4 py-5 lg:px-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Project</p>
            <h1 className="text-xl font-semibold">{project.name}</h1>
          </div>
          <Link href="/dashboard" className="text-sm text-sky-300 hover:text-sky-200">
            Back to dashboard
          </Link>
        </header>

        <ProjectWorkspace
          projectId={project.id}
          initialRevisionId={latest.latestRevision?.id ?? null}
          initialAuditId={latest.latestAudit?.id ?? null}
          modelAllowlist={env.AUDIT_MODEL_ALLOWLIST}
        />
      </div>
    </main>
  );
}
