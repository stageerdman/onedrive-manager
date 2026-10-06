import { NextRequest, NextResponse } from "next/server";
import { getMoveState, resumeMove } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Resume a paused/failed move — continues with the files not yet copied. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ moveId: string }> }) {
  const { moveId } = await ctx.params;
  if (!getMoveState(moveId)) return NextResponse.json({ error: "Unknown move" }, { status: 404 });
  const ok = resumeMove(moveId);
  return NextResponse.json({ ok, ...getMoveState(moveId) });
}
