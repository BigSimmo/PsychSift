"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, History, Square } from "lucide-react";

import {
  answerProgressDisplayMessage,
  answerProgressPreviewMessage,
  answerProgressStepIndex,
  answerProgressTookUnusualRoute,
  type TimedAnswerProgressUpdate,
} from "@/components/clinical-dashboard/answer-progress";
import {
  AnswerEvidencePreview,
  visiblePreviewSourceLimit,
} from "@/components/clinical-dashboard/answer-evidence-preview";
import type { VerifiedEvidencePreviewUnit } from "@/lib/answer-stream-contract";
import { AnswerSuggestionChips } from "@/components/clinical-dashboard/answer-suggestion-chips";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { ModeHomeTemplate } from "@/components/mode-home-template";
import { LazyMyDayHomeCard } from "@/components/my-day/my-day-home-card-lazy";
import { ShowAllChip } from "@/components/show-all-chip";
import { AnswerProseSkeleton } from "@/components/clinical-dashboard/answer-skeleton";
import { cn } from "@/components/ui-primitives";
import { appModeIcons } from "@/lib/app-mode-icons";
import type { AppModeId } from "@/lib/app-modes";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { motionIsSuppressed } from "@/lib/scroll-behavior";
import { sharedHomeEmptyState, sharedHomePresentation, type SharedHomePresentation } from "@/lib/ui-copy";

export { CopyButton } from "@/components/ui/copy-button";
// The skeleton lives apart so the lazy-load fallbacks can draw it without this module.
export { AnswerSkeleton } from "@/components/clinical-dashboard/answer-skeleton";

/**
 * The one-tap route into a mode's catalogue from the shared home.
 *
 * The shared home renders no starter cards and no mode tab bar
 * (`isModeSecondaryNavigationRoute` lists routed destinations only), so a mode whose
 * catalogue is a real browsable surface would otherwise be reachable only by typing a
 * search. Calculators established the pattern; Sources joined it when its four-card
 * home at `/sources` was retired into this one.
 */
const sharedHomeCatalogueChips: Partial<Record<AppModeId, { label?: string; ariaLabel: string }>> = {
  calculators: { ariaLabel: "Show all calculators" },
  sources: { label: "Browse catalogue", ariaLabel: "Browse the source catalogue" },
};

export function SharedHomeEmptyState({
  modeId,
  desktopComposerSlotId,
  recentQueries = [],
  onSelectRecent,
}: {
  modeId: AppModeId;
  desktopComposerSlotId?: string;
  recentQueries?: string[];
  onSelectRecent?: (query: string) => void;
}) {
  // Returning users get their prior questions back as one-tap chips so they can
  // re-run without retyping. Capped for a calm surface; storage already dedupes.
  // Gated on the "Recent searches on home" preference so the settings toggle
  // actually controls this surface (2026-07-19 audit wiring).
  const { preferences } = useAppPreferences();
  const recents =
    onSelectRecent && preferences.showRecentOnHome
      ? recentQueries.filter((entry) => entry.trim().length > 0).slice(0, 5)
      : [];
  const presentation: SharedHomePresentation = sharedHomePresentation[modeId];
  const catalogueChip = sharedHomeCatalogueChips[modeId];

  return (
    <ModeHomeTemplate
      testId="shared-home-empty-state"
      title={presentation.title}
      subtitle={presentation.subtitle}
      icon={appModeIcons[modeId]}
      headingLevel={2}
      stabilizePhoneCopy
      desktopComposerSlotId={desktopComposerSlotId}
      heroAction={
        catalogueChip ? (
          <ShowAllChip
            href={consolidatedModeSearchPath(modeId)}
            icon={appModeIcons[modeId]}
            label={catalogueChip.label}
            ariaLabel={catalogueChip.ariaLabel}
            testId={`${modeId}-show-all`}
          />
        ) : undefined
      }
      actionsLabel={sharedHomeEmptyState.starterActionsLabel}
      actions={[]}
      footer={
        <div className="grid w-full gap-3">
          {/* My Day sits under the composer, never above it: the composer
              stays the first thing on the home screen (one owner, no shift),
              and the card renders nothing at all until it has items. */}
          <LazyMyDayHomeCard />
          {recents.length > 0 && (
            <AnswerSuggestionChips
              testId="shared-home-recent-queries"
              suggestions={recents}
              onPick={(entry) => onSelectRecent?.(entry)}
              label={sharedHomeEmptyState.recentLabel}
              layout="wrap"
              className="home-recent-searches justify-center"
              icon={History}
            />
          )}
        </div>
      }
    />
  );
}

