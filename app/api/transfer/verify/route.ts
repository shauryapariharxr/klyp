import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPin } from "@/lib/pin";
import { findReadyTransferByPinHash } from "@/lib/transfers";
import { isDbConfigured } from "@/lib/db";
import {
  PIN_FAILURE_LIMIT,
  PIN_FAILURE_WINDOW_MS,
  clearPinFailures,
  getPinFailures,
  rateLimit,
  recordPinFailure,
} from "@/lib/rate-limit";
import { getClientIp, jsonError } from "@/lib/http";

export const runtime = "nodejs";

const verifySchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Enter a 4-digit PIN."),
});

const VERIFY_LIMIT = 30;
const VERIFY_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`verify:${ip}`, VERIFY_LIMIT, VERIFY_WINDOW_MS).allowed) {
    return jsonError("Too many attempts. Try again later.", 429);
  }

  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid PIN.", 400);
  }

  const attemptKey = `pin:${ip}`;
  if (getPinFailures(attemptKey) >= PIN_FAILURE_LIMIT) {
    return jsonError(
      "Too many wrong PINs. Wait a few minutes before trying again.",
      429,
      { retryAfterSeconds: Math.ceil(PIN_FAILURE_WINDOW_MS / 60) },
    );
  }

  const pinHash = await hashPin(parsed.data.pin);
  const transfer = await findReadyTransferByPinHash(pinHash);

  if (!transfer) {
    const failures = recordPinFailure(attemptKey);
    const remaining = Math.max(0, PIN_FAILURE_LIMIT - failures);
    return jsonError(
      remaining > 0
        ? `Wrong or expired PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
        : "Too many wrong PINs. Wait a few minutes before trying again.",
      remaining > 0 ? 404 : 429,
    );
  }

  clearPinFailures(attemptKey);

  return NextResponse.json({
    transferId: transfer.id,
    accessToken: transfer.accessToken,
    expiresAt: transfer.expiresAt.toISOString(),
  });
}
