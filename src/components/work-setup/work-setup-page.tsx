"use client";

import "@/components/work-setup/work-setup.css";

import { Check, ChevronLeft, Compass, LogIn } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { WorkButton, WorkCard, WorkDock, WorkIconRow } from "@/components/mode-kit/work";
import { universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";
import { useSetupExampleData, useSetupTimeZone } from "@/components/work-setup/shared-settings";
import { useWorkSetupProgress } from "@/components/work-setup/use-work-setup-progress";
import { WORK_SETUP_STEP_COPY, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import { WORK_SETUP_STEP_BODY, type WorkSetupStepContext } from "@/components/work-setup/work-setup-steps";
import { useAuthSession } from "@/lib/supabase/client";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  completeWorkSetupStep,
  countedWorkSetupSteps,
  dismissWorkSetup,
  goToWorkSetupStep,
  OTHER_AREA_STEP_AREAS,
  previousWorkSetupStep,
  resolveWorkSetupStep,
  setWorkSetupAreas,
  skipWorkSetupStep,
  WORK_SETUP_STEPS,
  visibleWorkSetupSteps,
  type WorkSetupAreaId,
  type WorkSetupProgress,
  type WorkSetupStepId,
} from "@/lib/work-setup/progress";

const EXIT_HREF = "/my-day";
const HELP_HREF = "/my-day/help";

function readStepParam(value: string | null): WorkSetupStepId | null {
  return value && (WORK_SETUP_STEPS as readonly string[]).includes(value) ? (value as WorkSetupStepId) : null;
}

/**
 * A deep link into a step this doctor's choices hide (Roster's empty page linking
 * to the roster step, say) means they use that area. `?area=` names it for the
 * other-areas step. Without one, the link can't say which area, so nothing is added.
 */
function areasForDeepLink(
  step: WorkSetupStepId,
  areas: readonly WorkSetupAreaId[],
  named: string | null,
): readonly WorkSetupAreaId[] {
  if (step === "roster" && !areas.includes("rost")) return [...areas, "rost"];
  const area = OTHER_AREA_STEP_AREAS.find((item) => item === named);
  if (step === "other-areas" && area && !areas.includes(area)) return [...areas, area];
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
 * The step back, drawn in the top bar's round left button in place of the
 * menu, the same slot a page reached from More uses for its back button.
 */
function SetupHeaderBack({ label, onBack }: { readonly label: string; readonly onBack: () => void }) {
  const host = useSyncExternalStore(
    subscribeNothing,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  if (!host) return null;
  return createPortal(
    <button
      type="button"
      className="universal-header-icon-control work-frame-back"
      aria-label={label}
      onClick={onBack}
      data-testid="work-setup-back"
    >
      <ChevronLeft aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
    </button>,
    host,
  );
}

/**
 * Set up Work (`/my-day/setup`). A focused page, without the band or tabs:
 * where you are and Close, one step, and a dock. Back is the top bar's left button. Every step can be
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
  const shownStep: WorkSetupStepId = requested ?? resolveWorkSetupStep(progress);
  // A step these choices hide, reached by an old address, shows where the doctor got to instead.
  const step: WorkSetupStepId =
    visibleWorkSetupSteps(progress.areas).includes(shownStep) ||
    areasForDeepLink(shownStep, progress.areas, searchParams?.get("area") ?? null) !== progress.areas
      ? shownStep
      : resolveWorkSetupStep(progress);
  const signedIn = authStatus === "authenticated";
  const signedOut = authStatus === "signed_out" || authStatus === "expired" || authStatus === "unconfigured";

  // A deep link adds the area it stands for, once per address, so stepping back
  // to Areas and unticking it sticks. Only Continue, Skip and Done's rows move the
  // stored place, so merely viewing a step from Help never rewrites progress.
  const linkedArea = searchParams?.get("area") ?? null;
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !requested) return;
    const key = `${requested}|${linkedArea ?? ""}`;
    if (handledLink.current === key) return;
    handledLink.current = key;
    const areas = areasForDeepLink(requested, progress.areas, linkedArea);
    if (areas !== progress.areas) update((current) => setWorkSetupAreas(current, areas));
  }, [hydrated, requested, linkedArea, progress.areas, update]);

  // The phone's back gesture and the top bar's Back both walk back through the
  // steps this visit opened. Back past the first one opened here goes to the step before.
  const opened = useRef(0);
  useEffect(() => {
    const onPop = () => {
      opened.current = Math.max(0, opened.current - 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Each new step moves focus to its heading, so a screen reader hears where it is.
  const focusedStep = useRef<WorkSetupStepId | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (focusedStep.current === null) {
      focusedStep.current = step;
      return;
    }
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [hydrated, step]);

  const show = useCallback(
    (next: WorkSetupStepId, mode: "push" | "replace" = "push") => {
      const href = workSetupStepHref(next);
      if (mode === "push") {
        opened.current += 1;
        router.push(href, { scroll: false });
      } else router.replace(href, { scroll: false });
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
    if (opened.current > 0) {
      router.back();
      return;
    }
    const previous = previousWorkSetupStep(step, progress.areas);
    if (previous) show(previous, "replace");
    else router.push(EXIT_HREF);
  }, [progress.areas, router, show, step]);

  // "Not now" on the welcome puts setup away, the same as on My Day's card.
  const onNotNow = useCallback(() => {
    update(dismissWorkSetup);
    router.push(EXIT_HREF);
  }, [router, update]);

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
  const backLabel = previousWorkSetupStep(step, progress.areas) ? "Previous step" : "Back to My Day";
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
      <SetupHeaderBack label={backLabel} onBack={onBack} />
      <div className="work-setup__top">
        <p className="work-setup__where" data-testid="work-setup-position">
          {framed ? `Step ${position} of ${counted.length}` : "Set up Work"}
        </p>
        {framed ? (
          <WorkButton
            variant="quiet"
            href={EXIT_HREF}
            aria-label="Close setup. Your place is kept."
            testId="work-setup-close"
          >
            Close
          </WorkButton>
        ) : null}
      </div>
      {framed ? <StepProgress progress={progress} step={step} /> : null}

      <main className="work-setup__body" aria-labelledby="work-setup-heading">
        {framed ? null : (
          <span aria-hidden="true" className="work-setup__art" data-tone={step === "done" ? "green" : undefined}>
            {step === "done" ? (
              <Check aria-hidden="true" strokeWidth={2.2} />
            ) : (
              <Compass aria-hidden="true" strokeWidth={1.8} />
            )}
          </span>
        )}
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
            <WorkButton variant="quiet" onClick={onNotNow} testId="work-setup-not-now">
              Not now
            </WorkButton>
            <WorkButton size="wide" onClick={onContinue} testId="work-setup-start">
              {progress.completed.length > 0 || progress.skipped.length > 0 ? "Carry on" : "Start"}
            </WorkButton>
          </>
        ) : step === "done" ? (
          <>
            <WorkButton variant="quiet" href={HELP_HREF} testId="work-setup-help">
              Open help
            </WorkButton>
            <WorkButton size="wide" href={EXIT_HREF} testId="work-setup-finish">
              Go to My Day
            </WorkButton>
          </>
        ) : (
          <>
            <WorkButton variant="quiet" onClick={onSkip} testId="work-setup-skip">
              Skip for now
            </WorkButton>
            <WorkButton size="wide" onClick={onContinue} testId="work-setup-continue">
              Continue
            </WorkButton>
          </>
        )}
      </WorkDock>
      <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
