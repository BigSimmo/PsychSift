import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import Link from "next/link";
import { BookOpen } from "lucide-react";

import { JuniorEntryRowBody, juniorEntryRowClass } from "@/components/admin/junior/junior-shared";

/**
 * Entry to the starter pack. For the main build to mount: New job (above
 * "Contacts for this job") and Admin More ("Work and leave"). Already
 * mounted on Ready for day one.
 */
function StarterPackEntryLinkShown() {
  return (
    <Link href="/admin/new-job/starter" className={juniorEntryRowClass} data-testid="admin-starter-entry">
      <JuniorEntryRowBody
        icon={BookOpen}
        title="New to WA hospitals?"
        line="Starter pack: local words, your dates, who to ask"
      />
    </Link>
  );
}

/** Leads to a new work mode screen, so it shows only to readers the launch switch has let in. */
export function StarterPackEntryLink() {
  return (
    <NewWorkModeOnly>
      <StarterPackEntryLinkShown />
    </NewWorkModeOnly>
  );
}
