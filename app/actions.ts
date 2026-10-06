"use server";

import { revalidatePath } from "next/cache";
import { updateLabelDescription, disconnectAccount } from "@/lib/accounts";
import { db } from "@/lib/db";
import { clearTokenCache } from "@/lib/graph/client";

/**
 * Inline-edit save for an account's user-authored label / description.
 * Called as an RPC from the client InlineEditText component.
 */
export async function saveAccountField(
  accountId: string,
  field: "label" | "description",
  rawValue: string,
): Promise<{ ok: boolean; value: string | null }> {
  const value = rawValue.trim();

  if (field === "label") {
    // Label is required — ignore an empty submit, keep the previous value.
    if (!value) return { ok: false, value: null };
    const updated = updateLabelDescription(accountId, { label: value });
    revalidatePath("/");
    return { ok: !!updated, value: updated?.label ?? null };
  }

  // Description is optional — empty clears it.
  const updated = updateLabelDescription(accountId, { description: value || null });
  revalidatePath("/");
  return { ok: !!updated, value: updated?.description ?? null };
}

/**
 * Disconnect an account: delete its local row, encrypted token, cached scan, and
 * items. Local delete only — does NOT revoke Microsoft's grant (the UI tells the
 * user to do that at account.microsoft.com).
 */
export async function disconnectAccountAction(accountId: string): Promise<void> {
  db.prepare("DELETE FROM items WHERE account_id = ?").run(accountId);
  db.prepare("DELETE FROM scans WHERE account_id = ?").run(accountId);
  disconnectAccount(accountId);
  clearTokenCache(accountId);
  revalidatePath("/");
  revalidatePath("/settings");
}

/** Clear an account's cached scan snapshot (safe — it's only a cache). */
export async function clearScanCacheAction(accountId: string): Promise<void> {
  db.prepare("DELETE FROM items WHERE account_id = ?").run(accountId);
  db.prepare("DELETE FROM scans WHERE account_id = ?").run(accountId);
  revalidatePath(`/account/${accountId}`);
  revalidatePath("/settings");
}
