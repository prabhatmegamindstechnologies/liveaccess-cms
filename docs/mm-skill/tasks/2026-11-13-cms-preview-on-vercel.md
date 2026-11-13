# CMS: Publish to the website from Vercel (GitHub commit)

- Flow: FEATURE
- Status: done locally (approved 2026-11-13, Prabhat: "yes"), waiting for a real publish on Vercel
- Requested: 2026-11-13, Prabhat ("how to fix that such that I can check live preview", screenshot of the Publish centre on Vercel:
  "The local preview is only available when the CMS runs on your own computer.")
- Scope change: 2026-11-13, Prabhat: "Part B chahiye mujhe". Part A (public preview on Vercel) is dropped from this task.
- Branch: feature/cms

## Done =
On the Vercel deployment, a Super Admin clicks "Publish to website" in the Publish centre, and the site built from the current drafts
lands as one commit on `main` of `prabhatmegamindstechnologies/liveaccess-cms`, with the drafts marked as published.

## What exists today (checked 2026-11-13)
- `publish/build-site.ts` `buildSite()` builds the whole site from drafts into `.site-preview/` (disk), swapping a temp folder in.
- `api/preview-server.ts` serves that folder on `localhost:4000`, a separate origin, with a strict CSP, analytics blocked, noindex,
  and only the contact form POST allowed.
- `api/publish/routes.ts` (`POST/GET /publish/preview`) is mounted only when the CMS runs locally (`cfg.preview`), so on Vercel the
  Publish centre shows "only available ... on your own computer" (`admin/src/screens/PublishCentre.tsx:49`).
- Vercel Functions have only a temporary `/tmp`, separate per instance, and no second server/port.
- Media uploads are off on Vercel (no Blob driver yet), so previews can only show images that ship with the site.

