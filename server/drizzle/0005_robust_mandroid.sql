ALTER TABLE "trips" ADD COLUMN "origin_airport" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "destination_airport" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_airport_airports_iata_code_fk" FOREIGN KEY ("origin_airport") REFERENCES "public"."airports"("iata_code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_destination_airport_airports_iata_code_fk" FOREIGN KEY ("destination_airport") REFERENCES "public"."airports"("iata_code") ON DELETE set null ON UPDATE no action;