import { defineConfig } from "drizzle-kit";
import { env } from "./env.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: env.databaseUrl() }
});
