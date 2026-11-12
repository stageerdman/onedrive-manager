import { NextResponse } from "next/server";
import { clearFinishedMoves } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Forget finished transfers. */
export async function POST() {
  clearFinishedMoves();
  return NextResponse.json({ ok: true });
}
