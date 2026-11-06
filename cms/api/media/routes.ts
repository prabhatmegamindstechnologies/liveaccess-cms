// /<ADMIN_PATH>/api/media — the Media library. Anyone signed in can upload, edit, replace and delete; an image in use can't be deleted.
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { hasHiddenChars, MEDIA_DIR } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { media } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";
import { MAX_UPLOAD_BYTES, processImage } from "./process.ts";
import { validKey, type MediaStorage } from "./storage.ts";
import { mediaUsage, type Use } from "./usage.ts";

const PAGE_SIZE = 48;
const MAX_ALT = 300;
const NOT_FOUND = { error: "Image not found." };
const NOT_AN_IMAGE = "This isn't a usable image. Upload a JPG, PNG or WebP of at most 50 megapixels.";

type Row = typeof media.$inferSelect;

const view = (r: Row, usedIn: Use[]) => ({
  id: r.id, key: r.storageKey, src: `${MEDIA_DIR}${r.storageKey}`, fileName: r.fileName, altText: r.altText, width: r.width, height: r.height, bytes: r.bytes,
  createdAt: r.createdAt, updatedAt: r.updatedAt, usedIn
});

const idOf = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : null);
/** The name as the person knows it: no folders, no control characters. */
const cleanName = (name: string) => name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 200) || "image";

function altProblem(alt: string) {
  if (!alt) return "Describe the image: alt text is required.";
  if (alt.length > MAX_ALT) return `Alt text can be at most ${MAX_ALT} characters.`;
  return hasHiddenChars(alt) ? "Remove the hidden characters." : null;
}

/** Public, because <img> can't send a token. The names can't be guessed, and there's no way to list them. */
export function mediaFileRoutes(storage: MediaStorage) {
  const app = new Hono();
  app.get("/:key", async (c) => {
    const key = c.req.param("key");
    const data = validKey(key) ? await storage.get(key) : null;
    if (!data) return c.json(NOT_FOUND, 404);
    return c.body(new Uint8Array(data), 200, {
      "content-type": "image/webp",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      // With ?v= the address changes on every replace; without it the file must be checked each time.
      "cache-control": c.req.query("v") ? "public, max-age=31536000, immutable" : "no-cache"
    });
  });
  return app;
}

export function mediaRoutes(db: Db, storage: MediaStorage, limit: SaveLimit = { max: 30, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser());
  app.use("*", saveLimit(limit));

  /** The uploaded file, processed, or the response to send instead. */
  async function incoming(c: Context, form: Record<string, unknown>) {
    const file = form.file;
    if (!(file instanceof File)) return { refuse: c.json({ error: "Choose an image.", errors: { file: "Choose an image." } }, 422) };
    if (file.size > MAX_UPLOAD_BYTES) return { refuse: c.json({ error: "The image is too large (10 MB at most)." }, 413) };
    const image = await processImage(new Uint8Array(await file.arrayBuffer()));
    if (!image) return { refuse: c.json({ error: NOT_AN_IMAGE, errors: { file: NOT_AN_IMAGE } }, 422) };
    return { image, fileName: cleanName(file.name) };
  }
  const formOf = (c: Context) => c.req.parseBody().catch(() => ({})) as Promise<Record<string, unknown>>;

  app.get("/", async (c) => {
    const { q = "", page: pageParam } = c.req.query();
    const page = pageParam === undefined ? 1 : /^[1-9]\d{0,6}$/.test(pageParam) ? Number(pageParam) : null;
    if (page === null || q.length > 200) return c.json({ error: "Invalid filter." }, 400);
    const pattern = `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const where = q.trim() ? or(ilike(media.fileName, pattern), ilike(media.altText, pattern)) : undefined;
    const [rows, [total], used] = await Promise.all([
      db.select().from(media).where(where).orderBy(desc(media.createdAt), desc(media.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(media).where(where),
      mediaUsage(db)
    ]);
    return c.json({ items: rows.map((r) => view(r, used.get(r.id) ?? [])), total: total?.n ?? 0, page, pageSize: PAGE_SIZE });
  });

  app.post("/", async (c) => {
    const form = await formOf(c);
    const altText = typeof form.alt === "string" ? form.alt.replace(/\s+/g, " ").trim() : "";
    const problem = altProblem(altText);
    if (problem) return c.json({ error: problem, errors: { alt: problem } }, 422);
    const got = await incoming(c, form);
    if (got.refuse) return got.refuse;

    const user = c.get("user"), storageKey = `${randomBytes(16).toString("hex")}.webp`;
    await storage.put(storageKey, got.image.data);
    const [row] = await db.insert(media).values({
      fileName: got.fileName, storageKey, mime: "image/webp", width: got.image.width, height: got.image.height, bytes: got.image.data.length, altText, createdBy: user.id
    }).returning().catch(async (e) => {
      await storage.remove(storageKey);
      throw e;
    });
    await audit(db, { userId: user.id, action: "media_uploaded", entityType: "media", entityId: row!.id, detail: { title: row!.fileName } });
    return c.json({ media: view(row!, []) }, 201);
  });

  app.patch("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json(NOT_FOUND, 404);
    const body = await c.req.json().catch(() => null);
    const altText = typeof body?.altText === "string" ? body.altText.replace(/\s+/g, " ").trim() : "";
    const problem = altProblem(altText);
    if (problem) return c.json({ error: problem, errors: { altText: problem } }, 422);
    const [row] = await db.update(media).set({ altText, updatedAt: new Date() }).where(eq(media.id, id)).returning();
    if (!row) return c.json(NOT_FOUND, 404);
    await audit(db, { userId: c.get("user").id, action: "media_edited", entityType: "media", entityId: id, detail: { title: row.fileName } });
    return c.json({ media: view(row, (await mediaUsage(db)).get(id) ?? []) });
  });

  // Same key, so every page and guide that uses the image gets the new picture.
  app.post("/:id/replace", async (c) => {
    const id = idOf(c.req.param("id"));
    const [old] = id ? await db.select().from(media).where(eq(media.id, id)) : [];
    if (!old) return c.json(NOT_FOUND, 404);
    const got = await incoming(c, await formOf(c));
    if (got.refuse) return got.refuse;
    await storage.put(old.storageKey, got.image.data);
    const [row] = await db.update(media).set({
      fileName: got.fileName, width: got.image.width, height: got.image.height, bytes: got.image.data.length, updatedAt: new Date()
    }).where(eq(media.id, old.id)).returning();
    if (!row) return c.json(NOT_FOUND, 404);
    await audit(db, { userId: c.get("user").id, action: "media_replaced", entityType: "media", entityId: row.id, detail: { title: row.fileName } });
    return c.json({ media: view(row, (await mediaUsage(db)).get(row.id) ?? []) });
  });

  app.delete("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    const [row] = id ? await db.select().from(media).where(eq(media.id, id)) : [];
    if (!row) return c.json(NOT_FOUND, 404);
    const usedIn = (await mediaUsage(db)).get(row.id) ?? [];
    if (usedIn.length) return c.json({ error: `This image is in use: ${usedIn.map((u) => u.title).join(", ")}. Remove it there first.`, usedIn }, 409);
    await db.delete(media).where(eq(media.id, row.id));
    await storage.remove(row.storageKey);
    await audit(db, { userId: c.get("user").id, action: "media_deleted", entityType: "media", entityId: row.id, detail: { title: row.fileName } });
    return c.body(null, 204);
  });

  return app;
}
