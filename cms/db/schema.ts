// CMS database schema (PostgreSQL). All tables are created on Day 1; later days only use them.
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["super_admin", "editor"]);
export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const contentStatusEnum = pgEnum("content_status", ["draft", "published"]);
export const articleTypeEnum = pgEnum("article_type", ["guide", "area"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("editor"),
  status: userStatusEnum("status").notNull().default("active"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt()
}, (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  csrfToken: text("csrf_token").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt()
}, (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

const seoColumns = () => ({
  seoTitle: text("seo_title").notNull().default(""),
  seoDescription: text("seo_description").notNull().default(""),
  canonical: text("canonical").notNull().default(""),
  noindex: boolean("noindex").notNull().default(false),
  ogMediaId: integer("og_media_id")
});

export const pages = pgTable("pages", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  file: text("file").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  html: text("html").notNull(),
  publishedHtml: text("published_html"),
  status: contentStatusEnum("status").notNull().default("draft"),
  ...seoColumns(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // Bumped on every save; a save based on an older version is refused (no silent overwrites).
  version: integer("version").notNull().default(1),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex("pages_key_unique").on(t.key)]);

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  type: articleTypeEnum("type").notNull(),
  slug: text("slug").notNull(),
  publishedSlug: text("published_slug"),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  areaSlug: text("area_slug"),
  publishedDate: date("published_date"),
  blocks: jsonb("blocks").notNull().default(sql`'[]'::jsonb`),
  status: contentStatusEnum("status").notNull().default("draft"),
  ...seoColumns(),
  authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  // What is live: { slug, title, summary, areaSlug, publishedDate, blocks, seo } at the last publish (null = never).
  published: jsonb("published"),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex("articles_type_slug_unique").on(t.type, t.slug), index("articles_type_status_idx").on(t.type, t.status)]);

export const revisions = pgTable("revisions", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  note: text("note").notNull().default(""),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt()
}, (t) => [index("revisions_entity_idx").on(t.entityType, t.entityId, t.createdAt)]);

export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  mime: text("mime").notNull(),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes").notNull(),
  altText: text("alt_text").notNull().default(""),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt()
});

export const menus = pgTable("menus", {
  id: serial("id").primaryKey(),
  location: text("location").notNull(),
  items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
  version: integer("version").notNull().default(1),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex("menus_location_unique").on(t.location)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull()
});

export const redirects = pgTable("redirects", {
  id: serial("id").primaryKey(),
  fromPath: text("from_path").notNull(),
  toPath: text("to_path").notNull(),
  code: integer("code").notNull().default(301),
  isAuto: boolean("is_auto").notNull().default(false),
  hits: integer("hits").notNull().default(0),
  createdAt: createdAt()
}, (t) => [uniqueIndex("redirects_from_unique").on(t.fromPath)]);

export const contactMessages = pgTable("contact_messages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull().default(""),
  topic: text("topic").notNull().default(""),
  message: text("message").notNull(),
  page: text("page").notNull().default(""),
  status: text("status").notNull().default("new"),
  ipHash: text("ip_hash"),
  createdAt: createdAt()
}, (t) => [index("contact_status_idx").on(t.status, t.createdAt)]);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  detail: jsonb("detail"),
  ip: text("ip"),
  createdAt: createdAt()
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt)]);

export const publishJobs = pgTable("publish_jobs", {
  id: serial("id").primaryKey(),
  triggeredBy: integer("triggered_by").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("queued"),
  items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
  log: text("log").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true })
});
