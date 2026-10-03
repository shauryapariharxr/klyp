import { NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { LOCAL_SIGNAL_MAX_BYTES } from "@/lib/limits";
import { authenticateDevice, enqueueSignal } from "@/lib/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const signalSchema = z.object({
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(1).max(128),
  toDeviceId: z.string().uuid(),
  payload: z.unknown(),
});

/**
 * Enqueue a WebRTC signaling message (offer/answer/accept/decline) for one
 * peer. Payload is validated as JSON and size-capped; SDP is a few KB, file
 * previews are tiny, and the actual file bytes never pass through here.
 */
export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = signalSchema.safeParse(body);
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

    await enqueueSignal(device.id, parsed.data.toDeviceId, parsed.data.payload);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[local/signal] failed", error);
    return jsonError("Could not deliver the signal. Try again.", 500);
  }
}
