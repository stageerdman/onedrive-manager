import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, HardDrive } from "lucide-react";
import { getAccount, type Accent } from "@/lib/accounts";
import { getDriveQuota } from "@/lib/graph/drive";
import { ReconnectNeededError } from "@/lib/graph/client";
import { getScanState } from "@/lib/graph/scan";
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
import { ScanControl } from "@/components/explorer/scan-control";
import { SizeBarRow } from "@/components/explorer/size-bar-row";
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

  const view: ExplorerView =
    typeof sp.view === "string" && VALID_VIEWS.includes(sp.view as ExplorerView)
      ? (sp.view as ExplorerView)
      : "browse";
  const folderParam = typeof sp.folder === "string" ? sp.folder : null;

  // Quota for the header (reconnect-aware).
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

  const scan = getScanState(id);
  const neverScanned = scan.readGen == null && !scan.isRunning;

  return (
    <>
      <AppBar connectHref="/api/auth/login" canAdd={false} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 p-6">
        {/* Identity header strip */}
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
          {!needsReconnect && <ScanControl accountId={id} initial={scan} />}
        </div>

        {needsReconnect ? (
          <ReconnectPanel accountId={id} />
        ) : neverScanned ? (
          <NotScannedPanel accountId={id} initial={scan} />
        ) : (
          <>
            <AnalysisNav accountId={id} active={view} />
            {view === "browse" ? (
              <BrowseView accountId={id} folderId={folderParam} accountUsed={used ?? 0} label={account.label} />
            ) : (
              <AnalysisView accountId={id} view={view} />
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
}: {
  accountId: string;
  folderId: string | null;
  accountUsed: number;
  label: string;
}) {
  const items = listChildren(accountId, folderId, "size");
  const crumbs = folderId ? breadcrumbs(accountId, folderId) : [];
  const currentFolder = folderId ? getItem(accountId, folderId) : null;
  const parentSize = currentFolder?.size ?? accountUsed;
  const maxSize = items.reduce((m, it) => Math.max(m, it.size), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Breadcrumbs */}
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

      {items.length === 0 ? (
        <EmptyFolder />
      ) : (
        <RowList>
          {items.map((it) => (
            <SizeBarRow key={it.id} accountId={accountId} item={it} maxSize={maxSize} parentSize={parentSize} />
          ))}
        </RowList>
      )}
    </div>
  );
}

function AnalysisView({ accountId, view }: { accountId: string; view: ExplorerView }) {
  const items: Item[] =
    view === "files" ? biggestFiles(accountId) : view === "folders" ? biggestFolders(accountId) : staleFiles(accountId);
  const maxSize = items.reduce((m, it) => Math.max(m, it.size), 0);

  // Resolve each row's parent-folder name for the path column.
  const pathFor = (it: Item): string => {
    if (!it.parentId) return "";
    const parent = getItem(accountId, it.parentId);
    return parent?.name ?? "";
  };

  return (
    <div className="flex flex-col gap-3">
      {view === "stale" && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          We can&apos;t see when a file was last <em>opened</em> — Microsoft doesn&apos;t provide that for
          personal accounts. &quot;Stale&quot; means not <em>modified</em> in a long time, ranked by a
          cleanup score (size × age) — big, long-untouched files first.
        </p>
      )}
      {items.length === 0 ? (
        <EmptyFolder />
      ) : (
        <RowList>
          {items.map((it) => (
            <SizeBarRow key={it.id} accountId={accountId} item={it} maxSize={maxSize} pathLabel={pathFor(it)} />
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

function NotScannedPanel({ accountId, initial }: { accountId: string; initial: ReturnType<typeof getScanState> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border bg-muted/40">
        <HardDrive className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Not scanned yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Scan this drive to see its folder structure by size and surface the biggest and
          longest-untouched items. Large drives stream in progressively.
        </p>
      </div>
      <ScanControl accountId={accountId} initial={initial} />
    </div>
  );
}

function ReconnectPanel({ accountId }: { accountId: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-12 text-center">
      <p className="text-sm text-amber-600 dark:text-amber-500">
        Access to this account expired. Reconnect to scan and browse it again.
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
