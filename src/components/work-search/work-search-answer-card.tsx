"use client";

import {
  Award,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  Check,
  Database,
  Info,
  Moon,
  Phone,
  Presentation,
  RotateCcw,
  Sunset,
  TreePalm,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/components/ui-primitives";
import { cardSurface, focusRing, onPlainClick, ResultRow } from "@/components/work-search/work-search-parts";
import type { WorkAnswer, WorkAnswerIcon, WorkAnswerProgress } from "@/lib/work-search/answers";

const ANSWER_ICONS: Readonly<Record<WorkAnswerIcon, LucideIcon>> = {
  night: Moon,
  evening: Sunset,
  shift: CalendarDays,
  "on-call": Phone,
  due: CalendarCheck,
  leave: TreePalm,
  presenting: Presentation,
  cpd: Award,
  free: CalendarOff,
};

/** Bar widths in tenths, listed whole so the stylesheet keeps every one. The tick and words carry the state. */
const BAR_WIDTHS = [
  "w-0",
  "w-[10%]",
  "w-[20%]",
  "w-[30%]",
  "w-[40%]",
  "w-1/2",
  "w-[60%]",
  "w-[70%]",
  "w-[80%]",
  "w-[90%]",
  "w-full",
] as const;

function ProgressRows({ rows }: { rows: readonly WorkAnswerProgress[] }) {
  return (
    <ul className="grid gap-2.5">
      {rows.map((row) => (
        <li key={row.label} className="grid gap-1">
          <div className="flex items-start justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-start gap-1.5 font-semibold leading-snug text-[color:var(--text-heading)]">
              {row.met ? (
                <Check aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0 text-[color:var(--success)]" />
              ) : null}
              <span>{row.label}</span>
            </span>
            <span
              className={cn(
                "max-w-[45%] shrink-0 text-right text-xs leading-snug",
                row.met ? "text-[color:var(--text-muted)]" : "font-bold text-[color:var(--text-heading)]",
              )}
            >
              {row.summary}
            </span>
          </div>
          {row.fraction !== null ? (
            <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-inset)]">
              <span
                className={cn(
                  "block h-full rounded-full bg-[color:var(--mode-identity)]",
                  BAR_WIDTHS[Math.min(10, Math.max(1, Math.round(row.fraction * 10)))],
                )}
              />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
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
      {answer.loading ? null : (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Retry: ${answer.headline}`}
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
  const Icon = ANSWER_ICONS[answer.icon];
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
              : "border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)]",
          )}
        >
          <Icon aria-hidden="true" className="size-icon-sm" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-2xs font-extrabold uppercase tracking-widest",
            identity ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
          )}
        >
          {answer.label}
        </span>
        <span className="shrink-0 text-xs font-semibold text-[color:var(--text-muted)]">From your records</span>
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
      {answer.progress && answer.progress.length > 0 ? <ProgressRows rows={answer.progress} /> : null}
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
          onClick={onPlainClick(onOpen)}
          data-work-search-primary=""
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
