import { HardDrive, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Global top bar (UX spec: ~56px, title left, primary "Add drive" action right).
 * Isolated and reusable across the overview and account pages.
 */
export function AppBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <HardDrive className="size-5 text-muted-foreground" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">OneDrive Manager</span>
      </div>
      {/* Wired up in Phase 1 (connect a OneDrive account). */}
      <Button size="sm" disabled>
        <Plus className="size-4" aria-hidden />
        Add drive
      </Button>
    </header>
  );
}
