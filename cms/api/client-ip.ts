// The caller's IP for audit entries (and Day 6 rate limits).
// Headers are only trusted behind a known proxy: on Vercel, `x-real-ip` is set by the platform, not the client.
// The leftmost x-forwarded-for entry is never used, because the client controls it.
import type { Context } from "hono";

export function clientIp(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) return c.req.header("x-real-ip") ?? null;
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? null;
}
