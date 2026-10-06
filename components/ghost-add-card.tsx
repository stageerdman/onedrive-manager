import { Plus } from "lucide-react";

/**
 * Dashed placeholder for a free slot (spec #1 §7): same dimensions as a real
 * card, invites connecting another drive. It's a full navigation to the consent
 * flow, hence a plain anchor.
 */
export function GhostAddCard({ connectHref }: { connectHref: string }) {
  return (
    <a
      href={connectHref}
      className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-dashed">
        <Plus className="size-5" aria-hidden />
      </div>
      <span className="text-sm font-medium">Add another drive</span>
    </a>
  );
}
