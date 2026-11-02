// Server-side sessions. The cookie holds a random token; the database only holds its SHA-256.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { sessions, users } from "../../db/schema.ts";

export const SESSION_COOKIE = "la_session";
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(db: Db, userId: number, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    csrfToken,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + SESSION_IDLE_MS)
  });
  return { token, csrfToken };
}

/** Returns the session and its user if the token is valid and active; renews the idle timeout. */
export async function readSession(db: Db, token: string | undefined) {
  if (!token) return null;
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status !== "active") return null;
  await db.update(sessions)
    .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_IDLE_MS) })
    .where(eq(sessions.id, row.session.id));
  return row;
}

export const deleteSession = (db: Db, id: number) => db.delete(sessions).where(eq(sessions.id, id));
