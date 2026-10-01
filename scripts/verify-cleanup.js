#!/usr/bin/env node
/**
 * Verifies that expired transfers are REALLY deleted — not just hidden:
 *   - the actual objects in Supabase Storage (completed uploads AND
 *     abandoned uploads that never called /complete — the orphan path)
 *   - the transfers row and its cascade-deleted files rows in the DB
 *
 * Run: node scripts/verify-cleanup.js [BASE_URL]   (default http://localhost:3123)
 *
 * Flow: upload a canary file through the full API flow, upload an abandoned
 * transfer's bytes without /complete, backdate both rows in the DB, call
 * /api/cleanup, then assert everything is gone.
 *
 * Uses .env.local for DATABASE_URL + the S3_* storage vars.
 */
import fs from "node:fs";
import postgres from "postgres";
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const BASE = process.argv[2] ?? "http://localhost:3123";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
const s3 = new S3Client({
  region: env.S3_REGION ?? "auto",
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});
const BUCKET = env.S3_BUCKET;

const J = { "Content-Type": "application/json" };
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function createFileTransfer() {
  const res = await fetch(`${BASE}/api/transfer/create`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ hasFiles: true }),
  });
  if (!res.ok) throw new Error(`create failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function uploadBytes(transfer, fileName, body) {
  const res = await fetch(`${BASE}/api/transfer/${transfer.transferId}/upload`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({
      accessToken: transfer.accessToken,
      files: [{ fileName, fileSize: body.length, mimeType: "text/plain" }],
    }),
  });
  if (!res.ok) throw new Error(`upload plan failed ${res.status}: ${await res.text()}`);
  const plan = await res.json();
  const item = plan.uploadUrls[0];
  const put = await fetch(item.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body,
  });
  return { item, putStatus: put.status };
}

async function main() {
  console.log(`Verifying deletion against ${BASE} (bucket: ${BUCKET})\n`);

  // ---- Test 1: a COMPLETED file transfer (the normal path) ----
  const t1 = await createFileTransfer();
  const canaryBody = "canary bytes for cleanup verification";
  const { item, putStatus } = await uploadBytes(t1, "canary.txt", canaryBody);
  check("canary uploaded to storage (presigned PUT)", putStatus === 200, `PUT ${putStatus}`);

  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: item.storageKey }));
  check("canary object exists in bucket before expiry", head.$metadata.httpStatusCode === 200);

  const complete = await fetch(`${BASE}/api/transfer/${t1.transferId}/complete`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({
      accessToken: t1.accessToken,
      uploaded: [
        {
          fileName: item.fileName,
          fileSize: canaryBody.length,
          mimeType: "text/plain",
          storageKey: item.storageKey,
        },
      ],
    }),
  });
  check("canary transfer completed (/complete ok)", complete.ok);

  // ---- Test 2: an ABANDONED upload (bytes in the bucket, no /complete) ----
  const t2 = await createFileTransfer();
  const { putStatus: orphanPut } = await uploadBytes(t2, "orphan.txt", "orphan bytes");
  check("orphan bytes uploaded (never completed)", orphanPut === 200, `PUT ${orphanPut}`);

  // ---- expire both, then run the cleanup endpoint ----
  await sql`UPDATE transfers SET expires_at = now() - interval '1 minute' WHERE id IN (${t1.transferId}, ${t2.transferId})`;

  const cleanupRes = await fetch(`${BASE}/api/cleanup`);
  const cleanup = await cleanupRes.json().catch(() => ({}));
  check("cleanup endpoint ran", cleanupRes.ok && cleanup.ok === true, JSON.stringify(cleanup));

  // ---- assert the storage bytes are gone ----
  let canaryAfter;
  try {
    canaryAfter = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: item.storageKey }));
  } catch (error) {
    canaryAfter = error;
  }
  const canaryCode = canaryAfter?.$metadata?.httpStatusCode ?? canaryAfter?.name;
  check(
    "canary object DELETED from storage",
    canaryCode === 404 || canaryCode === "NotFound" || canaryCode === "NoSuchKey",
    `got ${canaryCode}`,
  );

  const orphanAfter = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `transfers/${t2.transferId}/` }),
  );
  check(
    "orphan bytes DELETED (prefix safety net)",
    (orphanAfter.Contents ?? []).length === 0,
    `${(orphanAfter.Contents ?? []).length} object(s) left`,
  );

  // ---- assert the DB rows are gone ----
  const transfersLeft = await sql`
    SELECT count(*)::int AS n FROM transfers WHERE id IN (${t1.transferId}, ${t2.transferId})
  `;
  check("transfers rows deleted from DB", transfersLeft[0].n === 0, `${transfersLeft[0].n} row(s) left`);

  const filesLeft = await sql`
    SELECT count(*)::int AS n FROM files WHERE transfer_id IN (${t1.transferId}, ${t2.transferId})
  `;
  check("files rows cascade-deleted from DB", filesLeft[0].n === 0, `${filesLeft[0].n} row(s) left`);

  await sql.end();
  console.log(
    failures === 0
      ? "\n🎉 DELETION VERIFICATION PASSED — expired transfers are fully removed (storage + DB)"
      : `\n💥 ${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
