import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Account, Accent } from "@/lib/accounts";
import type { DriveQuota } from "@/lib/graph/drive";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { FullnessMeter } from "@/components/fullness-meter";
import { InlineEditText } from "@/components/inline-edit-text";

const ACCENT_DOT: Record<Accent, string> = {
  indigo: "bg-indigo-500",
  teal: "bg-teal-500",
  rose: "bg-rose-500",
};

/**
 * One account on the overview (spec #1 §3). Identity on top (accent dot +
 * editable label, editable description, muted email), the fullness meter as the
 * hero visual, free-GB as the hero number, then used/total, then footer.
 * Reconnect state keeps identity visible and swaps the number for a Reconnect CTA.
 */
export function AccountCard({
  account,
  quota,
  needsReconnect,
}: {
  account: Account;
  quota: DriveQuota | null;
  needsReconnect: boolean;
}) {
  return (
    <Card className={cn("flex flex-col gap-3 p-6", needsReconnect && "opacity-90")}>
      {/* Identity */}
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", ACCENT_DOT[account.accent])} aria-hidden />
        <div className="min-w-0 flex-1">
          <InlineEditText
            accountId={account.id}
            field="label"
            value={account.label}
            placeholder="Name this drive"
            className="text-base font-semibold tracking-tight"
          />
          <InlineEditText
            accountId={account.id}
            field="description"
            value={account.description}
            placeholder="Add a description"
            className="text-sm text-muted-foreground"
          />
          {account.email && (
            <p className="truncate px-1.5 text-xs text-muted-foreground/70">{account.email}</p>
          )}
        </div>
      </div>

      {/* Hero: meter + free number, or reconnect */}
      {needsReconnect || !quota ? (
        <div className="flex flex-col gap-2 py-1">
          <FullnessMeter fraction={0} className="opacity-40" />
          <p className="text-sm text-amber-600 dark:text-amber-500">Access expired — reconnect to refresh.</p>
          <a
            href={`/api/auth/login?reconnect=${account.id}`}
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "self-start")}
          >
            Reconnect
          </a>
        </div>
      ) : (
        <>
          <FullnessMeter fraction={quota.fraction} />
          <div>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatBytes(quota.remaining)} free
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatBytes(quota.used)} of {formatBytes(quota.total)} used
            </p>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="mt-1 flex items-center justify-between border-t pt-3">
        <span className="text-xs text-muted-foreground">
          {needsReconnect ? "Reconnect needed" : "Connected"}
        </span>
        <Link
          href={`/account/${account.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Explore
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}
