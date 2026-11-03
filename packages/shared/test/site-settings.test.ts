import { describe, expect, it } from "vitest";
import { validateSiteSettings, type SiteSettings } from "../src/site-settings.ts";

const good = (): SiteSettings => ({
  siteName: "LiveAccess",
  tagline: "The 24/7 service app from TPS for dairy, food and beverage plants.",
  appStore: "https://apps.apple.com/app/liveaccess-24-7/id6790754198",
  playStore: "https://play.google.com/store/apps/details?id=com.liveaccess.app",
  email: "liveaccess@tps.ltd",
  notifyEmail: "",
  ga4: "G-JFHJD3T51M",
  gtm: ""
});

describe("validateSiteSettings", () => {
  it("accepts today's values, trimming and normalising", () => {
    const r = validateSiteSettings({ ...good(), siteName: "  LiveAccess ", ga4: " g-jfhjd3t51m ", gtm: "gtm-abc123", email: " LiveAccess@TPS.ltd " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings).toMatchObject({ siteName: "LiveAccess", ga4: "G-JFHJD3T51M", gtm: "GTM-ABC123", email: "LiveAccess@TPS.ltd" });
  });

  it("never lets the GA4 ID be empty or malformed", () => {
    for (const ga4 of ["", "  ", "UA-12345-1", "G-", "G-abc def", "GTM-ABC123"]) {
      const r = validateSiteSettings({ ...good(), ga4 });
      expect(r.ok, ga4).toBe(false);
      if (!r.ok) expect(r.errors.ga4, ga4).toBeTruthy();
    }
  });

  it("only accepts real store links", () => {
    const bad: Partial<SiteSettings>[] = [
      { appStore: "https://evil.test/app" }, { appStore: "http://apps.apple.com/app/x" }, { appStore: "https://apps.apple.com.evil.test/x" },
      { playStore: "https://play.google.com/store/apps/details" }, { playStore: "https://play.google.evil.test/store/apps/details?id=x" },
      { playStore: "javascript:alert(1)" }
    ];
    for (const b of bad) {
      const r = validateSiteSettings({ ...good(), ...b });
      expect(r.ok, JSON.stringify(b)).toBe(false);
      if (!r.ok) expect(Object.keys(r.errors)).toEqual(Object.keys(b));
    }
  });

  it("refuses emails that would add headers to mailto links", () => {
    for (const email of ["x?bcc=spy@evil.test", "a%0Abcc%3Dy@b.co", "a&b=c@tps.ltd", "a#b@tps.ltd", "a/b@tps.ltd"]) {
      expect(validateSiteSettings({ ...good(), email }).ok, email).toBe(false);
    }
    expect(validateSiteSettings({ ...good(), email: "first.last+cms@tps.ltd" }).ok).toBe(true);
  });

  it("keeps the Google Play link to just the app id", () => {
    for (const playStore of ["https://play.google.com/store/apps/details?id=x&referrer=evil", "https://play.google.com/store/apps/details?id=x#frag", "https://play.google.com/store/apps/details?hl=en&id=x"]) {
      expect(validateSiteSettings({ ...good(), playStore }).ok, playStore).toBe(false);
    }
  });

  it("checks emails, GTM and text fields", () => {
    const r = validateSiteSettings({ ...good(), email: "not-an-email", notifyEmail: "a b@tps.ltd", gtm: "G-123", siteName: "", tagline: "x".repeat(201) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["email", "gtm", "notifyEmail", "siteName", "tagline"]);
    expect(validateSiteSettings({ ...good(), notifyEmail: "alerts@tps.ltd" }).ok).toBe(true);
    expect(validateSiteSettings({ ...good(), tagline: "Hi‮" }).ok).toBe(false);
    expect(validateSiteSettings(null).ok).toBe(false);
  });
});
