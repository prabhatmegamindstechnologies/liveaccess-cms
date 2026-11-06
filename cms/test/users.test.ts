import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../api/app.ts";
import { auditLog, sessions, users } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
const api = "http://local/la-studio/api";
const shared = () => createApp({ db, adminPath: "la-studio", secureCookies: true });
let app: ReturnType<typeof shared>;

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  app = shared();
});

const json = { "content-type": "application/json" };
const own = "correct-horse-battery";

async function login(email: string, password: string) {
  const res = await app.request(`${api}/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const body = await res.json();
  let authorization = `Bearer ${body.accessToken}`;
  const call = (method: string, path: string, data?: unknown) =>
    app.request(`${api}${path}`, { method, headers: { authorization, ...json }, body: data === undefined ? undefined : JSON.stringify(data) });
  const refresh = () => app.request(`${api}/auth/refresh`, { method: "POST", headers: { cookie } });
  const useToken = (token: string) => { authorization = `Bearer ${token}`; };
  return { res, body, call, refresh, useToken, id: body.user?.id as number };
}
async function signIn(email = "admin@example.com", role: "super_admin" | "editor" = "super_admin") {
  const { password } = await makeUser(db, { email, role });
  return login(email, password);
}
const addEditor = async (a: Awaited<ReturnType<typeof signIn>>, email = "new@example.com") => {
  const res = await a.call("POST", "/users", { name: "New Person", email, role: "editor" });
  return { res, body: await res.json() };
};
const sessionsOf = async (id: number) => (await db.select().from(sessions).where(eq(sessions.userId, id))).length;

describe("who can use the users API", () => {
  it("needs a signed-in Super Admin on every route", async () => {
    expect((await app.request(`${api}/users`)).status).toBe(401);
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    const routes: [string, string, unknown?][] = [
      ["GET", "/users"], ["POST", "/users", { name: "X", email: "x@example.com", role: "editor" }], ["PATCH", `/users/${admin.id}`, { name: "X" }],
      ["POST", `/users/${admin.id}/reset-password`], ["POST", `/users/${admin.id}/unlock`]
    ];
    for (const [method, path, data] of routes) expect((await editor.call(method, path, data)).status, `${method} ${path}`).toBe(403);
    expect(await db.select().from(users).where(eq(users.email, "x@example.com"))).toEqual([]);
  });

});

describe("GET /users", () => {
  it("lists users without any password data", async () => {
    const admin = await signIn();
    const res = await admin.call("GET", "/users");
    const { users: list, me } = await res.json();
    expect(me).toBe(admin.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: "admin@example.com", role: "super_admin", status: "active", locked: false, mustChangePassword: false });
    expect(list[0].lastLoginAt).toBeTruthy();
    expect(JSON.stringify(list)).not.toMatch(/hash|argon/i);
  });

  it("shows a locked account", async () => {
    const admin = await signIn();
    const { body } = await addEditor(admin);
    await db.update(users).set({ lockedUntil: new Date(Date.now() + 60_000) }).where(eq(users.id, body.user.id));
    const { users: list } = await (await admin.call("GET", "/users")).json();
    expect(list.find((u: { id: number }) => u.id === body.user.id).locked).toBe(true);
  });
});

describe("POST /users", () => {
  it("creates a user with a temporary password that is shown once and stored only as a hash", async () => {
    const admin = await signIn();
    const { res, body } = await addEditor(admin, "New@Example.com");
    expect(res.status).toBe(201);
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(body.user).toMatchObject({ email: "new@example.com", role: "editor", status: "active", mustChangePassword: true });
    const [row] = await db.select().from(users).where(eq(users.id, body.user.id));
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row!.passwordHash).not.toContain(body.temporaryPassword);
    expect(JSON.stringify(await (await admin.call("GET", "/users")).json())).not.toContain(body.temporaryPassword);
    expect(JSON.stringify(await db.select().from(auditLog))).not.toContain(body.temporaryPassword);
  });

  it("gives different passwords", async () => {
    const admin = await signIn();
    const a = await addEditor(admin, "a@example.com"), b = await addEditor(admin, "b@example.com");
    expect(a.body.temporaryPassword).not.toBe(b.body.temporaryPassword);
  });

  it("refuses bad input field by field", async () => {
    const admin = await signIn();
    const res = await admin.call("POST", "/users", { name: " ", email: "not-an-email", role: "owner" });
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).errors).sort()).toEqual(["email", "name", "role"]);
  });

  it("refuses an email already in use, whatever its case", async () => {
    const admin = await signIn();
    await addEditor(admin);
    const { res, body } = await addEditor(admin, "NEW@example.com");
    expect(res.status).toBe(422);
    expect(body.errors.email).toBeTruthy();
  });

  it("logs who added whom", async () => {
    const admin = await signIn();
    const { body } = await addEditor(admin);
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "user_created"));
    expect(log).toMatchObject({ userId: admin.id, entityId: String(body.user.id) });
  });
});

describe("the first sign-in with a temporary password", () => {
  it("can do nothing but change the password, then works as usual", async () => {
    const admin = await signIn();
    const { body } = await addEditor(admin);
    const user = await login("new@example.com", body.temporaryPassword);
    expect(user.res.status).toBe(200);
    expect(user.body.user.mustChangePassword).toBe(true);

    const blocked = await user.call("GET", "/pages");
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).passwordChangeRequired).toBe(true);
    expect((await user.refresh()).status).toBe(200);

    const changed = await user.call("POST", "/auth/change-password", { currentPassword: body.temporaryPassword, newPassword: "my-own-long-password" });
    expect(changed.status).toBe(200);
    const signedIn = await changed.json();
    expect(signedIn.user.mustChangePassword).toBe(false);
    user.useToken(signedIn.accessToken);
    expect((await user.call("GET", "/pages")).status).toBe(200);
    expect((await login("new@example.com", body.temporaryPassword)).res.status).toBe(401);
    expect((await login("new@example.com", "my-own-long-password")).res.status).toBe(200);
  });
});

describe("POST /auth/change-password", () => {
  const next = "another-long-password";

  it("needs the right current password", async () => {
    const admin = await signIn();
    const res = await admin.call("POST", "/auth/change-password", { currentPassword: "wrong", newPassword: next });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.currentPassword).toBeTruthy();
  });

  it("refuses a short, an overlong or an unchanged password", async () => {
    const admin = await signIn();
    for (const newPassword of ["short", "x".repeat(1025), "correct-horse-battery"]) {
      const res = await admin.call("POST", "/auth/change-password", { currentPassword: "correct-horse-battery", newPassword });
      expect(res.status, newPassword.slice(0, 8)).toBe(422);
      expect((await res.json()).errors.newPassword).toBeTruthy();
    }
  });

  it("limits guesses", async () => {
    const admin = await signIn();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await admin.call("POST", "/auth/change-password", { currentPassword: "wrong", newPassword: next })).status);
    expect(statuses.at(-1)).toBe(429);
  });

  it("ends the user's other sessions and keeps this one", async () => {
    const admin = await signIn();
    const other = await login("admin@example.com", "correct-horse-battery");
    await admin.call("POST", "/auth/change-password", { currentPassword: "correct-horse-battery", newPassword: next });
    expect((await admin.refresh()).status).toBe(200);
    expect((await other.refresh()).status).toBe(401);
  });

  it("is logged without the passwords", async () => {
    const admin = await signIn();
    await admin.call("POST", "/auth/change-password", { currentPassword: "correct-horse-battery", newPassword: next });
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "password_changed"));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(next);
  });
});

describe("PATCH /users/:id", () => {
  it("changes the name, email and role", async () => {
    const admin = await signIn();
    const { body } = await addEditor(admin);
    const res = await admin.call("PATCH", `/users/${body.user.id}`, { name: "Renamed", email: "renamed@example.com", role: "super_admin", currentPassword: own });
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ name: "Renamed", email: "renamed@example.com", role: "super_admin" });
  });

  it("refuses an email another user has", async () => {
    const admin = await signIn();
    const { body } = await addEditor(admin);
    const res = await admin.call("PATCH", `/users/${body.user.id}`, { email: "ADMIN@example.com" });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.email).toBeTruthy();
  });

  it("answers 404 for an unknown user or a bad id", async () => {
    const admin = await signIn();
    expect((await admin.call("PATCH", "/users/99999", { name: "X" })).status).toBe(404);
    expect((await admin.call("PATCH", "/users/abc", { name: "X" })).status).toBe(404);
  });

  it("ends a disabled user's session at once, and they can't sign in until enabled", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    expect((await admin.call("PATCH", `/users/${editor.id}`, { status: "disabled" })).status).toBe(200);
    expect(await sessionsOf(editor.id)).toBe(0);
    expect((await editor.refresh()).status).toBe(401);
    expect((await login("editor@example.com", "correct-horse-battery")).res.status).toBe(401);
    expect((await admin.call("PATCH", `/users/${editor.id}`, { status: "active" })).status).toBe(200);
    expect((await login("editor@example.com", "correct-horse-battery")).res.status).toBe(200);
  });

  it("signs a user out when their role changes, but not when only the name does", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    await admin.call("PATCH", `/users/${editor.id}`, { name: "Renamed" });
    expect(await sessionsOf(editor.id)).toBe(1);
    await admin.call("PATCH", `/users/${editor.id}`, { role: "super_admin", currentPassword: own });
    expect(await sessionsOf(editor.id)).toBe(0);
  });

  it("signs a user out when their email changes, logs both addresses, and keeps your own session on your own change", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    await admin.call("PATCH", `/users/${editor.id}`, { email: "someone-else@example.com" });
    expect(await sessionsOf(editor.id)).toBe(0);
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "user_edited"));
    expect(log!.detail).toMatchObject({ email: { from: "editor@example.com", to: "someone-else@example.com" } });
    expect((await admin.call("PATCH", `/users/${admin.id}`, { email: "new-me@example.com" })).status).toBe(200);
    expect((await admin.call("GET", "/users")).status).toBe(200);
  });

  it("keeps the old name in the log, so a rename can't rewrite who did what", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    await admin.call("PATCH", `/users/${editor.id}`, { name: "Asha Rao" });
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "user_edited"));
    expect(log!.detail).toMatchObject({ name: { from: "Test User", to: "Asha Rao" } });
  });

  it("doesn't deadlock when a reset and an edit of the same user run together", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    const editor = await signIn("editor@example.com", "editor");
    for (let i = 0; i < 4; i++) {
      const results = await Promise.all([
        a.call("POST", `/users/${editor.id}/reset-password`), b.call("PATCH", `/users/${editor.id}`, { name: `Name ${i}` }),
        b.call("POST", `/users/${editor.id}/unlock`), a.call("PATCH", `/users/${editor.id}`, { name: `Other ${i}` })
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    }
  });

  it("won't let you disable or demote yourself, but you can rename yourself", async () => {
    const admin = await signIn();
    const other = await signIn("second@example.com");
    for (const change of [{ status: "disabled" }, { role: "editor" }]) expect((await other.call("PATCH", `/users/${other.id}`, change)).status).toBe(409);
    expect((await admin.call("PATCH", `/users/${admin.id}`, { name: "Me" })).status).toBe(200);
  });

  it("always keeps one active Super Admin, even when two remove each other at once", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    const results = await Promise.all([a.call("PATCH", `/users/${b.id}`, { role: "editor", currentPassword: own }), b.call("PATCH", `/users/${a.id}`, { status: "disabled", currentPassword: own })]);
    expect(results.map((r) => r.status).sort()).toContain(200);
    const left = (await db.select().from(users)).filter((u) => u.role === "super_admin" && u.status === "active");
    expect(left).toHaveLength(1);
  });

  it("doesn't count a disabled Super Admin as the one that's left", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    const c = await signIn("c@example.com");
    await a.call("PATCH", `/users/${c.id}`, { status: "disabled", currentPassword: own });
    expect((await a.call("PATCH", `/users/${b.id}`, { role: "editor", currentPassword: own })).status).toBe(200);
    const only = (await db.select().from(users)).filter((u) => u.role === "super_admin" && u.status === "active");
    expect(only.map((u) => u.id)).toEqual([a.id]);
  });
});

describe("reset password and unlock", () => {
  it("gives a new temporary password, unlocks the account and signs the user out", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    await db.update(users).set({ lockedUntil: new Date(Date.now() + 60_000), failedLogins: 3 }).where(eq(users.id, editor.id));
    const res = await admin.call("POST", `/users/${editor.id}/reset-password`);
    expect(res.status).toBe(200);
    const { temporaryPassword, user } = await res.json();
    expect(user).toMatchObject({ mustChangePassword: true, locked: false });
    expect(await sessionsOf(editor.id)).toBe(0);
    expect((await login("editor@example.com", "correct-horse-battery")).res.status).toBe(401);
    const again = await login("editor@example.com", temporaryPassword);
    expect(again.res.status).toBe(200);
    expect(again.body.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(await db.select().from(auditLog))).not.toContain(temporaryPassword);
  });

  it("won't reset your own password here", async () => {
    const admin = await signIn();
    expect((await admin.call("POST", `/users/${admin.id}/reset-password`)).status).toBe(409);
  });

  it("unlocks an account and keeps its password", async () => {
    const admin = await signIn();
    const { password } = await makeUser(db, { email: "locked@example.com", role: "editor" });
    const [row] = await db.update(users).set({ lockedUntil: new Date(Date.now() + 60_000), failedLogins: 4 }).where(eq(users.email, "locked@example.com")).returning();
    expect((await admin.call("POST", `/users/${row!.id}/unlock`)).status).toBe(200);
    expect((await login("locked@example.com", password)).res.status).toBe(200);
  });
});

describe("your own password for changes to Super Admins", () => {
  const add = { name: "Boss", email: "boss@example.com", role: "super_admin" };

  it("is needed to add a Super Admin, and not an Editor", async () => {
    const admin = await signIn();
    const res = await admin.call("POST", "/users", add);
    expect(res.status).toBe(422);
    expect((await res.json()).errors.currentPassword).toBeTruthy();
    expect((await admin.call("POST", "/users", { ...add, currentPassword: "wrong" })).status).toBe(422);
    expect(await db.select().from(users).where(eq(users.email, "boss@example.com"))).toEqual([]);
    expect((await admin.call("POST", "/users", { ...add, currentPassword: own })).status).toBe(201);
    expect((await addEditor(admin)).res.status).toBe(201);
  });

  it("is needed to promote someone, and not for other edits", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    expect((await admin.call("PATCH", `/users/${editor.id}`, { role: "super_admin" })).status).toBe(422);
    const [row] = await db.select().from(users).where(eq(users.id, editor.id));
    expect(row!.role).toBe("editor");
    expect((await admin.call("PATCH", `/users/${editor.id}`, { name: "Renamed" })).status).toBe(200);
    expect((await admin.call("PATCH", `/users/${editor.id}`, { role: "super_admin", currentPassword: own })).status).toBe(200);
  });

  it("is needed to reset a Super Admin, and not an Editor", async () => {
    const admin = await signIn();
    const other = await signIn("second@example.com");
    const editor = await signIn("editor@example.com", "editor");
    expect((await admin.call("POST", `/users/${other.id}/reset-password`, {})).status).toBe(422);
    expect((await login("second@example.com", own)).res.status).toBe(200);
    expect((await admin.call("POST", `/users/${other.id}/reset-password`, { currentPassword: own })).status).toBe(200);
    expect((await admin.call("POST", `/users/${editor.id}/reset-password`, {})).status).toBe(200);
  });

  it("isn't fooled by guesses sent at the same moment", async () => {
    const admin = await signIn();
    const results = await Promise.all(Array.from({ length: 12 }, () => admin.call("POST", "/users", { ...add, currentPassword: "wrong" })));
    expect(results.filter((r) => r.status === 422)).toHaveLength(5);
    expect(results.filter((r) => r.status !== 422).every((r) => r.status === 429 || r.status === 401)).toBe(true);
  });

  it("is needed to disable, enable or demote a Super Admin, and not an Editor", async () => {
    const admin = await signIn();
    const other = await signIn("second@example.com");
    const editor = await signIn("editor@example.com", "editor");
    for (const change of [{ status: "disabled" }, { role: "editor" }]) expect((await admin.call("PATCH", `/users/${other.id}`, change)).status).toBe(422);
    expect((await admin.call("PATCH", `/users/${other.id}`, { status: "disabled", currentPassword: own })).status).toBe(200);
    expect((await admin.call("PATCH", `/users/${other.id}`, { status: "active" })).status).toBe(422);
    expect((await admin.call("PATCH", `/users/${other.id}`, { status: "active", currentPassword: own })).status).toBe(200);
    expect((await admin.call("PATCH", `/users/${editor.id}`, { status: "disabled" })).status).toBe(200);
  });

  it("limits guesses, ends the session, and logs them", async () => {
    const admin = await signIn();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await admin.call("POST", "/users", { ...add, currentPassword: "wrong" })).status);
    expect(statuses).toEqual([422, 422, 422, 422, 422, 401]);
    expect((await admin.call("POST", "/users", { ...add, currentPassword: own })).status).toBe(401);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "own_password_failed"))).toHaveLength(5);
  });
});

describe("editable temporary passwords", () => {
  const typed = "typed-by-the-admin";

  it("uses a password typed when adding a user, still temporary", async () => {
    const admin = await signIn();
    const res = await admin.call("POST", "/users", { name: "T", email: "t@example.com", role: "editor", password: typed });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.temporaryPassword).toBe(typed);
    expect(body.user.mustChangePassword).toBe(true);
    const user = await login("t@example.com", typed);
    expect(user.body.user.mustChangePassword).toBe(true);
    expect((await user.call("GET", "/pages")).status).toBe(403);
  });

  it("uses a password typed on reset", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    expect((await admin.call("POST", `/users/${editor.id}/reset-password`, { password: typed })).status).toBe(200);
    expect((await login("editor@example.com", typed)).res.status).toBe(200);
  });

  it("refuses a password that's too short or too long", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    for (const password of ["short", "x".repeat(1025), 12345678901234]) {
      const a = await admin.call("POST", "/users", { name: "T", email: "t@example.com", role: "editor", password });
      expect(a.status).toBe(422);
      expect((await a.json()).errors.password).toBeTruthy();
      expect((await admin.call("POST", `/users/${editor.id}/reset-password`, { password })).status).toBe(422);
    }
  });

  it("logs whether it was typed, never the password", async () => {
    const admin = await signIn();
    await admin.call("POST", "/users", { name: "T", email: "t@example.com", role: "editor", password: typed });
    await admin.call("POST", "/users", { name: "G", email: "g@example.com", role: "editor", password: typed, passwordSource: "generated" });
    await addEditor(admin);
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "user_created")).orderBy(auditLog.id);
    expect(logs.map((l) => (l.detail as { passwordSource: string }).passwordSource)).toEqual(["typed", "generated", "generated"]);
    expect(JSON.stringify(logs)).not.toContain(typed);
  });
});

describe("temporary passwords expire", () => {
  it("after 72 hours sign-in gives the usual message, and a reset gives a new one", async () => {
    const admin = await signIn();
    const { body } = await addEditor(admin);
    const [row] = await db.select().from(users).where(eq(users.id, body.user.id));
    const hours = (row!.tempPasswordExpiresAt!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);

    await db.update(users).set({ tempPasswordExpiresAt: new Date(Date.now() - 1000) }).where(eq(users.id, body.user.id));
    const late = await login("new@example.com", body.temporaryPassword);
    expect(late.res.status).toBe(401);
    expect(late.body.error).toBe("Email or password is wrong.");
    const { users: list } = await (await admin.call("GET", "/users")).json();
    expect(list.find((u: { id: number }) => u.id === body.user.id).temporaryExpired).toBe(true);

    const reset = await (await admin.call("POST", `/users/${body.user.id}/reset-password`, {})).json();
    expect(reset.user.temporaryExpired).toBe(false);
    expect((await login("new@example.com", reset.temporaryPassword)).res.status).toBe(200);
  });

  it("stops mattering once the user has chosen their own password", async () => {
    const admin = await signIn();
    const { body } = await addEditor(admin);
    const user = await login("new@example.com", body.temporaryPassword);
    await user.call("POST", "/auth/change-password", { currentPassword: body.temporaryPassword, newPassword: "my-own-long-password" });
    const [row] = await db.select().from(users).where(eq(users.id, body.user.id));
    expect(row!.tempPasswordExpiresAt).toBeNull();
  });
});

describe("sessions have a hard limit", () => {
  it("ends a session after 7 days even if it's in use, and not before", async () => {
    const admin = await signIn();
    const day = 86_400_000;
    await db.update(sessions).set({ createdAt: new Date(Date.now() - 6.9 * day) }).where(eq(sessions.userId, admin.id));
    expect((await admin.refresh()).status).toBe(200);
    await db.update(sessions).set({ createdAt: new Date(Date.now() - 7.1 * day) }).where(eq(sessions.userId, admin.id));
    expect((await admin.refresh()).status).toBe(401);
    expect((await admin.call("GET", "/users")).status).toBe(401);
  });
});
