import type { ComponentProps } from "react";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import Link from "next/link";
import { Wallet } from "lucide-react";

import { JuniorEntryRowBody, juniorEntryRowClass, juniorQuietLinkClass } from "@/components/admin/junior/junior-shared";

/**
 * Entry to the Leave wallet. For the main build to mount: Roster's leave
 * page ("Every leave type"), Work profile and Admin More. Already mounted
 * (compact) on the contract end tracker's "Leave before the end".
 */
function LeaveWalletEntryLinkShown({ compact = false }: { compact?: boolean }) {
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

/** Leads to a new work mode screen, so it shows only to readers the launch switch has let in. */
export function LeaveWalletEntryLink(props: ComponentProps<typeof LeaveWalletEntryLinkShown>) {
  return (
    <NewWorkModeOnly>
      <LeaveWalletEntryLinkShown {...props} />
    </NewWorkModeOnly>
  );
}