/**
 * The whole animation, in one element.
 *
 * A 5px dot at the head of the status line, breathing on a 2.4s cycle. It
 * replaces a `Loader2` spinner in the search banner and a scrolling ECG trace in
 * the answer progress panel, and it is the only moving thing either surface now
 * has.
 *
 * The reason it is a dot and not a spinner is the state it has to survive. The
 * indicator must stay correct and clearly visible when motion is suppressed —
 * that is a contract this repo learned the hard way, after Reduce Motion set the
 * ECG trace to `opacity: 0` and left a dead panel on a physical iPhone while an
 * answer was generating. A stopped dot is a bullet. A stopped spinner is a
 * fragment of a circle.
 *
 * The animation itself lives in globals.css as `.answer-progress-dot`, not as a
 * `motion-safe:` utility, because the in-app Motion preference has to be able to
 * opt back IN over the OS request and a Tailwind media variant cannot be
 * overridden by `html[data-motion="full"]`.
 */
function ProgressDot() {
  // One colour, running or complete. A green dot on completion was a status hue
  // carrying meaning that nothing else on the element repeated — and it was
  // redundant besides, because the line beside it already changes to "Answer
  // ready in 3s". Dropping it removes a colour-only signal and one more thing to
  // look at.
  //
  // The 20px box is the line-height of the text it marks, so the dot sits on the
  // optical centre of the first line without a nudge margin, and stays on the
  // first line when the text wraps.
  return (
    <span
      aria-hidden="true"
      data-slot="answer-progress-dot"
      className="answer-progress-dot grid h-5 w-2 shrink-0 place-items-center"
    >
      <span className="block h-[5px] w-[5px] rounded-full bg-[color:var(--clinical-accent)] forced-colors:bg-[Highlight]" />
    </span>
  );
}

/**
 * The Stop control, as a quiet text control rather than a raised pill.
 *
 * Kept at a 48px tap target with an 8px-tall visible face, the same
 * hit-area-larger-than-face pattern the raised pill used, so nothing about
 * reachability changes — only the weight.
 */
function StopControl({ onStop }: { onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      data-testid="stop-answer"
      aria-label="Stop generating answer"
      className="group -my-2 inline-flex min-h-tap shrink-0 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
    >
      <span className="inline-flex items-center gap-1 rounded-md px-1 text-2xs font-semibold text-[color:var(--text-muted)] transition group-hover:text-[color:var(--text-heading)] motion-reduce:transition-none">
        <Square aria-hidden="true" className="size-icon-xs shrink-0 fill-current" />
        Stop
      </span>
    </button>
  );
}

/** After this long the wait is worth naming as abnormal. Deliberately a single
 *  threshold rather than a running counter: the old panel re-rendered "Ns
 *  elapsed" every second in the one position the eye already rests on, which
 *  makes the wait the subject. Nothing can be done with the number while the
 *  search is healthy; "taking longer than usual" is the part that is actionable,
 *  and it is announced once. */
const slowAnswerNoticeMs = 10_000;

function useSlowNotice(active: boolean, startedAt: number | null) {
  // The timer records WHICH run went slow rather than a bare boolean, so a new
  // question clears the notice by identity instead of by a reset written into an
  // effect body. Nothing is set synchronously during the effect.
  const [slowRun, setSlowRun] = useState<number | null>(null);
  useEffect(() => {
    if (!active || startedAt === null) return undefined;
    const timer = window.setTimeout(() => setSlowRun(startedAt), slowAnswerNoticeMs);
    return () => window.clearTimeout(timer);
  }, [active, startedAt]);
  return active && startedAt !== null && slowRun === startedAt;
}

/** One card per rung. `--duration-moderate` is an existing duration token (200ms) rather than
 *  a new one — `globals.css` says in as many words not to invent a rung — and six cards
 *  therefore land over about 1.2s. That is long enough that each is separately noticeable and
 *  short enough to be standing well before generation ends, which is the window the rail has
 *  to be readable in. */
const evidenceRevealIntervalMs = 200;

/** The motion preference as a subscription rather than a snapshot, so the in-app Reduce motion
 *  toggle takes effect on the wait already on screen. `use-app-preferences.ts` mirrors that
 *  toggle onto `<html data-motion>`, and the OS request arrives through the media query;
 *  `motionIsSuppressed()` reads both, this only watches them for changes. */
