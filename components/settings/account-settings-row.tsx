"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InlineEditText } from "@/components/inline-edit-text";
import { clearScanCacheAction, disconnectAccountAction } from "@/app/actions";

/** One account's settings: rename, clear its folder cache, disconnect. */
export function AccountSettingsRow({
  accountId,
  email,
  label,
}: {
  accountId: string;
  email: string | null;
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0 flex-1">
        <InlineEditText
          accountId={accountId}
          field="label"
          value={label}
          placeholder="Name this account"
          className="-ml-1.5 text-[15px] font-medium"
        />
        {email && <p className="truncate text-[13px] text-white/50">{email}</p>}
      </div>

      {confirming ? (
        <span className="flex items-center gap-2 text-[13px]">
          <span className="text-white/60">Disconnect?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => disconnectAccountAction(accountId))}
            className="rounded-full px-3 py-1 text-rose-400 hover:bg-rose-400/10 disabled:opacity-50"
          >
            Disconnect
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-full px-3 py-1 text-white/60 hover:bg-white/10"
          >
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[13px]">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => clearScanCacheAction(accountId))}
            className="rounded-full px-3 py-1 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            Clear cache
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-full px-3 py-1 text-rose-400/80 hover:bg-rose-400/10 hover:text-rose-400"
          >
            Disconnect
          </button>
        </span>
      )}
    </li>
  );
}
