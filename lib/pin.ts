import { randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

function getPepper(): string {
  return process.env.PIN_HASH_PEPPER ?? "klyp-dev-pepper-change-me";
}

/** Uniformly random 4-digit PIN, e.g. "0042". */
export function generatePin(): string {
  return randomInt(0, 10_000).toString().padStart(4, "0");
}

/**
 * Deterministic scrypt hash of the PIN, peppered with a server-side secret.
 * The raw PIN is never persisted; the deterministic hash lets us look an
 * active transfer up by PIN through an indexed equality query.
 */
export async function hashPin(pin: string): Promise<string> {
  const derived = await scryptAsync(pin, getPepper(), KEY_LENGTH);
  return derived.toString("hex");
}

/** Timing-safe comparison of a candidate PIN against a stored hash. */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const derived = await scryptAsync(pin, getPepper(), KEY_LENGTH);
  const stored = Buffer.from(storedHash, "hex");
  return derived.length === stored.length && timingSafeEqual(derived, stored);
}