function subscribeToMotionPreference(onChange: () => void) {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    media?.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/**
 * How many source cards are on screen right now.
 *
 * The sources all arrive in one stream event, so this is a reveal, not live discovery — see
 * the note on `AnswerEvidencePreview`. It lives here rather than in the rail because the
 * status line prints this same number, and the wait's one copy rule is that no number appears
 * that the reader cannot reconcile with something on screen. One owner, one count.
 *
 * Keyed by preview identity, in the same shape `useSlowNotice` uses for the run: a retry or a
 * new question hands over a different unit and the count starts again. The reset is a
 * render-phase adjustment, not a write inside an effect — nothing here calls setState
 * synchronously during an effect, where it would cascade renders.
 *
 * **The count for one unit never goes backwards.** Motion is a live subscription, so a reader
 * can change the preference mid-generation; if suppressing motion filled the rail and then
 * re-enabling it restarted the count, six cards a reader was already reading would vanish and
 * re-accrue. The count only ever rises, so a preference change can complete the rail early but
 * can never take back a card.
 *
 * Motion suppressed reveals everything immediately, with no timer in the path at all. That is
 * the hard-won rule on this surface: Reduce Motion once left a dead panel on a physical iPhone
 * mid-generation, and a JS reveal could withhold content in a way a CSS delay never could.
 */
function useProgressiveReveal(total: number, preview: VerifiedEvidencePreviewUnit | null) {
  // `motionIsSuppressed`, not `prefersReducedMotion`: this gates a JS animation, and the CSS
  // animations around it honour an explicit in-app "Full" over an OS reduce request. Reading
  // the weaker form here would freeze this rail alone while the rest of the interface animates.
  const suppressed = useSyncExternalStore(subscribeToMotionPreference, motionIsSuppressed, () => false);
  const [revealed, setRevealed] = useState<{ unit: VerifiedEvidencePreviewUnit; count: number } | null>(null);

  const cap = preview && total > 0 ? total : 0;
  const stored = revealed?.unit === preview ? revealed.count : 0;
  // The first card is on screen the instant the unit arrives. This preview exists to shorten
  // time to first useful content, and holding the whole rail back for a rung to make the
  // animation tidier would spend exactly what it was built to buy.
  const floor = cap === 0 ? 0 : suppressed ? cap : Math.min(1, cap);
  const count = Math.max(stored, floor);
  if (preview && count !== stored) setRevealed({ unit: preview, count });

  useEffect(() => {
    if (suppressed || !preview || count >= cap) return undefined;
    // One card per rung, as a chain of timeouts keyed on the current count rather than a
    // self-clearing interval: it terminates on its own when the rail is full, and the state
    // write is the only thing the callback does.
    const timer = window.setTimeout(() => setRevealed({ unit: preview, count: count + 1 }), evidenceRevealIntervalMs);
    return () => window.clearTimeout(timer);
  }, [preview, cap, count, suppressed]);

  return count;
}

/**
 * Single-line progress for the non-answer (library/document) search modes, the
 * flat sibling of AnswerProgress.
 *
 * It was a filled accent band with a spinning `Loader2`. Fill is how this app
 * marks a hazard, and a search in flight is not one, so it is now the same quiet
 * line the answer surface uses.
 */
/**
 * The five steps every answer goes through, named as the reader would say them.
 *
 * These are the same clauses the status line already prints for each stage
 * (`answerProgressDisplayMessage`), so the list adds no new vocabulary: it shows
 * the reader where the line is in a sequence that is the same on every run.
 * Requested by the owner on 2026-10-04 after a slow search left the screen
 * effectively blank; the index comes from `answerProgressStepIndex`, so a step
 * is ticked only after the stream has actually moved past it.
 */
const answerProgressSteps = [
  "Reading your question",
  "Searching your documents",
  "Choosing the most relevant passages",
  "Writing the answer",
  "Checking citations and clinical numbers",
] as const;

function AnswerProgressSteps({ current }: { current: number }) {
  return (
    <ol aria-label="Search steps" data-slot="answer-progress-steps" className="grid gap-1.5">
      {answerProgressSteps.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li
            key={label}
            data-step-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex items-start gap-2 text-xs leading-5",
              state === "done" && "text-[color:var(--text-muted)]",
              state === "current" && "font-semibold text-[color:var(--text-heading)]",
              state === "upcoming" && "text-[color:var(--text-muted)] opacity-80",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]",
                state === "done" &&
                  "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--primary-contrast)]",
                state === "current" && "border-2 border-[color:var(--clinical-accent)]",
                state === "upcoming" && "border-[color:var(--border-strong)]",
              )}
            >
              {state === "done" ? <Check aria-hidden="true" className="size-2.5" strokeWidth={3.5} /> : null}
              {state === "current" ? (
                <span className="block size-1.5 rounded-full bg-[color:var(--clinical-accent)] forced-colors:bg-[Highlight]" />
              ) : null}
            </span>
            <span className="min-w-0">
              {label}
              <span className="sr-only">
                {state === "done" ? ", done" : state === "current" ? ", in progress" : ", not started"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function SearchProgressBanner({ message, onStop }: { message: string; onStop: () => void }) {
  return (
    <p
      role="status"
      data-testid="search-progress"
      className="flex min-h-8 items-start gap-2 text-xs leading-5 text-[color:var(--text-muted)]"
    >
      <ProgressDot />
      <span className="min-w-0 flex-1">{message}</span>
      <StopControl onStop={onStop} />
    </p>
  );
}

/**
 * The wait on the answer surface.
 *
 * Replaces `AnswerProgressStepper`: a filled accent panel carrying a 36px icon
 * tile, a five-circle stepper with connecting rails, a scrolling ECG trace, a
 * per-second elapsed counter and a Processing details disclosure. It narrated
 * the orchestrator's five stages, which the reader is not operating, and it
 * never showed a single source — even though the evidence preview crosses the
 * stream boundary before the prose and is the most useful content this surface
 * has.
 *
 * What is here instead is the pending screen from
 * `/mockups/answer-chat-perfected-v2`, in the order that mockup draws it and for
 * the reason it draws it that way:
 *
 *     status line
 *     prose placeholder      ← where the answer's prose will be
 *     sources                ← where the answer's source rail will be
 *
 * That order is the entire "nothing jumps" claim. The first cut of this
 * component put the rail directly under the line and left the prose placeholder
 * to render below it as a sibling, which meant the rail travelled the height of
 * the answer at the exact moment the reader was given something to read. Here
 * every element is already standing where its finished counterpart lands, so the
 * arrival swaps content in place: the placeholder becomes prose, and the dotted
 * preview cards are replaced by the answer's own numbered rail in the same spot.
 *
 * On completion this renders no visible chrome at all. The answer surface
 * already prints its own governed provenance line above the prose
 * ("AI-generated from N cited sources", clinical owner approved 2026-08-25), so
 * a second "Answer ready in 3s" underneath it was a competing completion
 * statement and a last vestige of the elapsed counter. What survives is the
 * screen-reader announcement and, when the answer left the ordinary route, the
 * disclosure that explains it.
 *
 * The rail degrades to nothing rather than to a placeholder: the preview unit is
 * gated behind `NEXT_PUBLIC_RAG_INCREMENTAL_EVIDENCE_PREVIEW_RENDER` (#100 Phase
 * 1), which is ON unless explicitly set to `false` (2026-08-27 owner decision —
 * see `src/lib/client-env.ts`). When the server emits no preview, or rendering is
 * rolled back, the line and the prose placeholder are the whole wait. Nothing
 * here invents a source to fill the space.
 */
export function AnswerProgress({
  events,
  startedAt,
  active,
  onStop,
  evidencePreview = null,
  question = null,
}: {
  question?: string | null;
  events: TimedAnswerProgressUpdate[];
  startedAt: number | null;
  active: boolean;
  onStop: () => void;
  evidencePreview?: VerifiedEvidencePreviewUnit | null;
}) {
  const latest = events.at(-1) ?? null;
  const finished = latest?.stage === "complete";
  const running = active && !finished;
  const slow = useSlowNotice(running, startedAt);
  const unusualRoute = answerProgressTookUnusualRoute(events);
  const stepIndex = latest ? answerProgressStepIndex(latest.stage) : 0;
  // The only number the wait prints, and it counts the cards directly below it — which is
  // why it is the rail's visible cap, not the unit's length. A unit may carry up to twelve
  // sources while the rail draws six, and a line reading "8 sources found" above six cards
  // is a number the reader cannot reconcile with anything on screen.
  const previewSourceCount = Math.min(evidencePreview?.sources.length ?? 0, visiblePreviewSourceLimit);
  // The cards are revealed one at a time, so the line counts what is currently standing
  // beneath it rather than what the unit carries. Before the first card lands there is no
  // count to print and the line falls back to the stage clause.
  const revealedSourceCount = useProgressiveReveal(previewSourceCount, evidencePreview);
  const previewMessage = latest ? answerProgressPreviewMessage(revealedSourceCount, latest.stage) : null;
  const currentMessage = previewMessage ?? (latest ? answerProgressDisplayMessage(latest) : "Reading your question…");
  const details = events
    .map((event) => ({ ...event, displayMessage: answerProgressDisplayMessage(event) }))
    .filter((event, index, all) => index === 0 || event.displayMessage !== all[index - 1]?.displayMessage)
    .slice(-8);

  return (
    <section
      data-testid="answer-progress"
      data-progress-state={finished ? "complete" : "active"}
      aria-label={finished ? "Answer generation complete" : "Answer generation progress"}
      aria-busy={running}
      className="grid gap-2"
    >
      {finished ? (
        <span role="status" className="sr-only">
          Answer ready.
        </span>
      ) : (
        <>
          <div
            data-slot="answer-progress-card"
            className="grid gap-2.5 rounded-2xl bg-[color:var(--clinical-accent-soft)] px-3.5 py-3 forced-colors:border forced-colors:border-[CanvasText]"
          >
            {question ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-3xs font-bold tracking-eyebrow text-[color:var(--text-muted)] uppercase">
                    Your question
                  </p>
                  <p
                    data-testid="answer-progress-question"
                    className="text-base leading-snug font-semibold break-words text-[color:var(--text-heading)]"
                  >
                    {question}
                  </p>
                </div>
                {running ? <StopControl onStop={onStop} /> : null}
              </div>
            ) : null}
            <div className="flex items-start gap-2">
              <p
                aria-live="polite"
                data-testid="answer-progress-line"
                className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-5 font-semibold text-[color:var(--text-heading)]"
              >
                <ProgressDot />
                <span className="min-w-0 flex-1">
                  {currentMessage}
                  {slow ? (
                    <span className="font-normal text-[color:var(--text-muted)]">
                      {" "}
                      &middot; taking longer than usual
                    </span>
                  ) : null}
                </span>
              </p>
              {/* Outside the live line on purpose: the line prints no number the reader
                  cannot reconcile, and this one counts the list directly beneath it. */}
              <span aria-hidden="true" className="nums shrink-0 text-2xs leading-5 text-[color:var(--text-muted)]">
                Step {stepIndex + 1} of {answerProgressSteps.length}
              </span>
              {running && !question ? <StopControl onStop={onStop} /> : null}
            </div>
            <AnswerProgressSteps current={stepIndex} />
          </div>

          <div
            data-slot="answer-progress-answer"
            className="grid gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3.5 py-3"
          >
            <p className="text-3xs font-bold tracking-eyebrow text-[color:var(--text-muted)] uppercase">Answer</p>
            <p className="text-xs text-[color:var(--text-muted)]">Your cited answer will appear here.</p>
            <AnswerProseSkeleton />
          </div>

          <div data-slot="answer-progress-sources" className="grid gap-1.5">
            <p className="flex items-baseline justify-between text-3xs font-bold tracking-eyebrow text-[color:var(--text-muted)] uppercase">
              <span>Sources</span>
              <span className="nums text-2xs font-semibold tracking-normal normal-case">
                {revealedSourceCount > 0 ? `${revealedSourceCount} found` : "None chosen yet"}
              </span>
            </p>
            {evidencePreview && revealedSourceCount > 0 ? (
              <AnswerEvidencePreview preview={evidencePreview} revealedCount={revealedSourceCount} />
            ) : (
              <div aria-hidden="true" data-slot="answer-progress-source-slots" className="flex gap-1.5 overflow-hidden">
                {[0, 1, 2].map((slot) => (
                  <span
                    key={slot}
                    className="h-12 w-32 shrink-0 rounded-xl border-[1.5px] border-dashed border-[color:var(--border-strong)]"
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* A routine answer has nothing to disclose — the retired panel offered the
          same five stages every time. These three stages mean the answer did not
          take the ordinary route, which is the case a reader may actually want to
          read back. */}
      {finished && unusualRoute ? (
        <details className="text-2xs text-[color:var(--text-muted)]">
          <summary className="w-fit cursor-pointer rounded-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]">
            How this answer was built
          </summary>
          <ol className="mt-2 space-y-1 border-l border-[color:var(--border)] pl-3">
            {details.map((event, index) => (
              <li key={`${event.receivedAt}-${event.stage}-${index}`} className="leading-relaxed">
                {event.displayMessage}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
