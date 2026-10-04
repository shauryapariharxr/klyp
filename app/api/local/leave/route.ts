import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { localDevices } from "@/db/schema";
import { getClientIp, jsonError, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { TINY_BODY_MAX_BYTES } from "@/lib/limits";
import { authenticateDevice } from "@/lib/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const leaveSchema = z.object({
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(1).max(128),
});

const LEAVE_LIMIT = 60;
const LEAVE_WINDOW_MS = 60 * 1000;

/**
 * Explicit departure (pagehide). The device row is deleted so it disappears
 * from every peer's list immediately; queued signals for it cascade-delete.
 */
export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  const ip = getClientIp(req);
  if (!rateLimit(`local-leave:${ip}`, LEAVE_LIMIT, LEAVE_WINDOW_MS).allowed) {
    return jsonError("Too many requests. Try again shortly.", 429);
  }

  const body = await readJson(req, TINY_BODY_MAX_BYTES);
  if (!body.ok) {
    return jsonError(body.error, body.status);
  }

  const parsed = leaveSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError("Invalid leave request.", 400);
  }

  try {
    const device = await authenticateDevice(parsed.data.deviceId, parsed.data.deviceToken);
    if (device) {
      await getDb().delete(localDevices).where(eq(localDevices.id, device.id));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[local/leave] failed", error);
    return jsonError("Could not leave the room. Try again.", 500);
  }
}
