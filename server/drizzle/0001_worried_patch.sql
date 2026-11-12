CREATE TABLE "api_usage" (
	"api" text NOT NULL,
	"month" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_api_month_pk" PRIMARY KEY("api","month")
);
