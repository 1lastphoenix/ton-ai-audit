"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  return (
    <Button
      variant="outline"
      disabled={isLoading}
      onClick={async () => {
        setIsLoading(true);
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      {isLoading ? "Signing out..." : "Sign out"}
    </Button>
  );
}
