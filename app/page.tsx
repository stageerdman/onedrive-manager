import { HardDrive } from "lucide-react";
import { AppBar } from "@/components/app-bar";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { listAccounts } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const accounts = listAccounts();

  const notice = typeof sp.connect_notice === "string" ? sp.connect_notice : null;
  const error = typeof sp.connect_error === "string" ? sp.connect_error : null;

  return (
    <>
      <AppBar connectHref="/api/auth/login" canAdd={accounts.length < 3} />
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
          /* Temporary list — the Phase 3 dashboard replaces this with account cards. */
          <ul className="flex flex-col gap-2">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-xl border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{a.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                </div>
                <Badge variant={a.status === "connected" ? "secondary" : "destructive"}>
                  {a.status === "connected" ? "Connected" : "Reconnect needed"}
                </Badge>
              </li>
            ))}
          </ul>
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
        <a href="/api/auth/login" className={cn(buttonVariants({ size: "lg" }))}>
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
