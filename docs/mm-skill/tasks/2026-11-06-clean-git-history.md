# Keep only the CMS commits in this repository

- Flow: SMALL_TASK
- Status: see Result below
- Requested: 2026-11-06, Prabhat ("In this repo I don't want old commit history here only want my cms commit history")
- Approved: 2026-11-06, Prabhat ("yes")
- Branch: feature/cms

## Done =
`feature/cms` on GitHub holds `main`'s Initial commit, one import commit for the existing site, and the 15 CMS commits. Its files are byte-for-byte the same as today, and a PR into `main` lists only those 16 commits.

## What exists today (checked 2026-11-06)
- `origin/feature/cms` at `43998da`: 87 commits. `origin/main` at `0259391`: 1 commit. Only those two branches on GitHub, and no tags.
- Old history: 71 commits from `c92fe5c` to `51a0d7c` (July to 2 November), by the old repo's authors and the website work before the CMS.
- CMS history: 15 commits from `391042b` to `e60de9f`, in a straight line with no merges.
- `43998da` is the merge that connected the branches. It's no longer needed after this.
- No tracked file mentions a commit hash, so no document goes stale.

## Brainstorm
N/A (SMALL_TASK — no brainstorm)

## Plan
New history:

```
0259391  Initial commit                        (main, unchanged)
<new>    Import the LiveAccess website         (all site files as of 51a0d7c, with main's README)
<new>    Add CMS foundation ...                (the 15 CMS commits, same authors, messages and dates)
...
<new>    Add the CMS Media library
```

- [ ] Fetch, and stop if `origin/feature/cms` isn't `43998da` (someone has pushed since).
- [ ] Keep a local backup branch, `backup/before-history-clean`, at `43998da`.
- [ ] Build the new history in a temporary worktree in the scratchpad, so the working folder and the uncommitted `.claude/settings.json` aren't touched.
- [ ] **Safety check:** the new tip's file tree must be identical to `43998da`'s. If it differs, stop and push nothing.
- [ ] Move local `feature/cms` to the new tip, then `git push --force-with-lease` to `feature/cms`, naming the expected old commit. `main` isn't touched.
- [ ] Confirm from GitHub: tip matches, 16 commits ahead of `main`, 0 behind, and the same files.

### What this changes
- Every CMS commit gets a new hash. Authors, messages and dates stay the same.
- The 71 old commits, including Rahul's and Nikunj's, leave this repo's branches. Their work stays in the files, under the one import commit.
- Anyone else with a clone of `feature/cms` must re-clone or hard-reset it, or they'd push the old history back.
- Vercel will deploy again. The files are the same as the current deployment.

### What this can't remove
Closed PR #1 keeps pointing at the old commits, and GitHub keeps them for it. Its Commits tab will still list them. Only GitHub Support can remove that, or creating the repository afresh.

### Alternatives
- Picked: one import commit, then the replayed CMS commits. The CMS commits only make sense on top of the site, so its files must come from somewhere.
- Rejected: squashing everything into one commit, because you asked to keep the CMS history.
- Rejected: changing `main` as well, because it isn't needed.

### Rollback
Until the force-push nothing has changed on GitHub. After it: `git push --force-with-lease origin backup/before-history-clean:feature/cms`.

## Result (2026-11-06)
Done. `origin/feature/cms` moved from `43998da` to `6294e18`; `main` is unchanged at `0259391`.
- 16 commits ahead of `main`, 0 behind, merge base `0259391`, no file differences from `43998da`.
- The 15 CMS commits keep their authors, author dates and messages.
- Changed from the plan: commit dates, not author dates, are raised to 2026-11-04 for the 6 commits older than `main`'s Initial commit. Otherwise commits would be older than their parent, which gave a wrong "behind main" count.
- Local backup branch `backup/before-history-clean` stays at `43998da`. Delete it once you're happy.
- This record is untracked, so the pushed files stayed identical. Commit it with the next change.
- PR #1 still shows the old commits, as expected. Not checked: the GitHub web page itself (private repo, no CLI here).
