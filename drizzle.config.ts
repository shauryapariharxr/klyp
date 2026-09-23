import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js keeps secrets in .env.local, which drizzle-kit doesn't load on its own.
loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
