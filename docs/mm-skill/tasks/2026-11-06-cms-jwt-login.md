# CMS: JWT login

- Flow: FEATURE
- Status: done
- Requested: 2026-11-06, Prabhat ("I want to use the jwt token for login purpose so implement that")
- Approved: 2026-11-06, Prabhat ("yes")
- Branch: feature/cms

## Done =
CMS sign-in issues a JWT, and every protected CMS API route is authorised by verifying it, with the current account rules still enforced.

## What exists today (checked 2026-11-06)
- `cms/api/auth/session.ts`: server-side sessions. Cookie `la_session` holds a random token; the `sessions` table holds its SHA-256.
  Sessions end after 8 idle hours or 7 days.
- Cookie is `httpOnly`, `sameSite: Strict`, `Secure` unless `CMS_INSECURE_COOKIES=1`, path `/<ADMIN_PATH>`.
- `cms/api/auth/require-user.ts`: `requireUser` reads the session, checks the CSRF token on changes, and blocks everything else while
  `mustChangePassword` is set. It also sets `c.get("session")`, which `auth/routes.ts` and `users/routes.ts` use.
- Sessions are ended at once on password change, role change, disable, reset, and too many wrong own-password tries
  (`auth/routes.ts:112`, `users/routes.ts:132`, `:205`, `:247`).
- Admin app: `cms/admin/src/lib/api.ts` uses `credentials: "same-origin"` and sends `x-csrf-token`; `lib/auth.tsx` restores sign-in from `/auth/me`.
- No JWT library is installed. `hono` includes `hono/jwt`. No `JWT_SECRET` in `cms/env.ts` or `.env.example`.

## Brainstorm
Answers (2026-11-06, Prabhat):
- Who uses the JWT: **(a)** only the CMS admin app in the browser.
- Token transport: **(b)** `Authorization: Bearer` header.
- Sign-out speed: **(a)** short-lived JWT (15 minutes) plus a refresh token stored in the database.

- Refresh token: **approach 1**, an `httpOnly` cookie sent only to `/<ADMIN_PATH>/api/auth`.
- Accepted trade-off: an XSS attack can use the 15-minute token while the page is open, but can't take the refresh token.
- Accepted delay: on routes without a database check, a removed or demoted user can keep access for up to 15 minutes.

## Plan

### How it will work
1. **Sign-in:** `POST /auth/login` keeps every current check (lockout, timing, temporary passwords, audit). It creates a `sessions` row, sets
   the refresh cookie, and returns `{ user, accessToken, csrfToken }`.
2. **Access token:** HS256 JWT, 15 minutes. Claims: `sub` (user id), `sid` (session id), `name`, `role`, `mustChangePassword`, `iat`, `exp`.
   The admin app keeps it in a JavaScript variable only, never in `localStorage`.
3. **API calls:** `requireUser` verifies `Authorization: Bearer`, with HS256 fixed so the token can't choose its own algorithm. The cookie alone
   gets 401. Protected routes no longer need `x-csrf-token`, because a browser doesn't add a Bearer header by itself.
4. **Refresh:** `POST /auth/refresh` reads the cookie, runs the `readSession` checks (session exists, inside 8 idle hours and 7 days, user active),
   renews the idle limit and the cookie, and returns `{ user, accessToken, csrfToken }`. It replaces `GET /auth/me`, and the app calls it on page load.
5. **Sign-out:** `POST /auth/logout` uses the cookie plus `x-csrf-token`, as today. It deletes the session and clears the cookie.
6. **Database check on sensitive routes:** new `requireFreshUser` loads the session and user on every request, so a deleted session or a role change
   counts at once. Used on `/users`, `/audit` and `/auth/change-password`.

