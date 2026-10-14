"use client";

import "@/components/work-setup/work-setup.css";

import { CircleCheck, Compass } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { WorkButton, WorkCard, WorkIconCircle, WorkTag, useWorkUndoToast } from "@/components/mode-kit/work";
import { useWorkSetupProgress } from "@/components/work-setup/use-work-setup-progress";
import { WORK_SETUP_HREF, WORK_SETUP_STEP_COPY, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import { useAuthSession } from "@/lib/supabase/client";
import {
  countedWorkSetupSteps,
  dismissWorkSetup,
  workSetupCount,
  workSetupCountLabel,
  workSetupPromptVisible,
} from "@/lib/work-setup/progress";

const subscribeNothing = () => () => undefined;

/**
 * "Get set up" on My Day's Today: the one setup prompt in Work (design audit
 * 13 Oct 2026, D11, owner decision 4 — the per-area "Finish setting up" rows
 * were removed so the prompt is not repeated on every area's first page). An
 * offer, never a gate. It lists each setup step with a tick when done and a
 * link straight to that step, shows for a signed-in doctor who has not
 * finished or put away setup, resumes where they left off, and "Not now" puts
 * it away (with Undo). Drawn only after the stored progress is read, so it
 * never appears and then vanishes.
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
    const before = progress.status;
    update(dismissWorkSetup);
    // Undo restores only the status, so a step finished meanwhile is kept.
    undoToast?.("Setup put away. Find it in More or Help.", () =>
      update((current) => (current.status === "dismissed" ? { ...current, status: before } : current)),
    );
  };

  return (
    <WorkCard as="section" testId="work-setup-prompt" aria-label="Get set up">
      <div className="work-setup-prompt work-card--pad">
        <WorkIconCircle icon={Compass} />
        <div className="work-setup-prompt__text">
          <h2 className="work-setup-prompt__title">Get set up</h2>
          <p className="work-setup-prompt__sub">
            {started ? workSetupCountLabel(done, total) : "Stage, areas, time zone, roster and alerts"}
          </p>
        </div>
      </div>
      <ul className="work-rows work-setup-prompt__list" aria-label="Setup steps">
        {countedWorkSetupSteps(progress.areas).map((step) => {
          const stepDone = progress.completed.includes(step);
          const skipped = progress.skipped.includes(step);
          return (
            <li key={step}>
              <Link href={workSetupStepHref(step)} className="work-row" data-testid={`work-setup-prompt-step-${step}`}>
                <span className="work-row__text">
                  <span className="work-row__title">{WORK_SETUP_STEP_COPY[step].short}</span>
                </span>
                <span className="work-row__end">
                  {stepDone ? (
                    <span className="work-setup__ready">
                      <CircleCheck aria-hidden="true" className="size-icon-sm" strokeWidth={2.2} />
                      Done
                    </span>
                  ) : skipped ? (
                    <WorkTag tone="neutral">Skipped</WorkTag>
                  ) : (
                    <WorkTag tone="amber">To do</WorkTag>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="work-setup-prompt__actions work-card--pad">
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
