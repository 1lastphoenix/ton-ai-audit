import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { projects } from "@ton-audit/shared";

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
    .where(eq(projects.ownerUserId, session.user.id))
    .orderBy(desc(projects.createdAt));

  return (
    <main className="min-h-screen bg-[#0b0f15] text-zinc-100">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">TON Audit Workspace</h1>
            <p className="text-sm text-zinc-400">{session.user.email}</p>
          </div>
          <SignOutButton />
        </header>

        <ProjectCreateForm />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projectRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/15 p-6 text-sm text-zinc-400">
              No projects yet. Create one to start auditing.
            </div>
          ) : (
            projectRows.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="rounded-lg border border-white/10 bg-[#11161e] p-4 hover:border-sky-400/50"
              >
                <div className="font-medium">{project.name}</div>
                <div className="text-xs text-zinc-400">{project.slug}</div>
                <div className="mt-2 text-xs text-zinc-500">
                  Created {new Date(project.createdAt).toLocaleString()}
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
