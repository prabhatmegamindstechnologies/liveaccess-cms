// Where each library image is used. Worked out from the content itself, drafts and live copies alike, so it can't drift from it.
import { like, or } from "drizzle-orm";
import { MEDIA_DIR, mediaKeysIn, type Block } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { articles, media, pages } from "../../db/schema.ts";

export type Use = { kind: "page" | "guide" | "area"; title: string; link: string; live: boolean };

/** Library images a set of blocks refers to, by number or by address. */
function mediaIn(blocks: unknown, idOf: Map<string, number>) {
  const list = Array.isArray(blocks) ? blocks as Block[] : [];
  const ids = list.flatMap((b) => (b.type === "image" && b.mediaId ? [b.mediaId] : []));
  const keyed = mediaKeysIn(JSON.stringify(list)).flatMap((k) => idOf.get(k) ?? []);
  return new Set([...ids, ...keyed]);
}

export async function mediaUsage(db: Db) {
  const [files, pageRows, articleRows] = await Promise.all([
    db.select({ id: media.id, key: media.storageKey }).from(media),
    db.select({ key: pages.key, title: pages.title, html: pages.html, publishedHtml: pages.publishedHtml }).from(pages)
      .where(or(like(pages.html, `%${MEDIA_DIR}%`), like(pages.publishedHtml, `%${MEDIA_DIR}%`))),
    db.select({ id: articles.id, type: articles.type, title: articles.title, blocks: articles.blocks, published: articles.published }).from(articles)
  ]);
  const idOf = new Map(files.map((f) => [f.key, f.id]));
  const used = new Map<number, Use[]>();
  const add = (id: number, use: Use) => used.set(id, [...(used.get(id) ?? []), use]);

  for (const p of pageRows) {
    const live = new Set(mediaKeysIn(p.publishedHtml ?? ""));
    for (const key of new Set([...mediaKeysIn(p.html), ...live])) {
      const id = idOf.get(key);
      if (id) add(id, { kind: "page", title: p.title, link: `/pages/${p.key}`, live: live.has(key) });
    }
  }
  for (const a of articleRows) {
    const live = mediaIn((a.published as { blocks?: unknown } | null)?.blocks, idOf);
    for (const id of new Set([...mediaIn(a.blocks, idOf), ...live])) add(id, { kind: a.type, title: a.title, link: `/${a.type}s/${a.id}`, live: live.has(id) });
  }
  return used;
}
