import { NextRequest, NextResponse } from "next/server";
import { getMoveState } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Poll a move job's progress/status. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/moves/[moveId]">) {
  const { moveId } = await ctx.params;
  const state = getMoveState(moveId);
  if (!state) return NextResponse.json({ error: "Unknown move" }, { status: 404 });
  return NextResponse.json(state);
}
