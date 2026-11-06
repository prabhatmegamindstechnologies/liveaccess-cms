# Run database migrations on Vercel deployments

- Flow: SMALL_TASK
- Status: done locally; not yet proven on a real Vercel deployment
- Requested: 2026-11-06, Prabhat ("let check why migration file not run on deployment at vercel", then "use option 1")
- Approved: 2026-11-06, Prabhat ("yes": `feature/cms` deploys as Production, on a single Vercel project)
- Branch: feature/cms

## Done =
Each Vercel deployment that owns a database applies pending migrations during its build, and a failed migration stops that deployment.

## Root cause (checked 2026-11-06)
Nothing runs migrations on deployment. `cms/db/migrate.ts` runs only through `pnpm db:migrate` and the test helper. The repo has no `vercel.json` in any commit, and `deploy.yml` only copies site files over FTP.
The Vercel dashboard's Build Command couldn't be checked: the CLI isn't installed and the repo isn't linked.

## Brainstorm
N/A (SMALL_TASK — no brainstorm)

## Plan
- [ ] Add `vercel.json` at the repo root with only `$schema` and `buildCommand`. Output folder and framework stay as set in the dashboard.
- [ ] Prove the command locally against the test database, with and without `VERCEL_ENV`, and with a failing migration.
- [ ] Update `docs/mm-skill/wiki/cms.md`.
- [ ] Security gate — PENDING
- [ ] Code review — PENDING
- [ ] Verification — PENDING

Command, if migrations run on Production only:

`pnpm build:admin && if [ "$VERCEL_ENV" = "production" ]; then pnpm db:migrate; fi`

### Changes from the option as first described
- **Build first, then migrate.** The first version migrated first, so a failed build would leave the database ahead of the code that's live.
- **Environment check.** Without one, every preview build migrates whichever database `DATABASE_URL` points at. If the variable is scoped to Production only, as advised, preview builds would instead fail with "Missing environment variable DATABASE_URL".

### Open questions
1. Which Vercel environment deploys `feature/cms`? Vercel treats only its Production Branch as Production, so if this branch deploys as a Preview, a Production-only check would never run for it.
2. Is there more than one Vercel project on this repo? The wiki plans two. A root `vercel.json` applies to each project whose Root Directory is the repo root, so a site project would also run this command.

### Alternatives
- Picked: `vercel.json`, because it's reviewed in git and can't be lost in a settings change. It overrides the dashboard's Build Command, so anything else in that command must be copied in.
- Rejected: `if [ -n "$DATABASE_URL" ]`, which quietly skips migrations when the variable is missing, the same failure as today.

### Rollback
Delete `vercel.json`, or `git revert` the commit. Migrations already applied stay applied.

## Security Gate
Status: PASSED
- ✅ No secrets in `vercel.json`; `DATABASE_URL` stays in Vercel's settings.
- ✅ No injection risk: the command is fixed and only compares `VERCEL_ENV`.
- ✅ No control removed. Previews can no longer migrate a database by accident.

## Code Review
Status: APPROVED
- ✅ Logic matches the plan, proven case by case below. No dead code.
- 🟡 SUGGESTION: the build log only says `Migrations applied.`, not which ones.

## Verification (2026-11-06, the command from `vercel.json`, run under `sh` on the test database)
| Case | Exit | Migrated |
|---|---|---|
| Production, database set | 0 | yes |
| Preview | 0 | no |
| No `VERCEL_ENV` | 0 | no |
| Production, no `DATABASE_URL` | 1 | no, "Missing environment variable DATABASE_URL" |
| Production, database down | 1 | no |
| Failed build | 1 | no |

All 7 migration files are applied on the test database. NOT verified: a real Vercel deployment, and the project's Root Directory (the root `vercel.json` only applies if it's the repo root).
