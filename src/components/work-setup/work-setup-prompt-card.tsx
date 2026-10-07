"use client";

import "@/components/work-setup/work-setup.css";

import { Compass } from "lucide-react";
import { useSyncExternalStore } from "react";

import { WorkButton, WorkCard, WorkIconCircle, useWorkUndoToast } from "@/components/mode-kit/work";
import { useWorkSetupProgress } from "@/components/work-setup/use-work-setup-progress";
import { WORK_SETUP_HREF, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import { useAuthSession } from "@/lib/supabase/client";
import {
  countedWorkSetupSteps,
  dismissWorkSetup,
  workSetupCount,
  workSetupPromptVisible,
  type WorkSetupProgress,
} from "@/lib/work-setup/progress";

const subscribeNothing = () => () => undefined;

/**
 * "Set up Work" on My Day's Today: an offer, never a gate. It shows for a
 * signed-in doctor who has not finished or put away setup, resumes where they
 * left off, and "Not now" puts it away (with Undo). Setup stays one tap away in
 * My Day's More and in Help either way. Drawn only after the stored progress is
 * read, so it never appears and then vanishes.
 */
export function WorkSetupPromptCard() {
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const { status } = useAuthSession();
  const { progress, update } = useWorkSetupProgress();
  const undoToast = useWorkUndoToast();
  if (!hydrated || status !== "authenticated" || !workSetupPromptVisible(progress)) return null;

  const { done, total } = workSetupCount(progress);
  const started = progress.status === "in-progress";
  const putAway = () => {
    const before: WorkSetupProgress = progress;
    update(dismissWorkSetup);
    undoToast?.("Setup put away. Find it in More.", () => update(() => before));
  };

  return (
    <WorkCard padded testId="work-setup-prompt" aria-label="Set up Work">
      <div className="work-setup-prompt">
        <WorkIconCircle icon={Compass} />
        <div className="work-setup-prompt__text">
          <p className="work-setup-prompt__title">Set up Work</p>
          <p className="work-setup-prompt__sub">
            {started ? `${done} of ${total} done` : "Stage, areas, time zone, roster and alerts"}
          </p>
        </div>
      </div>
      <ol className="work-setup__progress work-setup-prompt__bar" aria-hidden="true">
        {countedWorkSetupSteps(progress.areas).map((step) => (
          <li
            key={step}
            className="work-setup__segment"
            data-state={
              progress.completed.includes(step) ? "done" : progress.skipped.includes(step) ? "skipped" : "todo"
            }
          />
        ))}
      </ol>
      <div className="work-setup-prompt__actions">
        <WorkButton
          href={started ? workSetupStepHref(progress.step) : WORK_SETUP_HREF}
          testId="work-setup-prompt-start"
        >
          {started ? "Resume" : "Start"}
        </WorkButton>
        <WorkButton variant="quiet" onClick={putAway} testId="work-setup-prompt-dismiss">
          Not now
        </WorkButton>
      </div>
    </WorkCard>
  );
}
