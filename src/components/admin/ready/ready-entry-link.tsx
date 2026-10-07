import type { ComponentProps } from "react";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";

import { JuniorEntryRowBody, juniorEntryRowClass } from "@/components/admin/junior/junior-shared";

/**
 * Entry to Ready for day one. For the main build to mount: New job, above
 * "Before". Already mounted on the starter pack.
 */
function ReadyForDayOneEntryLinkShown({ line = "What is recorded, and what is still to do" }: { line?: string }) {
  return (
    <Link href="/admin/new-job/ready" className={juniorEntryRowClass} data-testid="admin-ready-entry">
      <JuniorEntryRowBody icon={BriefcaseBusiness} title="Ready for day one" line={line} />
    </Link>
  );
}

/** Leads to a new work mode screen, so it shows only to readers the launch switch has let in. */
export function ReadyForDayOneEntryLink(props: ComponentProps<typeof ReadyForDayOneEntryLinkShown>) {
  return (
    <NewWorkModeOnly>
      <ReadyForDayOneEntryLinkShown {...props} />
    </NewWorkModeOnly>
  );
}
