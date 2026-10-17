"use client";

import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  Grid2X2,
  HelpCircle,
  Library,
  ListChecks,
  LockKeyhole,
  Palette,
  PlayCircle,
  RotateCcw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type UIEvent } from "react";

import {
  guideQuickTasks,
  guideTopicById,
  guideTopics,
  guideTourSteps,
  type GuideTopic,
  type GuideTopicId,
  type GuideView,
} from "@/components/clinical-dashboard/guide-content";
import {
  clearGuideProgress,
  completeGuideStep,
  emptyGuideProgress,
  firstIncompleteGuideStep,
  loadGuideProgress,
  saveGuideProgress,
  type GuideProgress,
} from "@/components/clinical-dashboard/guide-progress";
import { useScrollHideReporter } from "@/components/clinical-dashboard/use-hide-on-scroll";
import { ColourCodingReferenceContent } from "@/components/reference/colour-coding-reference-content";
import { SourceMethodReferenceContent } from "@/components/reference/source-method-reference-content";
import { colourCodingReferenceHref } from "@/lib/reference-routes";
import { SOURCE_METHOD_ROUTE } from "@/lib/sources/rating-method";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText, floatingControl, commandControl, textMuted } from "@/components/ui-primitives";

const guideAccessibleNameId = "clinical-kb-guide-accessible-name";

const topicIcons: Record<GuideTopicId, LucideIcon> = {
  "getting-started": BookOpen,
  "ask-better-questions": HelpCircle,
  "document-scope": SlidersHorizontal,
  "answer-anatomy": ListChecks,
  "sources-citations": Library,
  "source-rating": Scale,
  "colour-coding": Palette,
  "document-administration": FileSearch,
  "privacy-safe-use": ShieldCheck,
  "keyboard-shortcuts": Grid2X2,
};

const quickTaskIcons: readonly LucideIcon[] = [HelpCircle, SlidersHorizontal, ShieldCheck, LockKeyhole];

/**
 * The guided tour is the ONLY control in the phone dock, so it takes the filled
 * command treatment. The Guide is a system workflow, so its filled action stays
 * neutral graphite rather than inheriting a clinical area accent — the role
 * `differentials-mobile-compare-fab__button` fills
 * on its own surface, not the quiet outlined framing reserved for dock addons
 * (`patient-details-fab__button`, Compare's empty state).
 *
 * That reversed on 2026-08-19. While a search composer shared this dock the tour
 * button WAS an addon, and a filled slab beside the pill put back a smaller
 * version of the opaque cover the dock conversion removed. With the composer
 * gone there is nothing for it to compete with and nothing left to cover: the
 * surface's single call to action should read as one.
 *
 * Only the pill radius and elevation are phone-scoped — from `sm` the footer is
 * a real Sheet band where a square-cornered `commandControl` is correct.
 */
const guideTourAction = cn(commandControl, "max-sm:rounded-full max-sm:shadow-[var(--e3)]");

/** Secondary dock controls stay quiet pills so the primary action keeps the eye. */
const guideSecondaryAction = cn(floatingControl, "max-sm:rounded-full max-sm:shadow-[var(--e3)]");

