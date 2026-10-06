import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { getScanState, startScan } from "@/lib/graph/scan";

export const runtime = "nodejs";

/** Poll scan status/progress. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/scan">) {
  const { id } = await ctx.params;
  if (!getAccount(id)) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  return NextResponse.json(getScanState(id));
}

/** Start (or resume) a scan. Fire-and-forget; the client polls GET for progress. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/scan">) {
  const { id } = await ctx.params;
  if (!getAccount(id)) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  startScan(id);
  return NextResponse.json(getScanState(id), { status: 202 });
}
