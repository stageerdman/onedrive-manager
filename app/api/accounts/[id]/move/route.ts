import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { getMoveState, startMove } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Start a cross-account move. Body: { itemId, targetAccountId }. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/move">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const itemId = body?.itemId;
  const targetAccountId = body?.targetAccountId;

  if (!itemId || !targetAccountId) {
    return NextResponse.json({ error: "itemId and targetAccountId are required" }, { status: 400 });
  }
  if (targetAccountId === id) {
    return NextResponse.json({ error: "Source and target are the same account" }, { status: 400 });
  }
  if (!getAccount(id) || !getAccount(targetAccountId)) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }

  const moveId = startMove({ sourceAccount: id, targetAccount: targetAccountId, itemId });
  return NextResponse.json(getMoveState(moveId), { status: 202 });
}
