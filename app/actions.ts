"use server";

import { revalidatePath } from "next/cache";
import { updateLabelDescription } from "@/lib/accounts";

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
