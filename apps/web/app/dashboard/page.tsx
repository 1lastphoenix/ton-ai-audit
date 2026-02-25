import { and, desc, eq, isNull } from "drizzle-orm";
import { Activity, Clock3, FolderKanban, Sparkles } from "lucide-react";

import { projects } from "@ton-audit/shared";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ProjectCreateForm } from "@/components/dashboard/project-create-form";
import { ProjectList } from "@/components/dashboard/project-list";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/server/db";
import { requireServerSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const dayMs = 24 * 60 * 60 * 1_000;

function toEpoch(value: string | Date) {
  return new Date(value).getTime();
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

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

  const now = Date.now();
  const newThisWeek = projectRows.filter((project) => now - toEpoch(project.createdAt) <= 7 * dayMs).length;
  const activeToday = projectRows.filter((project) => now - toEpoch(project.updatedAt) <= dayMs).length;
  const averageProjectAgeDays =
    projectRows.length === 0
      ? null
      : Math.round(
          projectRows.reduce((sum, project) => sum + (now - toEpoch(project.createdAt)), 0) /
            projectRows.length /
            dayMs
        );
  const latestProject = projectRows[0] ?? null;

  return (
    <main className="bg-background text-foreground relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(90%_70%_at_0%_0%,rgba(14,165,233,0.14),transparent_60%),radial-gradient(80%_65%_at_100%_10%,rgba(245,158,11,0.18),transparent_55%),radial-gradient(75%_65%_at_50%_100%,rgba(6,182,212,0.09),transparent_70%)]" />

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="animate-in fade-in-0 slide-in-from-top-1 relative overflow-hidden rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm backdrop-blur">
          <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-sky-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 bottom-0 size-56 rounded-full bg-amber-500/20 blur-3xl" />

          <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="space-y-4">
              <Badge variant="outline" className="bg-background/70">
                Workspace Dashboard
              </Badge>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">TON Audit Workspace</h1>
                <p className="text-muted-foreground mt-2 text-sm">
                  Manage active projects, monitor recent activity, and jump into reviews faster.
                </p>
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                <span>{session.user.email ?? "Authenticated user"}</span>
                {latestProject ? <span>Latest project: {formatDate(latestProject.createdAt)}</span> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <ProjectCreateForm />
              <SignOutButton />
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="bg-card/80 border-border/70 rounded-2xl border p-4 shadow-sm backdrop-blur">
            <div className="text-muted-foreground flex items-center justify-between text-xs uppercase tracking-wide">
              Total projects
              <FolderKanban className="size-4" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{projectRows.length}</p>
            <p className="text-muted-foreground mt-1 text-xs">Ready workspaces available now</p>
          </article>

          <article className="bg-card/80 border-border/70 rounded-2xl border p-4 shadow-sm backdrop-blur">
            <div className="text-muted-foreground flex items-center justify-between text-xs uppercase tracking-wide">
              New this week
              <Sparkles className="size-4" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{newThisWeek}</p>
            <p className="text-muted-foreground mt-1 text-xs">Created in the last 7 days</p>
          </article>

          <article className="bg-card/80 border-border/70 rounded-2xl border p-4 shadow-sm backdrop-blur">
            <div className="text-muted-foreground flex items-center justify-between text-xs uppercase tracking-wide">
              Active today
              <Activity className="size-4" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{activeToday}</p>
            <p className="text-muted-foreground mt-1 text-xs">Updated within the last 24 hours</p>
          </article>

          <article className="bg-card/80 border-border/70 rounded-2xl border p-4 shadow-sm backdrop-blur">
            <div className="text-muted-foreground flex items-center justify-between text-xs uppercase tracking-wide">
              Avg project age
              <Clock3 className="size-4" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {averageProjectAgeDays === null ? "-" : `${averageProjectAgeDays}d`}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">Time since workspace creation</p>
          </article>
        </section>

        <ProjectList projects={projectRows} />

        <div className="text-muted-foreground text-xs">
          Tip: Use &quot;Create project&quot; with &quot;Upload Smart Contracts&quot; to import an existing repository.
        </div>
      </div>
    </main>
  );
}