function GuideTopNavigation({
  view,
  compact,
  onNavigate,
}: {
  view: GuideView;
  compact: boolean;
  onNavigate: (view: GuideView) => void;
}) {
  const items: ReadonlyArray<{ view: GuideView; label: string; icon: LucideIcon }> = [
    { view: "home", label: "Guide home", icon: BookOpen },
    { view: "tour", label: "Guided tour", icon: PlayCircle },
    { view: "topics", label: "All topics", icon: Grid2X2 },
  ];
  return (
    <nav
      aria-label="Guide views"
      className={cn(
        "grid grid-cols-3 border-t border-[color:var(--border)] bg-[color:var(--surface-raised)]",
        compact && "max-sm:-mt-1",
      )}
    >
      {items.map((item) => {
        const active = view === item.view || (view === "topic" && item.view === "topics");
        const Icon = item.icon;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex min-h-tap items-center justify-center gap-1.5 px-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] sm:gap-2 sm:px-2 sm:text-sm",
              active
                ? "text-[color:var(--clinical-accent)] after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-[color:var(--clinical-accent)]"
                : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
            )}
          >
            <Icon aria-hidden="true" className="size-icon-md shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function GuideContents({
  activeTopicId,
  onSelect,
}: {
  activeTopicId?: GuideTopicId;
  onSelect: (id: GuideTopicId) => void;
}) {
  return (
    <nav aria-label="Guide contents" className="space-y-1">
      {guideTopics.map((topic) => {
        const Icon = topicIcons[topic.id];
        const active = activeTopicId === topic.id;
        return (
          <button
            key={topic.id}
            type="button"
            onClick={() => onSelect(topic.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-tap w-full items-center gap-2 rounded-lg border-l-2 px-2.5 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
              active
                ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "border-transparent text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
            )}
          >
            <Icon aria-hidden="true" className="size-icon-md shrink-0" />
            <span>{topic.navLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}

function CompactContents({
  activeTopicId,
  onSelect,
}: {
  activeTopicId?: GuideTopicId;
  onSelect: (id: GuideTopicId) => void;
}) {
  return (
    <details className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] lg:hidden">
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] [&::-webkit-details-marker]:hidden">
        <span>{activeTopicId ? guideTopicById[activeTopicId].navLabel : "Guide contents"}</span>
        <ChevronDown aria-hidden="true" className="size-icon-md" />
      </summary>
      <div className="border-t border-[color:var(--border)] p-2">
        <GuideContents activeTopicId={activeTopicId} onSelect={onSelect} />
      </div>
    </details>
  );
}

function ProgressCard({ progress, onResume }: { progress: GuideProgress; onResume: () => void }) {
  const count = progress.completedStepIds.length;
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 shadow-[var(--shadow-inset)]">
      <p className="text-sm font-semibold text-[color:var(--text-heading)]">Guide progress · {count} of 5</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-subtle)]" aria-hidden="true">
        <div className="h-full bg-[color:var(--clinical-accent)]" style={{ width: `${count * 20}%` }} />
      </div>
      <button
        type="button"
        onClick={onResume}
        className="mt-2 inline-flex min-h-tap items-center gap-1 rounded-md text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        {count === 0 ? "Start learning" : "Continue learning"}
        <ChevronRight aria-hidden="true" className="size-icon-sm" />
      </button>
    </div>
  );
}

function QuickTasks({ onSelect }: { onSelect: (id: GuideTopicId) => void }) {
  return (
    <section aria-labelledby="guide-quick-task-heading" className="space-y-2.5">
      <h2 id="guide-quick-task-heading" className={eyebrowText}>
        What do you need help with?
      </h2>
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        {guideQuickTasks.map((task, index) => {
          const Icon = quickTaskIcons[index];
          return (
            <button
              key={task.topicId}
              type="button"
              onClick={() => onSelect(task.topicId)}
              className={cn(
                floatingControl,
                "min-h-14 min-w-0 justify-start gap-2.5 px-2.5 text-left text-xs sm:px-3 sm:text-sm",
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <Icon aria-hidden="true" className="size-icon-md" />
              </span>
              <span className="leading-4 sm:leading-5">{task.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function VerificationDemo({ onOpenSourceGuide }: { onOpenSourceGuide: () => void }) {
  return (
    <section aria-labelledby="guide-home-heading" className="min-w-0">
      <p className={cn(eyebrowText, "text-[color:var(--clinical-accent)]")}>Essential workflow</p>
      <h2
        id="guide-home-heading"
        data-guide-page-heading
        tabIndex={-1}
        className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--text-heading)] outline-none sm:text-3xl"
      >
        How to verify an answer
      </h2>
      <p className={cn("mt-2 text-sm leading-6 sm:text-base", textMuted)}>
        Follow each claim to the source before using it in practice.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        <ol
          className="relative grid grid-cols-3 gap-2 before:absolute before:left-[16.666%] before:right-[16.666%] before:top-3.5 before:h-px before:bg-[color:var(--clinical-accent-border)] md:grid-cols-1 md:gap-3 md:before:hidden"
          aria-label="Verification steps"
        >
          {["Check the claim", "Open the citation", "Read the source passage"].map((label, index) => (
            <li
              key={label}
              className="relative z-10 flex min-w-0 flex-col items-center gap-2 text-center text-xs font-semibold text-[color:var(--text-heading)] md:flex-row md:items-start md:gap-2.5 md:text-left md:text-sm"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-xs font-bold text-[color:var(--clinical-accent-contrast)] ring-4 ring-[color:var(--surface-raised)]">
                {index + 1}
              </span>
              <span className="max-w-28 leading-4 md:max-w-none md:pt-1 md:leading-5">{label}</span>
            </li>
          ))}
        </ol>

        <article className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--shadow-inset)]">
          <p className={cn(eyebrowText, "text-[color:var(--clinical-accent)]")}>Illustrative answer</p>
          <h3 className="mt-1 text-base font-semibold text-[color:var(--text-heading)]">
            Check each claim, not just the summary
          </h3>
          <div
            className="mt-3 space-y-3 text-sm leading-6 text-[color:var(--text)]"
            aria-label="Neutral illustrative answer"
          >
            <p>
              The answer should state a focused claim and place its citation beside the words it supports{" "}
              <span className="inline-flex rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-1.5 py-0.5 font-mono text-xs font-semibold text-[color:var(--clinical-accent)]">
                [1]
              </span>
              .
            </p>
            <p className="border-l-2 border-[color:var(--clinical-accent)] pl-3 text-[color:var(--text-muted)]">
              Open the citation and compare the source passage with the wording, population, and limits of the claim{" "}
              <span className="inline-flex rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-1.5 py-0.5 font-mono text-xs font-semibold text-[color:var(--clinical-accent)]">
                [2]
              </span>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSourceGuide}
            className="mt-3 inline-flex min-h-tap items-center gap-1 rounded-md text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            Learn about sources
            <ChevronRight aria-hidden="true" className="size-icon-sm" />
          </button>
        </article>
      </div>
    </section>
  );
}

/**
 * Deliberately markerless. Until 2026-08-19 the first three items carried a green
 * tick and the fourth an empty circle — by hardcoded index, with no state behind
 * it — so a static reminder read as live verification progress on a clinical
 * surface. Neutral dots say "checklist" without claiming anything is done.
 */
function SafetyChecklist() {
  const items = [
    "Question is focused",
    "Scope matches the task",
    "Claims link to citations",
    "Primary source confirms meaning",
  ];
  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--shadow-inset)]">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <ShieldCheck aria-hidden="true" className="size-icon-md" />
        </span>
        <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Before you use an answer</h2>
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex min-h-8 items-center gap-2.5 text-sm font-medium text-[color:var(--text-heading)]"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)]"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-lg border border-[color:var(--warning-border)] border-l-2 bg-[color:var(--warning-soft)] px-3 py-2.5 text-xs font-semibold leading-5 text-[color:var(--text-heading)]">
        Keep clinical judgement in the loop.
      </p>
    </section>
  );
}

function ColourCodingCallout({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--shadow-inset)]">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <Palette aria-hidden="true" className="size-icon-md" />
        </span>
        <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Colour coding & badges</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">
        Six tones flag what needs attention across answers, sources, medications, and documents. Meaning drives the
        colour — green is source-backed, not clinically safe.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 inline-flex min-h-tap items-center gap-1 rounded-md text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        Open colour coding guide
        <ChevronRight aria-hidden="true" className="size-icon-sm" />
      </button>
    </section>
  );
}

