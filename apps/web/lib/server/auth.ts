import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { dbSchema } from "@ton-audit/shared";

import { getDb } from "./db";
import { getEnv } from "./env";

type AppAuth = ReturnType<typeof betterAuth>;

const globalForAuth = globalThis as unknown as {
  auth?: AppAuth;
};

export function getAuthAdapterSchema() {
  return {
    ...dbSchema,
    verifications: dbSchema.verificationTokens
  };
}

export function getAuth() {
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
        clientSecret: env.GITHUB_CLIENT_SECRET
      }
    },
    plugins: [nextCookies()],
    trustedOrigins: [env.NEXT_PUBLIC_APP_URL]
  });

  if (env.NODE_ENV !== "production") {
    globalForAuth.auth = auth;
  }

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
