-- Expand step: users become people, and the ways they sign in become identities.
-- users.provider / users.provider_id are no longer read (a later migration drops them).
CREATE TABLE IF NOT EXISTS "user_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_id" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_identities_provider_identity" UNIQUE ("provider", "provider_id")
);
CREATE INDEX IF NOT EXISTS "user_identities_user_idx" ON "user_identities" ("user_id");
-- Existing users keep working: each gets one identity. Their email is not known to be verified yet
-- (it is refreshed at their next sign-in).
INSERT INTO "user_identities" ("user_id", "provider", "provider_id", "email", "email_verified")
SELECT "id", "provider", "provider_id", "email", false FROM "users"
WHERE "provider" IS NOT NULL AND "provider_id" IS NOT NULL
ON CONFLICT ("provider", "provider_id") DO NOTHING;
ALTER TABLE "users" ALTER COLUMN "provider" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "provider_id" DROP NOT NULL;
