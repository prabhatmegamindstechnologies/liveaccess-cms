# Fix the Vercel "No Output Directory named public" build error

- Flow: BUG_FIX
- Status: done locally, not committed; not yet proven on a real Vercel deployment
- Requested: 2026-11-06, Prabhat (error reported by Akash: `STATIC_BUILD_NO_OUT_DIR`)
- Approved: 2026-11-06, Prabhat ("yes")
- Branch: feature/cms

## Done =
A Vercel deployment finishes without `STATIC_BUILD_NO_OUT_DIR`, and the admin app's page and its CSS and JS load at `/la-studio/`.

## Root cause
`vercel.json` (added in `d72be19`) sets a `buildCommand` but no `outputDirectory`. The build completes, and Vite writes the admin to `cms/dist/admin` (`cms/vite.config.ts:18`). Vercel then looks for `public`, which this repo doesn't have, and stops.

The error comes after "the Build completed", so the build command itself got through. On a Production deployment that includes `pnpm db:migrate`. The build log should show `Migrations applied.`

## What was checked
- `cms/dist/admin/index.html` loads `/la-studio/assets/index-*.js` and `/la-studio/assets/index-*.css`.
- `dist/admin` is referenced only in `cms/vite.config.ts`.
- There is no root `api/` folder, and neither `cms/api/server.ts` nor `cms/api/app.ts` has a default export, which Vercel's Hono support requires.
- Vercel docs: `outputDirectory` overrides the dashboard setting; "Only the contents of this Output Directory will be served statically".
- Not checked: the Vercel dashboard (Root Directory, Framework Preset, `ADMIN_PATH`). No access from here.

## Plan
- [x] `cms/vite.config.ts`: change `outDir` to `` `../dist/${env.adminPath}` ``, so the files sit at the same path they're built for.
- [x] `vercel.json`: add `"outputDirectory": "cms/dist"`.
- [x] `vercel.json`: add a rewrite from `/la-studio/:path*` to `/la-studio/index.html`, so reloading `/la-studio/media` works. Real files are matched first.
- [x] `vercel.json`: redirect `/` to `/la-studio/`, because nothing else is served from this output.
- [x] Add a test that the output folder in `vercel.json` plus `ADMIN_PATH` holds `index.html` and every asset it links to after a build.
- [x] Run the exact build command under `sh` on the test database, then serve `cms/dist` locally and load `/la-studio/`, `/la-studio/media` and the assets.
- [x] Update `docs/mm-skill/wiki/cms.md` and `bugs-fixed` notes. Run the security gate and post-task review.

### Not in this fix: the API on Vercel
After this fix the build passes and the sign-in page appears, but **signing in will fail**: `/la-studio/api` has no Vercel Function, so it returns 404 or the admin page. That's the "Day 6" hosting work and needs its own plan:
- a Function entry for the Hono app, which must also call `env.jwtSecret()`
- a check that `sharp`, `@node-rs/argon2`, the workspace package and the `.ts` import paths work in a Vercel Function
- a Blob driver for media, since Vercel's request limit is 4.5 MB (now confirmed in the docs) and local files can't be kept there
- a decision on how Publish works there, since it writes files to disk

### What needs checking on Vercel
- Root Directory must be the repo root, or `vercel.json` is ignored.
- `ADMIN_PATH` must be unset or `la-studio`. Vite reads it during the build and `vercel.json` can't, so another value needs the same change in `vercel.json`.
- Clear any Output Directory override in the dashboard, or confirm that `vercel.json` wins.

### Alternatives
- Picked: output `cms/dist` with the admin in a `la-studio` folder. The URLs in the built page then match real files.
- Rejected: `"outputDirectory": "cms/dist/admin"`. The error goes away, but the files land at `/assets/...` while the page asks for `/la-studio/assets/...`, so the deployment is a blank page.
- Rejected: `"outputDirectory": "."`. It would publish the whole repo, including `cms/` source and `docs/`.
- Rejected: creating an empty `public` folder. Green build, nothing useful served.
- Rejected: removing `buildCommand`. It brings back the problem of migrations not running.

### Rollback
`git revert` the commit. Vercel's last good deployment stays live until a new one succeeds, and failed deployments don't replace it.

## Blast Radius
- State coupling: none.
- Caller coupling: `dist/admin` appeared only in `cms/vite.config.ts`. `pnpm dev:admin` doesn't use `outDir`.
- Sibling coupling: `pnpm build:site` writes to `.site-preview/`, not `cms/dist`.
- At-risk: the migration step of the build command, Preview builds skipping it, and the existing test suite.

## Failing Test
`cms/test/vercel.test.ts`, 3 tests. RED before the fix: `ENOENT ... public\la-studio\index.html`, and `vercel.rewrites` undefined. GREEN after it.

## Security Gate
Status: PASSED
- ✅ Purely functional bug, not exploitable.
- ✅ Same pattern elsewhere: no other build output is served.
- ✅ No new attack surface: only `cms/dist` is published. In the local check, `/package.json`, `/cms/env.ts`, `/docs/...` and `/.env` all returned 404.
- ✅ No security control changed, and no secrets in the diff. Not auth-related.
- 🟡 The local check imitates Vercel's routing with a script. It isn't Vercel itself.

## Code Review
Status: APPROVED
- ✅ Root cause fixed: output location declared, and it matches the URLs in the built page.
- ✅ Regression test builds the admin and checks every linked file, so the blank-page mistake would also fail it.
- ✅ Edge case: `/la-studio` without a trailing slash and deep links both return the admin page.
- 🟡 SUGGESTION: `la-studio` is written in `vercel.json` because that file can't read `ADMIN_PATH`. The new test fails if they differ locally, but not if only Vercel's value differs.

## Verification (2026-11-06)
- `pnpm test`: shared 152 passed, cms 266 passed, exit 0. Afterwards one type-only change in the new test (`m[1]!`), then `vercel.test.ts` 3 passed.
- `pnpm typecheck`: exit 0.
- Build command under `sh` on the test database: Production printed `Migrations applied.`, exit 0. Preview skipped migrations, exit 0.
- Output: `cms/dist/la-studio/index.html` and `assets/`.
- Local serving: `/` 307 to `/la-studio/`; `/la-studio`, `/la-studio/`, `/la-studio/media`, `/la-studio/pages/1` 200 with the admin page; both assets 200.
- NOT verified: a real Vercel deployment, its Root Directory and `ADMIN_PATH`, or the `:path*` rewrite on Vercel. Sign-in on Vercel will fail until the API has a Function.

## Final Status: DONE locally ✅, waiting for commit and a Vercel deployment
