// Local development server. On Vercel the same app runs as a Function (entry added on Day 6).
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { env, repoRoot } from "../env.ts";
import { createDb } from "../db/client.ts";
import { PREVIEW_DIR } from "../publish/build-site.ts";
import { createApp } from "./app.ts";
import { previewSite } from "./preview-server.ts";

const { db } = createDb(env.databaseUrl());
// siteRoot enables the preview-asset route: local development only, never in production.
const dev = process.env.NODE_ENV !== "production";
// The site build also needs the "this is my own computer" setting, so a host that forgets NODE_ENV doesn't get it.
const local = dev && !env.secureCookies && !process.env.VERCEL;
const previewUrl = `http://localhost:${env.previewPort}/`;
const app = createApp({
  db, adminPath: env.adminPath, secureCookies: env.secureCookies, trustProxy: env.trustProxy, siteRoot: dev ? env.siteRoot : undefined, siteFilesRoot: env.siteRoot,
  preview: local ? { siteRoot: env.siteRoot, previewRoot: repoRoot, url: previewUrl } : undefined
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`CMS API on http://localhost:${info.port}/${env.adminPath}/api`);
});

if (local) {
  const site = previewSite(join(repoRoot, PREVIEW_DIR));
  // This machine only. If the port is taken the API keeps running without the preview.
  serve({ fetch: site.fetch, port: env.previewPort, hostname: "127.0.0.1" }, () => console.log(`Site preview on ${previewUrl}`))
    .on("error", (e) => console.error(`Site preview not started: ${e.message}`));
}
