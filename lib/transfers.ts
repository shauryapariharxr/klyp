import { and, eq, gt } from "drizzle-orm";
import { getDb } from "./db";
import { files, transfers, type Transfer, type TransferFile } from "@/db/schema";
import { isStorageConfigured, getDownloadUrl } from "./storage";
import { tokensMatch } from "./token";

export type TransferFileView = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  downloadUrl: string | null;
};

export type TransferView = {
  id: string;
  textContent: string | null;
  expiresAt: string;
  createdAt: string;
  files: TransferFileView[];
};

export type TransferLookupResult =
  | { ok: true; view: TransferView }
  | { ok: false; status: 400 | 401 | 404 | 409 | 410; message: string };

/**
 * Load a transfer for viewing: id + access token must both be valid, the
 * transfer must be ready (all uploads finished) and unexpired.
 */
export async function getTransferView(
  id: string,
  token: string | null,
): Promise<TransferLookupResult> {
  if (!token) {
    return { ok: false, status: 401, message: "Missing access token for this transfer." };
  }

  const db = getDb();
  const [transfer]: Transfer[] = await db
    .select()
    .from(transfers)
    .where(eq(transfers.id, id))
    .limit(1);

  if (!transfer) {
    return { ok: false, status: 404, message: "This transfer does not exist." };
  }
  if (!tokensMatch(transfer.accessToken, token)) {
    return { ok: false, status: 401, message: "Invalid access token for this transfer." };
  }
  if (transfer.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 410, message: "This transfer has expired." };
  }
  if (!transfer.ready) {
    return {
      ok: false,
      status: 409,
      message: "This transfer is still uploading. Ask the sender to finish.",
    };
  }

  const rows: TransferFile[] = await db
    .select()
    .from(files)
    .where(eq(files.transferId, transfer.id));

  const withStorage = isStorageConfigured();
  const fileViews: TransferFileView[] = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      fileName: row.fileName,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      downloadUrl:
        withStorage && row.fileSize > 0 ? await getDownloadUrl(row.storageKey, row.fileName) : null,
    })),
  );

  return {
    ok: true,
    view: {
      id: transfer.id,
      textContent: transfer.textContent,
      expiresAt: transfer.expiresAt.toISOString(),
      createdAt: transfer.createdAt.toISOString(),
      files: fileViews,
    },
  };
}

/** Find a ready, unexpired transfer by its PIN hash (PIN verification step). */
export async function findReadyTransferByPinHash(pinHash: string): Promise<Transfer | null> {
  const db = getDb();
  const [transfer]: Transfer[] = await db
    .select()
    .from(transfers)
    .where(
      and(
        eq(transfers.pinHash, pinHash),
        eq(transfers.ready, true),
        gt(transfers.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return transfer ?? null;
}
