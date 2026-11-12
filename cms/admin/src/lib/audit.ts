// Audit log entries in plain language. The sentence is built when it's shown, so old entries get current names and
// wording. An action that isn't listed here still shows, with its own name.

export type AuditItem = { title: string; link: string | null };
type Entry = { action: string; item: AuditItem | null; detail: Record<string, unknown> };

const named = (e: Entry, withName: string, without: string) => (e.item?.title ? `${withName} ${e.item.title}` : without);

function userEdited(e: Entry) {
  const who = e.item?.title || "a user";
  if (e.detail.status === "disabled") return `Disabled ${who}`;
  if (e.detail.status === "active") return `Enabled ${who}`;
  if (e.detail.role === "super_admin") return `Made ${who} a Super Admin`;
  if (e.detail.role === "editor") return `Made ${who} an Editor`;
  if (e.detail.email) return `Changed the email address of ${who}`;
  if (e.detail.name) return `Renamed ${who}`;
  return `Edited ${who}`;
}

const SENTENCES: Record<string, (e: Entry) => string> = {
  login: () => "Signed in",
  logout: () => "Signed out",
  login_failed: () => "Failed sign-in",
  login_locked: () => "Account locked after failed sign-ins",
  page_edited: (e) => named(e, "Edited the page", "Edited a page"),
  page_restored: (e) => named(e, "Restored an earlier version of the page", "Restored an earlier version of a page"),
  guide_created: (e) => named(e, "Created the guide", "Created a guide"),
  guide_edited: (e) => named(e, "Edited the guide", "Edited a guide"),
  guide_deleted: (e) => named(e, "Deleted the guide", "Deleted a guide"),
  area_created: (e) => named(e, "Created the process area", "Created a process area"),
  area_edited: (e) => named(e, "Edited the process area", "Edited a process area"),
  area_deleted: (e) => named(e, "Deleted the process area", "Deleted a process area"),
  area_renamed: (e) => named(e, "Changed the address of the process area", "Changed the address of a process area"),
  media_uploaded: (e) => named(e, "Uploaded the image", "Uploaded an image"),
  media_edited: (e) => named(e, "Changed the alt text of", "Changed the alt text of an image"),
  media_replaced: (e) => named(e, "Replaced an image with", "Replaced an image"),
  media_deleted: (e) => named(e, "Deleted the image", "Deleted an image"),
  menus_edited: () => "Changed the menus",
  site_settings_edited: () => "Changed the site settings",
  seo_redirects_edited: () => "Changed the redirects",
  seo_robots_edited: () => "Changed robots.txt",
  seo_llms_edited: () => "Changed llms.txt",
  seo_defaults_edited: () => "Changed the SEO defaults",
  preview_built: () => "Built the local preview",
  message_deleted: () => "Deleted a contact message",
  messages_purged: () => "Deleted handled contact messages older than 12 months (automatic)",
  user_created: (e) => named(e, "Added the user", "Added a user"),
  user_edited: userEdited,
  user_password_reset: (e) => named(e, "Reset the password of", "Reset a user's password"),
  user_unlocked: (e) => named(e, "Unlocked", "Unlocked a user"),
  password_changed: () => "Changed their own password",
  password_change_failed: () => "Failed to change their password (wrong current password)",
  own_password_failed: () => "Wrong password given for a Super Admin change"
};

export function describeAudit(e: Entry): string {
  const sentence = Object.hasOwn(SENTENCES, e.action) ? SENTENCES[e.action] : undefined;
  if (sentence) return sentence(e);
  const words = e.action.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
