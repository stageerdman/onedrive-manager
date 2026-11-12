import Link from "next/link";
import { File as FileIcon, Folder } from "lucide-react";
import type { Item } from "@/lib/items";
import { formatBytes } from "@/lib/format";
import { MoveMenu, type MoveTarget } from "@/components/explorer/move-menu";

/**
 * One folder/file at the current level: icon, name with a size bar (relative to the
 * biggest sibling), size, modified month, and a hover-revealed "move" action.
 */
export function ItemRow({
  accountId,
  item,
  maxSize,
  targets,
}: {
  accountId: string;
  item: Item;
  maxSize: number;
  targets: MoveTarget[];
}) {
  const pct = maxSize > 0 ? Math.max((item.size / maxSize) * 100, item.size > 0 ? 1 : 0) : 0;
  const Icon = item.isFolder ? Folder : FileIcon;
  const modified = item.modified
    ? new Date(item.modified).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "";

  const name = (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[15px]" title={item.name}>
        {item.name}
      </span>
      <span className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full">
        <span className="block h-full rounded-full bg-sky-300/70" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );

  return (
    <li className="group relative grid h-14 first:rounded-t-2xl last:rounded-b-2xl grid-cols-[20px_1fr_auto_auto_36px] items-center gap-4 px-4 transition-colors duration-150 hover:bg-white/[0.04]">
      <Icon className="size-[18px] text-white/60" aria-hidden />
      {item.isFolder ? (
        <Link
          href={`/account/${accountId}?folder=${item.id}`}
          className="min-w-0 focus-visible:outline-none after:absolute after:inset-0 focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-sky-300/80"
        >
          {name}
        </Link>
      ) : (
        name
      )}
      <span className="text-right text-[15px] tabular-nums">{formatBytes(item.size)}</span>
      <span className="hidden w-20 text-right text-[13px] text-white/50 sm:block">{modified}</span>
      <div className="relative z-10">
        <MoveMenu sourceAccountId={accountId} itemId={item.id} itemName={item.name} itemSize={item.size} targets={targets} />
      </div>
    </li>
  );
}
