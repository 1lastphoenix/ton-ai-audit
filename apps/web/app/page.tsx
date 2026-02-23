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
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
        <Card className="w-full">
          <CardHeader className="space-y-3">
            <Badge variant="outline" className="w-fit">
              TON Audit Platform v1
            </Badge>
            <CardTitle className="max-w-3xl text-4xl leading-tight sm:text-5xl">
              Professional TON smart-contract audits with a Codespaces-style workflow.
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-muted-foreground max-w-3xl">
              Upload Blueprint ZIPs or source files, review immutable audit revisions, edit in a VS Code-like
              web IDE, run re-audits, and export PDF reports with traceable finding lifecycle.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <GitHubSignInButton callbackPath="/dashboard" />
              <Button asChild variant="outline">
                <Link
                  href="https://docs.ton.org/contract-dev/blueprint/overview"
                  target="_blank"
                  rel="noreferrer"
                >
                  TON Blueprint docs
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
