import { NextRequest, NextResponse } from "next/server";
import { cancelMove, getMoveState } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Request cancellation of an in-flight move. The job stops at its next checkpoint. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ moveId: string }> }) {
  const { moveId } = await ctx.params;
  const state = getMoveState(moveId);
  if (!state) return NextResponse.json({ error: "Unknown move" }, { status: 404 });
  const accepted = cancelMove(moveId);
  return NextResponse.json({ accepted, ...getMoveState(moveId) });
}
