import Link from "next/link";
import { Folder, File as FileIcon, ChevronRight } from "lucide-react";
import type { Item } from "@/lib/items";
import {
  formatBytes,
  formatPercent,
  formatRelativeDate,
  formatAbsoluteDate,
  stalenessLevel,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const STALE_DOT = {
  fresh: "bg-transparent",
  aging: "bg-amber-500",
  stale: "bg-red-500/70",
} as const;

/**
 * One row of the ranked list (spec #2 §1–4): icon, name, proportional size bar
 * scaled to the largest sibling, size, % of parent (browse) or path (analysis),
 * item count for folders, and an honest "Modified" with staleness colour.
 * Folder rows drill; file rows are static.
 */
export function SizeBarRow({
  accountId,
  item,
  maxSize,
  parentSize,
  pathLabel,
}: {
  accountId: string;
  item: Item;
  maxSize: number;
  parentSize?: number;
  pathLabel?: string;
}) {
  const barPct = maxSize > 0 ? (item.size / maxSize) * 100 : 0;
  const stale = stalenessLevel(item.modified);
  const Icon = item.isFolder ? Folder : FileIcon;

  const inner = (
    <>
      <Icon
        className={cn("size-4 shrink-0", item.isFolder ? "text-foreground/70" : "text-muted-foreground")}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm" title={item.name}>
        {item.name}
      </span>

      {/* size bar */}
      <div className="hidden h-2 w-28 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${barPct}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-sm tabular-nums">{formatBytes(item.size)}</span>

      {/* % of parent (browse) or path (analysis) */}
      {pathLabel !== undefined ? (
        <span className="hidden w-40 shrink-0 truncate text-right text-xs text-muted-foreground md:block" title={pathLabel}>
          {pathLabel || "—"}
        </span>
      ) : (
        <span className="hidden w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
          {parentSize && parentSize > 0 ? formatPercent(item.size / parentSize) : ""}
        </span>
      )}

      {/* item count (folders) */}
      <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums lg:block">
        {item.isFolder ? `${item.childCount.toLocaleString()} items` : ""}
      </span>

      {/* modified + staleness */}
      <span
        className="hidden w-24 shrink-0 items-center justify-end gap-1.5 text-right text-xs text-muted-foreground tabular-nums md:flex"
        title={`Modified ${formatAbsoluteDate(item.modified)}`}
      >
        <span className={cn("size-1.5 rounded-full", STALE_DOT[stale])} aria-hidden />
        {formatRelativeDate(item.modified) || "—"}
      </span>

      {item.isFolder ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <span className="w-4 shrink-0" />
      )}
    </>
  );

  const className = "flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50";

  if (item.isFolder) {
    return (
      <Link href={`/account/${accountId}?view=browse&folder=${item.id}`} className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}
