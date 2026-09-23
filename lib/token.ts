import { randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe random token used as the per-transfer download capability. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
