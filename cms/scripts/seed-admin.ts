// pnpm db:seed-admin [-- --email you@example.com --name "Your Name"]
// Creates the Super Admin, or resets their password and unlocks them if they already exist.
// The password is typed in the terminal (hidden), or read from ADMIN_PASSWORD for automation. It is never stored in code.
import { createInterface } from "node:readline";
import { eq, sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createDb } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { assertPasswordRules, hashPassword } from "../api/auth/password.ts";

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    out._writeToOutput = (s: string) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  });
}

const email = arg("email", "admin@example.com").trim().toLowerCase();
const name = arg("name", "Super Admin");
const password = process.env.ADMIN_PASSWORD ?? (await askHidden(`Password for ${email} (min 12 characters): `));
assertPasswordRules(password);

const { db, close } = createDb(env.databaseUrl());
try {
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) {
    // This is the way back into a compromised account too, so nobody stays signed in with the old password.
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, role: "super_admin", status: "active", mustChangePassword: false, tempPasswordExpiresAt: null, failedLogins: 0, lockedUntil: null }).where(eq(users.id, existing.id));
      await tx.delete(sessions).where(eq(sessions.userId, existing.id));
    });
    console.log(`Updated Super Admin ${email} (password reset, account unlocked).`);
  } else {
    await db.insert(users).values({ name, email, passwordHash, role: "super_admin" });
    console.log(`Created Super Admin ${email}.`);
  }
} finally {
  await close();
}
