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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_90%_at_50%_0%,oklch(0.97_0.015_220)_0%,transparent_60%)]" />
      <section className="relative mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
        <Card className="mx-auto w-full max-w-3xl border-border/70 bg-card/90 shadow-xl shadow-black/5 backdrop-blur-sm">
          <CardHeader className="items-center space-y-4 text-center">
            <Badge variant="outline" className="tracking-[0.16em] uppercase">
              TON Audit Platform
            </Badge>
            <CardTitle className="text-4xl leading-tight sm:text-5xl">
              Professional TON contract audits, without the noise.
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-8 text-center">
            <p className="text-muted-foreground mx-auto max-w-2xl text-base sm:text-lg">
              Upload, analyze, and export clear security reports from one minimal workspace designed for focused
              review.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <GitHubSignInButton callbackPath="/dashboard" />
              <Button asChild variant="outline">
                <Link
                  href="https://docs.ton.org/contract-dev/blueprint/overview"
                  target="_blank"
                  rel="noreferrer"
                >
                  TON Docs
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
