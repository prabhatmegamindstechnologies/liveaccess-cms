ALTER TABLE "articles" ADD COLUMN "published" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Everything imported so far is live: record it as the published copy.
UPDATE "articles" SET "published" = jsonb_build_object(
  'slug', "slug", 'title', "title", 'summary', "summary", 'areaSlug', coalesce("area_slug", ''),
  'publishedDate', coalesce(to_char("published_date", 'YYYY-MM-DD'), ''), 'blocks', "blocks",
  'seo', jsonb_build_object('title', "seo_title", 'description', "seo_description", 'noindex', "noindex")
) WHERE "status" = 'published';
