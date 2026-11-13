// /<ADMIN_PATH>/api/publish/live — Publish to the website: one commit on the website's GitHub branch.
// GET: whether Publish is set up, and the last publishes (any signed-in user). POST: publish (Super Admins, checked in the database).
import { Hono } from "hono";
import type { Db } from "../../db/client.ts";
import { GithubError, type GithubConfig } from "../../publish/github.ts";
import { PublishBusy, publishLive, recentPublishes } from "../../publish/publish-live.ts";
import { audit } from "../audit.ts";
import { requireFreshUser, requireSuperAdmin, requireUser, type FreshAuthVars } from "../auth/require-user.ts";
import { clientIp } from "../client-ip.ts";
import type { MediaStorage } from "../media/storage.ts";

export type GithubSettings = () => { config: GithubConfig | null; missing: string[] };

export function publishLiveRoutes(db: Db, opts: { github: GithubSettings; storage: MediaStorage; trustProxy?: boolean }) {
  const app = new Hono<{ Variables: FreshAuthVars }>();

  app.get("/", requireUser(), async (c) => {
    const { config, missing } = opts.github();
    return c.json({
      configured: !!config, missing,
      repo: config?.repo ?? null, branch: config?.branch ?? null,
      publishes: await recentPublishes(db)
    });
  });

  app.post("/", requireFreshUser(db), requireSuperAdmin, async (c) => {
    const { config, missing } = opts.github();
    if (!config) return c.json({ error: `Publishing isn't set up on this server. Missing: ${missing.join(", ")}.` }, 503);
    const user = c.get("user");
    try {
      const outcome = await publishLive(db, { github: config, storage: opts.storage, user: { id: user.id, name: user.name } });
      await audit(db, {
        userId: user.id, action: "site_published", entityType: "publish", ip: clientIp(c, !!opts.trustProxy),
        detail: { commit: outcome.commit?.sha ?? null, files: outcome.files.length }
      });
      return c.json(outcome);
    } catch (e) {
      if (e instanceof PublishBusy) return c.json({ error: e.message }, 409);
      if (e instanceof GithubError && e.status === 409) return c.json({ error: "The website changed while publishing. Nothing was published; try again." }, 409);
      console.error(e);
      if (e instanceof GithubError) {
        return c.json({ error: `GitHub refused the publish (${e.status}). Check GITHUB_TOKEN and GITHUB_REPO. Nothing was published.` }, 502);
      }
      return c.json({ error: "The site couldn't be published. Nothing went live." }, 500);
    }
  });

  return app;
}
