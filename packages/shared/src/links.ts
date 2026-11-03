// Checks for links that editors type in (menus, redirects).

const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;

/**
 * A full https:// address that is safe to write into a page, in the form the browser will use
 * (lower-case host, trailing slash, punycode), or null. No user:password, no hidden characters.
 */
export function safeHttpsUrl(s: string, maxLength = 300): string | null {
  if (!/^https:\/\//i.test(s) || s.length > maxLength || /[\s"'<>\\]/.test(s) || HIDDEN.test(s)) return null;
  let url: URL;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return null;
  return url.href;
}

/** True when the text has control or direction-changing characters (other than newlines and tabs). */
export const hasHiddenChars = (s: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/.test(s);
