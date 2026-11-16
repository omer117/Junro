ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'must' NOT NULL;
ALTER TABLE "stages" DROP CONSTRAINT IF EXISTS "stages_priority_check";
ALTER TABLE "stages" ADD CONSTRAINT "stages_priority_check" CHECK ("priority" IN ('must', 'optional'));
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "dropped" boolean DEFAULT false NOT NULL;
ALTER TABLE "days" ADD COLUMN IF NOT EXISTS "end_time" integer;
