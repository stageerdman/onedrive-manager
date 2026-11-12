import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** "Connect account" tile — shown in the next free slot (max 3 accounts). */
export function ConnectSlot({ prominent = false }: { prominent?: boolean }) {
  return (
    <a
      href="/api/auth/login"
      className={cn(
        "flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15",
        "text-[15px] text-white/60 transition-colors duration-150 hover:border-white/30 hover:text-white/90",
        prominent && "mx-auto w-full max-w-sm",
      )}
    >
      <Plus className="size-6" aria-hidden />
      Connect account
    </a>
  );
}
