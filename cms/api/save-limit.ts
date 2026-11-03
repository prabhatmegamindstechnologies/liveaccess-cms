// Per-user limit on saves. In-memory, per server instance; a shared limiter comes with the Day 6 rate limits.
import type { MiddlewareHandler } from "hono";
import type { AuthVars } from "./auth/require-user.ts";

export type SaveLimit = { max: number; windowMs: number };

export function saveLimit(limit: SaveLimit): MiddlewareHandler<{ Variables: AuthVars }> {
  const recent = new Map<number, number[]>();
  return async (c, next) => {
    if (c.req.method === "GET") return next();
    const id = c.get("user").id, now = Date.now();
    const hits = (recent.get(id) ?? []).filter((t) => now - t < limit.windowMs);
    if (hits.length >= limit.max) return c.json({ error: "Too many saves. Wait a moment and try again." }, 429);
    hits.push(now);
    recent.set(id, hits);
    await next();
  };
}
