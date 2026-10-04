import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Best-effort client IP for room grouping and rate limiting.
 *
 * On the production host (Vercel) `x-real-ip` is set by the platform and
 * cannot be spoofed by the client, so it is preferred. Otherwise the LAST
 * `x-forwarded-for` entry is used: under standard proxy semantics the closest
 * trusted proxy appends the real client address, while earlier entries are
 * attacker-controlled. Rooms are keyed by this value, so trusting a spoofable
 * first entry would let a remote client pick which room it appears in.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "unknown";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type JsonBodyResult =
  | { ok: true; data: unknown }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Parse a JSON request body with a hard byte cap. Route handlers have no
 * built-in body limit, so uncapped `req.json()` would let a single request
 * buffer an arbitrarily large payload in memory. The Content-Length header
 * gives a cheap early reject; the stream itself is still capped while
 * reading so a missing/lying header cannot bypass the limit.
 */
export async function readJson(req: Request, maxBytes: number): Promise<JsonBodyResult> {
  const contentLength = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, status: 413, error: "Request body too large." };
  }

  try {
    if (!req.body) return { ok: false, status: 400, error: "Invalid JSON body." };

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: "Request body too large." };
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(merged);
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body." };
  }
}
