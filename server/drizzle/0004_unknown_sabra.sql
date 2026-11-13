CREATE TABLE "airports" (
	"iata_code" text PRIMARY KEY NOT NULL,
	"icao_code" text,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country_code" text NOT NULL,
	"country_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "airports_country_idx" ON "airports" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "airports_rank_idx" ON "airports" USING btree ("rank");