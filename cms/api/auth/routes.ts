// Sign-in, current user and sign-out, mounted at /<ADMIN_PATH>/api/auth.
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { sessions, users } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { clientIp } from "../client-ip.ts";
import { saveLimit } from "../save-limit.ts";
import { requireUser, sameToken } from "./require-user.ts";
import { assertPasswordRules, dummyPasswordHash, hashPassword, verifyPassword } from "./password.ts";
import { createSession, deleteSession, readSession, SESSION_COOKIE, SESSION_IDLE_MS } from "./session.ts";

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const WRONG = { error: "Email or password is wrong." };

export type AuthConfig = { db: Db; adminPath: string; secureCookies: boolean; trustProxy?: boolean };

export const publicUser = (u: typeof users.$inferSelect) => ({ id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: u.mustChangePassword });

// Audit entries for unknown emails keep only a short hash: people sometimes type their password into the email box.
const emailFingerprint = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 16);

export function authRoutes({ db, adminPath, secureCookies, trustProxy = false }: AuthConfig) {
  const app = new Hono();
  const cookieOpts = { httpOnly: true, secure: secureCookies, sameSite: "Strict" as const, path: `/${adminPath}` };

  app.post("/login", async (c) => {
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) return c.json({ error: "Send JSON." }, 415);
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password || email.length > 254 || password.length > 1024) return c.json({ error: "Enter your email and password." }, 400);
    const ip = clientIp(c, trustProxy);

    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    // Always run exactly one argon2 check, so unknown, locked and disabled accounts take as long as a wrong password.
    const passwordOk = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), password);

    if (!user) {
      await audit(db, { action: "login_failed", entityType: "user", detail: { emailHash: emailFingerprint(email) }, ip });
      return c.json(WRONG, 401);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await audit(db, { userId: user.id, action: "login_locked", entityType: "user", entityId: user.id, ip });
      return c.json(WRONG, 401);
    }
    // An expired temporary password looks like any wrong password, so nothing is revealed.
    const expired = !!user.tempPasswordExpiresAt && user.tempPasswordExpiresAt <= new Date();
    if (!passwordOk || expired || user.status !== "active") {
      // Atomic increment, so parallel guesses can't all read the same count and skip the lockout.
      const [row] = await db.update(users)
        .set({ failedLogins: sql`${users.failedLogins} + 1` })
        .where(eq(users.id, user.id))
        .returning({ failed: users.failedLogins });
      let locked = false;
      if ((row?.failed ?? 0) >= MAX_FAILED) {
        const done = await db.update(users)
          .set({ failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) })
          .where(and(eq(users.id, user.id), gte(users.failedLogins, MAX_FAILED)))
          .returning({ id: users.id });
        locked = done.length > 0;
      }
      await audit(db, {
        userId: user.id, action: locked ? "login_locked" : "login_failed", entityType: "user", entityId: user.id, ip,
        ...(passwordOk && expired ? { detail: { reason: "Temporary password expired" } } : {})
      });
      return c.json(WRONG, 401);
    }

    await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const { token, csrfToken } = await createSession(db, user.id, { ip, userAgent: c.req.header("user-agent") });
    setCookie(c, SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_IDLE_MS / 1000 });
    await audit(db, { userId: user.id, action: "login", entityType: "user", entityId: user.id, ip });
    return c.json({ user: publicUser(user), csrfToken });
  });

  app.get("/me", async (c) => {
    const s = await readSession(db, getCookie(c, SESSION_COOKIE));
    if (!s) return c.json({ error: "Not signed in." }, 401);
    return c.json({ user: publicUser(s.user), csrfToken: s.session.csrfToken });
  });

  // A stolen session can't be used to guess the current password for long.
  app.post("/change-password", requireUser(db, { duringPasswordChange: true }), saveLimit({ max: 5, windowMs: 60_000 }), async (c) => {
    const body = await c.req.json().catch(() => null);
    const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body?.newPassword === "string" ? body.newPassword : "";
    const user = c.get("user"), ip = clientIp(c, trustProxy);
    const refuse = (field: string, msg: string) => c.json({ error: msg, errors: { [field]: msg } }, 422);

    if (current.length > 1024 || !(await verifyPassword(user.passwordHash, current))) {
      await audit(db, { userId: user.id, action: "password_change_failed", entityType: "user", entityId: user.id, ip });
      return refuse("currentPassword", "Your current password is wrong.");
    }
    try {
      assertPasswordRules(next);
    } catch (e) {
      return refuse("newPassword", (e as Error).message);
    }
    if (next === current) return refuse("newPassword", "Choose a password different from your current one.");

    const passwordHash = await hashPassword(next);
    const saved = await db.transaction(async (tx) => {
      // Only if the password is still the one checked above: a reset by a Super Admin in the meantime must win.
      const [row] = await tx.update(users).set({ passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null })
        .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash))).returning();
      if (!row) return null;
      // Anyone else signed in with the old password is out.
      await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, c.get("session").id)));
      await audit(tx as unknown as Db, { userId: user.id, action: "password_changed", entityType: "user", entityId: user.id, ip });
      return row;
    });
    if (!saved) return c.json({ error: "Your password was changed by someone else just now. Sign in again." }, 409);
    return c.json({ user: publicUser(saved) });
  });

  app.post("/logout", async (c) => {
    const s = await readSession(db, getCookie(c, SESSION_COOKIE));
    if (!s) return c.json({ error: "Not signed in." }, 401);
    if (!sameToken(c.req.header("x-csrf-token"), s.session.csrfToken)) return c.json({ error: "Missing or wrong CSRF token." }, 403);
    await deleteSession(db, s.session.id);
    deleteCookie(c, SESSION_COOKIE, cookieOpts);
    await audit(db, { userId: s.user.id, action: "logout", entityType: "user", entityId: s.user.id, ip: clientIp(c, trustProxy) });
    return c.body(null, 204);
  });

  return app;
}
