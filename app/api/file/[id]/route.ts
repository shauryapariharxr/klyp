import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { files, transfers } from "@/db/schema";
import { getDownloadUrl } from "@/lib/r2";
import { tokensMatch } from "@/lib/token";
import { isUuid, jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/http";

export const runtime = "nodejs";

const DOWNLOAD_LIMIT = 60;
const DOWNLOAD_WINDOW_MS = 10 * 60 * 1000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Invalid file id.", 400);

  const ip = getClientIp(req);
  if (!rateLimit(`file:${ip}`, DOWNLOAD_LIMIT, DOWNLOAD_WINDOW_MS).allowed) {
    return jsonError("Too many download requests. Try again later.", 429);
  }

  const url = new URL(req.url);
  const transferId = url.searchParams.get("transferId");
  const token = url.searchParams.get("token");
  if (!transferId || !isUuid(transferId) || !token) {
    return jsonError("Missing transferId or token.", 400);
  }

  const db = getDb();
  const [file] = await db
    .select()
    .from(files)
    .where(eq(files.id, id))
    .limit(1);
  if (!file || file.transferId !== transferId) {
    return jsonError("File not found.", 404);
  }

  const [transfer] = await db
    .select()
    .from(transfers)
    .where(
      and(
        eq(transfers.id, transferId),
        eq(transfers.ready, true),
        gt(transfers.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!transfer) {
    return jsonError("This transfer has expired.", 410);
  }
  if (!tokensMatch(transfer.accessToken, token)) {
    return jsonError("Invalid access token for this transfer.", 401);
  }

  const downloadUrl = await getDownloadUrl(file.storageKey, file.fileName);
  return NextResponse.json({ downloadUrl, fileName: file.fileName, expiresIn: 600 });
}
