import Link from "next/link";
import { cn } from "@/lib/utils";

export type ExplorerView = "browse" | "files" | "folders" | "stale";

const TABS: { key: ExplorerView; label: string }[] = [
  { key: "browse", label: "Browse" },
  { key: "files", label: "Biggest files" },
  { key: "folders", label: "Biggest folders" },
  { key: "stale", label: "Stale" },
];

/**
 * Segmented control (spec #2 §5) that reframes the same row list via a different
 * query. Links, not state, so each view is deep-linkable and survives refresh.
 */
export function AnalysisNav({ accountId, active }: { accountId: string; active: ExplorerView }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/account/${accountId}?view=${t.key}`}
          className={cn(
            "rounded-md px-3 py-1 font-medium transition-colors",
            active === t.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
