// Local development server. On Vercel the same app runs as a Function (entry added on Day 6).
import { serve } from "@hono/node-server";
import { env } from "../env.ts";
import { createDb } from "../db/client.ts";
import { createApp } from "./app.ts";

const { db } = createDb(env.databaseUrl());
const app = createApp({ db, adminPath: env.adminPath, secureCookies: env.secureCookies, trustProxy: env.trustProxy });

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`CMS API on http://localhost:${info.port}/${env.adminPath}/api`);
});
