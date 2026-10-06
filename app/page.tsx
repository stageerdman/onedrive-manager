import { HardDrive } from "lucide-react";
import { AppBar } from "@/components/app-bar";
import { Button } from "@/components/ui/button";

export default function OverviewPage() {
  return (
    <>
      <AppBar />
      <main className="flex flex-1 items-center justify-center p-6">
        {/* Phase 0: no accounts connected yet. Phase 3 replaces this with the
            multi-account overview (free/used/total, copyable username, description). */}
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border bg-muted/40">
            <HardDrive className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight">No drives connected yet</h1>
            <p className="text-sm text-muted-foreground">
              Connect your OneDrive accounts to see, in one glance, where you have free
              space and what&apos;s eating it.
            </p>
          </div>
          <Button disabled>Connect a OneDrive account</Button>
          <p className="text-xs text-muted-foreground">Connecting accounts arrives in the next phase.</p>
        </div>
      </main>
    </>
  );
}
