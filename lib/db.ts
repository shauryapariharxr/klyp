import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "@/db/schema";

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** True when a database connection string is present in the environment. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Singleton Drizzle client over Neon's WebSocket driver, which (unlike the
 * plain HTTP driver) supports transactions — required by the PIN-collision
 * retry logic and the complete-file metadata write.
 */
export function getDb() {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Create a free Postgres database at https://neon.tech and put its connection string in .env.local (see README).",
    );
  }

  cached = drizzle(new Pool({ connectionString }), { schema });
  return cached;
}
