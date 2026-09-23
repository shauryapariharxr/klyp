import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { files, transfers } from "@/db/schema";
import { objectExists } from "@/lib/storage";
import { tokensMatch } from "@/lib/token";
import { STORAGE_PREFIX } from "@/lib/limits";
import { isUuid, jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/http";

export const runtime = "nodejs";

const completeSchema = z.object({
  accessToken: z.string().min(16),
  uploaded: z.array(
    z.object({
      fileName: z.string().min(1).max(255),
      fileSize: z.number().int().min(0),
      mimeType: z.string().min(1).max(255),
      storageKey: z.string().min(1).max(512),
    }),
  ),
});

const COMPLETE_LIMIT = 20;
const COMPLETE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Invalid transfer id.", 400);

  const ip = getClientIp(req);
  if (!rateLimit(`complete:${ip}`, COMPLETE_LIMIT, COMPLETE_WINDOW_MS).allowed) {
    return jsonError("Too many requests. Try again later.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  const db = getDb();
  const [transfer] = await db
    .select()
    .from(transfers)
    .where(and(eq(transfers.id, id), gt(transfers.expiresAt, new Date())))
    .limit(1);
  if (!transfer) return jsonError("Transfer not found or expired.", 404);
  if (!tokensMatch(transfer.accessToken, parsed.data.accessToken)) {
    return jsonError("Invalid access token for this transfer.", 401);
  }

  const rows: (typeof files.$inferInsert)[] = [];
  for (const uploaded of parsed.data.uploaded) {
    if (!uploaded.storageKey.startsWith(`${STORAGE_PREFIX}/${id}/`)) {
      return jsonError("Invalid storage key.", 400);
    }
    if (!(await objectExists(uploaded.storageKey))) {
      return jsonError(`Upload for "${uploaded.fileName}" did not finish. Retry the upload.`, 409);
    }
    rows.push({
      transferId: id,
      fileName: uploaded.fileName,
      fileSize: uploaded.fileSize,
      mimeType: uploaded.mimeType,
      storageKey: uploaded.storageKey,
    });
  }

  try {
    await db.transaction(async (tx) => {
      if (rows.length > 0) {
        await tx.insert(files).values(rows);
      }
      await tx
        .update(transfers)
        .set({ ready: true })
        .where(eq(transfers.id, id));
    });
  } catch (error) {
    console.error("[complete] finalize failed", error);
    return jsonError("Could not finalize the transfer. Try again.", 500);
  }

  return NextResponse.json({ ok: true, fileCount: rows.length });
}
