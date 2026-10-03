export const TRANSFER_TTL_MS = 15 * 60 * 1000;
export const MAX_FILES = 10;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 10_000;
export const PIN_LENGTH = 4;
export const DOWNLOAD_URL_TTL_SECONDS = 600;
export const UPLOAD_URL_TTL_SECONDS = 900;
export const STORAGE_PREFIX = "transfers";
/**
 * Soft cap on total bytes stored in the bucket (sized for the ~1 GB free-tier
 * quota). Upload-plan admission control rejects transfers that would push
 * usage past this, so a burst degrades gracefully instead of exhausting the
 * provider quota and failing randomly. Usage naturally decays: everything
 * expires within TRANSFER_TTL_MS.
 */
export const STORAGE_BUDGET_BYTES = 800 * 1024 * 1024;

// --- Local (same-Wi-Fi) peer-to-peer transfers ---
export const LOCAL_DEVICE_NAME_MAX = 24;
/** Cap on one signaling payload (SDP + file previews) — real ones are a few KB. */
export const LOCAL_SIGNAL_MAX_BYTES = 64 * 1024;
/** A device shows in the room while it heartbeats at least this often. */
export const LOCAL_PEER_TTL_MS = 20 * 1000;
/** Devices that stopped heartbeating are pruned after this long. */
export const LOCAL_STALE_DEVICE_MS = 10 * 60 * 1000;
/** Undelivered signals are pruned after this long (recipient left). */
export const LOCAL_SIGNAL_TTL_MS = 5 * 60 * 1000;
/** Client heartbeat cadence — every 2s refreshes presence and drains signals. */
export const LOCAL_SYNC_INTERVAL_MS = 2 * 1000;

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}
