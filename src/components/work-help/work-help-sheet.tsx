"use client";

import "@/components/work-help/work-help.css";

import { BookOpen } from "lucide-react";

import { WorkButton } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { WorkHelpTopicBrief } from "@/components/work-help/work-help-topic";
import { WORK_HELP_HREF, type WorkHelpTopic } from "@/lib/work-help";

/**
 * Help for the area you are in, over the page you are on: what the tabs are
 * for and the first questions, with the whole help centre one tap away. It
 * wears the More sheet's glass, because it opens from More.
 */
export default function WorkHelpSheet({
  topic,
  open,
  onClose,
}: {
  readonly topic: WorkHelpTopic;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${topic.title} help`}
      description="How this area works"
      testId="work-help-sheet"
      contentClassName="work-more-sheet"
      headerClassName="work-more-sheet__header"
      titleClassName="work-more-sheet__title"
      closeButtonClassName="work-more-sheet__close"
      bodyClassName="work-more-sheet__body"
    >
      <div className="grid gap-4 pb-2">
        <WorkHelpTopicBrief topic={topic} onNavigate={onClose} />
        <div>
          <WorkButton variant="secondary" icon={BookOpen} href={WORK_HELP_HREF} testId="work-help-sheet-all">
            All help
          </WorkButton>
        </div>
      </div>
    </Sheet>
  );
}
