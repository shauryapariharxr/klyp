import { NextResponse } from "next/server";
import { cleanupExpiredTransfers } from "@/lib/cleanup";
import { isDbConfigured } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLEANUP_LIMIT = 2;
const CLEANUP_WINDOW_MS = 60 * 1000;

/**
 * Called by the Vercel Cron job (see vercel.json) every 5 minutes to delete
 * expired transfers. Vercel automatically adds an `x-vercel-cron` header for
 * real cron invocations; CRON_SECRET can also be set as a shared secret.
 */
export async function GET(req: Request) {
  const isCron = req.headers.get("x-vercel-cron") !== null;
  const isAuthorized =
    isCron ||
    (process.env.CRON_SECRET !== undefined &&
      process.env.CRON_SECRET !== "" &&
      req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`);

  if (!isAuthorized) {
    const ip = getClientIp(req);
    if (!rateLimit(`cleanup:${ip}`, CLEANUP_LIMIT, CLEANUP_WINDOW_MS).allowed) {
      return jsonError("Too many cleanup attempts.", 429);
    }
    // Allowed without a secret (handy for local testing), but rate-limited.
  }

  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  try {
    const result = await cleanupExpiredTransfers();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cleanup] failed", error);
    return jsonError("Cleanup failed.", 500);
  }
}
