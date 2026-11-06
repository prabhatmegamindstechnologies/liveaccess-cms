// Vercel serves only outputDirectory, so every URL in the built admin page must exist there as a real file.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { env, repoRoot } from "../env.ts";

const vercel = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8"));
const outputRoot = () => resolve(repoRoot, vercel.outputDirectory ?? "public");
const page = () => join(outputRoot(), env.adminPath, "index.html");

describe("Vercel output", () => {
  beforeAll(async () => {
    await build({ configFile: join(repoRoot, "cms/vite.config.ts"), logLevel: "silent" });
  }, 120_000);

  it("holds the admin page at the path it's served from", () => {
    expect(existsSync(page())).toBe(true);
  });

  it("holds every file the admin page links to", () => {
    const urls = [...readFileSync(page(), "utf8").matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(existsSync(join(outputRoot(), url)), url).toBe(true);
  });

  it("sends admin routes to the admin page, so reloading one works", () => {
    expect(vercel.rewrites).toContainEqual({ source: `/${env.adminPath}/:path*`, destination: `/${env.adminPath}/index.html` });
  });
});