function TopicArticle({ topic, onOpenColourCodingGuide }: { topic: GuideTopic; onOpenColourCodingGuide?: () => void }) {
  const Icon = topicIcons[topic.id];
  return (
    <article className="mx-auto max-w-[70ch]">
      <p className={cn(eyebrowText, "flex items-center gap-2 text-[color:var(--clinical-accent)]")}>
        <Icon aria-hidden="true" className="size-icon-md" /> Guide topic
      </p>
      <h2
        data-guide-page-heading
        tabIndex={-1}
        className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--text-heading)] outline-none sm:text-3xl"
      >
        {topic.title}
      </h2>
      <p className={cn("mt-2 text-base leading-7", textMuted)}>{topic.summary}</p>
      <div className="mt-6 space-y-6">
        {topic.sections.map((section) => (
          <section key={section.heading}>
            <h3 className="text-lg font-semibold text-[color:var(--text-heading)]">{section.heading}</h3>
            <div className="mt-2 space-y-3 text-sm leading-6 text-[color:var(--text)] sm:text-base sm:leading-7">
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets ? (
                <ul className="space-y-2 pl-0">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2.5">
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-1 size-icon-md shrink-0 text-[color:var(--clinical-accent)]"
                      />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {topic.id === "answer-anatomy" &&
              section.heading === "Read status badges with the answer" &&
              onOpenColourCodingGuide ? (
                <button
                  type="button"
                  onClick={onOpenColourCodingGuide}
                  className="mt-2 inline-flex min-h-tap items-center gap-1 rounded-md text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  Open colour coding guide
                  <ChevronRight aria-hidden="true" className="size-icon-sm" />
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function AllTopics({ onSelect }: { onSelect: (id: GuideTopicId) => void }) {
  return (
    <section>
      <p className={eyebrowText}>Reference guide</p>
      <h2
        data-guide-page-heading
        tabIndex={-1}
        className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--text-heading)] outline-none sm:text-3xl"
      >
        All guide topics
      </h2>
      <p className={cn("mt-2 text-sm leading-6 sm:text-base", textMuted)}>Choose a topic to read in full.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {guideTopics.map((topic) => {
          const Icon = topicIcons[topic.id];
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => onSelect(topic.id)}
              className="group min-h-tap rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 text-left shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--e1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <span className="grid size-9 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <Icon aria-hidden="true" className="size-icon-md" />
              </span>
              <span className="mt-3 block text-base font-semibold text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]">
                {topic.navLabel}
              </span>
              <span className={cn("mt-1 block text-sm leading-6", textMuted)}>{topic.summary}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TourView({
  progress,
  stepIndex,
  complete,
  onReview,
  onRestart,
}: {
  progress: GuideProgress;
  stepIndex: number;
  complete: boolean;
  onReview: () => void;
  onRestart: () => void;
}) {
  if (complete) {
    return (
      <section className="mx-auto max-w-2xl py-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-[color:var(--success-soft)] text-[color:var(--success)]">
          <CheckCircle2 aria-hidden="true" className="size-7" />
        </span>
        <h2
          data-guide-page-heading
          tabIndex={-1}
          className="mt-4 text-2xl font-semibold text-[color:var(--text-heading)] outline-none sm:text-3xl"
        >
          Guided tour complete
        </h2>
        <p className={cn("mx-auto mt-2 max-w-xl text-sm leading-6 sm:text-base", textMuted)}>
          You have covered the complete evidence-first workflow. Return whenever you need a quick refresher; your
          completion stays on this browser only.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onReview} className={commandControl}>
            <PlayCircle aria-hidden="true" className="size-icon-md" /> Review tour
          </button>
          <button type="button" onClick={onRestart} className={floatingControl}>
            <RotateCcw aria-hidden="true" className="size-icon-md" /> Restart guided tour
          </button>
        </div>
      </section>
    );
  }
  const step = guideTourSteps[stepIndex];
  const topic = guideTopicById[step.topicId];
  return (
    <div className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3">
        <p className={eyebrowText}>Your learning path</p>
        <ol className="mt-3 space-y-1">
          {guideTourSteps.map((tourStep, index) => {
            const current = index === stepIndex;
            const done = progress.completedStepIds.includes(tourStep.id);
            return (
              <li
                key={tourStep.id}
                className={cn(
                  "flex min-h-tap items-center gap-2 rounded-lg px-2 text-sm font-semibold",
                  current
                    ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "text-[color:var(--text-muted)]",
                )}
                aria-current={current ? "step" : undefined}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border text-xs",
                    done
                      ? "border-[color:var(--success)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
                      : current
                        ? "border-[color:var(--clinical-accent)]"
                        : "border-[color:var(--border-strong)]",
                  )}
                >
                  {done ? <Check aria-hidden="true" className="size-icon-sm" /> : index + 1}
                </span>
                {tourStep.label}
              </li>
            );
          })}
        </ol>
      </aside>
      <section>
        <p className={cn(eyebrowText, "text-[color:var(--clinical-accent)]")}>Guided tour · Step {stepIndex + 1}</p>
        <h2
          data-guide-page-heading
          tabIndex={-1}
          className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--text-heading)] outline-none sm:text-3xl"
        >
          {step.focusHeading}
        </h2>
        <p className={cn("mt-2 text-base leading-7", textMuted)}>{topic.summary}</p>
        <div className="mt-5 space-y-5">
          {topic.sections.map((section) => (
            <article
              key={section.heading}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--shadow-inset)]"
            >
              <h3 className="text-base font-semibold text-[color:var(--text-heading)]">{section.heading}</h3>
              {section.paragraphs?.slice(0, 1).map((paragraph) => (
                <p key={paragraph} className="mt-2 text-sm leading-6 text-[color:var(--text)]">
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-3 space-y-2">
                  {section.bullets.slice(0, 3).map((bullet) => (
                    <li key={bullet} className="flex gap-2 text-sm leading-6">
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-1 size-icon-md shrink-0 text-[color:var(--clinical-accent)]"
                      />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function GuideDialogSession({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [view, setView] = useState<GuideView>("home");
  const [activeTopicId, setActiveTopicId] = useState<GuideTopicId>("answer-anatomy");
  const [progress, setProgress] = useState<GuideProgress>(() => loadGuideProgress());
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [tourComplete, setTourComplete] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  const contentStartRef = useRef<HTMLDivElement | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const dockScrollHide = useScrollHideReporter(
    false,
    false,
    `${view}:${activeTopicId}:${tourStepIndex}:${tourComplete}`,
  );
  const dockHidden = dockScrollHide.hidden;

  function focusPageStart() {
    window.requestAnimationFrame(() => {
      if (scrollBodyRef.current) scrollBodyRef.current.scrollTop = 0;
      setHeaderCompact(false);
      dockScrollHide.reset();
      contentStartRef.current?.querySelector<HTMLElement>("[data-guide-page-heading]")?.focus({ preventScroll: true });
    });
  }

  /**
   * Only the dock hides, so the only thing hiding releases is this dialog's own
   * dock clearance — hence `reserve-only`, and hence the budget is read straight
   * off `[data-guide-content]` rather than through `readChromeCollapseMetrics`.
   *
   * That helper resolves `universal-header-collapse` against the DOCUMENT, which
   * from inside a fullscreen modal is the shell header sitting behind the dialog
   * and releasing nothing. Charging it — plus this dialog's own 153px header,
   * back when that collapsed too — made the budget larger than some guide pages'
   * entire scroll range, and `collapseHasSafeRunway` then correctly refused every
   * hide. Shortening these pages is what exposed it.
   */
  function handleBodyScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    setHeaderCompact((compact) => (compact ? target.scrollTop > 8 : target.scrollTop > 48));
    const reserve = contentStartRef.current;
    // `data-reserve-hidden-pad="0"`: the pad collapses to nothing, so the whole
    // padding is what a hide gives back.
    const reserveRelease = reserve ? Number.parseFloat(window.getComputedStyle(reserve).paddingBottom) || 0 : 0;
    dockScrollHide.reportScroll({
      offset: target.scrollTop,
      maxOffset: Math.max(0, target.scrollHeight - target.clientHeight),
      collapseBudget: reserveRelease,
      collapseKind: "reserve-only",
      combinedChrome: false,
      source: target,
    });
  }

  function navigate(nextView: GuideView) {
    if (nextView === "tour") {
      const complete = progress.completedStepIds.length === guideTourSteps.length;
      setTourComplete(complete);
      const nextId = firstIncompleteGuideStep(progress);
      setTourStepIndex(
        Math.max(
          0,
          guideTourSteps.findIndex((step) => step.id === nextId),
        ),
      );
    }
    setView(nextView);
    focusPageStart();
  }

  function openTopic(topicId: GuideTopicId) {
    setActiveTopicId(topicId);
    setView("topic");
    focusPageStart();
  }

  function openFullColourCodingReference() {
    onClose();
    router.push(colourCodingReferenceHref());
  }

  function openFullSourceMethodPage() {
    onClose();
    router.push(SOURCE_METHOD_ROUTE);
  }

  function restartTour() {
    clearGuideProgress();
    setProgress(emptyGuideProgress);
    setTourStepIndex(0);
    setTourComplete(false);
    setView("tour");
    focusPageStart();
  }

  function continueTour() {
    const step = guideTourSteps[tourStepIndex];
    const nextProgress = completeGuideStep(progress, step.id);
    setProgress(nextProgress);
    saveGuideProgress(nextProgress);
    if (tourStepIndex === guideTourSteps.length - 1) {
      setTourComplete(true);
    } else {
      setTourStepIndex((index) => index + 1);
    }
    focusPageStart();
  }

  const tourPrimaryLabel =
    progress.completedStepIds.length === 0
      ? "Start guided tour"
      : progress.completedStepIds.length === guideTourSteps.length
        ? "Review guided tour"
        : "Resume guided tour";
  const footer = (
    <>
      {/* The guide keeps the shared dock geometry, but its dedicated modifier
          carries the tint through the Home Indicator region. Meaningful content
          remains above the inset while the background paints behind it. */}
      <div className="answer-footer-search-backdrop sm:hidden" aria-hidden="true" />
      <div
        data-guide-mobile-footer
        aria-hidden={dockHidden}
        inert={dockHidden || undefined}
        className="relative z-10 mx-auto grid w-full max-w-3xl min-w-0 gap-2"
      >
        <div data-guide-tour-action-row className="flex min-w-0 items-center justify-center gap-2">
          {view === "tour" && !tourComplete ? (
            <>
              <button
                type="button"
                tabIndex={dockHidden ? -1 : undefined}
                onClick={() => {
                  setTourStepIndex((index) => Math.max(0, index - 1));
                  focusPageStart();
                }}
                disabled={tourStepIndex === 0}
                className={cn(guideSecondaryAction, "px-3")}
              >
                <ChevronLeft aria-hidden="true" className="size-icon-md" /> Previous
              </button>
              <button
                type="button"
                tabIndex={dockHidden ? -1 : undefined}
                onClick={() => navigate("home")}
                className="hidden min-h-tap rounded-lg px-3 text-sm font-semibold text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:inline-flex sm:items-center"
              >
                Exit tour
              </button>
              <button
                type="button"
                tabIndex={dockHidden ? -1 : undefined}
                onClick={continueTour}
                className={cn(guideTourAction, "px-3 sm:px-5")}
              >
                {tourStepIndex === guideTourSteps.length - 1 ? "Complete tour" : "Continue"}
                <ChevronRight aria-hidden="true" className="size-icon-md" />
              </button>
            </>
          ) : view === "tour" && tourComplete ? (
            <button
              type="button"
              tabIndex={dockHidden ? -1 : undefined}
              onClick={() => navigate("home")}
              className={guideTourAction}
            >
              Return to Guide home
            </button>
          ) : (
            <button
              type="button"
              tabIndex={dockHidden ? -1 : undefined}
              onClick={() => navigate("tour")}
              className={cn(guideTourAction, "px-3 sm:px-5")}
            >
              <PlayCircle aria-hidden="true" className="size-icon-md" />
              {tourPrimaryLabel}
            </button>
          )}
        </div>
        <p className={cn("hidden items-center justify-center gap-2 text-xs sm:flex", textMuted)}>
          <ShieldCheck aria-hidden="true" className="size-icon-md shrink-0" /> Demo content only · Do not enter PHI
        </p>
      </div>
    </>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      labelledBy={guideAccessibleNameId}
      title="PsychSift Guide Centre"
      descriptionContent={
        <p className={cn("text-sm leading-6 text-[color:var(--text-muted)]", headerCompact && "max-sm:sr-only")}>
          Learn how to ask, scope, and verify.
        </p>
      }
      closeLabel="Close guide"
      headerLeading={
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
            headerCompact && "max-sm:size-8 max-sm:rounded-lg",
          )}
        >
          <BookOpen aria-hidden="true" className={cn("size-6", headerCompact && "max-sm:size-4")} />
        </span>
      }
      contentClassName="relative font-sans sm:max-w-none lg:h-[min(56rem,calc(100dvh-3rem))] lg:max-w-[min(94vw,90rem)]"
      bodyClassName="p-0 sm:p-0"
      bodyRef={scrollBodyRef}
      bodyTabIndex={0}
      onBodyScroll={handleBodyScroll}
      headerBottom={<GuideTopNavigation view={view} compact={headerCompact} onNavigate={navigate} />}
      // The branded row compacts on phones, but the title, Close control and
      // view tabs remain available. Collapsing the whole header previously left
      // a scrolled reader with no exit and consumed too much collapse runway.
      headerClassName={cn(
        "guide-centre-header pt-[max(1rem,env(safe-area-inset-top))] transition-[border-color,background-color] duration-[var(--duration-quick)] motion-reduce:transition-none sm:pt-5",
        headerCompact &&
          "guide-centre-header--compact max-sm:px-3 max-sm:pb-2 max-sm:pt-[max(0.5rem,var(--safe-area-top))] max-sm:bg-[color:var(--surface-chrome)]",
      )}
      titleClassName={cn(headerCompact && "max-sm:text-base max-sm:leading-5")}
      mobilePlacement="fullscreen"
      footer={footer}
      footerVariant="compact"
      footerClassName={cn(
        // Phones use the SHARED edge-to-edge dock chrome, not a Sheet footer band:
        // `.answer-footer-search-dock.answer-footer-search-edge` (globals.css) owns
        // the flush left/right/bottom geometry, the safe-area padding and the
        // transparent background, exactly as every other phone composer does. The
        // border/surface/elevation below are therefore sm+ only — on phones they
        // painted an opaque slab across the content behind the action. The dock
        // takes the COMPACT scrim: since the search composer was removed the dock
        // is a single action row, and the default 10rem scrim would tint far more
        // of the page than the control it exists to seat.
        "guide-tour-dock answer-footer-search-dock answer-footer-search-edge",
        "absolute inset-x-0 bottom-0 z-30 border-t-0 bg-transparent p-0 shadow-none transition-[transform,opacity] duration-[var(--duration-moderate)] motion-reduce:transition-none sm:static sm:border-t sm:border-[color:var(--border)] sm:bg-[color:var(--surface-raised)] sm:p-4",
        dockHidden &&
          "pointer-events-none translate-y-full opacity-0 sm:pointer-events-auto sm:translate-y-0 sm:opacity-100",
      )}
      testId="clinical-kb-guide-centre"
      closeButtonClassName="grid size-tap shrink-0 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] text-[color:var(--text-muted)] transition hover:bg-[color:var(--clinical-accent-soft)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
    >
      <span id={guideAccessibleNameId} className="sr-only">
        PsychSift guide
      </span>
      <div
        ref={contentStartRef}
        data-guide-content
        data-reserve-owner="guide-tour-dock"
        data-reserve-hidden-pad="0"
        className={cn(
          "space-y-5 p-3 sm:p-5",
          dockHidden ? "pb-0 sm:pb-5" : "pb-[calc(5rem+var(--safe-area-bottom))] sm:pb-5",
        )}
      >
        {view === "home" ? (
          <>
            <QuickTasks onSelect={openTopic} />
            <div className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)_19rem]">
              <aside className="hidden space-y-4 lg:block">
                <p className={eyebrowText}>Guide contents</p>
                <GuideContents activeTopicId="answer-anatomy" onSelect={openTopic} />
                <ProgressCard progress={progress} onResume={() => navigate("tour")} />
              </aside>
              <VerificationDemo onOpenSourceGuide={() => openTopic("sources-citations")} />
              <aside className="grid content-start gap-3">
                <SafetyChecklist />
                <ColourCodingCallout onOpen={() => openTopic("colour-coding")} />
              </aside>
            </div>
          </>
        ) : null}
        {view === "topics" ? <AllTopics onSelect={openTopic} /> : null}
        {view === "topic" ? (
          <div className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <p className={cn(eyebrowText, "mb-2")}>Guide contents</p>
              <GuideContents activeTopicId={activeTopicId} onSelect={openTopic} />
            </aside>
            <div className="space-y-4">
              <CompactContents activeTopicId={activeTopicId} onSelect={openTopic} />
              {activeTopicId === "colour-coding" ? (
                <div className="mx-auto max-w-[70ch]">
                  <ColourCodingReferenceContent variant="guide" onOpenFullReference={openFullColourCodingReference} />
                </div>
              ) : activeTopicId === "source-rating" ? (
                // The published rating method, rendered from the same component
                // `/sources/method` uses, so the guide cannot describe a method
                // the catalogue no longer applies. Wider than the 70ch reading
                // column: the weight bars and the band scale are tables, not prose.
                <SourceMethodReferenceContent variant="guide" onOpenFullPage={openFullSourceMethodPage} />
              ) : (
                <TopicArticle
                  topic={guideTopicById[activeTopicId]}
                  onOpenColourCodingGuide={() => openTopic("colour-coding")}
                />
              )}
            </div>
          </div>
        ) : null}
        {view === "tour" ? (
          <TourView
            progress={progress}
            stepIndex={tourStepIndex}
            complete={tourComplete}
            onReview={() => {
              setTourComplete(false);
              setTourStepIndex(0);
              focusPageStart();
            }}
            onRestart={restartTour}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

export function GuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <GuideDialogSession onClose={onClose} /> : null;
}
