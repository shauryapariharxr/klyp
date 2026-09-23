/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Good enough for the MVP. On serverless each instance has its own memory, so
 * limits are per-instance; swap for Upstash Redis or similar in production.
 */

const MAX_ENTRIES = 10_000;

const windows = new Map<string, number[]>();

function sweep(now: number, windowMs: number): void {
  if (windows.size < MAX_ENTRIES) return;
  for (const [key, timestamps] of windows) {
    const latest = timestamps[timestamps.length - 1] ?? 0;
    if (now - latest > windowMs) windows.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now, windowMs);

  const timestamps = (windows.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    windows.set(key, timestamps);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000)),
    };
  }

  timestamps.push(now);
  windows.set(key, timestamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

// --- Failed PIN attempts -----------------------------------------------------

export const PIN_FAILURE_LIMIT = 5;
export const PIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

const pinFailures = new Map<string, number[]>();

function prunePinFailures(key: string, now: number): number[] {
  const timestamps = (pinFailures.get(key) ?? []).filter(
    (t) => now - t < PIN_FAILURE_WINDOW_MS,
  );
  pinFailures.set(key, timestamps);
  return timestamps;
}

export function getPinFailures(key: string): number {
  return prunePinFailures(key, Date.now()).length;
}

export function recordPinFailure(key: string): number {
  const now = Date.now();
  const timestamps = prunePinFailures(key, now);
  timestamps.push(now);
  pinFailures.set(key, timestamps);
  return timestamps.length;
}

export function clearPinFailures(key: string): void {
  pinFailures.delete(key);
}
