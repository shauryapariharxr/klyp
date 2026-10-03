import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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

/**
 * A browser currently present on /local. Devices are grouped into rooms by a
 * hash of their network's public IP, so only devices behind the same router
 * ever see each other. The deviceToken is the capability that lets the browser
 * act as this device (heartbeat, signal, leave) — like transfers.accessToken.
 */
export const localDevices = pgTable(
  "local_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceToken: text("device_token").notNull(),
    name: text("name").notNull(),
    // sha256 of the room key (never the raw IP) — rooms are compared, not read.
    publicIpHash: text("public_ip_hash").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("local_devices_room_idx").on(table.publicIpHash, table.lastSeenAt)],
);

/**
 * One WebRTC signaling message (offer/answer/accept-decline) addressed from
 * one device to another. Deleted as soon as the recipient drains it; the
 * monotonic seq is the polling cursor. The file bytes themselves never pass
 * through here — only SDP metadata — because the transfer is peer-to-peer.
 */
export const localSignals = pgTable(
  "local_signals",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    fromDeviceId: uuid("from_device_id")
      .notNull()
      .references(() => localDevices.id, { onDelete: "cascade" }),
    toDeviceId: uuid("to_device_id")
      .notNull()
      .references(() => localDevices.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("local_signals_to_idx").on(table.toDeviceId, table.seq)],
);

export type Transfer = typeof transfers.$inferSelect;
export type TransferFile = typeof files.$inferSelect;
export type LocalDevice = typeof localDevices.$inferSelect;
export type LocalSignal = typeof localSignals.$inferSelect;
