// The few GitHub API calls Publish needs: read a branch's files, and add one commit on top of it.
// Uses the Git Data API (blobs, trees, commits, refs), so one publish is one commit however many files it changes.
import { createHash } from "node:crypto";

export type GithubConfig = { token: string; repo: string; branch: string; fetch?: typeof fetch };
export type TreeFile = { path: string; sha: string; size: number };

const API = "https://api.github.com";

/** The settings Publish needs, or the names of the missing ones. */
export function githubFromEnv(e: NodeJS.ProcessEnv = process.env): { config: GithubConfig | null; missing: string[] } {
  const token = e.GITHUB_TOKEN?.trim() ?? "";
  const repo = e.GITHUB_REPO?.trim() ?? "";
  const branch = e.GITHUB_BRANCH?.trim() || "main";
  const missing = [!token && "GITHUB_TOKEN", !repo && "GITHUB_REPO"].filter((m): m is string => !!m);
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) missing.push("GITHUB_REPO (owner/name)");
  return { config: missing.length ? null : { token, repo, branch }, missing };
}

/** Git's own id for a file's content, so files can be compared with the repo without downloading them. */
export const gitBlobSha = (data: Buffer) => createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");

export class GithubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function github(cfg: GithubConfig) {
  const doFetch = cfg.fetch ?? fetch;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await doFetch(`${API}/repos/${cfg.repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "liveaccess-cms",
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const detail = await res.json().then((j: { message?: string }) => j.message ?? "", () => "");
      throw new GithubError(res.status, `GitHub ${method} ${path.split("?")[0]} answered ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json() as Promise<T>;
  };
  const ref = `heads/${cfg.branch}`;

  return {
    /** The branch's latest commit and every file in it. */
    async head() {
      const r = await call<{ object: { sha: string } }>("GET", `/git/ref/${ref}`);
      const commit = await call<{ tree: { sha: string } }>("GET", `/git/commits/${r.object.sha}`);
      const tree = await call<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean }>(
        "GET", `/git/trees/${commit.tree.sha}?recursive=1`);
      if (tree.truncated) throw new Error("The repository is too large to read in one go.");
      const files: TreeFile[] = tree.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, sha: t.sha, size: t.size ?? 0 }));
      return { commit: r.object.sha, tree: commit.tree.sha, files };
    },

    async blob(sha: string) {
      const b = await call<{ content: string; encoding: string }>("GET", `/git/blobs/${sha}`);
      return Buffer.from(b.content, b.encoding === "base64" ? "base64" : "utf8");
    },

    /** Adds one commit with these files on top of `parent`. Fails (409) if the branch has moved since. */
    async commit(opts: { parent: string; baseTree: string; message: string; files: { path: string; data: Buffer }[] }) {
      const entries = [];
      for (const f of opts.files) {
        const b = await call<{ sha: string }>("POST", "/git/blobs", { content: f.data.toString("base64"), encoding: "base64" });
        entries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
      }
      const tree = await call<{ sha: string }>("POST", "/git/trees", { base_tree: opts.baseTree, tree: entries });
      const commit = await call<{ sha: string; html_url: string }>("POST", "/git/commits", { message: opts.message, tree: tree.sha, parents: [opts.parent] });
      try {
        await call("PATCH", `/git/refs/${ref}`, { sha: commit.sha, force: false });
      } catch (e) {
        // Not a fast-forward: someone pushed meanwhile. The new commit stays unreferenced and GitHub cleans it up.
        if (e instanceof GithubError && e.status === 422) throw new GithubError(409, "The website's branch changed while publishing.");
        throw e;
      }
      return { sha: commit.sha, url: commit.html_url };
    }
  };
}
