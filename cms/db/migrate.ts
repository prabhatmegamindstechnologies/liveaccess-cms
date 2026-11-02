// Applies pending migrations. `pnpm db:migrate` uses DATABASE_URL; tests call runMigrations() on the test database.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.ts";
import { createDb } from "./client.ts";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(url: string) {
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMigrations(env.databaseUrl());
  console.log("Migrations applied.");
}
