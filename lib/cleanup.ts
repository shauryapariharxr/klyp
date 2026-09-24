import { after } from "next/server";
import { eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { files, transfers } from "@/db/schema";
import { deleteObjects, deleteObjectsByPrefix, isStorageConfigured } from "./storage";
import { STORAGE_PREFIX } from "./limits";

export type CleanupResult = {
  deletedTransfers: number;
  r2Failures: number;
};

/**
 * Delete every expired transfer: R2 objects first, then the DB rows
 * (files rows cascade). Transfers whose R2 deletion failed are kept so
 * cleanup can retry on the next run.
 */
export async function cleanupExpiredTransfers(
  batchSize = 100,
): Promise<CleanupResult> {
  const db = getDb();
  const expired = await db
    .select()
    .from(transfers)
    .where(lt(transfers.expiresAt, new Date()))
    .limit(batchSize);

  let deletedTransfers = 0;
  let r2Failures = 0;

  for (const transfer of expired) {
    const keys = (
      await db.select({ storageKey: files.storageKey }).from(files).where(eq(files.transferId, transfer.id))
    ).map((row) => row.storageKey);

    if (keys.length > 0) {
      try {
        await deleteObjects(keys);
      } catch (error) {
        r2Failures += 1;
        console.error(`[cleanup] storage delete failed for transfer ${transfer.id}`, error);
        continue; // keep the row so the next run retries
      }
    }

    // Safety net: the files table only covers uploads that called "/complete",
    // so an abandoned session would otherwise leave its bytes in the bucket
    // forever. List-and-delete the transfer's whole prefix to catch orphans.
    if (isStorageConfigured()) {
      try {
        await deleteObjectsByPrefix(`${STORAGE_PREFIX}/${transfer.id}/`);
      } catch (error) {
        r2Failures += 1;
        console.error(`[cleanup] prefix delete failed for transfer ${transfer.id}`, error);
        continue;
      }
    }

    await db.delete(transfers).where(eq(transfers.id, transfer.id));
    deletedTransfers += 1;
  }

  return { deletedTransfers, r2Failures };
}

let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Opportunistic sweep: runs after the response is sent (via next/server
 * `after`), at most once a minute per server instance, so expired
 * transfers — and their stored files — are deleted within minutes of
 * expiry whenever the site is being used. The daily Vercel cron remains
 * as the backstop for quiet periods.
 */
export function scheduleExpirySweep(): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  after(async () => {
    try {
      const result = await cleanupExpiredTransfers(10);
      if (result.deletedTransfers > 0 || result.r2Failures > 0) {
        console.log(
          `[cleanup] sweep deleted ${result.deletedTransfers} transfer(s) ` +
            `(${result.r2Failures} storage failure(s) to retry)`,
        );
      }
    } catch (error) {
      console.error("[cleanup] sweep failed", error);
    }
  });
}
