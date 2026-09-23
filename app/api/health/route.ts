import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { isStorageConfigured } from "@/lib/storage";

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

  return NextResponse.json({
    ok: database,
    database,
    storage,
    pinHashPepper: pepper,
    cronSecret,
    hint: !database
      ? "DATABASE_URL is not visible to this deployment. Add it in Vercel: Settings -> Environment Variables, enable the Production scope, then Redeploy."
      : "Database is reachable from config. File uploads additionally need storage vars and bucket CORS for this origin.",
  });
}
