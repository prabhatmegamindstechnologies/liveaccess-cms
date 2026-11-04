// /<ADMIN_PATH>/api/users — Super Admins add, edit, disable, unlock and reset users. There's no delete: people stay
// on past edits and in the audit log. Passwords made here are temporary and shown once; only their hash is stored.
import { Hono } from "hono";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { sessions, users } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { clientIp } from "../client-ip.ts";
import { assertPasswordRules, hashPassword, temporaryPassword, verifyPassword } from "../auth/password.ts";
import { requireSuperAdmin, requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";
import type { Context } from "hono";

type Row = typeof users.$inferSelect;
type Errors = Record<string, string>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const TEMP_PASSWORD_MS = 72 * 60 * 60 * 1000;
const OWN_PASSWORD_TRIES = 5, OWN_PASSWORD_WINDOW_MS = 60_000;
const ROLES = new Set(["super_admin", "editor"]);
const STATUSES = new Set(["active", "disabled"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Control characters and invisible text direction marks have no place in a name shown across the admin.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;

const view = (u: Row) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, mustChangePassword: u.mustChangePassword,
  temporaryExpired: !!u.tempPasswordExpiresAt && u.tempPasswordExpiresAt <= new Date(),
  locked: !!u.lockedUntil && u.lockedUntil > new Date(), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt
});
const idOf = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : null);
const unlocked = { failedLogins: 0, lockedUntil: null };
const emailTaken = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return (err?.code ?? err?.cause?.code) === "23505";
};
const taken = { error: "Some fields need fixing.", errors: { email: "Another user already has this email address." } };

/**
 * Locks every Super Admin row and gives back the active ones, or null if the caller stopped being one. Every change here
 * starts with this, always in the same order: two admins acting on each other then run one after the other (the second
 * sees what the first did), and they can't deadlock.
 */
async function lockAdmins(tx: Tx, me: number) {
  const admins = (await tx.select().from(users).where(eq(users.role, "super_admin")).orderBy(asc(users.id)).for("update"))
    .filter((u) => u.status === "active");
  return admins.some((u) => u.id === me) ? admins : null;
}
const notAdmin = { error: "Only a Super Admin can do this." };
const retry = { error: "This user was just changed by someone else. Try again." };

/** A password typed by the Super Admin, or a generated one. Either way it's temporary. */
async function newPassword(input: unknown) {
  const typed = (input as { password?: unknown } | null)?.password;
  if (typed === undefined) {
    const password = temporaryPassword();
    return { password, source: "generated", passwordHash: await hashPassword(password) };
  }
  try {
    if (typeof typed !== "string") throw new Error("Enter a password.");
    assertPasswordRules(typed);
  } catch (e) {
    return { error: (e as Error).message };
  }
  // The screen fills in a generated password and says whether it was changed.
  const source = (input as { passwordSource?: unknown }).passwordSource === "generated" ? "generated" : "typed";
  return { password: typed, source, passwordHash: await hashPassword(typed) };
}
/** Gives someone Super Admin access, or changes the access of someone who has it: promoting, demoting, disabling, enabling. */
const touchesSuperAdmin = (row: Pick<Row, "role" | "status">, out: { role?: Row["role"]; status?: Row["status"] }) => {
  const role = out.role ?? row.role, status = out.status ?? row.status;
  return (role === "super_admin" || row.role === "super_admin") && (role !== row.role || status !== row.status);
};
const temporary = (passwordHash: string) => ({ passwordHash, mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_MS) });

/** Checks the fields that were sent. On a new user all of them are needed. */
function parse(input: unknown, isNew: boolean) {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const errors: Errors = {};
  const out: { name?: string; email?: string; role?: Row["role"]; status?: Row["status"] } = {};

  if (isNew || o.name !== undefined) {
    const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
    if (!name || name.length > 80 || HIDDEN.test(name)) errors.name = "Enter a name of up to 80 characters.";
    out.name = name;
  }
  if (isNew || o.email !== undefined) {
    const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
    if (email.length > 254 || !EMAIL.test(email) || HIDDEN.test(email)) errors.email = "Enter one email address, like name@tps.ltd.";
    out.email = email;
  }
  if (isNew || o.role !== undefined) {
    if (typeof o.role === "string" && ROLES.has(o.role)) out.role = o.role as Row["role"];
    else errors.role = "Choose Super Admin or Editor.";
  }
  if (!isNew && o.status !== undefined) {
    if (typeof o.status === "string" && STATUSES.has(o.status)) out.status = o.status as Row["status"];
    else errors.status = "Choose active or disabled.";
  }
  return { out, errors };
}

