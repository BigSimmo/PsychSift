"use client";

import {
  Award,
  CalendarCheck,
  Database,
  Info,
  Moon,
  Presentation,
  RotateCcw,
  Sparkles,
  TreePalm,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { createElement } from "react";

import { cn } from "@/components/ui-primitives";
import { AREA_ICONS, cardSurface, focusRing, ResultRow } from "@/components/work-search/work-search-parts";
import type { WorkAnswer } from "@/lib/work-search/answers";

function answerIcon(answer: WorkAnswer): LucideIcon {
  const label = answer.label.toLowerCase();
  if (label.includes("night") || label.includes("evening")) return Moon;
  if (label.startsWith("due")) return CalendarCheck;
  if (label.includes("leave")) return TreePalm;
  if (label.includes("presenting")) return Presentation;
  if (answer.area === "cme") return Award;
  return answer.area === "all" ? CalendarCheck : AREA_ICONS[answer.area];
}

function AnswerIcon({ answer }: { answer: WorkAnswer }) {
  return createElement(answerIcon(answer), { "aria-hidden": true, className: "size-icon-sm" });
}

/** When an area the question needs has not loaded: say so, never "nothing". */
function UnavailableCard({ answer, onRetry }: { answer: WorkAnswer; onRetry: () => void }) {
  return (
    <section
      aria-label={answer.label}
      data-testid="work-search-answer"
      className={cn(cardSurface, "flex items-start gap-3 p-3.5")}
    >
      <Info aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[color:var(--text-heading)]">{answer.label}</p>
        <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{answer.headline}</p>
      </div>
      {answer.headline.startsWith("Still loading") ? null : (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "inline-flex min-h-12 shrink-0 items-center gap-1.5 self-center rounded-full px-3 text-xs font-bold text-[color:var(--text-heading)]",
            focusRing,
          )}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border-strong)] px-3 py-1.5">
            <RotateCcw aria-hidden="true" className="size-icon-xs" />
            Retry
          </span>
        </button>
      )}
    </section>
  );
}

/** A built-in answer, worked out on the device from the reader's own records. */
export function AnswerCard({
  answer,
  today,
  onOpen,
  onRetry,
}: {
  answer: WorkAnswer;
  today: string;
  onOpen: () => void;
  onRetry: () => void;
}) {
  if (answer.unavailable) return <UnavailableCard answer={answer} onRetry={onRetry} />;
  const identity = answer.area === "all" ? undefined : answer.area;
  const longMeta = answer.meta.some((line) => line.length > 28);
  return (
    <section
      aria-label={answer.label}
      data-mode-identity={identity}
      data-testid="work-search-answer"
      className={cn(cardSurface, "grid gap-3 p-4")}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            identity
              ? "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
              : "bg-[color:var(--surface-inset)] text-[color:var(--text-heading)]",
          )}
        >
          <AnswerIcon answer={answer} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-2xs font-extrabold uppercase tracking-widest",
            identity ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
          )}
        >
          {answer.label}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[color:var(--text-muted)]">
          <Sparkles aria-hidden="true" className="size-icon-xs" />
          Answer
        </span>
      </div>
      <div>
        <p className="text-2xl font-extrabold leading-tight tracking-tight text-[color:var(--text-heading)]">
          {answer.headline}
        </p>
        {answer.sub ? <p className="mt-1 text-sm text-[color:var(--text-muted)]">{answer.sub}</p> : null}
      </div>
      {longMeta ? (
        <ul className="divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
          {answer.meta.map((line) => (
            <li key={line} className="py-2 text-sm text-[color:var(--text)]">
              {line}
            </li>
          ))}
        </ul>
      ) : answer.meta.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {answer.meta.map((line) => (
            <li
              key={line}
              className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[color:var(--text-muted)]"
            >
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {answer.area === "all" && answer.items.length > 0 ? (
        <ul className="-mx-1 divide-y divide-[color:var(--border)]">
          {answer.items.map((item) => (
            <ResultRow key={item.id} item={item} today={today} withAreaInDetail compact onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
      {answer.action ? (
        <Link
          href={answer.action.href}
          onClick={onOpen}
          className={cn(
            "inline-flex min-h-12 items-center justify-center rounded-full bg-[color:var(--mode-identity)] px-5 text-sm font-bold text-[color:var(--mode-identity-contrast)]",
            focusRing,
          )}
        >
          {answer.action.label}
        </Link>
      ) : null}
      <p className="flex items-center gap-2 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
        <Database aria-hidden="true" className="size-icon-xs shrink-0" />
        <span className="min-w-0 flex-1">{answer.source}</span>
      </p>
    </section>
  );
}
