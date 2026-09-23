#!/usr/bin/env node
/**
 * Sets the CORS policy on the klyp storage bucket so browsers can upload
 * directly via presigned PUT URLs (and download via presigned GET URLs).
 *
 * The bucket stays PRIVATE — CORS only governs which web origins may use
 * presigned URLs from the browser. Every real authorization still flows
 * through the app (access token + PIN), and presigned URLs expire in minutes.
 *
 * Usage: node scripts/set-cors.js
 */
import fs from "node:fs";
import {
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Load .env.local without printing any values.
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
if (!endpoint || !bucket) {
  console.error("S3_ENDPOINT and S3_BUCKET must be set in .env.local");
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const rules = [
  {
    // Presigned URLs are the authorization gate, so any web origin is fine
    // here; this also covers Vercel preview deployments and custom domains.
    AllowedOrigins: ["*"],
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3000,
  },
];

try {
  await s3.send(
    new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }),
  );
  console.log("CORS rule applied.");
} catch (error) {
  console.error("PutBucketCors failed:", error.name, "-", error.message);
  console.error("(If the provider rejects this API call, set the same rule in its web console instead.)");
  process.exit(1);
}

const confirm = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log("Confirmed bucket CORS rules:");
for (const rule of confirm.CORSRules ?? []) {
  console.log(JSON.stringify(rule));
}
