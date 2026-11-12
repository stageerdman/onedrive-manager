import Link from "next/link";
import type { Account } from "@/lib/accounts";
import type { DriveQuota } from "@/lib/graph/drive";
import { daysUntil, formatBytes, formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SpaceMeter } from "@/components/space-meter";

const NEARLY_FULL = 0.9;
const ENDING_SOON_DAYS = 14;

/**
 * One account on the home screen: name, free space (the hero), meter, usage, and when
 * access lapses. The whole card opens the account — except when access has expired,
 * where Reconnect is its only action.
 */
export function AccountCard({
  account,
  quota,
  expired,
}: {
  account: Account;
  quota: DriveQuota | null;
  expired: boolean;
}) {
  const full = !!quota && quota.fraction > NEARLY_FULL;
  const daysLeft = daysUntil(account.accessExpiresAt);

  return (
    <div
      className={cn(
        "glass relative flex min-h-[220px] flex-col rounded-2xl p-6 transition duration-150 ease-out",
        !expired && "hover:-translate-y-px hover:border-white/15 hover:bg-white/[0.09]",
      )}
    >
      <div className={cn("flex flex-col", expired && "opacity-50")}>
        {expired ? (
          <h2 className="truncate text-xl font-semibold">{account.label}</h2>
        ) : (
          <Link
            href={`/account/${account.id}`}
            className="truncate rounded-md text-xl font-semibold after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
          >
            {account.label}
          </Link>
        )}

        {quota ? (
          <>
            <p className="mt-3 flex items-baseline gap-2">
              <span
                className={cn("text-[32px] font-semibold leading-none tracking-tight tabular-nums", full && "text-amber-300")}
              >
                {formatBytes(quota.remaining)}
              </span>
              <span className="text-[15px] text-white/60">free</span>
            </p>
            <div className="mt-4">
              <SpaceMeter used={quota.used} total={quota.total} warn={full} />
            </div>
            <p className="mt-2 text-[13px] text-white/60 tabular-nums">
              {formatBytes(quota.used)} of {formatBytes(quota.total)} used
            </p>
          </>
        ) : (
          !expired && <p className="mt-3 text-[15px] text-white/60">Couldn&apos;t load space right now.</p>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-6 text-[13px]">
        {expired ? (
          <>
            <span className="text-rose-400">Access expired</span>
            <a
              href={`/api/auth/login?reconnect=${account.id}`}
              className="relative z-10 rounded-full bg-sky-300 px-4 py-1.5 font-medium text-neutral-950 transition-colors hover:bg-sky-200"
            >
              Reconnect
            </a>
          </>
        ) : daysLeft < ENDING_SOON_DAYS ? (
          <span className="text-amber-300">
            Access ends in {daysLeft} {daysLeft === 1 ? "day" : "days"} · open to renew
          </span>
        ) : (
          <span className="text-white/50">Access until {formatDayMonth(account.accessExpiresAt)}</span>
        )}
      </div>
    </div>
  );
}
