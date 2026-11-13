import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CircleAlert } from "lucide-react";
import { getAccount, listAccounts } from "@/lib/accounts";
import { getDriveQuotaCached } from "@/lib/graph/drive";
import { ReconnectNeededError } from "@/lib/graph/client";
import { ensureChildren, getFolderFetchedAt, getRootId } from "@/lib/graph/scan";
import { getItem, listChildren } from "@/lib/items";
import { ItemRow } from "@/components/explorer/item-row";
import { ScanButton } from "@/components/explorer/scan-button";
import type { MoveTarget } from "@/components/explorer/move-menu";

export const dynamic = "force-dynamic";

/** Free space of the other accounts, for the move popover (null when unknown). */
async function moveTargets(sourceId: string): Promise<MoveTarget[]> {
  const others = listAccounts().filter((a) => a.id !== sourceId && a.status === "connected");
  return Promise.all(
    others.map(async (a) => ({
      id: a.id,
      label: a.label,
      free: await getDriveQuotaCached(a.id).then((q) => q.remaining, () => null),
    })),
  );
}

export default async function AccountPage({ params, searchParams }: PageProps<"/account/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const account = getAccount(id);
  if (!account) notFound();
  const folderId = typeof sp.folder === "string" ? sp.folder : null;

  const targetsPromise = moveTargets(id);
  let expired = account.status === "reconnect";
  let loadError: string | null = null;
  if (!expired) {
    try {
      await getRootId(id);
      await ensureChildren(id, folderId);
    } catch (err) {
      if (err instanceof ReconnectNeededError) expired = true;
      else loadError = "Couldn't load this folder from OneDrive.";
    }
  }
  const targets = await targetsPromise;

  const folder = folderId ? getItem(id, folderId) : null;
  const rootId = expired ? null : await getRootId(id).catch(() => null);
  const parentId = folder?.parentId && folder.parentId !== rootId ? folder.parentId : null;
  const parent = parentId ? getItem(id, parentId) : null;
  const backHref = !folderId ? "/" : parentId ? `/account/${id}?folder=${parentId}` : `/account/${id}`;
  const backLabel = !folderId ? "Accounts" : (parent?.name ?? account.label);

  const items = expired || loadError ? [] : listChildren(id, folderId, "size");
  const maxSize = items.reduce((m, it) => Math.max(m, it.size), 0);

  return (
    <div className="flex flex-col">
      <header className="mb-6 flex items-center gap-4">
        <Link
          href={backHref}
          aria-label={`Back to ${backLabel}`}
          className="glass flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/[0.09]"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          {folder && <p className="truncate text-[13px] text-white/50">{account.label}</p>}
          <h1 className="truncate text-xl font-semibold">{folder?.name ?? account.label}</h1>
        </div>
        {!expired && <ScanButton accountId={id} folderId={folderId} fetchedAt={getFolderFetchedAt(id, folderId ?? rootId ?? "")} />}
      </header>

      {expired ? (
        <Panel>
          <p className="text-[15px] text-white/60">Access to {account.label} has expired.</p>
          <a
            href={`/api/auth/login?reconnect=${id}`}
            className="rounded-full bg-sky-300 px-4 py-2 text-[15px] font-medium text-neutral-950 hover:bg-sky-200"
          >
            Reconnect
          </a>
        </Panel>
      ) : loadError ? (
        <Panel>
          <CircleAlert className="size-6 text-rose-400" aria-hidden />
          <p className="text-[15px] text-white/60">{loadError} Try Scan.</p>
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <p className="text-[15px] text-white/50">This folder is empty</p>
        </Panel>
      ) : (
        <ul className="glass divide-y divide-white/5 rounded-2xl">
          {items.map((it) => (
            <ItemRow key={it.id} accountId={id} item={it} maxSize={maxSize} targets={targets} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="glass flex flex-col items-center gap-4 rounded-2xl py-16 text-center">{children}</div>;
}
