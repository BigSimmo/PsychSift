import Link from "next/link";
import { Wallet } from "lucide-react";

import { JuniorEntryRowBody, juniorEntryRowClass, juniorQuietLinkClass } from "@/components/admin/junior/junior-shared";

/**
 * Entry to the Leave wallet. For the main build to mount: Roster's leave
 * page ("Every leave type"), Work profile and Admin More. Already mounted
 * (compact) on the contract end tracker's "Leave before the end".
 */
export function LeaveWalletEntryLink({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link href="/admin/leave" className={juniorQuietLinkClass} data-testid="admin-leave-entry-compact">
        Leave wallet
      </Link>
    );
  }
  return (
    <Link href="/admin/leave" className={juniorEntryRowClass} data-testid="admin-leave-entry">
      <JuniorEntryRowBody icon={Wallet} title="Every leave type" line="Leave wallet: how to apply, ready messages" />
    </Link>
  );
}
