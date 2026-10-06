"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { saveAccountField } from "@/app/actions";

/**
 * Click-to-edit text (spec #1 §5 / spec #3 §3): no modal, no layout shift.
 * Enter/blur saves (optimistic), Esc cancels. Used for an account's label
 * (required) and description (optional, with a placeholder affordance).
 *
 * Display value is derived: an optimistic override while saving, otherwise the
 * server-provided `value` prop (refreshed after each save) — no prop→state sync.
 */
export function InlineEditText({
  accountId,
  field,
  value,
  placeholder,
  className,
  editClassName,
}: {
  accountId: string;
  field: "label" | "description";
  value: string | null;
  placeholder: string;
  className?: string;
  editClassName?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = optimistic ?? value ?? "";

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function begin() {
    setDraft(current);
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next === current) return;
    if (field === "label" && !next) return; // required — ignore empty
    setOptimistic(next);
    const res = await saveAccountField(accountId, field, next);
    if (!res.ok) {
      setOptimistic(null); // revert to server value
    } else {
      setOptimistic(res.value ?? "");
      router.refresh();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-md border bg-background px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          editClassName ?? className,
        )}
      />
    );
  }

  const isEmpty = !current;
  return (
    <button
      type="button"
      onClick={begin}
      className={cn(
        "group/inline inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left hover:bg-muted/60",
        isEmpty && "text-muted-foreground italic",
        className,
      )}
      title="Click to edit"
    >
      <span className="truncate">{isEmpty ? placeholder : current}</span>
      <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/inline:opacity-60" aria-hidden />
    </button>
  );
}
