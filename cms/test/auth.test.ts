import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../api/app.ts";
import { auditLog, sessions, users } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
const base = "http://local/la-studio/api/auth";

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => wipe(db));

const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true });
const login = (body: unknown) => app().request(`${base}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("POST /login", () => {
  it("signs in and sets a secure session cookie on the admin path", async () => {
    const { password } = await makeUser(db);
    const res = await login({ email: "Admin@Example.com ", password });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: "admin@example.com", role: "super_admin" });
    expect(body.user.passwordHash).toBeUndefined();
    expect(typeof body.csrfToken).toBe("string");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^la_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/la-studio/i);
  });

  it("stores only a hash of the session token", async () => {
    const { password } = await makeUser(db);
    const res = await login({ email: "admin@example.com", password });
    const token = cookieFrom(res).split("=")[1]!;
    const [s] = await db.select().from(sessions);
    expect(s!.tokenHash).not.toBe(token);
    expect(s!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("gives the same message for a wrong password and an unknown email", async () => {
    await makeUser(db);
    const a = await login({ email: "admin@example.com", password: "wrong-password-123" });
    const b = await login({ email: "nobody@example.com", password: "wrong-password-123" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual({ error: "Email or password is wrong." });
    expect(await b.json()).toEqual({ error: "Email or password is wrong." });
  });

  it("locks the account for 15 minutes after 5 wrong passwords, even for the right password", async () => {
    const { password } = await makeUser(db);
    for (let i = 0; i < 5; i++) await login({ email: "admin@example.com", password: "wrong-password-123" });
    const [u] = await db.select().from(users);
    expect(u!.lockedUntil).not.toBeNull();
    const minutes = (u!.lockedUntil!.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    const res = await login({ email: "admin@example.com", password });
    expect(res.status).toBe(401);
    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain("login_locked");
  });

  it("still locks the account when 10 wrong passwords arrive at the same time", async () => {
    await makeUser(db);
    await Promise.all(Array.from({ length: 10 }, () => login({ email: "admin@example.com", password: "wrong-password-123" })));
    const [u] = await db.select().from(users);
    expect(u!.lockedUntil).not.toBeNull();
  });

  it("only accepts JSON bodies", async () => {
    const res = await app().request(`${base}/login`, { method: "POST", headers: { "content-type": "text/plain" }, body: '{"email":"a@b.c","password":"x"}' });
    expect(res.status).toBe(415);
  });

  it("refuses changes coming from another site", async () => {
    const { password } = await makeUser(db);
    const res = await app().request(`${base}/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example", host: "local" },
      body: JSON.stringify({ email: "admin@example.com", password })
    });
    expect(res.status).toBe(403);
  });

  it("does not store the typed text of unknown emails in the audit log", async () => {
    await login({ email: "my-secret-password@oops", password: "wrong-password-123" });
    const rows = await db.select().from(auditLog);
    expect(JSON.stringify(rows)).not.toContain("my-secret-password");
  });

  it("resets the counter after a successful sign-in", async () => {
    const { password } = await makeUser(db);
    await login({ email: "admin@example.com", password: "wrong-password-123" });
    await login({ email: "admin@example.com", password });
    const [u] = await db.select().from(users);
    expect(u!.failedLogins).toBe(0);
  });

  it("refuses disabled users", async () => {
    const { password } = await makeUser(db, { status: "disabled" });
    expect((await login({ email: "admin@example.com", password })).status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    expect((await login({ email: "x" })).status).toBe(400);
  });
});

describe("GET /me and POST /logout", () => {
  async function signedIn() {
    const { password } = await makeUser(db);
    const res = await login({ email: "admin@example.com", password });
    return { cookie: cookieFrom(res), csrf: (await res.json()).csrfToken as string };
  }

  it("returns the current user with a session, 401 without", async () => {
    const { cookie } = await signedIn();
    const ok = await app().request(`${base}/me`, { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.email).toBe("admin@example.com");
    expect((await app().request(`${base}/me`)).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { cookie } = await signedIn();
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 minute'` });
    expect((await app().request(`${base}/me`, { headers: { cookie } })).status).toBe(401);
  });

  it("needs the CSRF token to sign out, then removes the session", async () => {
    const { cookie, csrf } = await signedIn();
    const noToken = await app().request(`${base}/logout`, { method: "POST", headers: { cookie } });
    expect(noToken.status).toBe(403);
    const res = await app().request(`${base}/logout`, { method: "POST", headers: { cookie, "x-csrf-token": csrf } });
    expect(res.status).toBe(204);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect((await app().request(`${base}/me`, { headers: { cookie } })).status).toBe(401);
  });

  it("writes login and logout to the audit log", async () => {
    const { cookie, csrf } = await signedIn();
    await app().request(`${base}/logout`, { method: "POST", headers: { cookie, "x-csrf-token": csrf } });
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityType, "user"));
    expect(rows.map((r) => r.action)).toEqual(["login", "logout"]);
  });

  it("marks every CMS response as noindex", async () => {
    const res = await app().request(`${base}/me`);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
