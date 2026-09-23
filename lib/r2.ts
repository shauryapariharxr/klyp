import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from "./limits";

const R2_ENDPOINT_VAR = "R2_ACCOUNT_ID";

export function isR2Configured(): boolean {
  return Boolean(
    process.env[R2_ENDPOINT_VAR] &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

function getS3(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      "Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (see README).",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env[R2_ENDPOINT_VAR]}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function bucket(): string {
  return process.env.R2_BUCKET!;
}

/**
 * Short-lived presigned PUT URL so the browser can upload directly to the
 * private R2 bucket. This keeps large uploads from flowing through (and
 * being size-limited by) the serverless function itself.
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

/** Delete objects in batches of up to 1000 (the S3/R2 API limit). */
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
