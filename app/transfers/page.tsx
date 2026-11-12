import { listAccounts } from "@/lib/accounts";
import { getDriveQuota } from "@/lib/graph/drive";
import { TransfersView, type AccountInfo } from "@/components/transfers/transfers-view";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const accounts: AccountInfo[] = await Promise.all(
    listAccounts().map(async (a) => ({
      id: a.id,
      label: a.label,
      connected: a.status === "connected",
      free: a.status === "connected" ? await getDriveQuota(a.id).then((q) => q.remaining, () => null) : null,
    })),
  );
  return <TransfersView accounts={accounts} />;
}