### Files
| File | Change |
|---|---|
| `cms/api/auth/token.ts` (new) | Sign and verify access tokens using `hono/jwt` (already installed, no new dependency) |
| `cms/api/auth/require-user.ts` | `requireUser` verifies the JWT; add `requireFreshUser`; `requireSuperAdmin` unchanged |
| `cms/api/auth/session.ts` | Rename the cookie to `la_refresh`; add `readSessionById` for `requireFreshUser` |
| `cms/api/auth/routes.ts` | Login returns the token; add `/refresh`; remove `/me`; cookie path `/<ADMIN_PATH>/api/auth`; change-password returns a new token |
| `cms/api/users/routes.ts`, `cms/api/audit/routes.ts` | Use `requireFreshUser` |
| `cms/api/preview-assets.ts` | Remove `requireUser` (see Alternatives) |
| `cms/env.ts`, `cms/api/server.ts`, `.env.example` | `JWT_SECRET`, at least 32 characters; the server refuses to start without it |
| `cms/admin/src/lib/api.ts` | Hold the token; add the Bearer header; refresh early; retry once on 401; one refresh at a time |
| `cms/admin/src/lib/auth.tsx` | Start from `/auth/refresh`; return to sign-in when refresh fails |
| `cms/test/helpers.ts` + 11 test files | Sign in through a shared helper and send the Bearer header |
| `docs/mm-skill/wiki/cms.md` | Record the new auth |

No database migration: `sessions` already has `tokenHash`, `csrfToken`, `expiresAt` and `createdAt`.

### Callers and contracts
`requireUser` is used by: `articles/routes.ts:66`, `audit/routes.ts:67`, `menus/routes.ts:36`, `users/routes.ts:105`, `dashboard/routes.ts:18`,
`publish/routes.ts:17`, `preview-assets.ts:19`, `seo/routes.ts:71`, `settings/routes.ts:40`, `pages/routes.ts:31`, `auth/routes.ts:87`.

`c.get("user")` today is the full `users` row. After this change, `requireUser` gives `{ id, name, role, mustChangePassword }`.
- Still works: `.id` (all routes, `save-limit.ts:11`), `.name` (`articles/routes.ts:100`, `:176`), `.role` (`requireSuperAdmin`, `menus:50`, `seo:87`, `settings:50`).
- Would break, so moved to `requireFreshUser`, which still gives the full row: `.passwordHash` at `users/routes.ts:126` and `auth/routes.ts:94`, `:109`.
- Typecheck will show any field missed here.

`c.get("session").id` (`auth/routes.ts:112`, `users/routes.ts:132`, `:205`) keeps working, filled from `sid`.

Browser requests that can't send a Bearer header:
- `admin/src/lib/preview.ts:5`: `preview-assets` is loaded by `<link>` and `<img>` tags (dev only).
- `PageEditor.tsx:75`: a `keepalive` save while the tab closes can't refresh and retry. The app therefore also refreshes when the tab regains focus
  if the token is close to expiry. A timer isn't used, because it would keep idle sessions alive past the 8-hour limit.

### Alternatives
- Picked: reuse `sessions` for refresh tokens. Rejected: a new `refresh_tokens` table, which would mean a migration and changes to all four places that end sessions.
- Picked: keep the same refresh token for the life of the session, like `la_session` today. Rejected: a new token on every refresh, because two open tabs
  refreshing together would sign each other out unless we add a migration and a grace period. Cost: a stolen refresh cookie works until the session ends.
- Picked: remove auth from dev-only `preview-assets`, which serves the public site's CSS, fonts and images and isn't mounted in production. Path limits and
  sandbox headers stay. Rejected: widening the cookie path to `/<ADMIN_PATH>`, which sends the refresh token to every API route.
- Picked: `hono/jwt` (`sign`/`verify` signatures checked in the installed 4.13.14 types). Rejected: `jsonwebtoken` or `jose`, an extra dependency for the same work.
- Picked: read `JWT_SECRET` in `token.ts`. Rejected: passing it through `createApp`, which changes all 11 `requireUser` call sites.

### Behaviour changes
- Everyone signs in again once, because old `la_session` cookies stop working.
- A demoted Super Admin could still save Menus, SEO or Site settings for up to 15 minutes. Users and Audit take effect at once.
- After sign-out, a copied access token still works for up to 15 minutes on routes without a database check.
- Active users can stay signed in up to the documented 7 days. Today the cookie is set once with an 8-hour life, so it ends at 8 hours even if the user is active.

