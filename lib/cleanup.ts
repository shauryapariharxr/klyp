import { eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { files, transfers } from "@/db/schema";
import { deleteObjects } from "./r2";

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
        console.error(`[cleanup] R2 delete failed for transfer ${transfer.id}`, error);
        continue; // keep the row so the next run retries
      }
    }

    await db.delete(transfers).where(eq(transfers.id, transfer.id));
    deletedTransfers += 1;
  }

  return { deletedTransfers, r2Failures };
}
