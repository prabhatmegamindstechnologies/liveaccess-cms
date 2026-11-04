// Middleware: a signed-in, active user is required; changes also need the session's CSRF token. Someone on a temporary
// password can only change it. requireSuperAdmin goes after requireUser.
import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Db } from "../../db/client.ts";
import type { sessions, users } from "../../db/schema.ts";
import { readSession, SESSION_COOKIE } from "./session.ts";

export type AuthVars = { user: typeof users.$inferSelect; session: typeof sessions.$inferSelect };

export const sameToken = (a: string | undefined, b: string) => {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function requireUser(db: Db, opts: { duringPasswordChange?: boolean } = {}) {
  return createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
    const s = await readSession(db, getCookie(c, SESSION_COOKIE));
    if (!s) return c.json({ error: "Not signed in." }, 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameToken(c.req.header("x-csrf-token"), s.session.csrfToken)) {
      return c.json({ error: "Missing or wrong CSRF token." }, 403);
    }
    if (s.user.mustChangePassword && !opts.duringPasswordChange) {
      return c.json({ error: "Choose a new password first.", passwordChangeRequired: true }, 403);
    }
    c.set("user", s.user);
    c.set("session", s.session);
    await next();
  });
}

export const requireSuperAdmin = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
  if (c.get("user").role !== "super_admin") return c.json({ error: "Only a Super Admin can do this." }, 403);
  await next();
});
