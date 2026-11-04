ALTER TABLE "users" ADD COLUMN "temp_password_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
-- Temporary passwords made before expiry existed get the same 72 hours from now.
UPDATE "users" SET "temp_password_expires_at" = now() + interval '72 hours' WHERE "must_change_password";
