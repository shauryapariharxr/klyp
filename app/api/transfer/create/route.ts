import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isDbConfigured } from "@/lib/db";
import { transfers } from "@/db/schema";
import { generatePin, hashPin } from "@/lib/pin";
import { generateToken } from "@/lib/token";
import { MAX_TEXT_LENGTH, TRANSFER_TTL_MS } from "@/lib/limits";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, jsonError } from "@/lib/http";
import { isStorageConfigured } from "@/lib/storage";
import { scheduleExpirySweep } from "@/lib/cleanup";

export const runtime = "nodejs";

const createSchema = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    hasFiles: z.boolean().optional().default(false),
  })
  .refine((data) => data.hasFiles || (data.text !== undefined && data.text.trim().length > 0), {
    message: "Provide some text or at least one file.",
  });

const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  scheduleExpirySweep();

  const ip = getClientIp(req);
  if (!rateLimit(`create:${ip}`, CREATE_LIMIT, CREATE_WINDOW_MS).allowed) {
    return jsonError("Too many transfers created. Try again later.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  if (parsed.data.hasFiles && !isStorageConfigured()) {
    return jsonError("File uploads are unavailable: storage is not configured.", 503);
  }

  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  let pin = generatePin();
  let pinHash = await hashPin(pin);
  const accessToken = generateToken();

  const db = getDb();
  let created;
  try {
    created = await db.transaction(async (tx) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const [row] = await tx
            .insert(transfers)
            .values({
              pinHash,
              textContent: parsed.data.text ?? null,
              accessToken,
              // Files are uploaded directly to object storage afterwards; a text-only
              // transfer is complete the moment it is created.
              ready: !parsed.data.hasFiles,
              expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
            })
            .returning();
          return row;
        } catch (error) {
          // 23505 = unique_violation: a (vanishingly rare) PIN collision. Re-roll.
          const code = (error as { code?: string }).code;
          if (code === "23505" && attempt < 4) {
            pin = generatePin();
            pinHash = await hashPin(pin);
            continue;
          }
          throw error;
        }
      }
      throw new Error("Could not allocate a unique PIN.");
    });
  } catch (error) {
    console.error("[create] insert failed", error);
    return jsonError("Could not create the transfer. Try again.", 500);
  }

  return NextResponse.json(
    {
      transferId: created.id,
      accessToken,
      pin,
      expiresAt: created.expiresAt.toISOString(),
    },
    { status: 201 },
  );
}
