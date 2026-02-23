import { and, desc, eq, isNull } from "drizzle-orm";

import { projects } from "@ton-audit/shared";

import { ProjectCard } from "@/components/dashboard/project-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ProjectCreateForm } from "@/components/dashboard/project-create-form";
import { db } from "@/lib/server/db";
import { requireServerSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireServerSession();

  const projectRows = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.ownerUserId, session.user.id),
        eq(projects.lifecycleState, "ready"),
        isNull(projects.deletedAt)
      )
    )
    .orderBy(desc(projects.createdAt));

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-10">
        <header className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">TON Audit Workspace</h1>
            <p className="text-muted-foreground text-sm">{session.user.email ?? "Authenticated user"}</p>
          </div>
          <div className="flex items-center gap-2">
            <ProjectCreateForm />
            <SignOutButton />
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectRows.length === 0 ? (
            <div className="text-muted-foreground bg-card rounded-xl border border-dashed p-8 text-sm">
              No ready projects yet. Create one to start auditing.
            </div>
          ) : (
            projectRows.map((project) => <ProjectCard key={project.id} project={project} />)
          )}
        </section>

        <div className="text-muted-foreground text-xs">
          Need to import existing contracts? Use Create project - Upload Smart Contracts.
        </div>
      </div>
    </main>
  );
}
