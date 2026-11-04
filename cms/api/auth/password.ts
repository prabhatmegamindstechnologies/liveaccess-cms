import { randomInt } from "node:crypto";
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
  if (password.length > 1024) throw new Error("Password can be at most 1,024 characters.");
}

// No look-alikes (0/O, 1/l/I), because this password gets read out or typed by hand.
const READABLE = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A random one-time password: 20 characters from 55 is about 115 bits. */
export const temporaryPassword = () => Array.from({ length: 20 }, () => READABLE[randomInt(READABLE.length)]).join("");

// A real hash of a random value, used so an unknown email takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;
export const dummyPasswordHash = () => (dummyHash ??= hash(crypto.randomUUID()));
