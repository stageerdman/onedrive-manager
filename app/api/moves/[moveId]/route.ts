import { NextResponse } from "next/server";
import { getMoveState, removeMove } from "@/lib/graph/move";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/api/moves/[moveId]">) {
  const { moveId } = await ctx.params;
  const state = getMoveState(moveId);
  if (!state) return NextResponse.json({ error: "Unknown transfer" }, { status: 404 });
  return NextResponse.json(state);
}

/** Remove from the queue: deletes the partial copy on the target; the source is untouched. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/moves/[moveId]">) {
  const { moveId } = await ctx.params;
  const ok = await removeMove(moveId);
  return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
}
