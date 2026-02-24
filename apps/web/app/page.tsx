import Link from "next/link";
import { redirect } from "next/navigation";

import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getServerSession();

  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return (
    <main className="bg-background text-foreground relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,oklch(0.95_0.02_230)_0%,transparent_55%)]" />
      <section className="relative mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
        <Card className="w-full border-border/70 bg-card/90 shadow-lg shadow-black/5 backdrop-blur-sm">
          <CardHeader className="space-y-5">
            <Badge variant="outline" className="w-fit tracking-[0.18em] uppercase">
              TON Audit Platform
            </Badge>
            <CardTitle className="max-w-3xl text-4xl leading-tight sm:text-5xl">
              Confident TON smart contract audits in one focused workspace.
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <p className="text-muted-foreground max-w-2xl text-base sm:text-lg">
              Upload code, review immutable revisions, re-run audits, and ship clear security reports from a
              single interface.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <GitHubSignInButton callbackPath="/dashboard" />
              <Button asChild variant="ghost">
                <Link
                  href="https://docs.ton.org/contract-dev/blueprint/overview"
                  target="_blank"
                  rel="noreferrer"
                >
                  Read TON docs
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
