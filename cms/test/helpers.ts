// Test database helpers: migrate once, wipe data between tests.
import { sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createDb, type Db } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { users } from "../db/schema.ts";
import { hashPassword } from "../api/auth/password.ts";

let migrated = false;

export async function testDb() {
  const url = env.testDatabaseUrl();
  if (!migrated) {
    await runMigrations(url);
    migrated = true;
  }
  return createDb(url);
}

export async function wipe(db: Db) {
  await db.execute(sql`TRUNCATE users, sessions, pages, articles, revisions, media, menus, settings, redirects, contact_messages, audit_log, publish_jobs RESTART IDENTITY CASCADE`);
}

export async function makeUser(db: Db, opts: { email?: string; password?: string; role?: "super_admin" | "editor"; status?: "active" | "disabled" } = {}) {
  const password = opts.password ?? "correct-horse-battery";
  const [u] = await db.insert(users).values({
    name: "Test User",
    email: opts.email ?? "admin@example.com",
    passwordHash: await hashPassword(password),
    role: opts.role ?? "super_admin",
    status: opts.status ?? "active"
  }).returning();
  return { user: u!, password };
}
