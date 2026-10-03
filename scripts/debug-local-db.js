/**
 * Reproduces the sync endpoint's exact DB path standalone, to isolate whether
 * the wedge is in Drizzle/postgres-js/Supabase or in Next.js request context.
 * Run: node scripts/debug-local-db.js
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const { drizzle } = await import("drizzle-orm/postgres-js");
const postgres = (await import("postgres")).default;
const { and, asc, eq, gt, ne, sql: dsql } = await import("drizzle-orm");
const schema = await import("../db/schema.ts");

const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const db = drizzle(client, { schema: { localDevices: schema.localDevices, localSignals: schema.localSignals } });

const [device] = await db
  .insert(schema.localDevices)
  .values({ deviceToken: "tok", name: "Dbg", publicIpHash: "dbg-room" })
  .returning();
console.log("insert ok", device.id);

const t0 = Date.now();
const rows = await db
  .select({ id: schema.localDevices.id, name: schema.localDevices.name })
  .from(schema.localDevices)
  .where(and(eq(schema.localDevices.publicIpHash, device.publicIpHash), ne(schema.localDevices.id, device.id)))
  .orderBy(dsql`${schema.localDevices.lastSeenAt} desc`)
  .limit(50);
console.log("peer select ok", rows.length, Date.now() - t0, "ms");

const upd = await db.update(schema.localDevices).set({ lastSeenAt: new Date() }).where(eq(schema.localDevices.id, device.id));
console.log("update ok", upd.count, Date.now() - t0, "ms");

const t1 = Date.now();
const sig = await db.select().from(schema.localSignals).where(and(eq(schema.localSignals.toDeviceId, device.id), gt(schema.localSignals.seq, 0))).orderBy(asc(schema.localSignals.seq)).limit(50);
console.log("signal select ok", sig.length, Date.now() - t1, "ms");

await db.delete(schema.localDevices).where(eq(schema.localDevices.id, device.id));
console.log("cleanup ok");
await client.end();
process.exit(0);
