import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** True when a database connection string is present in the environment. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Singleton Drizzle client over postgres-js, which fully supports
 * transactions (required by the PIN-collision retry logic and the
 * complete-file metadata write).
 *
 * Works with any Postgres provider. For Supabase's transaction pooler
 * (port 6543), `prepare: false` is required. `max` is kept small for
 * serverless but > 1: concurrent endpoints (heartbeat polling, file
 * metadata, health) must not serialize behind one connection — with ~700ms
 * pooler round trips, a single connection saturates under even two
 * concurrent pollers.
 */
export function getDb() {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Put your Postgres connection string (e.g. Supabase pooler URL) in .env.local — see README.",
    );
  }

  cached = drizzle(postgres(connectionString, { prepare: false, max: 3 }), { schema });
  return cached;
}
