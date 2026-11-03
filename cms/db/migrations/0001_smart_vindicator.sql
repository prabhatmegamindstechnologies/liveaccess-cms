ALTER TABLE "articles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;