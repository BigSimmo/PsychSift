"use client";

import type { WorkAreaId } from "@/lib/work-frame/areas";
import { workHelpTopic, workHelpTopicForArea } from "@/lib/work-help";
import WorkHelpSheet from "@/components/work-help/work-help-sheet";

/**
 * The help sheet for one area, with the topic chosen here so the help words load
 * with the sheet, not with every work page (src/components/work-help/work-help-host.tsx).
 */
export default function WorkHelpAreaSheet({
  area,
  pathname,
  onClose,
}: {
  readonly area: WorkAreaId;
  readonly pathname: string | null;
  readonly onClose: () => void;
}) {
  // Open shifts lives inside Roster's frame and has its own help.
  // Assessments sits inside Teaching's frame but has its own help too.
  const topic = pathname?.startsWith("/open-shifts")
    ? workHelpTopic("open-shifts")
    : pathname?.startsWith("/teaching/assessments")
      ? workHelpTopic("assess")
      : null;
  return <WorkHelpSheet topic={topic ?? workHelpTopicForArea(area)} open onClose={onClose} />;
}