export function userRoutes(db: Db, trustProxy = false, limit: SaveLimit = { max: 30, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser(db));
  app.use("*", requireSuperAdmin);
  app.use("*", saveLimit(limit));

  const failures = new Map<number, number[]>();
  /**
   * Changes that give someone Super Admin access need the caller's own password, so a stolen session alone can't create
   * lasting access. Answers with the response to send when that fails, or null when it's fine.
   */
  async function refuseOwnPassword(c: Context<{ Variables: AuthVars }>, input: unknown) {
    const given = (input as { currentPassword?: unknown } | null)?.currentPassword;
    if (given === undefined) {
      const msg = "Enter your own password to confirm this.";
      return c.json({ error: msg, errors: { currentPassword: msg } }, 422);
    }
    const me = c.get("user"), now = Date.now();
    const tries = (failures.get(me.id) ?? []).filter((t) => now - t < OWN_PASSWORD_WINDOW_MS);
    if (tries.length >= OWN_PASSWORD_TRIES) return c.json({ error: "Too many wrong passwords. Wait a minute and try again." }, 429);
    // Counted before the slow check, so guesses sent at the same moment can't all see an empty count.
    tries.push(now);
    failures.set(me.id, tries);
    if (typeof given === "string" && given.length <= 1024 && await verifyPassword(me.passwordHash, given)) {
      tries.splice(tries.indexOf(now), 1);
      return null;
    }
    await audit(db, { userId: me.id, action: "own_password_failed", entityType: "user", entityId: me.id, ip: clientIp(c, trustProxy) });
    // Whoever is guessing has to sign in again, which a stolen session can't do.
    if (tries.length >= OWN_PASSWORD_TRIES) await db.delete(sessions).where(eq(sessions.id, c.get("session").id));
    const msg = "Your password is wrong.";
    return c.json({ error: msg, errors: { currentPassword: msg } }, 422);
  }

  app.get("/", async (c) => {
    const rows = await db.select().from(users).orderBy(asc(users.name), asc(users.id));
    return c.json({ users: rows.map(view), me: c.get("user").id });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const { out, errors } = parse(body, true);
    const chosen = await newPassword(body);
    if ("error" in chosen) errors.password = chosen.error!;
    if (Object.keys(errors).length) return c.json({ error: "Some fields need fixing.", errors }, 422);
    if (out.role === "super_admin") {
      const refused = await refuseOwnPassword(c, body);
      if (refused) return refused;
    }
    const { password, source, passwordHash } = chosen as { password: string; source: string; passwordHash: string };
    const me = c.get("user").id;
    try {
      return await db.transaction(async (tx) => {
        if (!(await lockAdmins(tx, me))) return c.json(notAdmin, 403);
        const [row] = await tx.insert(users).values({ name: out.name!, email: out.email!, role: out.role!, ...temporary(passwordHash) }).returning();
        await audit(tx as unknown as Db, { userId: me, action: "user_created", entityType: "user", entityId: row!.id, detail: { role: row!.role, passwordSource: source }, ip: clientIp(c, trustProxy) });
        return c.json({ user: view(row!), temporaryPassword: password }, 201);
      });
    } catch (e) {
      if (emailTaken(e)) return c.json(taken, 422);
      throw e;
    }
  });

  app.patch("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "User not found." }, 404);
    const body = await c.req.json().catch(() => null);
    const { out, errors } = parse(body, false);
    if (Object.keys(errors).length) return c.json({ error: "Some fields need fixing.", errors }, 422);
    if (!Object.keys(out).length) return c.json({ error: "Nothing to change." }, 400);
    const me = c.get("user").id;

    // Checked before the locks: argon2 is slow. The transaction makes sure the answer still applies.
    const [before] = await db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, id));
    if (!before) return c.json({ error: "User not found." }, 404);
    // Your own account is refused below anyway, with a clearer message.
    const confirmed = id !== me && touchesSuperAdmin(before, out);
    if (confirmed) {
      const refused = await refuseOwnPassword(c, body);
      if (refused) return refused;
    }

    try {
      return await db.transaction(async (tx) => {
        const admins = await lockAdmins(tx, me);
        if (!admins) return c.json(notAdmin, 403);
        const [row] = await tx.select().from(users).where(eq(users.id, id)).for("update");
        if (!row) return c.json({ error: "User not found." }, 404);

        const role = out.role ?? row.role, status = out.status ?? row.status;
        const removing = row.role === "super_admin" && row.status === "active" && (role !== "super_admin" || status !== "active");
        if (removing && id === me) return c.json({ error: "You can't disable your own account or change your own role. Ask another Super Admin." }, 409);
        if (removing && admins.length < 2) return c.json({ error: "There must always be at least one active Super Admin." }, 409);
        if (touchesSuperAdmin(row, out) && !confirmed) return c.json(retry, 409);

        const enabled = row.status === "disabled" && status === "active";
        const [saved] = await tx.update(users).set({ ...out, ...(enabled ? unlocked : {}) }).where(eq(users.id, id)).returning();
        // What the old sessions were allowed to do no longer applies. A new email can mean a new person on the account;
        // someone changing their own email stays signed in here.
        const email = out.email ?? row.email;
        if (role !== row.role || status === "disabled" || email !== row.email) {
          await tx.delete(sessions).where(and(eq(sessions.userId, id), id === me ? ne(sessions.id, c.get("session").id) : undefined));
        }
        await audit(tx as unknown as Db, {
          userId: me, action: "user_edited", entityType: "user", entityId: id, ip: clientIp(c, trustProxy),
          detail: {
            fields: Object.keys(out), ...(role !== row.role ? { role } : {}), ...(status !== row.status ? { status } : {}),
            ...(email !== row.email ? { email: { from: row.email, to: email } } : {}),
            ...(out.name !== undefined && out.name !== row.name ? { name: { from: row.name, to: out.name } } : {})
          }
        });
        return c.json({ user: view(saved!) });
      });
    } catch (e) {
      if (emailTaken(e)) return c.json(taken, 422);
      throw e;
    }
  });

  app.post("/:id/reset-password", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "User not found." }, 404);
    const me = c.get("user").id;
    if (id === me) return c.json({ error: "Use Change password for your own account." }, 409);
    const body = await c.req.json().catch(() => null);
    const chosen = await newPassword(body);
    if ("error" in chosen) return c.json({ error: chosen.error, errors: { password: chosen.error } }, 422);
    const { password, source, passwordHash } = chosen as { password: string; source: string; passwordHash: string };

    const [before] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
    if (!before) return c.json({ error: "User not found." }, 404);
    const confirmed = before.role === "super_admin";
    if (confirmed) {
      const refused = await refuseOwnPassword(c, body);
      if (refused) return refused;
    }

    return db.transaction(async (tx) => {
      if (!(await lockAdmins(tx, me))) return c.json(notAdmin, 403);
      const [row] = await tx.select().from(users).where(eq(users.id, id)).for("update");
      if (!row) return c.json({ error: "User not found." }, 404);
      if (row.role === "super_admin" && !confirmed) return c.json(retry, 409);
      const [saved] = await tx.update(users).set({ ...temporary(passwordHash), ...unlocked }).where(eq(users.id, id)).returning();
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await audit(tx as unknown as Db, { userId: me, action: "user_password_reset", entityType: "user", entityId: id, detail: { passwordSource: source }, ip: clientIp(c, trustProxy) });
      return c.json({ user: view(saved!), temporaryPassword: password });
    });
  });

  app.post("/:id/unlock", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "User not found." }, 404);
    const me = c.get("user").id;
    return db.transaction(async (tx) => {
      if (!(await lockAdmins(tx, me))) return c.json(notAdmin, 403);
      const [saved] = await tx.update(users).set(unlocked).where(eq(users.id, id)).returning();
      if (!saved) return c.json({ error: "User not found." }, 404);
      await audit(tx as unknown as Db, { userId: me, action: "user_unlocked", entityType: "user", entityId: id, ip: clientIp(c, trustProxy) });
      return c.json({ user: view(saved) });
    });
  });

  return app;
}
