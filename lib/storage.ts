import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from "./limits";

/**
 * Storage works with ANY S3-compatible provider:
 *   Backblaze B2 (10 GB free, no card), Filebase (5 GB), Scaleway (75 GB),
 *   iDrive e2 (10 GB), Cloudflare R2, AWS S3, Minio, etc.
 *
 * Configure with either set of vars (checked in this order):
 *   S3_ENDPOINT          – full endpoint URL, e.g. https://s3.us-west-004.backblazeb2.com
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET
 *
 * Or the original Cloudflare-style vars (still supported):
 *   R2_ACCOUNT_ID        – endpoint becomes https://<id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
 */

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function getEndpoint(): string | undefined {
  const explicit = env("S3_ENDPOINT");
  if (explicit) return explicit;
  const accountId = env("S3_ACCOUNT_ID", "R2_ACCOUNT_ID");
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  return undefined;
}

export function isStorageConfigured(): boolean {
  return Boolean(
    getEndpoint() &&
      env("S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID") &&
      env("S3_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY") &&
      env("S3_BUCKET", "R2_BUCKET"),
  );
}

function getS3(): S3Client {
  const endpoint = getEndpoint();
  const accessKeyId = env("S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY");
  const bucket = env("S3_BUCKET", "R2_BUCKET");

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Object storage is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY_ID, " +
        "S3_SECRET_ACCESS_KEY and S3_BUCKET (see README — Backblaze B2 offers " +
        "10 GB free with no credit card).",
    );
  }

  return new S3Client({
    region: env("S3_REGION") ?? "auto",
    endpoint,
    forcePathStyle: env("S3_FORCE_PATH_STYLE") === "1",
    credentials: { accessKeyId, secretAccessKey },
  });
}

function bucket(): string {
  return env("S3_BUCKET", "R2_BUCKET")!;
}

/**
 * Short-lived presigned PUT URL so the browser can upload directly to the
 * private bucket. This keeps large uploads from flowing through (and being
 * size-limited by) the serverless function itself.
 */
export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  const s3 = getS3();
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

/** Short-lived signed download URL; the bucket itself stays private. */
export async function getDownloadUrl(key: string, fileName: string): Promise<string> {
  const s3 = getS3();
  const safeName = fileName.replace(/["\r\n\\]/g, "");
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  });
  return getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

/** Check whether an object exists in the bucket (used to confirm uploads). */
export async function objectExists(key: string): Promise<boolean> {
  const s3 = getS3();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey" || name === "404") return false;
    throw error;
  }
}

/** Delete objects in batches of up to 1000 (the S3 API limit). */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const s3 = getS3();

  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      }),
    );
  }
}
