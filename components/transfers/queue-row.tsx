"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, File as FileIcon, Folder, GripVertical, X } from "lucide-react";
import type { MoveState } from "@/lib/graph/move";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One waiting transfer: drag handle, position, name, route, size, and up/down/remove. */
export function QueueRow({
  move,
  position,
  label,
  canUp,
  canDown,
  onUp,
  onDown,
  onRemove,
  onRetry,
  dragProps,
  dragging,
}: {
  move: MoveState;
  position: number;
  label: (id: string) => string;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onRetry: () => void;
  dragProps: React.HTMLAttributes<HTMLLIElement> & { draggable: boolean };
  dragging: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const Icon = move.isFolder ? Folder : FileIcon;
  const name = move.itemName ?? "Waiting…";
  const stalled = move.status === "stalled";
  const partial = move.bytesDone > 0;
  const pct = move.bytesTotal > 0 ? Math.floor((move.bytesDone / move.bytesTotal) * 100) : 0;

  if (confirming) {
    return (
      <li className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <span className="min-w-0 flex-1 text-white/70">
          Remove <span className="text-white/90">{name}</span>?{" "}
          {partial
            ? `${formatBytes(move.bytesDone)} already copied to ${label(move.targetAccount)} will be deleted.`
            : ""}{" "}
          Source untouched.
        </span>
        <button
          type="button"
          autoFocus
          onClick={onRemove}
          className="rounded-full px-3 py-1 text-rose-400 hover:bg-rose-400/10"
        >
          Remove
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-full px-3 py-1 text-white/60 hover:bg-white/10"
        >
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li
      {...dragProps}
      onKeyDown={(e) => {
        if (!e.altKey) return;
        if (e.key === "ArrowUp" && canUp) {
          e.preventDefault();
          onUp();
        } else if (e.key === "ArrowDown" && canDown) {
          e.preventDefault();
          onDown();
        }
      }}
      className={cn(
        "group flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 transition-colors duration-150 md:flex-nowrap",
        dragging && "bg-white/[0.10] opacity-70",
      )}
    >
      <GripVertical className="size-4 shrink-0 cursor-grab text-white/30" aria-hidden />
      <span className="w-4 shrink-0 text-xs text-white/40 tabular-nums">{position}</span>
      <Icon className="size-4 shrink-0 text-white/60" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-base font-medium">{name}</span>
      <span className="order-last flex w-full items-center gap-1 pl-14 text-xs text-white/60 md:order-none md:w-auto md:pl-0">
        {label(move.sourceAccount)} <ArrowRight className="size-3" aria-hidden /> {label(move.targetAccount)}
      </span>
      {stalled ? (
        <span className="text-xs text-rose-400" title={move.error ?? ""}>
          Stopped after errors
        </span>
      ) : (
        partial && <span className="text-xs text-amber-300 tabular-nums">Paused at {pct}%</span>
      )}
      <span className="w-20 shrink-0 text-right text-sm tabular-nums">
        {move.bytesTotal > 0 ? formatBytes(move.bytesTotal) : ""}
      </span>
      <div className="flex shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        {stalled && (
          <button
            type="button"
            onClick={onRetry}
            className="mr-1 rounded-full bg-sky-300 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-sky-200"
          >
            Retry
          </button>
        )}
        <IconButton label={`Move ${name} up`} onClick={onUp} disabled={!canUp}>
          <ChevronUp className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={`Move ${name} down`} onClick={onDown} disabled={!canDown}>
          <ChevronDown className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={`Remove ${name}`} onClick={() => setConfirming(true)}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
    </li>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  );
}
