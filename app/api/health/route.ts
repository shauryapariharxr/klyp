import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { getBucketUsageBytes, isStorageConfigured } from "@/lib/storage";
import { STORAGE_BUDGET_BYTES } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment diagnostic: reports (booleans only, never values) which
 * environment variables the running deployment can actually see.
 * Open /api/health after adding env vars on Vercel — if anything is
 * `false`, the variables were not saved with the right scope, or the
 * deployment predates the change (redeploy required).
 */
export async function GET() {
  const database = isDbConfigured();
  const storage = isStorageConfigured();
  const pepper = Boolean(process.env.PIN_HASH_PEPPER);
  const cronSecret = Boolean(process.env.CRON_SECRET);

  // Quota visibility: how close the bucket is to the admission-control budget
  // (coarse MB granularity). null when storage isn't configured or the bucket
  // can't be listed right now.
  let storageUsage: {
    usedMb: number;
    budgetMb: number;
    percentUsed: number;
    warning: boolean;
  } | null = null;
  if (storage) {
    try {
      const usedBytes = await getBucketUsageBytes();
      const percentUsed = Math.round((usedBytes / STORAGE_BUDGET_BYTES) * 100);
      storageUsage = {
        usedMb: Math.round(usedBytes / (1024 * 1024)),
        budgetMb: Math.round(STORAGE_BUDGET_BYTES / (1024 * 1024)),
        percentUsed,
        warning: percentUsed >= 80,
      };
    } catch {
      storageUsage = null;
    }
  }

  return NextResponse.json({
    ok: database,
    database,
    storage,
    storageUsage,
    pinHashPepper: pepper,
    cronSecret,
    hint: !database
      ? "DATABASE_URL is not visible to this deployment. Add it in Vercel: Settings -> Environment Variables, enable the Production scope, then Redeploy."
      : "Database is reachable from config. File uploads additionally need storage vars and bucket CORS for this origin.",
  });
}
