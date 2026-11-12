import { ArrowDown, ArrowUp, Cloud, File as FileIcon, Folder, Laptop, RotateCw } from "lucide-react";
import type { MoveState } from "@/lib/graph/move";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Now transferring": Source → This Mac → Destination, with what each holds right now,
 * the file streaming through (download vs upload of the same bytes), and overall progress.
 */
export function TransferHero({
  move,
  label,
  queuePaused,
  actions,
}: {
  move: MoveState;
  label: (accountId: string) => string;
  queuePaused: boolean;
  actions?: React.ReactNode;
}) {
  const flowing = move.isRunning && !queuePaused;
  const pct = move.bytesTotal > 0 ? Math.min(100, (move.bytesDone / move.bytesTotal) * 100) : 0;
  const cur = move.current;
  const buffer = cur && !cur.serverSide ? Math.max(0, cur.downloaded - cur.uploaded) : 0;
  const retrying = move.isRunning && !!move.error;
  const Icon = move.isFolder ? Folder : FileIcon;

  const chip = queuePaused
    ? { text: "Paused", tone: "amber" }
    : retrying
      ? { text: "Retrying", tone: "amber" }
      : move.status === "deleting"
        ? { text: "Deleting source", tone: "plain" }
        : move.isRunning
          ? { text: "Copying", tone: "plain" }
          : { text: "Starting…", tone: "plain" };

  return (
    <section aria-label="Now transferring" className="glass relative flex flex-col gap-5 rounded-2xl p-6">
      <div className="flex items-center gap-3">
        <Icon className="size-5 shrink-0 text-white/60" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-base font-medium">{move.itemName ?? "Preparing…"}</h2>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs",
            chip.tone === "amber" ? "bg-amber-300/15 text-amber-300" : "bg-white/10 text-white/80",
          )}
        >
          {chip.text}
        </span>
        {actions}
      </div>

      {/* Flow strip */}
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Node
          icon={Cloud}
          title={label(move.sourceAccount)}
          figure={formatBytes(move.status === "complete" ? 0 : move.bytesTotal)}
          caption={move.status === "deleting" ? "being removed" : "still on source"}
        />
        <Connector flowing={flowing} />
        <Node
          icon={Laptop}
          title="This Mac"
          figure={cur?.serverSide ? "0 B" : formatBytes(buffer)}
          caption={cur?.serverSide ? "cloud to cloud · not via this Mac" : "in memory · nothing saved to disk"}
        />
        <Connector flowing={flowing} />
        <Node icon={Cloud} title={label(move.targetAccount)} figure={formatBytes(move.bytesDone)} caption="copied so far" />
      </div>

      {cur && move.isRunning && <CurrentFile file={cur} source={label(move.sourceAccount)} target={label(move.targetAccount)} />}

      {retrying && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-300/10 px-3 py-2 text-xs text-amber-300">
          <RotateCw className="mt-0.5 size-3 shrink-0 motion-safe:animate-spin [animation-duration:3s]" aria-hidden />
          <span className="min-w-0 break-words">{move.error}</span>
        </p>
      )}

      {/* Overall */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xl font-semibold tabular-nums">{Math.floor(pct)}%</span>
          <span className="text-xs text-white/50 tabular-nums">
            {formatBytes(move.bytesDone)} of {formatBytes(move.bytesTotal)}
            {move.filesDone > 0 && ` · ${move.filesDone.toLocaleString()} files copied`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Overall progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(pct)}
          aria-valuetext={`${formatBytes(move.bytesDone)} of ${formatBytes(move.bytesTotal)}`}
          className="h-2 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full rounded-full bg-sky-300 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-white/50">The source is deleted only after every file is copied and verified.</p>
      </div>
    </section>
  );
}

function Node({
  icon: Icon,
  title,
  figure,
  caption,
}: {
  icon: typeof Cloud;
  title: string;
  figure: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
      <Icon className="size-5 text-white/60" strokeWidth={1.6} aria-hidden />
      <p className="max-w-full truncate text-base font-medium">{title}</p>
      <p className="text-sm tabular-nums">{figure}</p>
      <p className="text-xs text-white/50">{caption}</p>
    </div>
  );
}

function Connector({ flowing }: { flowing: boolean }) {
  return (
    <div aria-hidden className="relative mx-auto h-6 w-px overflow-hidden bg-white/15 md:h-px md:w-16">
      {flowing && (
        <span className="absolute inset-y-0 left-0 hidden w-1/4 bg-sky-300 [animation:flow_1.6s_linear_infinite] md:motion-safe:block" />
      )}
    </div>
  );
}

function CurrentFile({
  file,
  source,
  target,
}: {
  file: NonNullable<MoveState["current"]>;
  source: string;
  target: string;
}) {
  const down = file.size > 0 ? Math.min(100, (file.downloaded / file.size) * 100) : 0;
  const up = file.size > 0 ? Math.min(100, (file.uploaded / file.size) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline gap-2 text-sm">
        <span className="min-w-0 truncate">{file.name}</span>
        <span className="shrink-0 text-white/50 tabular-nums">{formatBytes(file.size)}</span>
      </p>
      <div
        role="progressbar"
        aria-label="Current file uploaded"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(up)}
        className="relative h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-sky-300/35 transition-[width] duration-700 ease-out" style={{ width: `${down}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-sky-300 transition-[width] duration-700 ease-out" style={{ width: `${up}%` }} />
      </div>
      <div className="flex justify-between gap-3 text-xs text-white/50 tabular-nums">
        <span className="flex items-center gap-1">
          <ArrowDown className="size-3" aria-hidden /> from {source} {formatBytes(file.downloaded)}
        </span>
        <span className="flex items-center gap-1">
          <ArrowUp className="size-3" aria-hidden /> to {target} {formatBytes(file.uploaded)}
        </span>
      </div>
    </div>
  );
}
