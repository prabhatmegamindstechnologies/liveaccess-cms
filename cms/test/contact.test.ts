import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../api/app.ts";
import { visitorKey } from "../api/contact/routes.ts";
import { auditLog, contactMessages } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
let clock = Date.parse("2026-11-12T10:00:00Z");
const api = "http://local/la-studio/api";
const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true, trustProxy: true, now: () => clock });

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  clock = Date.parse("2026-11-12T10:00:00Z");
});

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const fields = { name: "Ann Smith", company: "Dairy Co", email: "ann@example.com", topic: "Access for my team", message: "We run two evaporators.\nPlease call.", _gotcha: "", _elapsed: "10000", ...over };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const send = (body: FormData | string, headers: Record<string, string> = {}) =>
  app().request(`${api}/contact`, { method: "POST", body, headers: { origin: "http://local", "x-real-ip": "203.0.113.7", ...headers } });
const stored = () => db.select().from(contactMessages);

async function signIn(role: "super_admin" | "editor" = "super_admin") {
  const email = `${role}@example.com`;
  const { password } = await makeUser(db, { email, role });
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "198.51.100.1" }, body: JSON.stringify({ email, password }) });
  const authorization = `Bearer ${(await res.json()).accessToken}`;
  return (method: string, path: string, body?: unknown) => app().request(`${api}/messages${path}`, {
    method, headers: { authorization, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined
  });
}

