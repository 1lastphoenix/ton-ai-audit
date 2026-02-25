"use client";

import type { ComponentProps } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type GitHubSignInButtonProps = {
  callbackPath?: string;
  className?: string;
  size?: ComponentProps<typeof Button>["size"];
};

export function GitHubSignInButton({ callbackPath = "/dashboard", className, size = "default" }: GitHubSignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <Button
      type="button"
      size={size}
      className={cn(className)}
      disabled={isLoading}
      onClick={async () => {
        setIsLoading(true);
        await authClient.signIn.social({
          provider: "github",
          callbackURL: callbackPath,
        });
        setIsLoading(false);
      }}
    >
      {isLoading ? "Redirecting..." : "Sign in with GitHub"}
    </Button>
  );
}
