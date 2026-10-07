import Link from "next/link";
import { FileClock } from "lucide-react";

import { JuniorEntryRowBody, juniorEntryRowClass } from "@/components/admin/junior/junior-shared";

/**
 * Entry to the contract end tracker. For the main build to mount: Work
 * profile (a "Contract and leave" group), Admin More ("Work and leave") and
 * New job. Already mounted on the Leave wallet and on Ready for day one.
 */
export function ContractEndEntryLink({ line = "End date, reminders and what to ask" }: { line?: string }) {
  return (
    <Link href="/admin/contract" className={juniorEntryRowClass} data-testid="admin-contract-entry">
      <JuniorEntryRowBody icon={FileClock} title="Contract end" line={line} />
    </Link>
  );
}
