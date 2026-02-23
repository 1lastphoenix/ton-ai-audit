import Link from "next/link";
import { redirect } from "next/navigation";

import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { getServerSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getServerSession();

  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937,transparent_50%),linear-gradient(180deg,#090b10_0%,#0d1117_100%)] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
        <div className="grid gap-8">
          <div className="inline-flex w-fit items-center rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-1 text-xs text-sky-200">
            TON Audit Platform v1
          </div>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
            Professional TON smart-contract audits with a Codespaces-style workflow.
          </h1>
          <p className="max-w-2xl text-zinc-300">
            Upload Blueprint ZIPs or source files, review immutable audit revisions, edit in a VS Code-like
            web IDE, run re-audits, and export PDF reports with traceable finding lifecycle.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <GitHubSignInButton callbackPath="/dashboard" />
            <Link
              href="https://docs.ton.org/contract-dev/blueprint/overview"
              className="rounded-md border border-white/15 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5"
              target="_blank"
              rel="noreferrer"
            >
              TON Blueprint docs
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
