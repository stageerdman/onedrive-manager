import { NextRequest, NextResponse } from "next/server";
import { setQueuePaused } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Pause or resume the whole queue. Body: { paused: boolean }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ error: "paused must be a boolean" }, { status: 400 });
  }
  setQueuePaused(body.paused);
  return NextResponse.json({ ok: true });
}
