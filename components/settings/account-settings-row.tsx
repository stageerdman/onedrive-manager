"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Accent } from "@/lib/accounts";
import { InlineEditText } from "@/components/inline-edit-text";
import { clearScanCacheAction, disconnectAccountAction } from "@/app/actions";

const ACCENT_DOT: Record<Accent, string> = {
  indigo: "bg-indigo-500",
  teal: "bg-teal-500",
  rose: "bg-rose-500",
};

/** One account's settings (spec #3 §1.6/§3): label/description editors, clear cache, disconnect. */
export function AccountSettingsRow({
  accountId,
  accent,
  email,
  label,
  description,
}: {
  accountId: string;
  accent: Accent;
  email: string | null;
  label: string;
  description: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", ACCENT_DOT[accent])} aria-hidden />
        <div className="min-w-0 flex-1">
          <InlineEditText
            accountId={accountId}
            field="label"
            value={label}
            placeholder="Name this drive"
            className="text-sm font-semibold"
          />
          <InlineEditText
            accountId={accountId}
            field="description"
            value={description}
            placeholder="Add a description"
            className="text-sm text-muted-foreground"
          />
          {email && <p className="truncate px-1.5 text-xs text-muted-foreground/70">{email}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => { await clearScanCacheAction(accountId); router.refresh(); })}
          className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          Clear cached scan
        </button>

        {confirming ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Disconnect this account?</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => { await disconnectAccountAction(accountId); router.refresh(); })}
              className="rounded-md bg-destructive/10 px-2.5 py-1 font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              Yes, disconnect
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border px-2.5 py-1 hover:bg-muted">
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
