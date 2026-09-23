import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Deterministic peppered scrypt hash — the raw PIN is never stored.
    // Unique because identical PINs must not collide on the lookup index.
    pinHash: text("pin_hash").notNull().unique(),
    textContent: text("text_content"),
    // Capability token required alongside the transfer id to view contents.
    accessToken: text("access_token").notNull(),
    // False until every file has been uploaded to R2 (direct presigned PUTs).
    ready: boolean("ready").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("transfers_expires_at_idx").on(table.expiresAt)],
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfers.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("files_transfer_id_idx").on(table.transferId)],
);

export type Transfer = typeof transfers.$inferSelect;
export type TransferFile = typeof files.$inferSelect;
