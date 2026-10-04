import { NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured } from "@/lib/db";
import { getClientIp, jsonError, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { LOCAL_PEER_TTL_MS, TINY_BODY_MAX_BYTES } from "@/lib/limits";
import {
  authenticateDevice,
  drainSignals,
  listPeers,
  pruneStaleLocalRows,
} from "@/lib/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncSchema = z.object({
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(1).max(128),
  afterSeq: z.number().int().min(0),
});

// Legit clients heartbeat every 2s (~30/min); several tabs on one IP share
// the limit, so it is generous but still bounds per-instance DB load.
const SYNC_LIMIT = 300;
const SYNC_WINDOW_MS = 60 * 1000;

/**
 * The polling heartbeat. One round-trip per tick does everything: proves the
 * device is alive, returns the live peer list for the room, and drains any
 * signaling messages addressed to this device.
 */
export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  const ip = getClientIp(req);
  if (!rateLimit(`local-sync:${ip}`, SYNC_LIMIT, SYNC_WINDOW_MS).allowed) {
    return jsonError("Polling too fast. Try again shortly.", 429);
  }

  const body = await readJson(req, TINY_BODY_MAX_BYTES);
  if (!body.ok) {
    return jsonError(body.error, body.status);
  }

  const parsed = syncSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError("Invalid sync request.", 400);
  }

  try {
    void pruneStaleLocalRows();

    const device = await authenticateDevice(parsed.data.deviceId, parsed.data.deviceToken);
    if (!device) {
      return jsonError("Unknown device — rejoin the room.", 404, { rejoin: true });
    }

    const [peers, drained] = await Promise.all([
      listPeers(device.publicIpHash, device.id),
      drainSignals(device.id, parsed.data.afterSeq),
    ]);

    return NextResponse.json({
      peers,
      signals: drained.signals,
      cursor: drained.cursor,
      peerTtlMs: LOCAL_PEER_TTL_MS,
    });
  } catch (error) {
    console.error("[local/sync] failed", error);
    return jsonError("Sync failed. Try again.", 500);
  }
}
