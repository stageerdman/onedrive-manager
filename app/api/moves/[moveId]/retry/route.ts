import { NextResponse } from "next/server";
import { retryMove } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Put a stalled transfer back in the queue; it continues where it left off. */
export async function POST(_req: Request, ctx: RouteContext<"/api/moves/[moveId]/retry">) {
  const { moveId } = await ctx.params;
  return NextResponse.json({ ok: retryMove(moveId) });
}
