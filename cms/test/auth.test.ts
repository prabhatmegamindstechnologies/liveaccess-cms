import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { sign } from "hono/jwt";
import { createApp } from "../api/app.ts";
import { env } from "../env.ts";
import { auditLog, sessions, users } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
const api = "http://local/la-studio/api";
const base = `${api}/auth`;

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => wipe(db));

const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true });
const login = (body: unknown) => app().request(`${base}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
const withToken = (token: string, path = "/dashboard") => app().request(`${api}${path}`, { headers: { authorization: `Bearer ${token}` } });
const refresh = (cookie?: string) => app().request(`${base}/refresh`, { method: "POST", headers: cookie ? { cookie } : {} });

async function signedIn(role: "super_admin" | "editor" = "super_admin") {
  const { user, password } = await makeUser(db, { role });
  const res = await login({ email: "admin@example.com", password });
  const body = await res.json();
  return { id: user.id, cookie: cookieFrom(res), csrf: body.csrfToken as string, token: body.accessToken as string };
}

describe("POST /login", () => {
  it("signs in, returns an access token and sets the refresh cookie for the auth routes only", async () => {
    const { password } = await makeUser(db);
    const res = await login({ email: "Admin@Example.com ", password });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: "admin@example.com", role: "super_admin" });
    expect(body.user.passwordHash).toBeUndefined();
    expect(typeof body.csrfToken).toBe("string");
    expect(typeof body.accessToken).toBe("string");
    expect(body.expiresIn).toBe(900);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^la_refresh=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/la-studio\/api\/auth(;|$)/i);
  });

  it("puts only what the API needs in the token, for 15 minutes", async () => {
    const { token, id } = await signedIn();
    const [s] = await db.select().from(sessions);
    const claims = claimsOf(token);
    expect(claims).toMatchObject({ sub: String(id), sid: s!.id, name: "Test User", role: "super_admin", mustChangePassword: false });
    expect(claims.exp - claims.iat).toBe(900);
    expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "mustChangePassword", "name", "role", "sid", "sub"]);
  });

  it("stores only a hash of the refresh token", async () => {
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

describe("the access token", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const claims = () => ({ sub: "1", sid: 1, name: "Test User", role: "super_admin", mustChangePassword: false, iat: now(), exp: now() + 900 });
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

  it("opens the API", async () => {
    const { token } = await signedIn();
    expect((await withToken(token)).status).toBe(200);
  });

  it("is needed: no header, another scheme and a malformed token all get 401", async () => {
    await signedIn();
    expect((await app().request(`${api}/dashboard`)).status).toBe(401);
    expect((await app().request(`${api}/dashboard`, { headers: { authorization: "Basic abc" } })).status).toBe(401);
    expect((await withToken("not-a-token")).status).toBe(401);
  });

  it("is refused when expired", async () => {
    await signedIn();
    const token = await sign({ ...claims(), iat: now() - 1000, exp: now() - 100 }, env.jwtSecret(), "HS256");
    expect((await withToken(token)).status).toBe(401);
  });

  it("is refused when signed with another key", async () => {
    await signedIn();
    expect((await withToken(await sign(claims(), "x".repeat(48), "HS256"))).status).toBe(401);
  });

  it("is refused when its contents were changed after signing", async () => {
    const { token } = await signedIn("editor");
    const [header, , signature] = token.split(".");
    const forged = `${header}.${b64({ ...claimsOf(token), role: "super_admin" })}.${signature}`;
    expect((await withToken(forged)).status).toBe(401);
  });

  it("can't choose its own algorithm", async () => {
    await signedIn();
    expect((await withToken(`${b64({ alg: "none", typ: "JWT" })}.${b64(claims())}.`)).status).toBe(401);
    expect((await withToken(await sign(claims(), env.jwtSecret(), "HS512"))).status).toBe(401);
  });

  it("is refused without the fields the API relies on, even when correctly signed", async () => {
    await signedIn();
    const { sid: _sid, ...noSession } = claims();
    expect((await withToken(await sign(noSession, env.jwtSecret(), "HS256"))).status).toBe(401);
    const { exp: _exp, ...noExpiry } = claims();
    expect((await withToken(await sign(noExpiry, env.jwtSecret(), "HS256"))).status).toBe(401);
  });

  it("is the only way in: the refresh cookie alone opens no protected route", async () => {
    const { cookie, csrf, id } = await signedIn();
    const routes: [string, string][] = [
      ["GET", "/dashboard"], ["GET", "/pages"], ["PUT", "/pages/about"], ["GET", "/menus"], ["PUT", "/menus"], ["GET", "/seo"], ["PUT", "/seo/robots"],
      ["GET", "/settings"], ["PUT", "/settings"], ["GET", "/guides"], ["POST", "/guides"], ["GET", "/areas"], ["POST", "/areas"],
      ["GET", "/users"], ["POST", "/users"], ["PATCH", `/users/${id}`], ["GET", "/audit"], ["POST", "/auth/change-password"]
    ];
    for (const [method, path] of routes) {
      const res = await app().request(`${api}${path}`, { method, headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("JWT_SECRET", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("must be set and long enough", () => {
    vi.stubEnv("JWT_SECRET", "");
    expect(() => env.jwtSecret()).toThrow(/JWT_SECRET/);
    vi.stubEnv("JWT_SECRET", "x".repeat(31));
    expect(() => env.jwtSecret()).toThrow(/32/);
    vi.stubEnv("JWT_SECRET", "x".repeat(32));
    expect(env.jwtSecret()).toBe("x".repeat(32));
  });
});

describe("POST /refresh", () => {
  it("gives a working token, the user and the CSRF token", async () => {
    const { cookie, csrf } = await signedIn();
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("admin@example.com");
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.csrfToken).toBe(csrf);
    expect(body.expiresIn).toBe(900);
    expect((await withToken(body.accessToken)).status).toBe(200);
  });

  it("renews the idle limit and the cookie, keeping the same refresh token", async () => {
    const { cookie } = await signedIn();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + 60_000) });
    const res = await refresh(cookie);
    const [s] = await db.select().from(sessions);
    expect(s!.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 60 * 60 * 1000);
    expect(cookieFrom(res)).toBe(cookie);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=28800/i);
  });

  it("works for several tabs at the same moment", async () => {
    const { cookie } = await signedIn();
    const all = await Promise.all([refresh(cookie), refresh(cookie), refresh(cookie)]);
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it("gets 401 without a cookie or with a wrong one", async () => {
    await signedIn();
    expect((await refresh()).status).toBe(401);
    expect((await refresh("la_refresh=wrong")).status).toBe(401);
  });

  it("doesn't accept the old session cookie", async () => {
    const { cookie } = await signedIn();
    expect((await refresh(cookie.replace("la_refresh=", "la_session="))).status).toBe(401);
  });

  it("doesn't accept an access token in place of the cookie", async () => {
    const { token } = await signedIn();
    expect((await refresh(`la_refresh=${token}`)).status).toBe(401);
  });

  it("is refused after the idle limit", async () => {
    const { cookie } = await signedIn();
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 minute'` });
    expect((await refresh(cookie)).status).toBe(401);
  });

  it("is refused once the user is disabled", async () => {
    const { cookie, id } = await signedIn();
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, id));
    expect((await refresh(cookie)).status).toBe(401);
  });

  it("picks up a role change", async () => {
    const { cookie, id } = await signedIn();
    await db.update(users).set({ role: "editor" }).where(eq(users.id, id));
    const { accessToken } = await (await refresh(cookie)).json();
    expect(claimsOf(accessToken).role).toBe("editor");
  });

  it("refuses requests from another site", async () => {
    const { cookie } = await signedIn();
    const byOrigin = await app().request(`${base}/refresh`, { method: "POST", headers: { cookie, origin: "https://evil.example", host: "local" } });
    expect(byOrigin.status).toBe(403);
    const byFetchSite = await app().request(`${base}/refresh`, { method: "POST", headers: { cookie, "sec-fetch-site": "cross-site" } });
    expect(byFetchSite.status).toBe(403);
  });

  it("marks the response as noindex and uncacheable", async () => {
    const res = await refresh();
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("routes that check the database on every request", () => {
  const sensitive = ["/users", "/audit"];

  it("open with a valid token and a live session", async () => {
    const { token } = await signedIn();
    for (const path of sensitive) expect((await withToken(token, path)).status, path).toBe(200);
  });

  it("refuse a still-valid token once its session has ended", async () => {
    const { token } = await signedIn();
    await db.delete(sessions);
    for (const path of sensitive) expect((await withToken(token, path)).status, path).toBe(401);
  });

  it("refuse a still-valid token once the user is disabled", async () => {
    const { token, id } = await signedIn();
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, id));
    for (const path of sensitive) expect((await withToken(token, path)).status, path).toBe(401);
  });

  it("use the role in the database, not the one in the token", async () => {
    const { token, id } = await signedIn();
    await db.update(users).set({ role: "editor" }).where(eq(users.id, id));
    for (const path of sensitive) expect((await withToken(token, path)).status, path).toBe(403);
  });

  it("refuse a user who must change their password, even with a token from before", async () => {
    const { token, id } = await signedIn();
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, id));
    const res = await withToken(token, "/users");
    expect(res.status).toBe(403);
    expect((await res.json()).passwordChangeRequired).toBe(true);
  });

  it("cover change-password too", async () => {
    const { token } = await signedIn();
    await db.delete(sessions);
    const res = await app().request(`${base}/change-password`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "correct-horse-battery", newPassword: "another-long-password" })
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /logout", () => {
  it("needs the CSRF token, then removes the session so the token can't be renewed", async () => {
    const { cookie, csrf, token } = await signedIn();
    const noToken = await app().request(`${base}/logout`, { method: "POST", headers: { cookie } });
    expect(noToken.status).toBe(403);
    const res = await app().request(`${base}/logout`, { method: "POST", headers: { cookie, "x-csrf-token": csrf } });
    expect(res.status).toBe(204);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect((await refresh(cookie)).status).toBe(401);
    expect((await withToken(token, "/users")).status).toBe(401);
  });

  it("clears the cookie on the path it was set on", async () => {
    const { cookie, csrf } = await signedIn();
    const res = await app().request(`${base}/logout`, { method: "POST", headers: { cookie, "x-csrf-token": csrf } });
    expect(res.headers.get("set-cookie")).toMatch(/^la_refresh=;.*Path=\/la-studio\/api\/auth/i);
  });

  it("writes login and logout to the audit log", async () => {
    const { cookie, csrf } = await signedIn();
    await app().request(`${base}/logout`, { method: "POST", headers: { cookie, "x-csrf-token": csrf } });
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityType, "user"));
    expect(rows.map((r) => r.action)).toEqual(["login", "logout"]);
  });
});
