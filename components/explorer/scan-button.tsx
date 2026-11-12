"use client";

import { useEffect, useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { refreshFolderAction } from "@/app/actions";
import { cn } from "@/lib/utils";

/** SQLite `datetime('now')` → epoch ms (it's UTC without a zone marker). */
const parseUtc = (s: string) => Date.parse(`${s.replace(" ", "T")}Z`);

function ago(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** Re-reads the current folder level from OneDrive. Shows how fresh the cached level is. */
export function ScanButton({
  accountId,
  folderId,
  fetchedAt,
}: {
  accountId: string;
  folderId: string | null;
  fetchedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="ml-auto flex items-center gap-3">
      {fetchedAt && !pending && (
        <span className="hidden text-[13px] text-white/50 sm:inline" suppressHydrationWarning>
          {ago(parseUtc(fetchedAt))}
        </span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => refreshFolderAction(accountId, folderId))}
        className="glass flex h-10 items-center gap-2 rounded-full px-4 text-[15px] transition-colors duration-150 hover:bg-white/[0.09] disabled:opacity-70"
      >
        <RotateCw className={cn("size-4", pending && "animate-spin motion-reduce:animate-none")} aria-hidden />
        {pending ? "Scanning…" : "Scan"}
      </button>
      <span className="sr-only" aria-live="polite">
        {pending ? "Scanning" : ""}
      </span>
    </div>
  );
}
