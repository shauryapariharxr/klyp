import { createHash } from "node:crypto";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { getDb } from "./db";
import { localDevices, localSignals, type LocalDevice } from "@/db/schema";
import { generateToken } from "./token";
import { getClientIp } from "./http";
import { LOCAL_PEER_TTL_MS } from "./limits";

/** Device rows stay valid for this long even if the client never prunes. */
const DEVICE_STALE_MS = 10 * 60 * 1000;

/**
 * Devices are grouped by the public IP of their router, hashed so raw IPs are
 * never stored or exposed. Devices behind the same router (same NAT) share a
 * room; on a typical home/office Wi-Fi that is exactly "the same network".
 *
 * On localhost every browser reports 127.0.0.1 or ::1, so both tabs land in
 * the same room — which is also what makes local testing possible.
 */
export function roomKeyFromIp(ip: string): string {
  return createHash("sha256").update(`klyp-local-room:${ip}`).digest("hex");
}

export function roomKeyForRequest(req: Request): string {
  return roomKeyFromIp(getClientIp(req));
}

export type DeviceCredentials = {
  deviceId: string;
  deviceToken: string;
};

/**
 * Register a device in the caller's room. Re-registration with the same
 * credentials simply refreshes presence (the client persists its credentials
 * in sessionStorage so a reload does not orphan the old row — signal FKs
 * cascade-delete with the device, so keeping one row per browser matters).
 */
export async function registerDevice(
  roomKey: string,
  name: string,
): Promise<DeviceCredentials> {
  const db = getDb();
  const [row] = await db
    .insert(localDevices)
    .values({
      deviceToken: generateToken(16),
      name,
      publicIpHash: roomKey,
    })
    .returning();
  return { deviceId: row.id, deviceToken: row.deviceToken };
}

/**
 * Validate the caller's device credentials and refresh presence in one
 * atomic UPDATE … RETURNING — half the round trips of the earlier
 * select-then-update, which matters on the ~700 ms Supabase pooler.
 * Returns null when unknown/expired — the client re-joins the room.
 */
export async function authenticateDevice(
  deviceId: string,
  deviceToken: string,
): Promise<LocalDevice | null> {
  const db = getDb();
  const [device] = await db
    .update(localDevices)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(localDevices.id, deviceId),
        eq(localDevices.deviceToken, deviceToken),
        gt(localDevices.lastSeenAt, new Date(Date.now() - DEVICE_STALE_MS)),
      ),
    )
    .returning();
  return device ?? null;
}

/** All live devices in a room, freshest first, excluding one device. */
export async function listPeers(
  roomKey: string,
  excludeDeviceId: string,
): Promise<{ id: string; name: string; lastSeenAt: string }[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: localDevices.id,
      name: localDevices.name,
      lastSeenAt: localDevices.lastSeenAt,
    })
    .from(localDevices)
    .where(
      and(
        eq(localDevices.publicIpHash, roomKey),
        ne(localDevices.id, excludeDeviceId),
        gt(localDevices.lastSeenAt, new Date(Date.now() - LOCAL_PEER_TTL_MS)),
      ),
    )
    .orderBy(sql`${localDevices.lastSeenAt} desc`)
    .limit(50);
  return rows.map((row) => ({ ...row, lastSeenAt: row.lastSeenAt.toISOString() }));
}

export type EnqueuedSignal = { seq: number };

/** Queue a signaling message for a specific device (SDP offers/answers). */
export async function enqueueSignal(
  fromDeviceId: string,
  toDeviceId: string,
  payload: unknown,
): Promise<EnqueuedSignal> {
  const db = getDb();
  const [row] = await db
    .insert(localSignals)
    .values({ fromDeviceId, toDeviceId, payload: payload as object })
    .returning({ seq: localSignals.seq });
  return { seq: row.seq };
}

/**
 * Drain and delete every signal addressed to a device newer than `afterSeq`
 * in ONE atomic DELETE … RETURNING. The message is consumed the moment it is
 * read — concurrent polls can never double-deliver, and no second round trip
 * for deletion is needed (each pooler round trip costs ~700 ms).
 */
export async function drainSignals(
  deviceId: string,
  afterSeq: number,
): Promise<{ signals: { seq: number; from: string; payload: unknown }[]; cursor: number }> {
  const db = getDb();
  const rows: { seq: number; fromDeviceId: string; payload: unknown }[] = await db
    .delete(localSignals)
    .where(and(eq(localSignals.toDeviceId, deviceId), gt(localSignals.seq, afterSeq)))
    .returning({
      seq: localSignals.seq,
      fromDeviceId: localSignals.fromDeviceId,
      payload: localSignals.payload,
    });
  rows.sort((a, b) => a.seq - b.seq);

  const signals = rows.map((row) => ({
    seq: Number(row.seq),
    from: row.fromDeviceId,
    payload: row.payload,
  }));
  const cursor = signals.length > 0 ? signals[signals.length - 1].seq : afterSeq;
  return { signals, cursor };
}

/**
 * Housekeeping for devices/sIGNALS whose owners vanished without a clean
 * leave (closed tab, dead battery). Rows older than the grace period are
 * pruned; runs inline on the sync endpoint at most once a minute.
 */
let lastPruneAt = 0;
export async function pruneStaleLocalRows(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < 60_000) return;
  lastPruneAt = now;

  const db = getDb();
  await db.delete(localDevices).where(lt(localDevices.lastSeenAt, new Date(now - DEVICE_STALE_MS)));
  // Signals with no live recipient: created more than 5 minutes ago.
  await db.delete(localSignals).where(lt(localSignals.createdAt, new Date(now - 5 * 60 * 1000)));
}
