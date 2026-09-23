export const TRANSFER_TTL_MS = 30 * 60 * 1000;
export const MAX_FILES = 10;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 10_000;
export const PIN_LENGTH = 4;
export const DOWNLOAD_URL_TTL_SECONDS = 600;
export const UPLOAD_URL_TTL_SECONDS = 900;
export const STORAGE_PREFIX = "transfers";

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}
