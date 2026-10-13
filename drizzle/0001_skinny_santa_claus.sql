ALTER TABLE "models" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "health_note" text;