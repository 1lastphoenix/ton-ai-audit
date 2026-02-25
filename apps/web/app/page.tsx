import Link from "next/link";
import { redirect } from "next/navigation";

import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getServerSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const trustSignals = [
  { label: "Audit Cycles", value: "3.4x faster" },
  { label: "False Positives", value: "31% lower" },
  { label: "Report Prep", value: "Under 10 min" },
];

const platformPillars = [
  {
    title: "Focused Workspace",
    description:
      "Diffs, findings, and source context stay side-by-side so reviewers do not lose thread across tabs.",
  },
  {
    title: "Deterministic Runs",
    description:
      "Each run pins toolchain and model settings, making reruns reproducible for audits and client sign-off.",
  },
  {
    title: "Report-First Output",
    description:
      "Evidence, severity, and impacted files are mapped into a clean report format as you work.",
  },
];

const auditFlow = [
  {
    title: "Upload revision",
    detail:
      "Drop a TON project archive and create an immutable revision snapshot.",
  },
  {
    title: "Run guided analysis",
    detail:
      "Execute checks and model-assisted review in a constrained sandbox for safer automation.",
  },
  {
    title: "Triage findings",
    detail:
      "Sort by severity, validate exploitability, and annotate business impact with source references.",
  },
  {
    title: "Export client-ready report",
    detail:
      "Ship a structured PDF with evidence trails and remediation notes that teams can execute.",
  },
];

const reportSignals = [
  "Severity distribution with explicit rationale",
  "Linked code snippets for each finding",
  "Fix guidance mapped to impacted modules",
  "Diff-ready changelog between audit passes",
];

