"use client";

import "@/components/work-setup/work-setup.css";

import { ChevronLeft, LogIn, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { WorkButton, WorkCard, WorkDock, WorkGlassButton, WorkIconRow } from "@/components/mode-kit/work";
import { useSetupExampleData, useSetupTimeZone } from "@/components/work-setup/shared-settings";
import { useWorkSetupProgress } from "@/components/work-setup/use-work-setup-progress";
import { WORK_SETUP_STEP_COPY, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import { WORK_SETUP_STEP_BODY, type WorkSetupStepContext } from "@/components/work-setup/work-setup-steps";
import { useAuthSession } from "@/lib/supabase/client";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  completeWorkSetupStep,
  countedWorkSetupSteps,
  goToWorkSetupStep,
  OTHER_AREA_STEP_AREAS,
  previousWorkSetupStep,
  resolveWorkSetupStep,
  setWorkSetupAreas,
  skipWorkSetupStep,
  WORK_SETUP_STEPS,
  type WorkSetupAreaId,
  type WorkSetupProgress,
  type WorkSetupStepId,
} from "@/lib/work-setup/progress";

const EXIT_HREF = "/my-day";
const HELP_HREF = "/my-day/help";

function readStepParam(value: string | null): WorkSetupStepId | null {
  return value && (WORK_SETUP_STEPS as readonly string[]).includes(value) ? (value as WorkSetupStepId) : null;
}

/** The area a deep link into a hidden step means the doctor uses (Roster's empty page linking here, say). */
function areasForDeepLink(step: WorkSetupStepId, areas: readonly WorkSetupAreaId[]): readonly WorkSetupAreaId[] {
  if (step === "roster" && !areas.includes("rost")) return [...areas, "rost"];
  if (step === "other-areas" && !OTHER_AREA_STEP_AREAS.some((area) => areas.includes(area))) {
    return [...areas, ...OTHER_AREA_STEP_AREAS];
  }
  return areas;
}

const subscribeNothing = () => () => undefined;
/** False on the server and the first client render, so stored progress never causes a hydration mismatch. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

function StepProgress({ progress, step }: { readonly progress: WorkSetupProgress; readonly step: WorkSetupStepId }) {
  const counted = countedWorkSetupSteps(progress.areas);
  return (
    <ol className="work-setup__progress" aria-hidden="true">
      {counted.map((item) => {
        const state =
          item === step
            ? "current"
            : progress.completed.includes(item)
              ? "done"
              : progress.skipped.includes(item)
                ? "skipped"
                : "todo";
        return <li key={item} className="work-setup__segment" data-state={state} />;
      })}
    </ol>
  );
}

/**
 * Set up Work (`/my-day/setup`). A focused page, without the band or tabs: a
 * top bar (back, where you are, close), one step, and a dock. Every step can be
 * skipped, Close keeps the place, and the address carries the step so the
 * phone's own back gesture walks back through the steps.
 */
export function WorkSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const { progress, update } = useWorkSetupProgress();
  const { status: authStatus } = useAuthSession();
  const online = useOnlineStatus();
  const exampleData = useSetupExampleData();
  const timeZone = useSetupTimeZone();
  const [signInOpen, setSignInOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const requested = readStepParam(searchParams?.get("step") ?? null);
  const step: WorkSetupStepId = requested ?? resolveWorkSetupStep(progress);
  const signedIn = authStatus === "authenticated";
  const signedOut = authStatus === "signed_out" || authStatus === "expired" || authStatus === "unconfigured";

  // A deep link to a step this doctor's choices hide brings its area back, then the
  // stored place follows the page shown so Close and My Day's card resume here.
  useEffect(() => {
    if (!hydrated) return;
    const areas = areasForDeepLink(step, progress.areas);
    if (areas !== progress.areas) update((current) => setWorkSetupAreas(current, areas));
    if (progress.step !== step && step !== "done") update((current) => goToWorkSetupStep(current, step));
  }, [hydrated, step, progress.areas, progress.step, update]);

  // Each new step moves focus to its heading, so a screen reader hears where it is.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  const show = useCallback(
    (next: WorkSetupStepId, mode: "push" | "replace" = "push") => {
      const href = workSetupStepHref(next);
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [router],
  );

  const onContinue = useCallback(() => {
    let next: WorkSetupStepId = "done";
    update((current) => {
      const changed = completeWorkSetupStep({ ...current, step }, step);
      next = changed.step;
      return changed;
    });
    show(next);
  }, [show, step, update]);

  const onSkip = useCallback(() => {
    let next: WorkSetupStepId = "done";
    update((current) => {
      const changed = skipWorkSetupStep({ ...current, step }, step);
      next = changed.step;
      return changed;
    });
    show(next);
  }, [show, step, update]);

  const onBack = useCallback(() => {
    const previous = previousWorkSetupStep(step, progress.areas);
    if (previous) show(previous, "replace");
    else router.push(EXIT_HREF);
  }, [progress.areas, router, show, step]);

  const onGoTo = useCallback(
    (target: WorkSetupStepId) => {
      update((current) => goToWorkSetupStep(current, target));
      show(target);
    },
    [show, update],
  );

  const onAreas = useCallback(
    (areas: readonly WorkSetupAreaId[]) => update((current) => setWorkSetupAreas(current, areas)),
    [update],
  );

  const copy = WORK_SETUP_STEP_COPY[step];
  const counted = countedWorkSetupSteps(progress.areas);
  const position = counted.indexOf(step) + 1;
  const framed = step !== "welcome" && step !== "done";
  const Body = WORK_SETUP_STEP_BODY[step];
  const context: WorkSetupStepContext = { progress, signedIn, online, exampleData, timeZone, onAreas, onGoTo };

  // Until stored progress is read, draw nothing that could jump: the bar and a quiet body.
  if (!hydrated) {
    return (
      <div className="work-setup" data-testid="work-setup-loading">
        <span role="status" className="sr-only">
          Loading setup
        </span>
      </div>
    );
  }

  return (
    <div className="work-setup" data-mode-identity="my-day" data-testid="work-setup" data-step={step}>
      <header className="work-setup__bar">
        {step === "welcome" ? (
          <span aria-hidden="true" className="work-setup__bar-gap" />
        ) : (
          <WorkGlassButton
            icon={ChevronLeft}
            label={previousWorkSetupStep(step, progress.areas) ? "Previous step" : "Back to My Day"}
            onClick={onBack}
            testId="work-setup-back"
          />
        )}
        <p className="work-setup__where">
          <span className="work-setup__where-title">Set up Work</span>
          {framed ? (
            <span className="work-setup__where-step" data-testid="work-setup-position">
              Step {position} of {counted.length}
            </span>
          ) : null}
        </p>
        <WorkGlassButton icon={X} label="Close setup. Your place is kept." href={EXIT_HREF} testId="work-setup-close" />
      </header>
      {framed ? <StepProgress progress={progress} step={step} /> : null}

      <main className="work-setup__body" aria-labelledby="work-setup-heading">
        <h1 id="work-setup-heading" ref={headingRef} tabIndex={-1} className="work-setup__title">
          {copy.title}
        </h1>
        <p className="work-setup__sub">{copy.sub}</p>

        {step === "welcome" && signedOut ? (
          <WorkCard testId="work-setup-signed-out">
            <WorkIconRow
              icon={LogIn}
              title="Sign in to save your setup"
              sub="Your stage and area setup are saved to your account."
              onClick={() => setSignInOpen(true)}
            />
          </WorkCard>
        ) : null}

        <Body {...context} />
      </main>

      <WorkDock aria-label="Setup actions">
        {step === "welcome" ? (
          <>
            <WorkButton size="wide" onClick={onContinue} testId="work-setup-start">
              {progress.completed.length > 0 || progress.skipped.length > 0 ? "Carry on" : "Start"}
            </WorkButton>
            <WorkButton variant="quiet" href={EXIT_HREF} testId="work-setup-not-now">
              Not now
            </WorkButton>
          </>
        ) : step === "done" ? (
          <>
            <WorkButton size="wide" href={EXIT_HREF} testId="work-setup-finish">
              Go to My Day
            </WorkButton>
            <WorkButton variant="quiet" href={HELP_HREF} testId="work-setup-help">
              Open help
            </WorkButton>
          </>
        ) : (
          <>
            <WorkButton size="wide" onClick={onContinue} testId="work-setup-continue">
              Continue
            </WorkButton>
            <WorkButton variant="quiet" onClick={onSkip} testId="work-setup-skip">
              Skip for now
            </WorkButton>
          </>
        )}
      </WorkDock>
      <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
