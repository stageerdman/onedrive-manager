"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Cloud, File as FileIcon, Folder } from "lucide-react";
import type { Item } from "@/lib/items";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AccountInfo } from "@/components/transfers/transfers-view";

type Step = "from" | "what" | "to";
const STEPS: { key: Step; label: string }[] = [
  { key: "from", label: "From" },
  { key: "what", label: "What" },
  { key: "to", label: "To" },
];

/** Three-step picker: source account → folder or file → destination → add to the queue. */
export function AddTransferDialog({
  accounts,
  onClose,
  onAdded,
}: {
  accounts: AccountInfo[];
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>("from");
  const [source, setSource] = useState<AccountInfo | null>(null);
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  const folderId = path.at(-1)?.id ?? null;
  useEffect(() => {
    if (step !== "what" || !source) return;
    let alive = true;
    const q = folderId ? `?folder=${encodeURIComponent(folderId)}` : "";
    fetch(`/api/accounts/${source.id}/children${q}`)
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) setLoadError(data.error ?? "Couldn't load this folder.");
        else setItems(data.items);
      })
      .catch(() => alive && setLoadError("Couldn't load this folder."));
    return () => {
      alive = false;
    };
  }, [step, source, folderId]);

  function openFolder(next: { id: string; name: string }[]) {
    setItems(null);
    setLoadError(null);
    setSelected(null);
    setPath(next);
  }

  async function add(target: AccountInfo) {
    if (!source || !selected) return;
    setSending(true);
    setSendError(false);
    const res = await fetch("/api/moves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceAccount: source.id, targetAccount: target.id, itemId: selected.id }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) onAdded(selected.name);
    else setSendError(true);
  }

  const maxSize = items?.reduce((m, it) => Math.max(m, it.size), 0) ?? 0;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Add transfer"
      className="glass-strong m-auto h-[520px] max-h-[90vh] w-[min(92vw,32rem)] rounded-2xl p-0 text-white/90 backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          {step !== "from" && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                if (step === "to") setStep("what");
                else if (path.length > 0) openFolder(path.slice(0, -1));
                else setStep("from");
              }}
              className="-ml-2 flex size-8 items-center justify-center rounded-full hover:bg-white/10"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
          )}
          <h2 className="text-base font-medium">Add transfer</h2>
          <ol className="ml-auto flex gap-3 text-xs">
            {STEPS.map((s, i) => (
              <li key={s.key} className={s.key === step ? "text-white/90" : "text-white/40"}>
                {i + 1} {s.label}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {step === "from" && (
            <div className="flex flex-col gap-2">
              {accounts.map((a) => (
                <AccountChoice
                  key={a.id}
                  account={a}
                  onClick={() => {
                    setSource(a);
                    openFolder([]);
                    setStep("what");
                  }}
                />
              ))}
            </div>
          )}

          {step === "what" && (
            <div className="flex flex-col">
              <p className="truncate px-2 pb-2 text-xs text-white/50">
                {[source?.label, ...path.map((p) => p.name)].join(" / ")}
              </p>
              {loadError ? (
                <p className="px-2 py-8 text-center text-sm text-rose-400">{loadError}</p>
              ) : items === null ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="mx-2 my-2 h-8 animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
                ))
              ) : items.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-white/50">This folder is empty</p>
              ) : (
                <ul role="listbox" aria-label="Pick a folder or file">
                  {items.map((it) => {
                    const Icon = it.isFolder ? Folder : FileIcon;
                    const isSel = selected?.id === it.id;
                    return (
                      <li key={it.id} className="flex items-center">
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          onClick={() => setSelected(it)}
                          onDoubleClick={() => it.isFolder && openFolder([...path, { id: it.id, name: it.name }])}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left",
                            isSel ? "bg-sky-300/15 ring-1 ring-sky-300/50" : "hover:bg-white/[0.06]",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-white/60" aria-hidden />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm">{it.name}</span>
                            <span className="mt-1 h-[3px] overflow-hidden rounded-full">
                              <span
                                className="block h-full rounded-full bg-sky-300/60"
                                style={{ width: `${maxSize > 0 ? (it.size / maxSize) * 100 : 0}%` }}
                              />
                            </span>
                          </span>
                          <span className="shrink-0 text-sm tabular-nums text-white/70">{formatBytes(it.size)}</span>
                        </button>
                        {it.isFolder ? (
                          <button
                            type="button"
                            aria-label={`Open ${it.name}`}
                            onClick={() => openFolder([...path, { id: it.id, name: it.name }])}
                            className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white"
                          >
                            <ChevronRight className="size-4" aria-hidden />
                          </button>
                        ) : (
                          <span className="ml-1 size-8 shrink-0" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {step === "to" && selected && (
            <div className="flex flex-col gap-2">
              <p className="px-2 pb-1 text-xs text-white/50">
                Move <span className="text-white/90">{selected.name}</span> ({formatBytes(selected.size)}) to…
              </p>
              {accounts
                .filter((a) => a.id !== source?.id)
                .map((a) => {
                  const fits = a.free == null || a.free >= selected.size;
                  return (
                    <AccountChoice
                      key={a.id}
                      account={a}
                      disabled={!fits || sending}
                      note={
                        !fits
                          ? `Needs ${formatBytes(selected.size)}, only ${formatBytes(a.free ?? 0)} free`
                          : a.free != null
                            ? `${formatBytes(a.free)} free → ${formatBytes(a.free - selected.size)}`
                            : undefined
                      }
                      warn={!fits}
                      onClick={() => add(a)}
                    />
                  );
                })}
              {sendError && <p className="px-2 text-sm text-rose-400">Couldn&apos;t add it. Try again.</p>}
            </div>
          )}
        </div>

        {step === "what" && (
          <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3">
            <span className="min-w-0 flex-1 truncate text-xs text-white/50">
              {selected ? `Selected: ${selected.name} · ${formatBytes(selected.size)}` : "Select a folder or file"}
            </span>
            <button
              type="button"
              disabled={!selected}
              onClick={() => setStep("to")}
              className="rounded-full bg-sky-300 px-4 py-1.5 text-sm font-medium text-neutral-950 hover:bg-sky-200 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}

function AccountChoice({
  account,
  onClick,
  disabled,
  note,
  warn,
}: {
  account: AccountInfo;
  onClick: () => void;
  disabled?: boolean;
  note?: string;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left hover:bg-white/[0.08] disabled:pointer-events-none disabled:opacity-60"
    >
      <Cloud className="size-5 shrink-0 text-white/60" strokeWidth={1.6} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-base font-medium">{account.label}</span>
      <span className={cn("shrink-0 text-xs tabular-nums", warn ? "text-amber-300" : "text-white/50")}>
        {note ?? (account.free != null ? `${formatBytes(account.free)} free` : "")}
      </span>
    </button>
  );
}
