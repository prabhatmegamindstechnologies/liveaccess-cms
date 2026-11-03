// A draft kept in one `settings` row as { value?, version, updatedBy, updatedAt }, saved with a version check.
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { settings, users } from "../db/schema.ts";

export type Meta = { version: number; updatedBy: number | null; updatedAt: string | null };
export type Stored<T> = Meta & { value: T };
export const FRESH: Meta = { version: 1, updatedBy: null, updatedAt: null };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type SaveResult = { ok: true; meta: Meta } | { ok: false; error: string; version?: number };

/**
 * Inside a transaction: locks the row, checks `baseVersion`, then stores the next version (with `value`, unless it
 * is undefined, e.g. when the data lives in its own table). `what` names the thing in the conflict message.
 */
export async function saveVersioned(tx: Tx, key: string, baseVersion: number, userId: number, value: unknown, what = "This"): Promise<SaveResult> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, key)).for("update");
  const current = (row?.value as Meta | undefined) ?? FRESH;
  if (current.version !== baseVersion) {
    const [by] = current.updatedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, current.updatedBy)) : [];
    return { ok: false, error: `${what} was changed by ${by?.name ?? "someone else"} at ${current.updatedAt ?? "just now"}. Reload to see their changes.`, version: current.version };
  }
  const meta: Meta = { version: current.version + 1, updatedBy: userId, updatedAt: new Date().toISOString() };
  const stored = value === undefined ? meta : { ...meta, value };
  // With no row yet there is nothing to lock: a simultaneous first save may insert first. Then this one conflicts.
  const [saved] = row
    ? await tx.update(settings).set({ value: stored }).where(eq(settings.key, key)).returning()
    : await tx.insert(settings).values({ key, value: stored }).onConflictDoNothing().returning();
  if (!saved) return { ok: false, error: `${what} was just changed by someone else. Reload to see their changes.` };
  return { ok: true, meta };
}

/** Display names for the `updatedBy` ids of some stored rows. */
export async function editorNames(db: Db, metas: (Meta | undefined)[]) {
  const ids = [...new Set(metas.map((m) => m?.updatedBy).filter((v): v is number => typeof v === "number"))];
  const rows = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  return new Map(rows.map((u) => [u.id, u.name]));
}
