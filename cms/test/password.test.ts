import { describe, expect, it } from "vitest";
import { assertPasswordRules, hashPassword, verifyPassword } from "../api/auth/password.ts";

describe("password", () => {
  it("hashes with argon2id and never stores the password", async () => {
    const h = await hashPassword("correct-horse-battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain("correct-horse-battery");
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const h = await hashPassword("correct-horse-battery");
    expect(await verifyPassword(h, "correct-horse-battery")).toBe(true);
    expect(await verifyPassword(h, "wrong-horse-battery")).toBe(false);
  });

  it("returns false for a broken hash instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "whatever-password")).toBe(false);
  });

  it("requires at least 12 characters", () => {
    expect(() => assertPasswordRules("short-pass1")).toThrow(/12 characters/);
    expect(() => assertPasswordRules("long-enough-pass")).not.toThrow();
  });
});
