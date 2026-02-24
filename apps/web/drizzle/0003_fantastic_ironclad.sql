ALTER TABLE "verification_tokens" RENAME TO "verifications";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "account_id" TO "accountId";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "provider_id" TO "providerId";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "access_token" TO "accessToken";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "refresh_token" TO "refreshToken";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "id_token" TO "idToken";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "access_token_expires_at" TO "accessTokenExpiresAt";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "refresh_token_expires_at" TO "refreshTokenExpiresAt";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "ip_address" TO "ipAddress";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "user_agent" TO "userAgent";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "email_verified" TO "emailVerified";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint
ALTER TABLE "verifications" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint
ALTER TABLE "verifications" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "verifications" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_provider_account_unique";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "accounts_user_id_idx";--> statement-breakpoint
DROP INDEX "sessions_user_id_idx";--> statement-breakpoint
DROP INDEX "users_email_idx";--> statement-breakpoint
DROP INDEX "verification_tokens_identifier_idx";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");