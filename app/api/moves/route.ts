import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { getMoveState, listMoves, startMove } from "@/lib/graph/move";

export const runtime = "nodejs";

/** The transfers queue (priority order), then recently finished ones. */
export async function GET() {
  return NextResponse.json(listMoves());
}

/** Add a transfer to the bottom of the queue. Body: { sourceAccount, targetAccount, itemId }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { sourceAccount, targetAccount, itemId } = body ?? {};
  if (!sourceAccount || !targetAccount || !itemId) {
    return NextResponse.json({ error: "sourceAccount, targetAccount and itemId are required" }, { status: 400 });
  }
  if (sourceAccount === targetAccount) {
    return NextResponse.json({ error: "Source and target are the same account" }, { status: 400 });
  }
  if (!getAccount(sourceAccount) || !getAccount(targetAccount)) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }
  const id = startMove({ sourceAccount, targetAccount, itemId });
  return NextResponse.json(getMoveState(id), { status: 202 });
}
