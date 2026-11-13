// Publish to the website, against an in-memory GitHub that holds this repo's own site files.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withoutCmsRedirects } from "@liveaccess/shared";
import { createApp } from "../api/app.ts";
import { disabledDriver } from "../api/media/storage.ts";
import { env } from "../env.ts";
import { importSite } from "../import/site.ts";
import { auditLog, pages, publishJobs, redirects } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { gitBlobSha, type GithubConfig } from "../publish/github.ts";
import { SITE_PATH } from "../publish/publish-live.ts";
import { assertLocalDatabase, makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
let siteFiles: Map<string, Buffer>;
const api = "http://local/la-studio/api";

/** A GitHub repo in memory: the Git Data API calls Publish makes, and what it did. */
function fakeGithub(files: Map<string, Buffer>) {
  const blobs = new Map<string, Buffer>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parent: string | null; message: string }>();
  const put = (data: Buffer) => { const sha = gitBlobSha(data); blobs.set(sha, data); return sha; };
  trees.set("t0", new Map([...files].map(([path, data]) => [path, put(data)])));
  commits.set("c0", { tree: "t0", parent: null, message: "start" });
  const state = { head: "c0", moved: false, requests: [] as string[], n: 0 };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/repos\/owner\/site/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    state.requests.push(`${method} ${path}`);
    if (new Headers(init?.headers).get("authorization") !== "Bearer test-token") return json({ message: "Bad credentials" }, 401);

    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/git/ref/heads/main") return json({ object: { sha: state.head } });
    if (method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) return json({ tree: { sha: commits.get(m[1]!)!.tree } });
    if (method === "GET" && (m = path.match(/^\/git\/trees\/(\w+)$/))) {
      return json({ truncated: false, tree: [...trees.get(m[1]!)!].map(([p, sha]) => ({ path: p, type: "blob", sha, size: blobs.get(sha)!.length })) });
    }
    if (method === "GET" && (m = path.match(/^\/git\/blobs\/(\w+)$/))) return json({ content: blobs.get(m[1]!)!.toString("base64"), encoding: "base64" });
    if (method === "POST" && path === "/git/blobs") return json({ sha: put(Buffer.from(body.content, "base64")) }, 201);
    if (method === "POST" && path === "/git/trees") {
      const t = new Map(trees.get(body.base_tree)!);
      for (const e of body.tree) t.set(e.path, e.sha);
      const sha = `t${++state.n}`;
      trees.set(sha, t);
      return json({ sha }, 201);
    }
    if (method === "POST" && path === "/git/commits") {
      const sha = `c${++state.n}`;
      commits.set(sha, { tree: body.tree, parent: body.parents[0], message: body.message });
      return json({ sha, html_url: `https://github.com/owner/site/commit/${sha}` }, 201);
    }
    if (method === "PATCH" && path === "/git/refs/heads/main") {
      if (state.moved || commits.get(body.sha)!.parent !== state.head) return json({ message: "Update is not a fast forward" }, 422);
      state.head = body.sha;
      return json({ object: { sha: body.sha } });
    }
    return json({ message: "Not Found" }, 404);
  }) as typeof fetch;

  /** The files the latest commit changed, and their contents. */
  const lastCommit = () => {
    const c = commits.get(state.head)!;
    const before = trees.get(commits.get(c.parent!)!.tree)!, after = trees.get(c.tree)!;
    const changed = [...after].filter(([p, sha]) => before.get(p) !== sha).map(([p]) => p).sort();
    return { message: c.message, changed, text: (p: string) => blobs.get(after.get(p)!)!.toString("utf8") };
  };
  return { fetch: fakeFetch, state, lastCommit };
}

async function readSite(root: string, dir = ""): Promise<[string, Buffer][]> {
  const out: [string, Buffer][] = [];
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory() && (rel === "images" || rel.startsWith("images/"))) out.push(...await readSite(root, rel));
    else if (e.isFile() && SITE_PATH.test(rel) && (await stat(join(root, rel))).size < 5_000_000) out.push([rel, await readFile(join(root, rel))]);
  }
  return out;
}

let gh: ReturnType<typeof fakeGithub>;
const config = (): GithubConfig => ({ token: "test-token", repo: "owner/site", branch: "main", fetch: gh.fetch });
const app = (github: () => { config: GithubConfig | null; missing: string[] } = () => ({ config: config(), missing: [] })) =>
  createApp({ db, adminPath: "la-studio", secureCookies: true, mediaStorage: disabledDriver(), github });

