import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults to argon2id (checked: hashes start with "$argon2id$").
export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function assertPasswordRules(password: string) {
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
}

// A real hash of a random value, used so an unknown email takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;
export const dummyPasswordHash = () => (dummyHash ??= hash(crypto.randomUUID()));
