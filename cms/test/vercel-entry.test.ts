// The API as a Vercel Function: vercel.json sends /<ADMIN_PATH>/api/* to api/cms.ts, Vercel adds the matched part as ?path=,
// and the entry turns it back into the URL createApp() expects.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATH_PARAM, UPLOADS_OFF, restoreRequest, vercelApp } from "../api/vercel.ts";
import { env, repoRoot } from "../env.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

const vercel = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8"));
const host = "https://cms.example.com";
const fn = (path: string, query = "") => `${host}/api/cms?${PATH_PARAM}=${path}${query ? `&${query}` : ""}`;

describe("vercel.json", () => {
  const api = { source: `/${env.adminPath}/api/:path*`, destination: "/api/cms" };

  it("sends API requests to the Function, before the admin-page rewrite catches them", () => {
    const rewrites: { source: string }[] = vercel.rewrites;
    const i = rewrites.findIndex((r) => r.source === api.source);
    expect(rewrites[i]).toEqual(api);
    expect(i).toBeLessThan(rewrites.findIndex((r) => r.source === `/${env.adminPath}/:path*`));
  });

  it("runs the Function next to the database and ships the files it reads at runtime", () => {
    expect(vercel.regions).toEqual(["iad1"]);
    expect(existsSync(join(repoRoot, "api/cms.ts"))).toBe(true);
    const cfg = vercel.functions["api/cms.ts"];
    expect(cfg.maxDuration).toBeGreaterThan(0);
    for (const f of ["*.html", "robots.txt", "llms.txt", "packages/shared/src/*.ts"]) expect(cfg.includeFiles).toContain(f);
  });

  it("builds the entry as an ES module that imports the compiled .js files", () => {
    expect(JSON.parse(readFileSync(join(repoRoot, "api/package.json"), "utf8")).type).toBe("module");
    const ts = JSON.parse(readFileSync(join(repoRoot, "tsconfig.json"), "utf8"));
    expect(ts.compilerOptions.rewriteRelativeImportExtensions).toBe(true);
  });
});

describe("restoreRequest", () => {
  const path = (r: Request | null) => (r ? new URL(r.url).pathname + new URL(r.url).search : null);

  it("rebuilds the API path and keeps the other query parameters", () => {
    expect(path(restoreRequest(new Request(fn("auth/login")), "la-studio"))).toBe("/la-studio/api/auth/login");
    expect(path(restoreRequest(new Request(fn("pages/3/revisions", "page=2&q=a%20b")), "la-studio")))
      .toBe("/la-studio/api/pages/3/revisions?page=2&q=a+b");
  });

  it("keeps a request that already has the original path (if Vercel passes it through)", () => {
    const req = new Request(`${host}/la-studio/api/health?${PATH_PARAM}=health`);
    expect(path(restoreRequest(req, "la-studio"))).toBe("/la-studio/api/health");
  });

  it("refuses paths outside the API", () => {
    for (const p of ["../../etc/passwd", "..%2F..%2Fx", "%2e%2e/%2e%2e/x", "auth/../../index.html"]) {
      expect(restoreRequest(new Request(fn(p)), "la-studio"), p).toBeNull();
    }
    expect(restoreRequest(new Request(`${host}/api/cms`), "la-studio")).toBeNull();
  });

  it("keeps the method, headers and body", async () => {
    const req = new Request(fn("auth/login"), { method: "POST", headers: { "content-type": "application/json", origin: host }, body: '{"a":1}' });
    const out = restoreRequest(req, "la-studio")!;
    expect(out.method).toBe("POST");
    expect(out.headers.get("origin")).toBe(host);
    expect(await out.text()).toBe('{"a":1}');
  });
});

describe("vercelApp", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await testDb()));
  afterAll(async () => close());
  beforeEach(async () => wipe(db));

  const app = () => vercelApp({ db, adminPath: "la-studio", secureCookies: true, trustProxy: true });
  const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
    app()(new Request(fn(path), { method: "POST", headers: { origin: host, ...headers }, body }));

  it("signs in through the Function URL", async () => {
    const { password } = await makeUser(db);
    const res = await post("auth/login", JSON.stringify({ email: "admin@example.com", password }), { "content-type": "application/json" });
    expect(res.status).toBe(200);
    expect((await res.json()).accessToken).toEqual(expect.any(String));
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("answers uploads with a clear message instead of writing to the Function's disk", async () => {
    for (const path of ["media", "media/7/replace"]) {
      const res = await post(path, new FormData());
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe(UPLOADS_OFF);
    }
  });

  it("answers 404 for a path outside the API", async () => {
    const res = await app()(new Request(fn("../../index.html")));
    expect(res.status).toBe(404);
  });
});
