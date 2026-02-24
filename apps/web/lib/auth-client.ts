import { createAuthClient } from "better-auth/react";

const resolvedBaseURL =
  typeof window === "undefined"
    ? process.env.NEXT_PUBLIC_APP_URL
    : window.location.origin;

export const authClient = createAuthClient(
  resolvedBaseURL
    ? {
        baseURL: resolvedBaseURL
      }
    : undefined,
);
