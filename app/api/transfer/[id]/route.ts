import { NextResponse } from "next/server";
import { getTransferView } from "@/lib/transfers";
import { isDbConfigured } from "@/lib/db";
import { isUuid, jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Invalid transfer id.", 400);

  if (!isDbConfigured()) {
    return jsonError("Service unavailable: the database is not configured.", 503);
  }

  const token = new URL(req.url).searchParams.get("token");
  const result = await getTransferView(id, token);
  if (!result.ok) return jsonError(result.message, result.status);

  return NextResponse.json(result.view);
}
