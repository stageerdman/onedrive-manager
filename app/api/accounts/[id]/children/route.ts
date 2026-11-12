import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { ReconnectNeededError } from "@/lib/graph/client";
import { ensureChildren } from "@/lib/graph/scan";
import { listChildren } from "@/lib/items";

export const runtime = "nodejs";

/** One folder level (root when ?folder is absent), for the Add-transfer picker. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/accounts/[id]/children">) {
  const { id } = await ctx.params;
  if (!getAccount(id)) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const folder = req.nextUrl.searchParams.get("folder");
  try {
    await ensureChildren(id, folder);
  } catch (err) {
    const reconnect = err instanceof ReconnectNeededError;
    return NextResponse.json(
      { error: reconnect ? "Access expired — reconnect this account." : "Couldn't load this folder." },
      { status: reconnect ? 401 : 502 },
    );
  }
  return NextResponse.json({ items: listChildren(id, folder, "size") });
}
