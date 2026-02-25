import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { dbSchema } from "@ton-audit/shared";

import { getDb } from "./db";
import { getEnv } from "./env";

type AppAuth = ReturnType<typeof betterAuth>;
type GitHubProfile = {
  id?: unknown;
  login?: unknown;
  email?: unknown;
};

const globalForAuth = globalThis as unknown as {
  auth?: AppAuth;
};

const authAdapterSchema = {
  users: dbSchema.users,
  sessions: dbSchema.sessions,
  accounts: dbSchema.accounts,
  verifications: dbSchema.verifications
} as const;

export function getAuthAdapterSchema() {
  return authAdapterSchema;
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toIdentifierSegment(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  const normalized = toNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  const sanitized = normalized.replace(/[^a-zA-Z0-9._-]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

export function mapGitHubProfileToUser(profile: GitHubProfile) {
  if (toNonEmptyString(profile.email)) {
    return {};
  }

  const accountId = toIdentifierSegment(profile.id);
  if (accountId) {
    return {
      email: `github-${accountId}@users.noreply.github.com`,
      emailVerified: false
    };
  }

  const login = toIdentifierSegment(profile.login);
  if (!login) {
    return {};
  }

  return {
    email: `${login.toLowerCase()}@users.noreply.github.com`,
    emailVerified: false
  };
}

function getAuth() {
  if (globalForAuth.auth) {
    return globalForAuth.auth;
  }

  const env = getEnv();
  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.NEXT_PUBLIC_APP_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: getAuthAdapterSchema(),
      usePlural: true,
      camelCase: true
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        scope: ["read:user", "user:email"],
        mapProfileToUser(profile) {
          return mapGitHubProfileToUser(profile as GitHubProfile);
        }
      }
    },
    plugins: [nextCookies()],
    trustedOrigins: [env.NEXT_PUBLIC_APP_URL]
  });

  globalForAuth.auth = auth;

  return auth;
}

function bindIfFunction<T extends object>(instance: T, value: unknown) {
  if (typeof value === "function") {
    return value.bind(instance);
  }

  return value;
}

export const auth = new Proxy({} as AppAuth, {
  has(_target, property) {
    const instance = getAuth();
    return Reflect.has(instance, property);
  },
  get(_target, property) {
    const instance = getAuth();
    const value = Reflect.get(instance, property, instance);
    return bindIfFunction(instance, value);
  }
});
