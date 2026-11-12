import { NextRequest, NextResponse } from "next/server";
import { reorderMoves } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Set the queue's priority order. Body: { ids: string[] } — first runs first. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "ids must be a string array" }, { status: 400 });
  }
  reorderMoves(ids);
  return NextResponse.json({ ok: true });
}
