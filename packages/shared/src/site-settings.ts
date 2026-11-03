// Site-wide values (name, footer tagline, store links, contact emails, analytics IDs) and their checks.
import { hasHiddenChars, safeHttpsUrl } from "./links.ts";

export type SiteSettings = {
  siteName: string;
  tagline: string;
  appStore: string;
  playStore: string;
  email: string;
  notifyEmail: string;
  ga4: string;
  gtm: string;
};
export type SiteSettingsCheck = { ok: true; settings: SiteSettings } | { ok: false; errors: Record<string, string> };

// Strict on purpose: the address goes into mailto: links, where ? & = % # would add headers (e.g. a hidden bcc).
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** A store link on exactly that host (no look-alike hosts), normalised, or null. */
function storeLink(s: string, host: string, path: RegExp) {
  const url = safeHttpsUrl(s);
  if (!url) return null;
  const u = new URL(url);
  return u.hostname === host && !u.hash && path.test(u.pathname + u.search) ? url : null;
}

export function validateSiteSettings(input: unknown): SiteSettingsCheck {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : null) as Record<string, unknown> | null;
  if (!o) return { ok: false, errors: { settings: "Invalid settings." } };
  const errors: Record<string, string> = {};
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

  const text = (key: "siteName" | "tagline", label: string, max: number) => {
    const s = str(o[key]);
    if (!s) errors[key] = `${label} is required.`;
    else if (s.length > max) errors[key] = `${label} can be at most ${max} characters.`;
    else if (hasHiddenChars(s)) errors[key] = "Remove the hidden characters.";
    return s;
  };
  const email = (key: "email" | "notifyEmail", required: boolean) => {
    const s = str(o[key]);
    if (!s) { if (required) errors[key] = "Email address is required."; return s; }
    if (s.length > 254 || !EMAIL.test(s)) errors[key] = "Enter one email address, like name@tps.ltd.";
    return s;
  };

  const siteName = text("siteName", "Site name", 60);
  const tagline = text("tagline", "Footer tagline", 200);

  const appStore = storeLink(str(o.appStore), "apps.apple.com", /^\/./);
  if (!appStore) errors.appStore = "Use the app's App Store address (https://apps.apple.com/…).";
  // Only ?id=…: Publish adds each page's own referrer to it.
  const playStore = storeLink(str(o.playStore), "play.google.com", /^\/store\/apps\/details\?id=[A-Za-z0-9._]+$/);
  if (!playStore) errors.playStore = "Use the app's Google Play address (https://play.google.com/store/apps/details?id=…).";

  const mail = email("email", true);
  const notifyEmail = email("notifyEmail", false);

  // The GA4 tag must stay on every page: the ID can change but never be removed.
  const ga4 = str(o.ga4).toUpperCase();
  if (!/^G-[A-Z0-9]{6,12}$/.test(ga4)) errors.ga4 = "The Google Analytics 4 ID is required and looks like G-XXXXXXXXXX.";
  const gtm = str(o.gtm).toUpperCase();
  if (gtm && !/^GTM-[A-Z0-9]{4,10}$/.test(gtm)) errors.gtm = "A Tag Manager ID looks like GTM-XXXXXXX (or leave it empty).";

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, settings: { siteName, tagline, appStore: appStore!, playStore: playStore!, email: mail, notifyEmail, ga4, gtm } };
}
