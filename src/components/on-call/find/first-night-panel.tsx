"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { focusRing } from "@/components/card-recipes";
import { OnCallTrackBar } from "@/components/on-call/kit/track-bar";
import { onCallActionLink } from "@/components/on-call/kit/calm";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { onCallChecklistItemKey, useOnCallChecklists } from "@/lib/on-call/checklist-storage";
import {
  ON_CALL_FIRST_NIGHT_STAGES,
  onCallFirstNightEntryId,
  onCallFirstNightProgress,
  type OnCallFirstNightStage,
} from "@/lib/on-call/first-night";
type StageId = OnCallFirstNightStage["id"];
/** How many prompts a stage shows here before "N more · Open". */
const SHOWN = 3;
const RING_RADIUS = 20;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
function ProgressRing({ done, total }: { readonly done: number; readonly total: number }) {
  const fraction = total > 0 ? done / total : 0;
  return (
    <span
      role="img"
      aria-label={`${done} of ${total} ticked`}
      className="relative grid size-12 shrink-0 place-items-center"
      data-testid="on-call-find-first-night-ring"
    >
      <svg viewBox="0 0 48 48" aria-hidden="true" className="absolute inset-0 size-12 -rotate-90">
        <circle
          cx="24"
          cy="24"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          className="stroke-[color:var(--surface-wash)]"
        />
        <circle
          cx="24"
          cy="24"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - fraction)}
          className="stroke-[color:var(--mode-identity)] forced-colors:stroke-[CanvasText]"
        />
      </svg>
      <span aria-hidden="true" className="nums relative text-sm font-semibold text-[color:var(--text-heading)]">
        {`${done}/${total}`}
      </span>
    </span>
  );
}
/**
 * Handbook's First night panel (mock-up v10 s-4): one quiet panel with a small
 * progress ring, a three-stage switch and the chosen stage's first prompts.
 *
 * Read-only. The stages and prompts are the First night page's own
 * (`src/lib/on-call/first-night.ts`), and the ticks are the reader's, kept on
 * this device (`checklist-storage.ts`); this panel only counts them and shows
 * which are done. Ticking happens on the First night page, one tap away, so
 * there is one place a tick is made. The induction manuals' own checklists are
 * not counted: they belong to the reader's Orientation shelf.
 */
export function OnCallFirstNightPanel({ id, testId }: { readonly id?: string; readonly testId?: string }) {
  const done = useOnCallChecklists();
  const headingId = useId();
  const progress = onCallFirstNightProgress(done);
  const stages = ON_CALL_FIRST_NIGHT_STAGES.map((stage) => {
    const prompts = stage.prompts.map((prompt) => ({
      text: prompt.text,
      done: done.has(onCallChecklistItemKey(onCallFirstNightEntryId(stage.id), prompt.text)),
    }));
    return { ...stage, prompts, done: prompts.filter((prompt) => prompt.done).length };
  });
  const total = progress.total;
  const ticked = progress.done;
  const firstOpen = stages.find((stage) => stage.done < stage.prompts.length)?.id ?? stages[0].id;
  const [picked, setPicked] = useState<StageId | null>(null);
  const current = stages.find((stage) => stage.id === (picked ?? firstOpen)) ?? stages[0];
  const more = current.prompts.length - SHOWN;
  return (
    <section id={id} aria-labelledby={headingId} className="grid min-w-0 scroll-mt-32 gap-2" data-testid={testId}>
      <div className="flex min-w-0 items-center gap-3 px-3">
        <ProgressRing done={ticked} total={total} />
        <div className="grid min-w-0 gap-0.5">
          <p className={eyebrowText}>First night</p>
          <h2 id={headingId} className="break-words text-lg-minus font-semibold text-[color:var(--text-heading)]">
            Sort these in daylight
          </h2>
        </div>
      </div>
      <div role="group" aria-label="Stage" className="grid min-w-0 grid-cols-3 gap-2 px-3">
        {stages.map((stage) => {
          const active = stage.id === current.id;
          const fill = stage.prompts.length > 0 ? (stage.done / stage.prompts.length) * 100 : 0;
          return (
            <button
              key={stage.id}
              type="button"
              aria-pressed={active}
              onClick={() => setPicked(stage.id)}
              data-testid={`on-call-find-first-night-stage-${stage.id}`}
              className={cn(focusRing, "grid min-h-12 min-w-0 content-center gap-1.5 rounded-sm text-left")}
            >
              <OnCallTrackBar percent={fill} />
              <span
                className={cn(
                  "break-words text-xs",
                  active
                    ? "font-semibold text-[color:var(--text-heading)]"
                    : "font-medium text-[color:var(--text-muted)]",
                )}
              >
                {stage.shortTitle}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-h-12 min-w-0 items-center justify-between gap-3 px-3">
          <h3 className={eyebrowText}>{current.title}</h3>
          <span className="nums text-sm font-semibold text-[color:var(--mode-identity)]">
            {`${current.done} of ${current.prompts.length}`}
          </span>
        </div>
        <ul role="list" className="grid min-w-0 gap-1 px-3" data-testid="on-call-find-first-night-prompts">
          {current.prompts.slice(0, SHOWN).map((prompt) => (
            <li key={prompt.text} className="flex min-h-12 min-w-0 items-start gap-3 py-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border forced-colors:border",
                  prompt.done
                    ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
                    : "border-[color:var(--border-strong)]",
                )}
              >
                {prompt.done ? <Check aria-hidden="true" className="size-icon-xs" /> : null}
              </span>
              <span className="min-w-0 break-words text-sm text-[color:var(--text-heading)]">
                {prompt.text}
                <span className="sr-only">{prompt.done ? ", ticked" : ", not ticked"}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 items-center justify-between gap-3 px-3">
          <span className={cn(modeSecondaryText, "min-w-0 break-words")}>
            {more > 0 ? `${more} more` : "Ticks stay on this phone"}
          </span>
          {/* A literal next/link href: route-reachability counts only those. */}
          <Link
            href="/on-call/first-night"
            aria-label="Open First night"
            data-testid="on-call-find-first-night-open"
            className={cn(onCallActionLink, focusRing)}
          >
            Open
          </Link>
        </div>
      </div>
    </section>
  );
}
