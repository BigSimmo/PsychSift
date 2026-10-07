import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";

import { JuniorEntryRowBody, juniorEntryRowClass } from "@/components/admin/junior/junior-shared";

/**
 * Entry to Ready for day one. For the main build to mount: New job, above
 * "Before". Already mounted on the starter pack.
 */
export function ReadyForDayOneEntryLink({ line = "What is recorded, and what is still to do" }: { line?: string }) {
  return (
    <Link href="/admin/new-job/ready" className={juniorEntryRowClass} data-testid="admin-ready-entry">
      <JuniorEntryRowBody icon={BriefcaseBusiness} title="Ready for day one" line={line} />
    </Link>
  );
}
