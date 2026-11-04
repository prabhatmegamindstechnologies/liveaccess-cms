// pnpm build:site — builds the local preview of the site from the drafts (the same build as the Publish centre button).
import { env, repoRoot } from "../env.ts";
import { createDb } from "../db/client.ts";
import { buildSite } from "../publish/build-site.ts";

const { db, close } = createDb(env.databaseUrl());
try {
  const { counts, skipped, warnings } = await buildSite(db, { siteRoot: env.siteRoot, previewRoot: repoRoot });
  console.log(`Built ${counts.pages} pages, ${counts.guides} guides, ${counts.areas} process areas (${counts.files} files written) into .site-preview/`);
  for (const s of skipped) console.log(`${s.live ? "Live copy used" : "Left out"}: ${s.kind} "${s.title}": ${s.reason}`);
  for (const w of warnings) console.log(`Warning: ${w}`);
  console.log(`With pnpm dev:api running, open http://localhost:${env.previewPort}/`);
} finally {
  await close();
}