export default async function HomePage() {
  const session = await getServerSession();

  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#f4f1e8] text-[#111316]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_65%_at_18%_5%,rgba(246,127,67,0.22),transparent_72%),radial-gradient(110%_85%_at_92%_0%,rgba(36,175,167,0.18),transparent_62%),linear-gradient(180deg,#f4f1e8_0%,#f5f7fb_42%,#f2f5ef_100%)]"
      />
      <div
        aria-hidden
        className="lp-grid-overlay pointer-events-none absolute inset-0 opacity-60"
      />

      <section className="relative mx-auto max-w-6xl px-6 pb-20 pt-8 sm:pt-10 lg:px-8">
        <header className="lp-reveal flex items-center justify-between gap-4">
          <span className="inline-flex items-center rounded-full border border-[#111316]/20 bg-white/70 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.22em] backdrop-blur-sm">
            TON Audit Studio
          </span>
          <Button
            asChild
            variant="ghost"
            className="text-xs uppercase tracking-[0.12em] sm:text-sm"
          >
            <Link
              href="https://docs.ton.org/contract-dev/blueprint/overview"
              target="_blank"
              rel="noreferrer"
            >
              Blueprint Docs
            </Link>
          </Button>
        </header>

        <div className="mt-14 grid items-start gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-8">
            <Badge
              variant="outline"
              className="lp-reveal border-[#111316]/30 bg-white/75 px-3 py-1 text-[0.68rem] uppercase tracking-[0.15em]"
              style={{ animationDelay: "120ms" }}
            >
              Built for security teams shipping on TON
            </Badge>
            <h1
              className="lp-reveal max-w-xl text-balance text-4xl font-semibold leading-[1.04] sm:text-5xl lg:text-[3.6rem]"
              style={{ animationDelay: "220ms" }}
            >
              Audit faster, explain better, and ship reports clients can trust.
            </h1>
            <p
              className="lp-reveal max-w-xl text-pretty text-base leading-relaxed text-[#111316]/75 sm:text-lg"
              style={{ animationDelay: "320ms" }}
            >
              Replace scattered scripts and ad-hoc notes with one controlled
              workflow for TON smart contract reviews, from upload to signed-off
              PDF.
            </p>
            <div
              className="lp-reveal flex flex-col items-start gap-3 sm:flex-row"
              style={{ animationDelay: "420ms" }}
            >
              <GitHubSignInButton
                callbackPath="/dashboard"
                size="lg"
                className="px-5 text-sm font-semibold"
              />
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-[#111316]/25 bg-white/70 px-5 font-semibold"
              >
                <Link
                  href="https://docs.ton.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Explore TON docs
                </Link>
              </Button>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
              {trustSignals.map((signal, index) => (
                <div
                  key={signal.label}
                  className="lp-reveal rounded-2xl border border-[#111316]/12 bg-white/70 p-4 backdrop-blur-sm"
                  style={{ animationDelay: `${520 + index * 90}ms` }}
                >
                  <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#111316]/55">
                    {signal.label}
                  </dt>
                  <dd className="mt-2 text-xl font-semibold tracking-tight">
                    {signal.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="relative w-full">
            <div
              className="lp-reveal relative rounded-[2rem] border border-[#111316]/12 bg-white/80 p-6 shadow-[0_35px_80px_-48px_rgba(17,19,22,0.72)] backdrop-blur-md sm:p-7"
              style={{ animationDelay: "240ms" }}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold uppercase tracking-[0.13em] text-[#111316]/70">
                  Live Audit Run
                </p>
                <span className="rounded-full bg-[#1ca29a]/16 px-3 py-1 text-xs font-semibold text-[#0d6e69]">
                  In Progress
                </span>
              </div>
              <div className="mt-7 space-y-4">
                <div className="rounded-xl border border-[#111316]/12 bg-white/75 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#111316]/60">
                    Current Stage
                  </p>
                  <p className="mt-1 text-base font-semibold">
                    Severity Triage and Evidence Linking
                  </p>
                  <div className="mt-4 h-2 rounded-full bg-[#111316]/10">
                    <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-[#f67f43] to-[#ef5c52]" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#111316]/12 bg-white/75 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-[#111316]/60">
                      Critical Checks
                    </p>
                    <p className="mt-1 text-2xl font-semibold">14</p>
                    <p className="text-xs text-[#111316]/60">
                      2 flagged for manual review
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#111316]/12 bg-white/75 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-[#111316]/60">
                      Report Confidence
                    </p>
                    <p className="mt-1 text-2xl font-semibold">92%</p>
                    <p className="text-xs text-[#111316]/60">
                      Based on deterministic reruns
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <aside className="lp-float lp-reveal absolute -bottom-6 -right-2 max-w-[16rem] rounded-2xl border border-[#111316]/15 bg-[#111316] p-4 text-[#f6f8fa] shadow-2xl sm:-right-6 sm:max-w-[18rem]">
              <p className="text-[0.68rem] uppercase tracking-[0.15em] text-[#f6f8fa]/65">
                Top finding
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                Reentrancy guard missing in jetton transfer callback. Suggested
                patch generated with call graph context.
              </p>
            </aside>
          </section>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 pb-14 lg:px-8">
        <div className="lp-reveal mb-6 max-w-2xl">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything important, nothing noisy.
          </h2>
          <p className="mt-3 text-pretty text-[#111316]/72">
            The platform is designed for audit depth, not dashboards for their
            own sake.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {platformPillars.map((pillar, index) => (
            <article
              key={pillar.title}
              className="lp-reveal rounded-3xl border border-[#111316]/14 bg-white/72 p-6 backdrop-blur-sm"
              style={{ animationDelay: `${120 + index * 90}ms` }}
            >
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#111316]/62">
                {pillar.title}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[#111316]/78">
                {pillar.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative mx-auto grid max-w-6xl gap-8 px-6 pb-24 lg:grid-cols-[1fr_1fr] lg:px-8">
        <article className="lp-reveal rounded-3xl border border-[#111316]/15 bg-white/80 p-7 backdrop-blur-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#111316]/55">
            Report Clarity
          </p>
          <h2 className="mt-3 max-w-sm text-3xl font-semibold leading-tight">
            Clients understand what changed and why.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[#111316]/75">
            Every finding is attached to evidence, impact, and patch notes so
            engineering teams can act without a follow-up call for basic
            context.
          </p>
          <div className="mt-6">
            <GitHubSignInButton
              callbackPath="/dashboard"
              size="lg"
              className="bg-[#101217] px-5 text-sm text-white hover:bg-[#20232b]"
            />
          </div>
        </article>

        <article className="lp-reveal lp-reveal-delay-1 rounded-3xl border border-[#111316]/16 bg-[#fdfdfb]/95 p-7 shadow-[0_30px_80px_-54px_rgba(17,19,22,0.72)] sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#111316]/55">
            Sample Report Includes
          </p>
          <ul className="mt-4 space-y-3">
            {reportSignals.map((item) => (
              <li
                key={item}
                className="rounded-xl border border-[#111316]/12 bg-white/80 px-3 py-2 text-sm"
              >
                {item}
              </li>
            ))}
          </ul>
          <Button
            asChild
            variant="link"
            className="mt-4 h-auto p-0 text-sm font-semibold text-[#0d6e69] hover:text-[#0a5652]"
          >
            <Link href="https://docs.ton.org/" target="_blank" rel="noreferrer">
              Read TON documentation
            </Link>
          </Button>
        </article>
      </section>
    </main>
  );
}
