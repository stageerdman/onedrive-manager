import { NextResponse } from "next/server";
import { listRecentMoves } from "@/lib/graph/move";

export const runtime = "nodejs";

/** Active + recently-finished moves for the global tracker bar. */
export async function GET() {
  return NextResponse.json({ moves: listRecentMoves(10) });
}
