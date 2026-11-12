import { AccountCard } from "@/components/account-card";
import { ConnectSlot } from "@/components/connect-slot";
import { listAccounts, type Account } from "@/lib/accounts";
import { getDriveQuota, type DriveQuota } from "@/lib/graph/drive";
import { ReconnectNeededError } from "@/lib/graph/client";

export const dynamic = "force-dynamic";

const MAX_ACCOUNTS = 3;

async function load(account: Account): Promise<{ account: Account; quota: DriveQuota | null; expired: boolean }> {
  if (account.status === "reconnect") return { account, quota: null, expired: true };
  try {
    return { account, quota: await getDriveQuota(account.id), expired: false };
  } catch (err) {
    return { account, quota: null, expired: err instanceof ReconnectNeededError };
  }
}

export default async function AccountsPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const error = typeof sp.connect_error === "string" ? sp.connect_error : null;
  const accounts = listAccounts();
  const views = await Promise.all(accounts.map(load));

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="glass rounded-xl px-4 py-3 text-[13px] text-rose-400">
          {error}
        </p>
      )}
      {accounts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center pt-10">
          <ConnectSlot prominent />
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {views.map((v) => (
            <AccountCard key={v.account.id} {...v} />
          ))}
          {accounts.length < MAX_ACCOUNTS && <ConnectSlot />}
        </div>
      )}
    </div>
  );
}
