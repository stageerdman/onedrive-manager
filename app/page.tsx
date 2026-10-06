import { HardDrive } from "lucide-react";
import { AppBar } from "@/components/app-bar";
import { buttonVariants } from "@/components/ui/button";
import { AccountCard } from "@/components/account-card";
import { GhostAddCard } from "@/components/ghost-add-card";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { listAccounts, type Account } from "@/lib/accounts";
import { getDriveQuota, type DriveQuota } from "@/lib/graph/drive";
import { ReconnectNeededError } from "@/lib/graph/client";

export const dynamic = "force-dynamic";

const CONNECT_HREF = "/api/auth/login";
const MAX_SLOTS = 3;

interface AccountView {
  account: Account;
  quota: DriveQuota | null;
  needsReconnect: boolean;
}

async function loadViews(accounts: Account[]): Promise<AccountView[]> {
  return Promise.all(
    accounts.map(async (account) => {
      if (account.status === "reconnect") return { account, quota: null, needsReconnect: true };
      try {
        const quota = await getDriveQuota(account.id);
        return { account, quota, needsReconnect: false };
      } catch (err) {
        return { account, quota: null, needsReconnect: err instanceof ReconnectNeededError };
      }
    }),
  );
}

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const accounts = listAccounts();
  const notice = typeof sp.connect_notice === "string" ? sp.connect_notice : null;
  const error = typeof sp.connect_error === "string" ? sp.connect_error : null;

  const views = await loadViews(accounts);
  const totalFree = views.reduce((sum, v) => sum + (v.quota?.remaining ?? 0), 0);
  const hasQuota = views.some((v) => v.quota);
  const freeSlots = Math.max(MAX_SLOTS - accounts.length, 0);

  return (
    <>
      <AppBar connectHref={CONNECT_HREF} canAdd={accounts.length < MAX_SLOTS} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        {notice && (
          <p className="rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">{notice}</p>
        )}
        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {accounts.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {views.map((v) => (
                <AccountCard
                  key={v.account.id}
                  account={v.account}
                  quota={v.quota}
                  needsReconnect={v.needsReconnect}
                />
              ))}
              {Array.from({ length: freeSlots }).map((_, i) => (
                <GhostAddCard key={`ghost-${i}`} connectHref={CONNECT_HREF} />
              ))}
            </div>
            {hasQuota && (
              <p className="text-center text-sm text-muted-foreground tabular-nums">
                Total free across all drives:{" "}
                <span className="font-semibold text-foreground">{formatBytes(totalFree)}</span>
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border bg-muted/40">
          <HardDrive className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Connect your first OneDrive</h1>
          <p className="text-sm text-muted-foreground">
            See, in one glance, where you have free space and what&apos;s eating it across all
            your OneDrive accounts.
          </p>
        </div>
        <a href={CONNECT_HREF} className={cn(buttonVariants({ size: "lg" }))}>
          Connect OneDrive
        </a>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>You&apos;ll sign in on Microsoft&apos;s own page — up to three accounts.</li>
          <li>It&apos;s your own Azure app, so Microsoft may show an &quot;unverified&quot; notice. That&apos;s expected.</li>
          <li>This app can read your files and, when you ask, move them between your drives.</li>
        </ul>
      </div>
    </div>
  );
}
