import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { cancelFullScan, getFullScanState, startFullScan } from "@/lib/graph/scan";

export const runtime = "nodejs";

/** Full-scan status (for account-wide analysis). Browsing itself is lazy, not here. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/scan">) {
  const { id } = await ctx.params;
  if (!getAccount(id)) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  return NextResponse.json(getFullScanState(id));
}

/** Start a full scan (walks every folder so analysis is complete). */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/scan">) {
  const { id } = await ctx.params;
  if (!getAccount(id)) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  startFullScan(id);
  return NextResponse.json(getFullScanState(id), { status: 202 });
}

/** Cancel a running full scan (keeps folders scanned so far). */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/scan">) {
  const { id } = await ctx.params;
  if (!getAccount(id)) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const accepted = cancelFullScan(id);
  return NextResponse.json({ accepted, ...getFullScanState(id) });
}
