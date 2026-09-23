import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { transfers } from "@/db/schema";
import { getUploadUrl, isR2Configured } from "@/lib/r2";
import { tokensMatch } from "@/lib/token";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, STORAGE_PREFIX } from "@/lib/limits";
import { sanitizeFileName } from "@/lib/limits";
import { isUuid, jsonError, getClientIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const uploadSchema = z.object({
  accessToken: z.string().min(16),
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(255),
        fileSize: z.number().int().min(1).max(MAX_FILE_BYTES),
        mimeType: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(MAX_FILES),
});

const UPLOAD_URL_LIMIT = 20;
const UPLOAD_URL_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Invalid transfer id.", 400);

  const ip = getClientIp(req);
  if (!rateLimit(`upload-urls:${ip}`, UPLOAD_URL_LIMIT, UPLOAD_URL_WINDOW_MS).allowed) {
    return jsonError("Too many upload requests. Try again later.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  const totalSize = parsed.data.files.reduce((sum, f) => sum + f.fileSize, 0);
  if (totalSize > MAX_TOTAL_BYTES) {
    return jsonError("Total size exceeds the 100 MB limit.", 413);
  }

  const db = getDb();
  const [transfer] = await db
    .select()
    .from(transfers)
    .where(and(eq(transfers.id, id), gt(transfers.expiresAt, new Date())))
    .limit(1);
  if (!transfer) return jsonError("Transfer not found or expired.", 404);
  if (transfer.ready) return jsonError("This transfer is already complete.", 409);
  if (!tokensMatch(transfer.accessToken, parsed.data.accessToken)) {
    return jsonError("Invalid access token for this transfer.", 401);
  }
  if (!isR2Configured()) {
    return jsonError("File uploads are unavailable: storage is not configured.", 503);
  }

  const uploadUrls = await Promise.all(
    parsed.data.files.map(async (f) => {
      const fileName = sanitizeFileName(f.fileName);
      const mimeType = f.mimeType || "application/octet-stream";
      const key = `${STORAGE_PREFIX}/${id}/${crypto.randomUUID()}`;
      return {
        fileName,
        fileSize: f.fileSize,
        mimeType,
        storageKey: key,
        uploadUrl: await getUploadUrl(key, mimeType),
      };
    }),
  );
  return NextResponse.json({ uploadUrls });
}
