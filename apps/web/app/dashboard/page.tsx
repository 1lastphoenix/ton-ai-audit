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

  const newestCreatedAt = projectRows.length > 0 ? toEpoch(projectRows[0]!.createdAt) : null;
  const oldestCreatedAt =
    projectRows.length > 0 ? toEpoch(projectRows[projectRows.length - 1]!.createdAt) : null;
  const newestUpdatedAt =
    projectRows.length > 0
      ? projectRows.reduce((max, project) => Math.max(max, toEpoch(project.updatedAt)), 0)
      : null;

  const recentCreationCount =
    newestCreatedAt === null
      ? 0
      : projectRows.filter((project) => newestCreatedAt - toEpoch(project.createdAt) <= 7 * dayMs)
          .length;
  const latestActivityCount =
    newestUpdatedAt === null
      ? 0
      : projectRows.filter((project) => newestUpdatedAt - toEpoch(project.updatedAt) <= dayMs)
          .length;
  const timelineSpanDays =
    newestCreatedAt === null || oldestCreatedAt === null
      ? null
      : Math.max(1, Math.round((newestCreatedAt - oldestCreatedAt) / dayMs));
  const latestProject = projectRows[0] ?? null;

  return (
    <main className="bg-background text-foreground relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(90%_70%_at_0%_0%,rgba(14,165,233,0.14),transparent_60%),radial-gradient(80%_65%_at_100%_10%,rgba(245,158,11,0.18),transparent_55%),radial-gradient(75%_65%_at_50%_100%,rgba(6,182,212,0.09),transparent_70%)]" />

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:gap-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="animate-in fade-in-0 slide-in-from-top-1 relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur sm:rounded-3xl sm:p-6">
          <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-sky-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 bottom-0 size-56 rounded-full bg-amber-500/20 blur-3xl" />

          <div className="relative grid gap-4 sm:gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="space-y-3 sm:space-y-4">
              <Badge variant="outline" className="bg-background/70">
                Workspace Dashboard
              </Badge>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  TON Audit Workspace
                </h1>
                <p className="text-muted-foreground mt-2 text-xs sm:text-sm">
                  Manage active projects, monitor recent activity, and jump into reviews faster.
                </p>
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs sm:gap-3">
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

        <section className="grid gap-2.5 sm:gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="bg-card/80 border-border/70 rounded-2xl border p-3.5 shadow-sm backdrop-blur sm:p-4">
            <div className="text-muted-foreground flex items-center justify-between text-[11px] uppercase tracking-wide">
              Total projects
              <FolderKanban className="size-4" />
            </div>
            <p className="mt-1.5 text-xl font-semibold tracking-tight sm:mt-2 sm:text-2xl">
              {projectRows.length}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">Ready workspaces available now</p>
          </article>

          <article className="bg-card/80 border-border/70 rounded-2xl border p-3.5 shadow-sm backdrop-blur sm:p-4">
            <div className="text-muted-foreground flex items-center justify-between text-[11px] uppercase tracking-wide">
              Recent cycle
              <Sparkles className="size-4" />
            </div>
            <p className="mt-1.5 text-xl font-semibold tracking-tight sm:mt-2 sm:text-2xl">
              {recentCreationCount}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Created within 7 days of the latest workspace
            </p>
          </article>

          <article className="bg-card/80 border-border/70 rounded-2xl border p-3.5 shadow-sm backdrop-blur sm:p-4">
            <div className="text-muted-foreground flex items-center justify-between text-[11px] uppercase tracking-wide">
              Latest activity
              <Activity className="size-4" />
            </div>
            <p className="mt-1.5 text-xl font-semibold tracking-tight sm:mt-2 sm:text-2xl">
              {latestActivityCount}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Updated within 24h of the most recent project update
            </p>
          </article>

          <article className="bg-card/80 border-border/70 rounded-2xl border p-3.5 shadow-sm backdrop-blur sm:p-4">
            <div className="text-muted-foreground flex items-center justify-between text-[11px] uppercase tracking-wide">
              Timeline span
              <Clock3 className="size-4" />
            </div>
            <p className="mt-1.5 text-xl font-semibold tracking-tight sm:mt-2 sm:text-2xl">
              {timelineSpanDays === null ? "-" : `${timelineSpanDays}d`}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">Difference between newest and oldest project</p>
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
