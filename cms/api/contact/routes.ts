// /<ADMIN_PATH>/api/contact — the website's contact form. The only route anyone can call without signing in, so every
// field is checked here, spam gets a quiet "OK" with nothing stored, and the number of messages is limited in the database
// (so the limit holds on Vercel, where each instance has its own memory). The count and the insert run under one lock, so
// requests sent at the same moment can't all slip under the limit. The sender is kept only as a keyed hash of their
// address (an IPv6 address by its /64, which one home connection owns).
import { createHmac } from "node:crypto";
import { Hono, type Context } from "hono";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { hasHiddenChars } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { contactMessages } from "../../db/schema.ts";
import { env } from "../../env.ts";
import { clientIp } from "../client-ip.ts";

/** The form's own options (contact.html). Anything else is stored as the last one. */
export const CONTACT_TOPICS = ["Access for my team", "Becoming a TPS client", "Help with the app", "Something else"] as const;
export const CONTACT_LIMITS = { name: 200, company: 200, email: 254, message: 5000, perVisitorPerHour: 5, totalPerHour: 100, minMs: 3000 } as const;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const HOUR = 60 * 60 * 1000;

export type ContactConfig = { db: Db; trustProxy?: boolean; now?: () => number };

/**
 * Called after a message is stored. Email notifications go here once the domain's mail service is chosen (Prabhat,
 * 2026-11-12). The sender's name may hold `"`, `<` and `,`, and the address `'`, `%`, `?` and `&`: never put them in a
 * From or Subject header as raw text (use the mail library's address object for Reply-To), and never log the message.
 */
async function notifyNewMessage(_id: number): Promise<void> {}

// Every contact insert takes this lock, so counting and storing happen one request at a time.
const LOCK = 734_200_101;

const field = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Who counts as one visitor: an IPv4 address, or an IPv6 /64 (one connection usually owns a whole /64, so counting single
 * addresses would let it send without limit). Visitors with no address known share one key.
 */
export function visitorKey(ip: string | null): string {
  if (!ip) return "unknown";
  const addr = ip.trim().replace(/%.*$/, "").toLowerCase();
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (v4) return v4[1]!;
  if (!addr.includes(":")) return addr;
  const [head = "", tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}
const visitorHash = (ip: string | null) => createHmac("sha256", env.jwtSecret()).update(`contact:${visitorKey(ip)}`).digest("hex");

async function readBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    if ((c.req.header("content-type") ?? "").includes("application/json")) {
      const j = await c.req.json();
      return j && typeof j === "object" && !Array.isArray(j) ? j as Record<string, unknown> : null;
    }
    return await c.req.parseBody() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function contactRoutes(cfg: ContactConfig) {
  const { db } = cfg;
  const now = cfg.now ?? Date.now;
  const app = new Hono();

  app.post("/", async (c) => {
    // Browsers say where a POST comes from (Origin, or Sec-Fetch-Site). The app's own check refuses other sites; this also
    // refuses the rare old browser that says neither, so another site can't send messages through its visitors.
    if (!c.req.header("origin") && c.req.header("sec-fetch-site") !== "same-origin") return c.json({ error: "Cross-site request refused." }, 403);

    const body = await readBody(c);
    if (!body) return c.json({ error: "We could not read your message." }, 400);

    // Spam: the hidden field is filled, or the form was sent less than 3 seconds after the page opened. `_elapsed` is
    // measured on the visitor's page (time since it loaded), so a wrong clock on their computer doesn't matter. Text from
    // the form, a number from JSON. Same answer as a real message, so bots learn nothing; only the reason is logged.
    const elapsed = typeof body._elapsed === "number" ? body._elapsed : Number(field(body._elapsed) || NaN);
    const spam = field(body._gotcha).trim() ? "honeypot" : !Number.isFinite(elapsed) || elapsed < CONTACT_LIMITS.minMs ? "too fast" : null;
    if (spam) {
      console.info(`contact form: dropped (${spam})`);
      return c.json({ ok: true });
    }

    const name = field(body.name).replace(/\s+/g, " ").trim();
    const company = field(body.company).replace(/\s+/g, " ").trim();
    const email = field(body.email).trim();
    const message = field(body.message).replace(/\r\n?/g, "\n").trim();
    const topicIn = field(body.topic).trim();
    const topic = (CONTACT_TOPICS as readonly string[]).includes(topicIn) ? topicIn : "Something else";

    const errors: Record<string, string> = {};
    if (!name) errors.name = "Add your name.";
    else if (name.length > CONTACT_LIMITS.name) errors.name = `Your name can be at most ${CONTACT_LIMITS.name} characters.`;
    if (company.length > CONTACT_LIMITS.company) errors.company = `The company can be at most ${CONTACT_LIMITS.company} characters.`;
    if (!EMAIL.test(email) || email.length > CONTACT_LIMITS.email) errors.email = "Add a valid email address so we can reply.";
    if (!message) errors.message = "Add a message.";
    else if (message.length > CONTACT_LIMITS.message) errors.message = `The message can be at most ${CONTACT_LIMITS.message.toLocaleString("en")} characters.`;
    // Line breaks and tabs are fine in a message; other control or direction-changing characters aren't, anywhere.
    for (const [k, v] of Object.entries({ name, company, email, message: message.replace(/[\n\t]/g, " ") })) {
      if (!errors[k] && hasHiddenChars(v)) errors[k] = "Remove the hidden characters.";
    }
    if (Object.keys(errors).length) return c.json({ error: Object.values(errors)[0], errors }, 400);

    const hash = visitorHash(clientIp(c, cfg.trustProxy ?? false));
    const since = new Date(now() - HOUR);
    // Times come from the same clock as the limit's window.
    const at = new Date(now());
    const id = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
      const [[mine], [all]] = await Promise.all([
        tx.select({ n: count() }).from(contactMessages).where(and(eq(contactMessages.ipHash, hash), gte(contactMessages.createdAt, since))),
        tx.select({ n: count() }).from(contactMessages).where(gte(contactMessages.createdAt, since))
      ]);
      if ((mine?.n ?? 0) >= CONTACT_LIMITS.perVisitorPerHour || (all?.n ?? 0) >= CONTACT_LIMITS.totalPerHour) return null;
      const [row] = await tx.insert(contactMessages).values({ name, email, company, topic, message, page: "contact.html", ipHash: hash, createdAt: at, statusChangedAt: at })
        .returning({ id: contactMessages.id });
      return row!.id;
    });
    if (id === null) return c.json({ error: "Too many messages. Please try again later." }, 429);
    await notifyNewMessage(id);
    return c.json({ ok: true });
  });

  return app;
}
