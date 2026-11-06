// Server-side sessions, which back the refresh cookie. The cookie holds a random token; the database only holds its SHA-256.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { sessions, users } from "../../db/schema.ts";

export const REFRESH_COOKIE = "la_refresh";
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
// Use renews the idle limit, so a stolen session could otherwise last for ever.
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(db: Db, userId: number, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const [row] = await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    csrfToken,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + SESSION_IDLE_MS)
  }).returning({ id: sessions.id });
  return { id: row!.id, token, csrfToken };
}

async function activeSession(db: Db, match: SQL) {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(match, gt(sessions.expiresAt, new Date()), gt(sessions.createdAt, new Date(Date.now() - SESSION_MAX_MS))))
    .limit(1);
  const row = rows[0];
  return row && row.user.status === "active" ? row : null;
}

/** Returns the session and its user if the refresh token is valid and active; renews the idle timeout. */
export async function readSession(db: Db, token: string | undefined) {
  if (!token) return null;
  const row = await activeSession(db, eq(sessions.tokenHash, sha256(token)));
  if (!row) return null;
  await db.update(sessions)
    .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_IDLE_MS) })
    .where(eq(sessions.id, row.session.id));
  return row;
}

/** The same checks for the session inside an access token. Only a refresh counts as use, so this renews nothing. */
export const readSessionById = (db: Db, id: number) => activeSession(db, eq(sessions.id, id));

export const deleteSession = (db: Db, id: number) => db.delete(sessions).where(eq(sessions.id, id));
