import Link from "next/link";
import { HardDrive, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Global top bar (UX spec: ~56px, wordmark left → home, primary "Add drive"
 * action right). The add action is a full navigation to the Microsoft consent
 * flow, so it's a plain link. Disabled once all three slots are filled.
 */
export function AppBar({
  connectHref,
  canAdd = true,
}: {
  connectHref: string;
  canAdd?: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2">
        <HardDrive className="size-5 text-muted-foreground" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">OneDrive Manager</span>
      </Link>
      {canAdd ? (
        <a href={connectHref} className={cn(buttonVariants({ size: "sm" }))}>
          <Plus className="size-4" aria-hidden />
          Add drive
        </a>
      ) : (
        <span className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "pointer-events-none opacity-50")}>
          <Plus className="size-4" aria-hidden />
          All slots full
        </span>
      )}
    </header>
  );
}
