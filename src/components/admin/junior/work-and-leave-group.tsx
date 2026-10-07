import { ContractEndEntryLink } from "@/components/admin/contract/contract-entry-link";
import { JuniorSectionLabel } from "@/components/admin/junior/junior-shared";
import { LeaveWalletEntryLink } from "@/components/admin/leave/leave-wallet-entry-link";
import { StarterPackEntryLink } from "@/components/admin/starter/starter-pack-entry-link";

/**
 * "Work and leave" on Admin Today: the way into Contract end, the Leave wallet and the starter pack, until
 * the main build adds the same group to Admin More. Each row is its own literal link.
 */
export function AdminWorkAndLeaveGroup() {
  return (
    <section aria-labelledby="admin-work-and-leave-heading" className="grid gap-2" data-testid="admin-work-and-leave">
      <JuniorSectionLabel id="admin-work-and-leave-heading">Work and leave</JuniorSectionLabel>
      <div className="grid gap-2">
        <ContractEndEntryLink />
        <LeaveWalletEntryLink />
        <StarterPackEntryLink />
      </div>
    </section>
  );
}