## Brainstorm
Answers (2026-11-13, Prabhat: "1 koi bhi dekh skta hai 2 ussi domain pr https://liveaccess-cms-git-main-prabhat-5653.vercel.app 3 Haa
4 asli website live krna hai"):
1. **(b)** Anyone with the link can open the preview, no sign-in. Still `noindex` and no analytics, so search engines and stats stay clean.
2. **(a)** Same domain as the admin, under `/la-studio/preview/`.
3. **(b)** The contact form works in the preview (messages land in the Contact inbox).
4. **(b)** Publish to the real website is in scope. Open: where the live site is hosted (follow-up question 5).

Found for question 5: today `liveaccess.ai` is deployed by `.github/workflows/deploy.yml` on push to `main` of the TPS-LiveAccess repo,
copying the site files over plain FTP (port 21) with secrets `SFTP_HOST/USERNAME/PASSWORD/REMOTE_PATH`.

5. **(a)** Publish commits the built site to GitHub, and `.github/workflows/deploy.yml` uploads it (as today). Repo:
   **`prabhatmegamindstechnologies/liveaccess-cms`**, branch `main` (Prabhat, 2026-11-13). That repo has no FTP secrets, so for now
   Publish updates the repo but not `liveaccess.ai`; switching to the company repo later is a settings change, not code.

Also found: the site files are 13 MB, of which 13 MB is `videocall_demovideo.mp4`. A Vercel Function response is limited to about
4.5 MB (Vercel docs), so the video can't be served through the Function.

## Plan

### Approach
Picked: **build in the Function's `/tmp`, serve the preview from the Function, publish through the GitHub API (one commit).**
Rejected:
- Storing built files in the database: more tables and code for files that can be rebuilt from the drafts in seconds.
- FTP from the Function (question 5 (b)) and moving the site to Vercel (5 (c)): see the brainstorm.

### Dropped (Prabhat, 2026-11-13: "Part B chahiye mujhe")
Part A, the public preview on Vercel (`/la-studio/preview/`, sandbox, contact form in the preview). Brainstorm answers 1–3 apply to it
and are kept for when it's picked up. "Build preview" stays local-only, as today.

### Needed from Part A for publishing
- [ ] A1. **Build where Vercel allows writing**: `buildSite()` runs with its output in `/tmp` and site files from the Function bundle.
      `vercel.json` `includeFiles` gets the site's files (`*.css`, `*.js`, `*.png`, `*.svg`, `*.woff2`, `*.xml`, `.htaccess`, `images/**`),
      but not the 13 MB video (it's already in the repo and never changes through the CMS).

### Part B: Publish to the website (GitHub commit)
- [ ] B1. **Settings** (Vercel environment variables, never in code): `GITHUB_TOKEN` (fine-grained token: this one repo,
      Contents read & write, nothing else), `GITHUB_REPO=prabhatmegamindstechnologies/liveaccess-cms`, `GITHUB_BRANCH=main`.
      Without them, the Publish button says what's missing.
- [ ] B2. **What gets published**: the same build as the preview. Only files that differ from the repo's `main` are sent (compared by
      Git blob hash): HTML pages, guides, areas, `consent.js`, `robots.txt`, `llms.txt`, `sitemap.xml`, `.htaccess`, library images.
      Nothing is deleted from the repo.
- [ ] B3. **One commit per publish**, through the GitHub API (blobs → tree → commit → move `main`), message
      "Publish from CMS by <name>". If `main` moved meanwhile, nothing is written and the user is asked to try again.
- [ ] B4. **After a successful commit**: drafts are marked as published (`pages.published_html`, `articles.published`), the
      `publish_jobs` row gets the commit link and the file list, and the audit log gets `site_published`.
- [ ] B5. **Who can publish**: Super Admins only. Building the preview stays open to every signed-in user.
- [ ] B6. **Publish centre**: "Publish to website" button with a confirm step, the list of changed files, and the last publishes with
      links to their GitHub commits.

### Part C: Repo and deploy side effects
- [ ] C1. `deploy.yml`: skip the FTP step when the `SFTP_HOST` secret isn't set, so every publish to this repo doesn't fail with an email.
- [ ] C2. `vercel.json` `ignoreCommand`: a commit that only changes site files (a publish) doesn't rebuild the CMS.
- [ ] C3. **Your push workflow changes**: once the CMS commits to `main`, `git push personal feature/cms:main --force` would erase those
      publishes. From then on: `git pull personal main`, then push without `--force`. Written into the wiki.

### Tests (first, on the local Docker test database only)
- Build into a temp folder outside the repo (as on Vercel), with the site files the Function bundle has.
- Publish with a fake GitHub API: only changed files are sent, one commit, `main` moved → nothing written, drafts marked published
  only after success, editors refused.
- Before any test: check that `TEST_DATABASE_URL` points at localhost, and refuse to run otherwise (a guard in `test/helpers.ts`), so
  the tests can't wipe Neon again.

### Changed while building (2026-11-13)
- **A1 replaced**: the build's base files come from the branch's latest commit (read through the GitHub API into `/tmp`), not from
  the Function bundle. The bundle is a snapshot from the last CMS deploy, so building on it would undo anyone's later change to a
  site file (for example `common.css`). Nothing extra goes into `includeFiles`. The 13 MB video isn't read.
- **Found and fixed**: the build appended the CMS redirects to `.htaccess` every time, so publishing on top of a published
  `.htaccess` would have doubled them (`withoutCmsRedirects` in `packages/shared/src/publish.ts`).
- **Found and fixed**: marking pages published set `published_at` on every page, so every publish would have changed every
  `lastmod` in `sitemap.xml`. Now only a page whose HTML changed gets a new date.
- **First publish** of the imported site changes 5 files: `contact.html` (form → `/la-studio/api/contact`), `sitemap.xml` (dates),
  and 3 guides where the build writes `'` for `&#x27;` (same text in a browser). A second publish changes nothing.
- `maxDuration` raised from 15 to 60 seconds for Publish (reads the branch, builds, commits).

### Verify on Vercel (Prabhat)
Edit a page → Publish to website → see one commit on GitHub with only the changed file(s) → the page shows as published in the CMS.

### Not in this task
The public preview on Vercel (Part A), media uploads on Vercel (Blob), the company repo and real FTP deploy, a custom domain, deleting
pages from the live site.

### Blast Radius
- `buildSite()` is shared by the local preview, so local behaviour must stay the same (existing `publish.test.ts`).
- `app.ts`: mounts the publish route on Vercel too (Super Admin only). The same-origin check is unchanged.
- `vercel.json` (includeFiles, ignoreCommand), `deploy.yml`, Publish centre screen.
- At-risk: the live repo's `main` (a wrong publish commits wrong files). Rollback: `git revert` that commit; the CMS drafts are untouched.

### Security notes for the gate
- `GITHUB_TOKEN` scoped to one repo, Contents only, stored only in Vercel.
- Publish is Super Admin only and audited. The commit only touches the site's own file types at the repo root, `images/` and the
  media folder: never `cms/`, `api/`, `packages/`, `.github/` or `vercel.json`.

## Security Gate
Status: PASSED
- ✅ `GITHUB_TOKEN` only from the environment; never logged, returned or stored. GitHub error text is passed on, the token isn't in it.
- ✅ Publish is Super Admin only, checked against the database (`requireFreshUser` + `requireSuperAdmin`), and audited (`site_published`).
- ✅ Only `SITE_PATH` files are read from or written to the branch (test repo includes `cms/api/app.ts`; never read or committed).
- ✅ Ref update is never forced: a moved branch means nothing is written (409), drafts unchanged.
- ✅ One publish at a time (running job in the database; a stale one expires after 5 minutes). `/tmp` folders removed afterwards.
- ✅ Tests can no longer reach a remote database (`assertLocalDatabase`).
- 🟡 Two simultaneous clicks can both pass the "already running" check in the same instant; the non-forced ref update still keeps the
  branch consistent (the second one gets 409).
- 🟡 Pointing `GITHUB_REPO` at the company repo publishes `contact.html` with its form sending to `/la-studio/api/contact` on
  `liveaccess.ai`, which only works once the API is served on that domain (planned shared domain). Until then the live contact form
  would fail. Not an issue for the personal repo (no FTP deploy).

## Code Review
Status: APPROVED
- ✅ Plan items B1–B6, C1–C3 done; A1 replaced by building on the branch's files (safer, see "Changed while building").
- ✅ Local preview unchanged: existing `publish.test.ts` passes.
- ✅ Idempotent: a second publish with no draft changes commits nothing (test).
- 🟡 `tsc -p tsconfig.json` (root, used by Vercel for diagnostics) reports 2 type errors in older files (`require-user.ts`, `storage.ts`)
  from a different `@types/node` resolving at the repo root. Same before this task; Vercel builds anyway. Worth fixing separately.

## Verification (2026-11-13, local Docker database)
- `pnpm test`: shared 176 passed, cms 329 passed (19 files), exit 0. `test/publish-live.test.ts`: 10 passed.
- `pnpm typecheck`: exit 0.
- NOT verified yet: a real publish on Vercel to GitHub (needs the token in Vercel).

## Final Status: DONE locally ✅, waiting for push, token and a real publish