### Tests (written first)
- Login returns a token and sets `la_refresh` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/la-studio/api/auth`.
- Bearer token accepted; 401 for no token, an expired token, a wrong signature, `alg: none`, or the cookie alone.
- Refresh: works with the cookie; refused after sign-out, disable, reset, password change, idle limit and 7-day limit; refused cross-site.
- `requireFreshUser`: a still-valid token is refused on `/users` and `/audit` after its session is deleted or the role is changed.
- `mustChangePassword` blocks other routes; change-password returns a token that works on them.
- Existing suites stay green. Each per-route "missing CSRF token gets 403" test becomes "cookie alone gets 401".
- Admin app: sign in, reload, and sign out in the browser. Then force an expired token during a page save and confirm the save succeeds.

### Rollback
Nothing changes in the database, so `git revert <commit>` restores session auth. Users would sign in again once.
Roll back if sign-in loops, saves fail with 401 after a refresh, or `pnpm test` can't be made green.

## What changed from the plan
- `requireUser` no longer takes `db`, so its call sites did change: it had no use for it. `JWT_SECRET` is still read in `token.ts`.
- `api/server.ts`: `siteRoot` now needs `local`, not just `dev`. `preview-assets` is open now, so a host that forgets `NODE_ENV` must not get it.
- `cms/test/helpers.ts` wasn't changed: each suite's sign-in reads `accessToken` itself.
- The per-route "cookie alone gets 401" tests became one table in `auth.test.ts` covering 18 routes, plus a no-token check in each suite.
- Two tests changed because of the accepted 15-minute delay: `users.test.ts` (a disabled user now fails on refresh, not on `/pages`) and
  `dashboard.test.ts` (the forced password change applies to tokens issued after it).

## Security Gate
Status: PASSED, from my own review of the diff. The independent `security-auditor` agent pass in the gate was NOT run: agents are only started when Prabhat asks.
Findings:
- ✅ Inputs: tokens are verified with HS256 fixed, and claim types are checked. Forged, expired, `alg: none`, HS512 and missing-claim tokens are all refused by tests.
- ✅ Permissions: all protected routes need a token; a cookie alone gets 401 on 18 routes. `/users`, `/audit` and change-password use the database role and session.
- ✅ New endpoint `/auth/refresh`: needs the refresh cookie, refuses cross-site requests, `no-store`.
- ✅ Dependencies: none added. `pnpm audit --audit-level=high` exit 0.
- ✅ Injection: no new raw SQL. Sensitive data: claims hold no email or password data; responses use `publicUser`; no token is logged.
- ✅ Secrets: none in the diff (scan matched only a test's sample password); `.env` is git-ignored and untracked.
- 🟡 Accepted delay: up to 15 minutes of access on `requireUser()` routes after a disable, role change or sign-out. This includes a demoted Super Admin saving Menus, SEO and Site settings.
- 🟡 XSS can use the access token while the page is open (accepted). The rich-text cleaning in `RichTextEditor.tsx` is the defence, so keep it strict.
- 🟡 `/auth/refresh` has no rate limit, as `/auth/me` had none. Add one with the hosting setup if abuse is a concern.
- 🟡 `JWT_SECRET` must be set per environment, and the Vercel entry must call `env.jwtSecret()` at startup.
- 🟡 Existing, unrelated: esbuild 0.18.20 has a moderate dev-server advisory (dev tooling only).

## Code Review
Status: APPROVED, by reading the full diff. `code-review-graph` isn't installed, so the graph review wasn't used.
Notes:
- ✅ Fixed in review: after a refresh proved the session had ended, `api()` sent a doomed request and asked for a second refresh.
- ✅ Callers traced in the plan; typecheck confirms the narrower `c.get("user")`.
- ✅ No old auth left in code (`SESSION_COOKIE`, `/auth/me`, `setCsrfToken`). `x-csrf-token` remains only for sign-out, as planned.
- 🟡 SUGGESTION: when a session ends mid-edit the app goes to sign-in and text not yet auto-saved is lost. Before, the user stayed on the screen with an error.
- 🟡 SUGGESTION: a `keepalive` save as the tab closes can't refresh and retry, if the token expired since the user's last action. Focus refresh makes this rare.

## Verification (2026-11-06, final run after the last code change)
- `pnpm test`: exit 0. shared 133 passed, cms 227 passed (205 before).
- `pnpm typecheck`: exit 0. `pnpm build:admin`: exit 0.
- Real admin app in headless Chrome, on throwaway servers and the test database: 19 of 19 checks passed, including sign-in, reload, cookie and storage safety, an expired token
  during a page save, early and focus refresh, preview files, sign-out, forced password change, and a session ended mid-use.
- Migration, Vercel and production hosting weren't exercised: no migration exists, and the Vercel entry isn't built yet.
