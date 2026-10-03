/**
 * Applies the klyp Local signaling schema (local_devices, local_signals)
 * directly via SQL. Equivalent to `drizzle-kit push` for these two tables;
 * kept because drizzle-kit push can hang on the transaction pooler.
 *
 * Run: node scripts/apply-local-schema.js
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

await sql`
  CREATE TABLE IF NOT EXISTS "local_devices" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "device_token" text NOT NULL,
    "name" text NOT NULL,
    "public_ip_hash" text NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS "local_devices_room_idx"
  ON "local_devices" ("public_ip_hash", "last_seen_at")
`;

await sql`
  CREATE TABLE IF NOT EXISTS "local_signals" (
    "seq" bigserial PRIMARY KEY,
    "from_device_id" uuid NOT NULL REFERENCES "local_devices"("id") ON DELETE CASCADE,
    "to_device_id" uuid NOT NULL REFERENCES "local_devices"("id") ON DELETE CASCADE,
    "payload" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS "local_signals_to_idx"
  ON "local_signals" ("to_device_id", "seq")
`;

const [{ count: devices }] = await sql`SELECT count(*)::int AS count FROM local_devices`;
const [{ count: signals }] = await sql`SELECT count(*)::int AS count FROM local_signals`;
console.log(`local_devices rows: ${devices}, local_signals rows: ${signals} — schema OK`);

await sql.end();