async function signIn(role: "super_admin" | "editor" = "super_admin") {
  const { password } = await makeUser(db, { role, email: `${role}@example.com` });
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${role}@example.com`, password }) });
  return (await res.json()).accessToken as string;
}
const publish = (token: string, a = app()) => a.request(`${api}/publish/live`, { method: "POST", headers: { authorization: `Bearer ${token}` } });

beforeAll(async () => {
  ({ db, close } = await testDb());
  siteFiles = new Map(await readSite(env.siteRoot));
  // Code next to the site in the repo: Publish must never read or write it.
  siteFiles.set("cms/api/app.ts", Buffer.from("export {}"));
}, 60_000);
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  await importSite(db, env.siteRoot);
  gh = fakeGithub(siteFiles);
});

describe("the test database guard", () => {
  it("refuses anything but a database on this computer", () => {
    expect(() => assertLocalDatabase("postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb")).toThrow(/local database/);
    expect(() => assertLocalDatabase("postgres://u:p@localhost:5433/x")).not.toThrow();
  });
});

describe("POST /publish/live", () => {
  it("the first publish of the imported site changes only what the build always writes differently", async () => {
    const res = await publish(await signIn());
    expect(res.status).toBe(200);
    const body = await res.json();
    // The contact form now sends to the CMS inbox; the sitemap dates are the import's; three guides write ' instead of &#x27;.
    const expected = ["contact.html", "sitemap.xml", "guide-centrifugal-pump-cavitation.html", "guide-plate-heat-exchanger-leak.html", "guide-powder-lumps-in-mixing.html"];
    expect([...body.files].sort()).toEqual([...expected].sort());
    expect(gh.lastCommit().text("contact.html")).toContain("/la-studio/api/contact");
  }, 60_000);

  it("commits nothing when the website already matches the drafts", async () => {
    const token = await signIn();
    expect((await publish(token)).status).toBe(200);
    const head = gh.state.head;
    const res = await publish(token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toEqual([]);
    expect(body.commit).toBeNull();
    expect(gh.state.head).toBe(head);
  }, 90_000);

  it("sends a changed page as one commit, and marks the draft as live", async () => {
    const [about] = await db.select().from(pages).where(eq(pages.key, "about"));
    const html = about!.html.replace("</h1>", " Updated</h1>");
    await db.update(pages).set({ html }).where(eq(pages.id, about!.id));

    const res = await publish(await signIn());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toContain("about.html");
    expect(body.commit.url).toMatch(/^https:\/\/github\.com\/owner\/site\/commit\//);

    const commit = gh.lastCommit();
    expect(commit.changed).toEqual(body.files);
    expect(commit.message).toBe("Publish from CMS by Test User");
    expect(commit.text("about.html")).toContain(" Updated</h1>");
    for (const f of commit.changed) expect(f).toMatch(SITE_PATH);
    // Only the Git Data calls, and only site files were read: never the code next to them.
    expect(gh.state.requests.filter((r) => r.startsWith("PATCH"))).toHaveLength(1);

    const [after] = await db.select().from(pages).where(eq(pages.id, about!.id));
    expect(after!.publishedHtml).toContain(" Updated</h1>");
    const [job] = await db.select().from(publishJobs);
    expect(job).toMatchObject({ status: "done", log: body.commit.url });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "site_published"))).toHaveLength(1);
  }, 60_000);

  it("writes nothing and marks nothing live when the branch moved meanwhile", async () => {
    const [about] = await db.select().from(pages).where(eq(pages.key, "about"));
    await db.update(pages).set({ html: about!.html.replace("</h1>", " Updated</h1>") }).where(eq(pages.id, about!.id));
    gh.state.moved = true;

    const res = await publish(await signIn());
    expect(res.status).toBe(409);
    expect(gh.state.head).toBe("c0");
    const [after] = await db.select().from(pages).where(eq(pages.id, about!.id));
    expect(after!.publishedHtml).toBe(about!.publishedHtml);
    const [job] = await db.select().from(publishJobs);
    expect(job!.status).toBe("failed");
  }, 60_000);

  it("doesn't double the CMS redirects already in the published .htaccess", async () => {
    const base = withoutCmsRedirects(siteFiles.get(".htaccess")!.toString("utf8"));
    await db.insert(redirects).values({ fromPath: "/old.html", toPath: "about.html", code: 301 });
    const token = await signIn();
    expect((await publish(token)).status).toBe(200);
    const first = gh.lastCommit().text(".htaccess");
    expect(first.startsWith(base)).toBe(true);
    expect(first.match(/# Redirects from the CMS\./g)).toHaveLength(1);

    // Publishing again, on top of that commit, changes nothing.
    const again = await (await publish(token)).json();
    expect(again.commit).toBeNull();
  }, 90_000);

  it("is for Super Admins only", async () => {
    const res = await publish(await signIn("editor"));
    expect(res.status).toBe(403);
    expect(gh.state.requests).toEqual([]);
  });

  it("says what's missing when it isn't set up", async () => {
    const res = await publish(await signIn(), app(() => ({ config: null, missing: ["GITHUB_TOKEN", "GITHUB_REPO"] })));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("GITHUB_TOKEN, GITHUB_REPO");
  });

  it("reports a refused token without publishing", async () => {
    const res = await publish(await signIn(), app(() => ({ config: { ...config(), token: "wrong" }, missing: [] })));
    expect(res.status).toBe(502);
    expect(gh.state.head).toBe("c0");
  });
});

describe("GET /publish/live", () => {
  it("shows the setup and the last publishes to any signed-in user", async () => {
    await publish(await signIn());
    const res = await app().request(`${api}/publish/live`, { headers: { authorization: `Bearer ${await signIn("editor")}` } });
    const body = await res.json();
    expect(body).toMatchObject({ configured: true, repo: "owner/site", branch: "main" });
    expect(body.publishes[0]).toMatchObject({ status: "done", by: "Test User" });
  }, 60_000);
});
