import { AccountSettingsRow } from "@/components/settings/account-settings-row";
import { listAccounts } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const accounts = listAccounts();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="px-1 text-[13px] text-white/50">Accounts</h1>
        {accounts.length === 0 ? (
          <p className="glass rounded-2xl px-5 py-4 text-[15px] text-white/60">No accounts connected.</p>
        ) : (
          <ul className="glass divide-y divide-white/[0.06] rounded-2xl">
            {accounts.map((a) => (
              <AccountSettingsRow
                key={a.id}
                accountId={a.id}
                email={a.email}
                label={a.label}
                needsReconnect={a.status === "reconnect"}
              />
            ))}
          </ul>
        )}
        <p className="px-1 text-[13px] text-white/50">
          Disconnecting removes an account from this app only. To revoke access too, visit{" "}
          <a
            href="https://account.microsoft.com/privacy/app-access"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-white/80"
          >
            Microsoft app permissions
          </a>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[13px] text-white/50">Privacy</h2>
        <p className="glass rounded-2xl px-5 py-4 text-[15px] leading-relaxed text-white/70">
          Everything stays on this Mac in one local database. Sign-in tokens are encrypted, and the app is only
          reachable from this computer.
        </p>
      </section>
    </div>
  );
}
