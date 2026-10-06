"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { formatRelativeDate } from "@/lib/format";
import { refreshFolderAction } from "@/app/actions";

/**
 * Per-folder refresh for the lazy browse view: re-fetch just this folder's children
 * from Graph (not the whole drive), with a "loaded Xm ago" hint.
 */
export function FolderRefresh({
  accountId,
  folderId,
  fetchedAt,
}: {
  accountId: string;
  folderId: string | null;
  fetchedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      {fetchedAt && <span>Loaded {formatRelativeDate(fetchedAt)}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => { await refreshFolderAction(accountId, folderId); router.refresh(); })}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-muted disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
        Refresh
      </button>
    </span>
  );
}
