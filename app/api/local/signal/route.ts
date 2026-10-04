import { NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured } from "@/lib/db";
import { getClientIp, jsonError, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { LOCAL_SIGNAL_BODY_MAX_BYTES, LOCAL_SIGNAL_MAX_BYTES } from "@/lib/limits";
import { authenticateDevice, enqueueSignal, LocalSignalError } from "@/lib/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const signalSchema = z.object({
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(1).max(128),
  toDeviceId: z.string().uuid(),
  payload: z.unknown(),
});

// Real transfers exchange a handful of signals; this bounds abuse without
// touching legitimate flows.
const SIGNAL_LIMIT = 120;
const SIGNAL_WINDOW_MS = 60 * 1000;

/**
 * Enqueue a WebRTC signaling message (offer/answer/accept/decline) for one
 * peer. Payload is validated as JSON and size-capped; SDP is a few KB, file
 * previews are tiny, and the actual file bytes never pass through here.
 */
export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  const ip = getClientIp(req);
  if (!rateLimit(`local-signal:${ip}`, SIGNAL_LIMIT, SIGNAL_WINDOW_MS).allowed) {
    return jsonError("Sending too many signals. Try again shortly.", 429);
  }

  const body = await readJson(req, LOCAL_SIGNAL_BODY_MAX_BYTES);
  if (!body.ok) {
    return jsonError(body.error, body.status);
  }

  const parsed = signalSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError("Invalid signal request.", 400);
  }

  if (JSON.stringify(parsed.data.payload ?? null).length > LOCAL_SIGNAL_MAX_BYTES) {
    return jsonError("Signal payload too large.", 413);
  }

  try {
    const device = await authenticateDevice(parsed.data.deviceId, parsed.data.deviceToken);
    if (!device) {
      return jsonError("Unknown device — rejoin the room.", 404, { rejoin: true });
    }

    await enqueueSignal(device.publicIpHash, device.id, parsed.data.toDeviceId, parsed.data.payload);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof LocalSignalError) {
      return jsonError(error.message, error.status);
    }
    console.error("[local/signal] failed", error);
    return jsonError("Could not deliver the signal. Try again.", 500);
  }
}
