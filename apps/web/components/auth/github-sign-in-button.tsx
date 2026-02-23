"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type GitHubSignInButtonProps = {
  callbackPath?: string;
};

export function GitHubSignInButton({ callbackPath = "/dashboard" }: GitHubSignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <Button
      type="button"
      disabled={isLoading}
      onClick={async () => {
        setIsLoading(true);
        await authClient.signIn.social({
          provider: "github",
          callbackURL: callbackPath
        });
        setIsLoading(false);
      }}
    >
      {isLoading ? "Redirecting..." : "Sign in with GitHub"}
    </Button>
  );
}
