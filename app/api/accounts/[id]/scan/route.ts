import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { cancelScan, getScanState, startScan } from "@/lib/graph/scan";

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

/** Cancel a running scan (keeps whatever was scanned as a partial snapshot). */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/scan">) {
  const { id } = await ctx.params;
  if (!getAccount(id)) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const accepted = cancelScan(id);
  return NextResponse.json({ accepted, ...getScanState(id) });
}
