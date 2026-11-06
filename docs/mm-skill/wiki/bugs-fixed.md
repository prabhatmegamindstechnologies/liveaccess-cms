# Bugs fixed

## 2026-11-06 — vercel-output-directory

**Symptom:** Vercel deployment failed with `STATIC_BUILD_NO_OUT_DIR`: no Output Directory named "public".
**Root cause:** `vercel.json` set a `buildCommand` but no `outputDirectory`, and the admin builds to a folder Vercel didn't know about.
**Location:** `vercel.json`, `cms/vite.config.ts`
**Fix:** Publish `cms/dist` and build the admin into `cms/dist/<ADMIN_PATH>`, so files match the URLs in the built page. Added a rewrite for admin routes and a redirect from `/`.
**Prevention:** `cms/test/vercel.test.ts` builds the admin and checks that every linked file exists in the output.
**Task:** [2026-11-06-vercel-output-directory](../tasks/2026-11-06-vercel-output-directory.md)
