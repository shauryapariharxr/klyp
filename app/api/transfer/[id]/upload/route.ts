import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { transfers } from "@/db/schema";
import { getBucketUsageBytes, getUploadUrl, isStorageConfigured } from "@/lib/storage";
import { tokensMatch } from "@/lib/token";
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  STORAGE_BUDGET_BYTES,
  STORAGE_PREFIX,
} from "@/lib/limits";
import { sanitizeFileName, JSON_BODY_MAX_BYTES } from "@/lib/limits";
import { isUuid, jsonError, getClientIp, readJson } from "@/lib/http";
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

  const body = await readJson(req, JSON_BODY_MAX_BYTES);
  if (!body.ok) {
    return jsonError(body.error, body.status);
  }

  const parsed = uploadSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  const totalSize = parsed.data.files.reduce((sum, f) => sum + f.fileSize, 0);
  if (totalSize > MAX_TOTAL_BYTES) {
    return jsonError("Total size exceeds the 50 MB limit.", 413);
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
  if (!isStorageConfigured()) {
    return jsonError("File uploads are unavailable: storage is not configured.", 503);
  }

  // Admission control: keep total bucket usage under the storage budget so a
  // burst can't exhaust the provider quota and start failing randomly. Fails
  // open (allows the upload) if usage can't be measured — storage being down
  // will surface on the PUT itself anyway.
  try {
    const usageBytes = await getBucketUsageBytes();
    if (usageBytes + totalSize > STORAGE_BUDGET_BYTES) {
      return jsonError(
        "Our storage is momentarily full. Transfers free up automatically every few minutes — please try again shortly.",
        503,
      );
    }
  } catch (error) {
    console.error("[upload] storage usage check failed; allowing upload", error);
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
