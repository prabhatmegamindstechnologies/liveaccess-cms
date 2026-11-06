// Loads the repo-root .env and resolves paths relative to the repo root, whatever the current folder is.
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(repoRoot, ".env"), quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.`);
  return v;
}

const adminPath = (process.env.ADMIN_PATH ?? "la-studio").replace(/^\/+|\/+$/g, "");
if (!/^[a-z0-9-]{3,40}$/.test(adminPath) || adminPath === "admin") {
  throw new Error("ADMIN_PATH must be 3-40 lowercase letters, digits or hyphens, and not 'admin'.");
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  testDatabaseUrl: () => required("TEST_DATABASE_URL"),
  jwtSecret: () => {
    const secret = required("JWT_SECRET");
    if (secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters.");
    return secret;
  },
  adminPath,
  port: Number(process.env.PORT ?? 8787),
  previewPort: Number(process.env.PREVIEW_PORT ?? 4000),
  siteRoot: resolve(repoRoot, process.env.SITE_ROOT ?? "."),
  // Cookies are Secure unless local development explicitly turns it off (http://localhost has no TLS).
  secureCookies: process.env.CMS_INSECURE_COOKIES !== "1",
  // Trust proxy headers (x-real-ip, x-forwarded-host) only on Vercel or when told to.
  trustProxy: process.env.VERCEL === "1" || process.env.TRUST_PROXY === "1"
};
