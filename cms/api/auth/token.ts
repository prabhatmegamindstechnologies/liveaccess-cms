// Access tokens: short-lived JWTs sent as "Authorization: Bearer". Ending one early isn't possible, which is why they last
// 15 minutes and why routes that need an instant answer use requireFreshUser.
import { sign, verify } from "hono/jwt";
import { env } from "../../env.ts";
import type { users } from "../../db/schema.ts";

export const ACCESS_TOKEN_SECONDS = 15 * 60;
// Fixed on both sides, so a token can't pick its own algorithm.
const ALG = "HS256";

export type TokenUser = Pick<typeof users.$inferSelect, "id" | "name" | "role" | "mustChangePassword">;

export function signAccessToken(user: TokenUser, sessionId: number) {
  const iat = Math.floor(Date.now() / 1000);
  return sign(
    { sub: String(user.id), sid: sessionId, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword, iat, exp: iat + ACCESS_TOKEN_SECONDS },
    env.jwtSecret(),
    ALG
  );
}

/** The user and session in a valid token, or null. */
export async function readAccessToken(token: string): Promise<{ user: TokenUser; sessionId: number } | null> {
  const claims = await verify(token, env.jwtSecret(), ALG).catch(() => null);
  if (!claims) return null;
  const { sub, sid, name, role, mustChangePassword, exp } = claims;
  const id = Number(sub);
  if (!Number.isInteger(id) || !Number.isInteger(sid) || typeof name !== "string" || typeof mustChangePassword !== "boolean" || typeof exp !== "number") return null;
  if (role !== "super_admin" && role !== "editor") return null;
  return { user: { id, name, role, mustChangePassword }, sessionId: sid as number };
}
