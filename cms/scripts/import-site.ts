// pnpm import:site — copies the current pages, guides and process areas into the CMS database.
import { env } from "../env.ts";
import { createDb } from "../db/client.ts";
import { importSite } from "../import/site.ts";

const { db, close } = createDb(env.databaseUrl());
try {
  const result = await importSite(db, env.siteRoot);
  console.log(`Imported from ${env.siteRoot}: ${result.pages} pages, ${result.guides} guides, ${result.areas} process areas.`);
} finally {
  await close();
}
