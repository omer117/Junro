CREATE TABLE IF NOT EXISTS "segments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "hotel_lat" double precision NOT NULL,
  "hotel_lng" double precision NOT NULL,
  "hotel_name" text,
  "hotel_place_id" text,
  "travel_mode" "travel_mode" NOT NULL,
  "start_time" integer NOT NULL,
  "end_time" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "segments_trip_idx" ON "segments" ("trip_id");
ALTER TABLE "days" ADD COLUMN IF NOT EXISTS "segment_id" uuid REFERENCES "segments"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "days_segment_idx" ON "days" ("segment_id");
ALTER TABLE "stages" ALTER COLUMN "day_id" DROP NOT NULL;
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "segment_id" uuid REFERENCES "segments"("id") ON DELETE CASCADE;
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "pinned_time" integer;
CREATE INDEX IF NOT EXISTS "stages_segment_idx" ON "stages" ("segment_id");
ALTER TABLE "stages" DROP CONSTRAINT IF EXISTS "stages_has_owner";
ALTER TABLE "stages" ADD CONSTRAINT "stages_has_owner" CHECK ("day_id" IS NOT NULL OR "segment_id" IS NOT NULL);
ALTER TABLE "stages" DROP CONSTRAINT IF EXISTS "stages_pin_needs_day";
ALTER TABLE "stages" ADD CONSTRAINT "stages_pin_needs_day" CHECK ("pinned_time" IS NULL OR "day_id" IS NOT NULL);
