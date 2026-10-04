import { NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, jsonError, readJson } from "@/lib/http";
import { LOCAL_DEVICE_NAME_MAX, TINY_BODY_MAX_BYTES } from "@/lib/limits";
import { pruneStaleLocalRows, registerDevice, roomKeyForRequest } from "@/lib/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const joinSchema = z.object({
  name: z.string().trim().min(1).max(LOCAL_DEVICE_NAME_MAX),
});

const JOIN_LIMIT = 30;
const JOIN_WINDOW_MS = 60 * 1000;

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  const ip = getClientIp(req);
  if (!rateLimit(`local-join:${ip}`, JOIN_LIMIT, JOIN_WINDOW_MS).allowed) {
    return jsonError("Too many join attempts. Try again shortly.", 429);
  }

  const body = await readJson(req, TINY_BODY_MAX_BYTES);
  if (!body.ok) {
    return jsonError(body.error, body.status);
  }

  const parsed = joinSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(
      `Provide a device name of up to ${LOCAL_DEVICE_NAME_MAX} characters.`,
      400,
    );
  }

  try {
    void pruneStaleLocalRows();
    const credentials = await registerDevice(roomKeyForRequest(req), parsed.data.name);
    return NextResponse.json(credentials, { status: 201 });
  } catch (error) {
    console.error("[local/join] failed", error);
    return jsonError("Could not join the room. Try again.", 500);
  }
}
