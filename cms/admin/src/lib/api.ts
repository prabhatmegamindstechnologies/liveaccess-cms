// Small fetch helper for the CMS API. Adds the CSRF token to every change; errors carry the API's message.

export const ADMIN_PATH = __ADMIN_PATH__;
export const API_BASE = `/${ADMIN_PATH}/api`;

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

let csrfToken = "";
export const setCsrfToken = (t: string) => { csrfToken = t; };

type Options = { method?: string; json?: unknown; keepalive?: boolean; signal?: AbortSignal };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-csrf-token"] = csrfToken;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    credentials: "same-origin",
    keepalive: opts.keepalive,
    signal: opts.signal
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `Request failed (${res.status}).`, body);
  return body as T;
}
