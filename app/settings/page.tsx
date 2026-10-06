import { join } from "node:path";
import Link from "next/link";
import { AppBar } from "@/components/app-bar";
import { AccountSettingsRow } from "@/components/settings/account-settings-row";
import { listAccounts } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const accounts = listAccounts();
  const dbPath = join(process.cwd(), "data", "onedrive-manager.db");

  return (
    <>
      <AppBar connectHref="/api/auth/login" canAdd={accounts.length < 3} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to overview</Link>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Accounts</h2>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts connected.</p>
          ) : (
            accounts.map((a) => (
              <AccountSettingsRow
                key={a.id}
                accountId={a.id}
                accent={a.accent}
                email={a.email}
                label={a.label}
                description={a.description}
              />
            ))
          )}
          <p className="text-xs text-muted-foreground">
            Disconnecting removes the account locally. To also revoke this app&apos;s access, visit{" "}
            <a
              href="https://account.microsoft.com/privacy/app-access"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              your Microsoft account permissions
            </a>
            .
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Data &amp; storage</h2>
          <p className="text-sm text-muted-foreground">
            Everything is stored locally in one SQLite file. Refresh tokens are encrypted at rest;
            the app binds to 127.0.0.1 only and has no login of its own — security comes from your
            machine (keep disk encryption on).
          </p>
          <code className="w-fit max-w-full overflow-x-auto rounded-md border bg-muted/40 px-2 py-1 text-xs">
            {dbPath}
          </code>
          <p className="text-xs text-muted-foreground">
            Cached scans are just a cache — clearing one (per account above) loses nothing but the
            snapshot; re-scan to rebuild it.
          </p>
        </section>
      </main>
    </>
  );
}
