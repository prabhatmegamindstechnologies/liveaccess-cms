// Small fetch helper for the CMS API. Sends the access token and renews it when needed; errors carry the API's message.
// The token lives in this module only, never in localStorage: a reload gets a new one through the refresh cookie.
import type { User } from "./auth.tsx";

export const ADMIN_PATH = __ADMIN_PATH__;
export const API_BASE = `/${ADMIN_PATH}/api`;

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

export type SignedIn = { user: User; accessToken: string; expiresIn: number; csrfToken?: string };

// Renew a little early, so a save made as the tab closes still has a valid token: it can't refresh and retry.
const RENEW_EARLY_MS = 60_000;

let accessToken = "";
let expiresAt = 0;
let csrfToken = "";
let refreshing: Promise<SignedIn | null> | null = null;
let onSignedOut = () => {};

export const setSignedOutHandler = (handler: () => void) => { onSignedOut = handler; };

export function setTokens(s: SignedIn) {
  accessToken = s.accessToken;
  expiresAt = Date.now() + s.expiresIn * 1000;
  if (s.csrfToken) csrfToken = s.csrfToken;
}

export function clearTokens() {
  accessToken = csrfToken = "";
  expiresAt = 0;
}

const expiring = () => !!accessToken && Date.now() > expiresAt - RENEW_EARLY_MS;

async function errorFrom(res: Response) {
  const body = await res.json().catch(() => null);
  return new ApiError(res.status, (body as { error?: string } | null)?.error ?? `Request failed (${res.status}).`, body);
}

async function askForToken() {
  const res = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "same-origin" });
  if (res.status === 401) {
    clearTokens();
    onSignedOut();
    return null;
  }
  if (!res.ok) throw await errorFrom(res);
  const s = await res.json() as SignedIn;
  setTokens(s);
  return s;
}

/** Null when the session has ended. Throws on a network or server failure, which says nothing about the session. */
export function refreshSession() {
  refreshing ??= askForToken().finally(() => { refreshing = null; });
  return refreshing;
}

/** For when the user comes back to the tab. There's no timer: it would keep idle sessions alive past their limit. */
export const refreshIfExpiring = () => { if (expiring()) refreshSession().catch(() => {}); };

type Options = { method?: string; json?: unknown; keepalive?: boolean; signal?: AbortSignal };

function send(path: string, opts: Options) {
  const headers: Record<string, string> = {};
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (path === "/auth/logout") headers["x-csrf-token"] = csrfToken;
  return fetch(API_BASE + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    credentials: "same-origin",
    keepalive: opts.keepalive,
    signal: opts.signal
  });
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  // A 401 from these two is the answer, not an expired token.
  const usesToken = path !== "/auth/login" && path !== "/auth/logout";
  if (usesToken && expiring()) await refreshSession().catch(() => {});
  let res = await send(path, opts);
  if (res.status === 401 && usesToken && accessToken && await refreshSession()) res = await send(path, opts);
  if (!res.ok) throw await errorFrom(res);
  return (res.status === 204 ? null : await res.json().catch(() => null)) as T;
}
