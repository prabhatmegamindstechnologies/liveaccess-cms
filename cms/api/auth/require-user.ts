// Middleware: a valid access token is required. A browser never adds the Bearer header by itself, so these routes need no
// CSRF token. Someone on a temporary password can only change it. requireSuperAdmin goes after requireUser or requireFreshUser.
import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Db } from "../../db/client.ts";
import type { sessions, users } from "../../db/schema.ts";
import { readSessionById } from "./session.ts";
import { readAccessToken, type TokenUser } from "./token.ts";

export type AuthVars = { user: TokenUser; session: { id: number } };
export type FreshAuthVars = { user: typeof users.$inferSelect; session: typeof sessions.$inferSelect };

export const sameToken = (a: string | undefined, b: string) => {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const fromHeader = (c: Context) => {
  const [scheme, token] = (c.req.header("authorization") ?? "").split(" ");
  return scheme === "Bearer" && token ? readAccessToken(token) : null;
};

const notSignedIn = (c: Context) => c.json({ error: "Not signed in." }, 401);
const changePasswordFirst = (c: Context) => c.json({ error: "Choose a new password first.", passwordChangeRequired: true }, 403);

/** Trusts the token, so a removed or demoted user keeps access until it expires (15 minutes at most). */
export function requireUser() {
  return createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
    const t = await fromHeader(c);
    if (!t) return notSignedIn(c);
    if (t.user.mustChangePassword) return changePasswordFirst(c);
    c.set("user", t.user);
    c.set("session", { id: t.sessionId });
    await next();
  });
}

/** Also checks the database, so an ended session or a changed role counts at once. For the most sensitive routes. */
export function requireFreshUser(db: Db, opts: { duringPasswordChange?: boolean } = {}) {
  return createMiddleware<{ Variables: FreshAuthVars }>(async (c, next) => {
    const t = await fromHeader(c);
    const s = t && await readSessionById(db, t.sessionId);
    if (!s) return notSignedIn(c);
    if (s.user.mustChangePassword && !opts.duringPasswordChange) return changePasswordFirst(c);
    c.set("user", s.user);
    c.set("session", s.session);
    await next();
  });
}

export const requireSuperAdmin = createMiddleware<{ Variables: Pick<AuthVars, "user"> }>(async (c, next) => {
  if (c.get("user").role !== "super_admin") return c.json({ error: "Only a Super Admin can do this." }, 403);
  await next();
});