describe("contact form endpoint", () => {
  it("stores a message sent as the site's form, without the IP itself", async () => {
    const res = await send(form());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [m] = await stored();
    expect(m).toMatchObject({ name: "Ann Smith", company: "Dairy Co", email: "ann@example.com", topic: "Access for my team", message: "We run two evaporators.\nPlease call.", page: "contact.html", status: "new" });
    expect(m!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(m)).not.toContain("203.0.113.7");
  });

  it("accepts JSON too", async () => {
    const res = await send(JSON.stringify({ name: "Bo", email: "bo@example.com", message: "Hi", _elapsed: 5000 }), { "content-type": "application/json" });
    expect(res.status).toBe(200);
    expect((await stored())[0]).toMatchObject({ name: "Bo", topic: "Something else", company: "" });
  });

  it.each([
    ["the honeypot is filled", { _gotcha: "http://spam.example" }],
    ["the form came back too fast", { _elapsed: "2999" }],
    ["the time on the page is missing", { _elapsed: "" }],
    ["the time on the page is nonsense", { _elapsed: "soon" }]
  ])("quietly drops spam when %s", async (_name, over) => {
    const res = await send(form(over));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await stored()).toHaveLength(0);
  });

  it.each([
    ["no name", { name: "  " }, "name"],
    ["a bad email", { email: "ann@" }, "email"],
    ["no message", { message: "" }, "message"],
    ["a long name", { name: "x".repeat(201) }, "name"],
    ["a long company", { company: "x".repeat(201) }, "company"],
    ["a long message", { message: "x".repeat(5001) }, "message"],
    ["a long email", { email: `${"a".repeat(250)}@x.io` }, "email"],
    ["hidden characters", { name: "Ann‮Smith" }, "name"],
    ["a control character in the message", { message: "Hi\u0007" }, "message"]
  ])("refuses %s", async (_name, over, key) => {
    const res = await send(form(over));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[key]).toBeTruthy();
    expect(typeof body.error).toBe("string");
    expect(await stored()).toHaveLength(0);
  });

  it("stores an unknown topic as 'Something else', and keeps text as text", async () => {
    await send(form({ topic: "<script>alert(1)</script>", message: "<img src=x onerror=alert(1)>" }));
    const [m] = await stored();
    expect(m!.topic).toBe("Something else");
    expect(m!.message).toBe("<img src=x onerror=alert(1)>");
  });

  it("limits each visitor to 5 messages an hour", async () => {
    for (let i = 0; i < 5; i++) expect((await send(form())).status).toBe(200);
    const sixth = await send(form());
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error).toMatch(/Too many/);
    expect((await send(form(), { "x-real-ip": "203.0.113.8" })).status).toBe(200);
    // An hour later the visitor can send again.
    clock += 61 * 60 * 1000;
    expect((await send(form())).status).toBe(200);
  });

  it("limits all visitors together to 100 messages an hour", async () => {
    await db.insert(contactMessages).values(Array.from({ length: 100 }, (_, i) => ({ name: "x", email: "x@example.com", message: "m", ipHash: `h${i}`, createdAt: new Date(clock - 1000) })));
    expect((await send(form())).status).toBe(429);
  });

  it("refuses a message sent from another site", async () => {
    expect((await send(form(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await send(form(), { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(await stored()).toHaveLength(0);
  });

  it("refuses a very large request", async () => {
    expect((await send(form({ message: "x".repeat(70_000) }))).status).toBe(413);
  });

  it("refuses a POST that says neither where it comes from (an old browser on another site)", async () => {
    const bare = (headers: Record<string, string>) => app().request(`${api}/contact`, { method: "POST", body: form(), headers: { "x-real-ip": "203.0.113.7", ...headers } });
    expect((await bare({})).status).toBe(403);
    expect((await bare({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect(await stored()).toHaveLength(1);
  });

  it("keeps to the limit when many messages arrive at the same moment", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => send(form())));
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(25);
    expect(await stored()).toHaveLength(5);
  });

  it("counts a whole IPv6 /64 as one visitor", async () => {
    for (let i = 0; i < 5; i++) expect((await send(form(), { "x-real-ip": `2001:db8:1:2::${i.toString(16)}` })).status).toBe(200);
    expect((await send(form(), { "x-real-ip": "2001:db8:1:2:ffff:ffff:ffff:ffff" })).status).toBe(429);
    expect((await send(form(), { "x-real-ip": "2001:db8:1:3::1" })).status).toBe(200);
  });

  it("puts visitors with no known address in one shared bucket", async () => {
    for (let i = 0; i < 5; i++) expect((await send(form(), { "x-real-ip": "" })).status).toBe(200);
    expect((await send(form(), { "x-real-ip": "" })).status).toBe(429);
  });
});

describe("visitorKey", () => {
  it("uses the IPv4 address, the IPv6 /64, or one shared key", () => {
    expect(visitorKey("203.0.113.7")).toBe("203.0.113.7");
    expect(visitorKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(visitorKey("2001:db8:1:2::5")).toBe("2001:db8:1:2::/64");
    expect(visitorKey("2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(visitorKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(visitorKey("::1")).toBe("0:0:0:0::/64");
    expect(visitorKey(null)).toBe("unknown");
    expect(visitorKey("")).toBe("unknown");
  });
});

describe("messages API (Contact inbox)", () => {
  const add = (n: number, over: Partial<typeof contactMessages.$inferInsert> = {}) =>
    db.insert(contactMessages).values(Array.from({ length: n }, (_, i) => ({ name: `Sender ${i}`, email: `s${i}@example.com`, message: `Message ${i}`, topic: "Help with the app", createdAt: new Date(clock - (n - i) * 1000), ...over })));

  it("needs a signed-in user", async () => {
    expect((await app().request(`${api}/messages`)).status).toBe(401);
    expect((await app().request(`${api}/messages/1`)).status).toBe(401);
  });

  it("lists new messages first by default, newest first, with counts per status", async () => {
    await add(3);
    await add(1, { status: "archived", name: "Old" });
    const call = await signIn();
    const body = await (await call("GET", "")).json();
    expect(body.messages.map((m: { name: string }) => m.name)).toEqual(["Sender 2", "Sender 1", "Sender 0"]);
    expect(body.counts).toEqual({ new: 3, read: 0, replied: 0, archived: 1, all: 3 });
    expect(body.canDelete).toBe(true);
    expect((await (await call("GET", "?status=all")).json()).messages).toHaveLength(3);
    expect((await (await call("GET", "?status=archived")).json()).messages[0].name).toBe("Old");
  });

  it("filters by topic and searches name, email, company and message", async () => {
    await add(2);
    await db.insert(contactMessages).values({ name: "Cara", email: "cara@dairy.example", company: "Big Dairy", message: "Evaporator 100% fouled", topic: "Becoming a TPS client" });
    const call = await signIn();
    const names = async (q: string) => (await (await call("GET", `?status=all&${q}`)).json()).messages.map((m: { name: string }) => m.name);
    expect(await names("topic=Becoming%20a%20TPS%20client")).toEqual(["Cara"]);
    for (const q of ["cara", "DAIRY.example", "big dairy", "evaporator"]) expect(await names(`q=${encodeURIComponent(q)}`), q).toEqual(["Cara"]);
    expect(await names("q=100%25")).toEqual(["Cara"]);
    // % and _ are searched as themselves, not as wildcards (only Cara's message has a %; nobody's has a _).
    expect(await names("q=%25")).toEqual(["Cara"]);
    expect(await names("q=_")).toEqual([]);
    expect((await call("GET", "?status=spam")).status).toBe(400);
    expect((await call("GET", "?topic=Other")).status).toBe(400);
  });

  it("pages 30 at a time", async () => {
    await add(35);
    const call = await signIn();
    const p2 = await (await call("GET", "?page=2")).json();
    expect(p2.messages).toHaveLength(5);
    expect(p2.total).toBe(35);
  });

  it("marks a new message read when opened, and records who changed its status", async () => {
    await add(1);
    const [m] = await stored();
    const call = await signIn("editor");
    const opened = await (await call("GET", `/${m!.id}`)).json();
    expect(opened.message).toMatchObject({ status: "read", statusChangedBy: "Test User" });
    const replied = await (await call("PATCH", `/${m!.id}`, { status: "replied" })).json();
    expect(replied.message.status).toBe("replied");
    // Opening it again doesn't change it back.
    expect((await (await call("GET", `/${m!.id}`)).json()).message.status).toBe("replied");
    expect((await call("PATCH", `/${m!.id}`, { status: "deleted" })).status).toBe(400);
    expect((await call("PATCH", "/999", { status: "read" })).status).toBe(404);
    expect((await call("GET", "/abc")).status).toBe(404);
  });

  it("lets only a Super Admin delete, and logs the id only", async () => {
    await add(1);
    const [m] = await stored();
    const editor = await signIn("editor");
    expect((await (await editor("GET", "")).json()).canDelete).toBe(false);
    expect((await editor("DELETE", `/${m!.id}`)).status).toBe(403);
    const admin = await signIn("super_admin");
    expect((await admin("DELETE", `/${m!.id}`)).status).toBe(200);
    expect(await stored()).toHaveLength(0);
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "message_deleted"));
    expect(log).toMatchObject({ entityType: "message", entityId: String(m!.id), detail: null });
    expect((await admin("DELETE", `/${m!.id}`)).status).toBe(404);
  });

  it("deletes handled messages 12 months after they were handled, and nothing else", async () => {
    const old = new Date(clock - 366 * 24 * 60 * 60 * 1000);
    await add(1, { name: "Old replied", status: "replied", statusChangedAt: old });
    await add(1, { name: "Old archived", status: "archived", statusChangedAt: old });
    await add(1, { name: "Old but new", status: "new", statusChangedAt: old, createdAt: old });
    await add(1, { name: "Old but read", status: "read", statusChangedAt: old });
    await add(1, { name: "Recent archived", status: "archived", statusChangedAt: new Date(clock - 30 * 24 * 60 * 60 * 1000) });
    const call = await signIn();
    await call("GET", "");
    expect((await stored()).map((m) => m.name).sort()).toEqual(["Old but new", "Old but read", "Recent archived"]);
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "messages_purged"));
    expect(log!.detail).toEqual({ count: 2 });
  });
});
