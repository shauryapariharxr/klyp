// Lists buckets on the configured S3 endpoint using .env.local credentials.
// Read-only — used to discover the bucket name for setup.
import { readFileSync } from "node:fs";
import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

let endpoint = env.S3_ENDPOINT;
if (endpoint && !/^https?:\/\//.test(endpoint)) endpoint = `https://${endpoint}`;

const s3 = new S3Client({
  endpoint,
  region: env.S3_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

try {
  const res = await s3.send(new ListBucketsCommand({}));
  console.log("endpoint:", endpoint);
  console.log("buckets:", JSON.stringify(res.Buckets?.map((b) => b.Name) ?? [], null, 2));
} catch (error) {
  console.error("ERROR:", error.name, "-", error.message);
  process.exit(1);
}
