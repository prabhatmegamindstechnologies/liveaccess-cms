// Publish: builds the site from the drafts on top of the website branch's own files, and commits only what changed.
// Building on the branch (not on this server's copy of the files) means a publish never undoes someone else's change.
// The commit is the only thing that reaches the website (its deploy runs from the branch); drafts are marked live after it.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { MediaStorage } from "../api/media/storage.ts";
import type { Db } from "../db/client.ts";
import { articles, pages, publishJobs, users } from "../db/schema.ts";
import { buildSiteInto, type BuildResult, type BuiltDrafts } from "./build-site.ts";
import { github, gitBlobSha, type GithubConfig } from "./github.ts";

/** What Publish may read from and write to the branch: the site's files at the top level, and images/. Never code or settings. */
export const SITE_PATH = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\.(?:html|css|js|png|svg|txt|xml|woff2)|\.htaccess|images\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*)$/;
// Larger files (the demo video) never change through the CMS, and the build doesn't need them.
const MAX_READ = 5 * 1024 * 1024;
// A publish that's been "running" longer than this died with its server; a new one may start.
const STALE_MS = 5 * 60_000;

export type PublishOutcome = { result: BuildResult; files: string[]; commit: { sha: string; url: string } | null };

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function filesIn(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...await filesIn(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** The drafts that went out are now what's live. A page's publish date (the sitemap's lastmod) only moves if the page changed. */
async function markPublished(db: Db, drafts: BuiltDrafts) {
  await db.transaction(async (tx) => {
    for (const p of drafts.pages) {
      await tx.update(pages).set({
        publishedHtml: p.html, status: "published",
        publishedAt: sql`case when ${pages.publishedHtml} is distinct from ${p.html} then now() else ${pages.publishedAt} end`
      }).where(eq(pages.id, p.id));
    }
    for (const a of drafts.articles) {
      await tx.update(articles).set({ published: a.value, publishedSlug: a.value.slug, status: "published" }).where(eq(articles.id, a.id));
    }
  });
}

export class PublishBusy extends Error {}

export async function publishLive(db: Db, opts: { github: GithubConfig; storage: MediaStorage; user: { id: number; name: string } }): Promise<PublishOutcome> {
  const running = await db.select({ id: publishJobs.id }).from(publishJobs)
    .where(and(eq(publishJobs.status, "running"), gt(publishJobs.startedAt, new Date(Date.now() - STALE_MS)))).limit(1);
  if (running.length) throw new PublishBusy("Someone is already publishing. Try again in a minute.");
  const [job] = await db.insert(publishJobs).values({ triggeredBy: opts.user.id, status: "running" }).returning({ id: publishJobs.id });

  const gh = github(opts.github);
  const site = await mkdtemp(join(tmpdir(), "cms-site-"));
  const out = await mkdtemp(join(tmpdir(), "cms-out-"));
  try {
    const head = await gh.head();
    const onBranch = new Map(head.files.map((f) => [f.path, f.sha]));
    await inBatches(head.files.filter((f) => SITE_PATH.test(f.path) && f.size <= MAX_READ), 8, async (f) => {
      const file = join(site, f.path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await gh.blob(f.sha));
    });

    const { result, drafts } = await buildSiteInto(db, { siteRoot: site, outDir: out, storage: opts.storage });

    const changed: { path: string; data: Buffer }[] = [];
    for (const full of await filesIn(out)) {
      const path = relative(out, full).split(sep).join("/");
      if (!SITE_PATH.test(path)) continue;
      const data = await readFile(full);
      if (onBranch.get(path) !== gitBlobSha(data)) changed.push({ path, data });
    }
    changed.sort((a, b) => a.path.localeCompare(b.path));

    const commit = changed.length
      ? await gh.commit({ parent: head.commit, baseTree: head.tree, message: `Publish from CMS by ${opts.user.name}`, files: changed })
      : null;
    await markPublished(db, drafts);

    const files = changed.map((c) => c.path);
    await db.update(publishJobs).set({ status: "done", items: files, log: commit ? commit.url : "Nothing had changed.", finishedAt: new Date() })
      .where(eq(publishJobs.id, job!.id));
    return { result, files, commit };
  } catch (e) {
    await db.update(publishJobs).set({ status: "failed", log: e instanceof Error ? e.message : String(e), finishedAt: new Date() })
      .where(eq(publishJobs.id, job!.id));
    throw e;
  } finally {
    await rm(site, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
}

/** The last publishes, newest first. */
export async function recentPublishes(db: Db, limit = 10) {
  const rows = await db.select().from(publishJobs).where(inArray(publishJobs.status, ["running", "done", "failed"]))
    .orderBy(desc(publishJobs.startedAt)).limit(limit);
  const ids = [...new Set(rows.map((r) => r.triggeredBy).filter((id): id is number => id != null))];
  const names = new Map(ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
  return rows.map((r) => ({
    id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt,
    by: r.triggeredBy != null ? names.get(r.triggeredBy) ?? null : null,
    files: r.items as string[],
    // A commit link for a finished publish; the error for a failed one.
    commitUrl: r.status === "done" && r.log.startsWith("https://") ? r.log : null,
    error: r.status === "failed" ? r.log : null
  }));
}
