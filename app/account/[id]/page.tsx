import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getAccount, listAccounts, type Accent } from "@/lib/accounts";
import { getDriveQuota } from "@/lib/graph/drive";
import { ReconnectNeededError } from "@/lib/graph/client";
import {
  ensureChildren,
  getRootId,
  getFolderFetchedAt,
  getFullScanState,
} from "@/lib/graph/scan";
import {
  listChildren,
  breadcrumbs,
  getItem,
  biggestFiles,
  biggestFolders,
  staleFiles,
  type Item,
} from "@/lib/items";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AppBar } from "@/components/app-bar";
import { AnalysisNav, type ExplorerView } from "@/components/explorer/analysis-nav";
import { FullScanControl } from "@/components/explorer/full-scan-control";
import { FolderRefresh } from "@/components/explorer/folder-refresh";
import { SizeBarRow } from "@/components/explorer/size-bar-row";
import type { MoveTarget } from "@/components/explorer/move-menu";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const ACCENT_DOT: Record<Accent, string> = {
  indigo: "bg-indigo-500",
  teal: "bg-teal-500",
  rose: "bg-rose-500",
};

const VALID_VIEWS: ExplorerView[] = ["browse", "files", "folders", "stale"];

export default async function ExplorerPage({ params, searchParams }: PageProps<"/account/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const account = getAccount(id);
  if (!account) notFound();

  const moveTargets: MoveTarget[] = listAccounts()
    .filter((a) => a.id !== id)
    .map((a) => ({ id: a.id, label: a.label }));

  const view: ExplorerView =
    typeof sp.view === "string" && VALID_VIEWS.includes(sp.view as ExplorerView)
      ? (sp.view as ExplorerView)
      : "browse";
  const folderParam = typeof sp.folder === "string" ? sp.folder : null;

  // Header quota (reconnect-aware).
  let used: number | null = null;
  let total: number | null = null;
  let needsReconnect = account.status === "reconnect";
  if (!needsReconnect) {
    try {
      const q = await getDriveQuota(id);
      used = q.used;
      total = q.total;
    } catch (err) {
      needsReconnect = err instanceof ReconnectNeededError;
    }
  }

  // Lazily load the current level for browse (surface first, deeper on open).
  let loadError: string | null = null;
  if (!needsReconnect && view === "browse") {
    try {
      await getRootId(id);
      await ensureChildren(id, folderParam);
    } catch (err) {
      if (err instanceof ReconnectNeededError) needsReconnect = true;
      else loadError = err instanceof Error ? err.message : "Couldn't load this folder.";
    }
  }

  const fullScan = getFullScanState(id);

  return (
    <>
      <AppBar connectHref="/api/auth/login" canAdd={false} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={cn("size-3 rounded-full", ACCENT_DOT[account.accent])} aria-hidden />
            <div>
              <h1 className="text-lg font-semibold leading-tight tracking-tight">{account.label}</h1>
              <p className="text-xs text-muted-foreground">
                {account.email}
                {used != null && total != null && (
                  <span className="tabular-nums"> · {formatBytes(used)} of {formatBytes(total)} used</span>
                )}
              </p>
            </div>
          </div>
          {!needsReconnect && <FullScanControl accountId={id} initial={fullScan} />}
        </div>

        {needsReconnect ? (
          <ReconnectPanel accountId={id} />
        ) : (
          <>
            <AnalysisNav accountId={id} active={view} />
            {view === "browse" ? (
              <BrowseView
                accountId={id}
                folderId={folderParam}
                accountUsed={used ?? 0}
                label={account.label}
                moveTargets={moveTargets}
                loadError={loadError}
              />
            ) : (
              <AnalysisView accountId={id} view={view} moveTargets={moveTargets} fullStatus={fullScan.status} />
            )}
          </>
        )}
      </main>
    </>
  );
}

function RowList({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col divide-y rounded-xl border">{children}</div>;
}

function BrowseView({
  accountId,
  folderId,
  accountUsed,
  label,
  moveTargets,
  loadError,
}: {
  accountId: string;
  folderId: string | null;
  accountUsed: number;
  label: string;
  moveTargets: MoveTarget[];
  loadError: string | null;
}) {
  const items = listChildren(accountId, folderId, "size");
  const crumbs = folderId ? breadcrumbs(accountId, folderId) : [];
  const currentFolder = folderId ? getItem(accountId, folderId) : null;
  const parentSize = currentFolder?.size ?? accountUsed;
  const maxSize = items.reduce((m, it) => Math.max(m, it.size), 0);
  const fetchedAt = getFolderFetchedAt(accountId, folderId ?? "");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">← All accounts</Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <Link
            href={`/account/${accountId}?view=browse`}
            className={cn("hover:text-foreground", !folderId && "font-medium text-foreground")}
          >
            {label}
          </Link>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" aria-hidden />
              <Link
                href={`/account/${accountId}?view=browse&folder=${c.id}`}
                className={cn("hover:text-foreground", i === crumbs.length - 1 && "font-medium text-foreground")}
              >
                {c.name}
              </Link>
            </span>
          ))}
        </nav>
        <FolderRefresh accountId={accountId} folderId={folderId} fetchedAt={fetchedAt} />
      </div>

      {loadError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
      ) : items.length === 0 ? (
        <EmptyFolder />
      ) : (
        <RowList>
          {items.map((it) => (
            <SizeBarRow
              key={it.id}
              accountId={accountId}
              item={it}
              maxSize={maxSize}
              parentSize={parentSize}
              moveTargets={moveTargets}
            />
          ))}
        </RowList>
      )}
    </div>
  );
}

function AnalysisView({
  accountId,
  view,
  moveTargets,
  fullStatus,
}: {
  accountId: string;
  view: ExplorerView;
  moveTargets: MoveTarget[];
  fullStatus: string;
}) {
  const items: Item[] =
    view === "files" ? biggestFiles(accountId) : view === "folders" ? biggestFolders(accountId) : staleFiles(accountId);
  const maxSize = items.reduce((m, it) => Math.max(m, it.size), 0);

  const pathFor = (it: Item): string => {
    if (!it.parentId) return "";
    return getItem(accountId, it.parentId)?.name ?? "";
  };

  return (
    <div className="flex flex-col gap-3">
      {fullStatus !== "complete" && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Based on the folders you&apos;ve opened so far. For complete account-wide results, run a{" "}
          <strong>Full scan</strong> (top right).
        </p>
      )}
      {view === "stale" && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          We can&apos;t see when a file was last <em>opened</em> — Microsoft doesn&apos;t provide that for
          personal accounts. &quot;Stale&quot; means not <em>modified</em> in a long time, ranked by a
          cleanup score (size × age).
        </p>
      )}
      {items.length === 0 ? (
        <EmptyFolder />
      ) : (
        <RowList>
          {items.map((it) => (
            <SizeBarRow
              key={it.id}
              accountId={accountId}
              item={it}
              maxSize={maxSize}
              pathLabel={pathFor(it)}
              moveTargets={moveTargets}
            />
          ))}
        </RowList>
      )}
    </div>
  );
}

function EmptyFolder() {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      Nothing here.
    </div>
  );
}

function ReconnectPanel({ accountId }: { accountId: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-12 text-center">
      <p className="text-sm text-amber-600 dark:text-amber-500">
        Access to this account expired. Reconnect to browse it again.
      </p>
      <a
        href={`/api/auth/login?reconnect=${accountId}`}
        className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
      >
        Reconnect
      </a>
    </div>
  );
}
