-- A day keeps the route lines of its latest routes (one per route), instead of a single line.
ALTER TABLE "days" ADD COLUMN IF NOT EXISTS "route_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "days" DROP COLUMN IF EXISTS "polyline";--> statement-breakpoint
ALTER TABLE "days" DROP COLUMN IF EXISTS "polyline_key";
