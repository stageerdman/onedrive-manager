"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, Cloud, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: "/", label: "Accounts", icon: Cloud, match: (p) => p === "/" || p.startsWith("/account") },
  { href: "/transfers", label: "Transfers", icon: ArrowLeftRight, match: (p) => p.startsWith("/transfers") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
];

/** The app's only navigation: three big icon tabs. Transfers shows a dot while one runs. */
export function NavTabs() {
  const pathname = usePathname();
  const transferring = useTransferring();

  return (
    <nav aria-label="Main" className="flex justify-center gap-8 pb-10 pt-8">
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        const showDot = href === "/transfers" && transferring;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex flex-col items-center gap-2 rounded-2xl text-[13px] transition-colors duration-150",
              active ? "text-white" : "text-white/60 hover:text-white/90",
            )}
          >
            <span
              className={cn(
                "relative flex size-14 items-center justify-center rounded-2xl transition-colors duration-150 sm:size-16",
                active ? "glass" : "group-hover:bg-white/[0.04]",
              )}
            >
              <Icon className="size-[26px]" strokeWidth={1.6} aria-hidden />
              {showDot && (
                <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-sky-300 motion-safe:animate-pulse" />
              )}
            </span>
            {label}
            {showDot && <span className="sr-only">, transfer in progress</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Light poll of the queue so the Transfers tab can show activity from any screen. */
function useTransferring(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch("/api/moves", { cache: "no-store" });
        const data: { moves?: { isRunning: boolean }[] } = await res.json();
        if (alive) setOn(!!data.moves?.some((m) => m.isRunning));
      } catch {
        /* ignore */
      }
    }
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return on;
}
