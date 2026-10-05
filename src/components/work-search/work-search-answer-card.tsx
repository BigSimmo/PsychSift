"use client";

import {
  Award,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  CalendarPlus,
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
import { useState } from "react";

import { cn } from "@/components/ui-primitives";
import { cardSurface, focusRing, onPlainClick, ResultRow } from "@/components/work-search/work-search-parts";
import { downloadTextFile } from "@/lib/admin/download-file";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import { perthTimeOf } from "@/lib/perth-time";
import type { WorkAnswer, WorkAnswerDay, WorkAnswerIcon, WorkAnswerProgress } from "@/lib/work-search/answers";
import type { WorkItem } from "@/lib/work-search/model";

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
    <ul className="grid gap-3">
      {rows.map((row) => (
        <li key={row.label} className="grid gap-1.5">
          <div className="flex items-start justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-start gap-1.5 leading-snug text-[color:var(--text-heading)]">
              {row.met ? (
                <Check aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0 text-[color:var(--success)]" />
              ) : null}
              <span>{row.label}</span>
            </span>
            <span
              className={cn(
                "max-w-[45%] shrink-0 text-right text-sm leading-snug tabular-nums",
                row.met ? "text-[color:var(--text-muted)]" : "font-semibold text-[color:var(--text-heading)]",
              )}
            >
              {row.summary}
            </span>
          </div>
          {row.fraction !== null ? (
            <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-[color:var(--surface-inset)]">
              <span
                className={cn(
                  "block h-full rounded-full bg-[color:var(--mode-identity)]",
                  BAR_WIDTHS[Math.min(10, Math.max(row.fraction > 0 ? 1 : 0, Math.round(row.fraction * 10)))],
                )}
              />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** CPD: the targets still short, with the met ones folded away until asked for. */
function CpdProgress({ rows }: { rows: readonly WorkAnswerProgress[] }) {
  const [all, setAll] = useState(false);
  const short = rows.filter((row) => !row.met);
  const shown = all || short.length === 0 ? rows : short;
  const foldable = short.length > 0 && short.length < rows.length;
  return (
    <div className="grid justify-items-start gap-3">
      <div className="w-full">
        <ProgressRows rows={shown} />
      </div>
      {foldable ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((value) => !value)}
          className={cn("-my-3 min-h-12 text-sm font-semibold text-[color:var(--text-heading)]", focusRing)}
        >
          {all ? "Show only targets still short" : `Show all ${rows.length} targets`}
        </button>
      ) : null}
    </div>
  );
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Monday to Sunday, the free days shaded in the area's colour; the rest drawn as dashed outlines. */
function WeekStrip({ days, label }: { days: readonly WorkAnswerDay[]; label: string }) {
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label={label}>
      {days.map((day) => {
        const date = new Date(`${day.date}T00:00:00Z`);
        const weekday = WEEKDAY_SHORT[date.getUTCDay()];
        const free = day.free && day.inRange;
        return (
          <li key={day.date} className="grid justify-items-center gap-1.5">
            <span className="text-2xs font-semibold text-[color:var(--text-muted)]">{weekday}</span>
            <span
              className={cn(
                "grid size-8 place-items-center rounded-full text-xs tabular-nums",
                free
                  ? "border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] font-semibold text-[color:var(--mode-identity)]"
                  : "border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]",
                !day.inRange && "border-[color:var(--border)]",
              )}
            >
              {date.getUTCDate()}
              <span className="sr-only">
                {free ? ", no rostered shift" : day.inRange ? ", rostered" : ", not asked about"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A calendar file for one shift, made on the device and handed over as a download. Nothing is sent. */
function addShiftToCalendar(item: WorkItem) {
  if (!item.startsAt || !item.endsAt || !item.date) return;
  const minutes = Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000);
  const location = item.detail?.split(" · ").slice(2).join(" · ") || undefined;
  const file = toIcs([
    {
      id: item.id,
      title: item.title,
      date: item.date,
      startTime: perthTimeOf(item.startsAt),
      durationMinutes: minutes,
      kind: "other",
      ...(location ? { location } : {}),
    },
  ]);
  downloadTextFile(file, icsFileName(item.title), "text/calendar;charset=utf-8");
}

const outlineButton =
  "inline-flex min-h-12 shrink-0 items-center gap-1.5 self-center rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-3.5 text-sm font-semibold text-[color:var(--text-heading)]";

/** When an area the question needs has not loaded: say so, never "nothing". */
function UnavailableCard({ answer, onRetry }: { answer: WorkAnswer; onRetry: () => void }) {
  return (
    <section
      aria-label={answer.label}
      data-testid="work-search-answer"
      className={cn(cardSurface, "flex items-start gap-3 p-4")}
    >
      <Info
        aria-hidden="true"
        className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]"
        strokeWidth={1.6}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[color:var(--text-heading)]">{answer.label}</p>
        <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">{answer.headline}</p>
      </div>
      {answer.loading ? null : (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Retry: ${answer.headline}`}
          className={cn(outlineButton, focusRing)}
        >
          <RotateCcw aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />
          Retry
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
  const Icon = ANSWER_ICONS[answer.icon];
  const calendar = answer.calendar;
  return (
    <section
      aria-label={answer.label}
      data-mode-identity={identity}
      data-testid="work-search-answer"
      className={cn(cardSurface, "grid grid-cols-[minmax(0,1fr)] gap-3 p-4")}
    >
      <p
        className={cn(
          "flex min-w-0 items-center gap-2 text-2xs font-semibold uppercase tracking-widest",
          identity ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
        )}
      >
        <Icon aria-hidden="true" className="size-icon-sm shrink-0" strokeWidth={1.6} />
        <span className="truncate">{answer.label}</span>
      </p>
      <div className="grid gap-1">
        <p className="text-xl font-semibold leading-tight tracking-tight text-[color:var(--text-heading)]">
          {answer.headline}
        </p>
        {answer.sub ? <p className="text-sm text-[color:var(--text-muted)]">{answer.sub}</p> : null}
        {answer.meta.length > 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">{answer.meta.join(" · ")}</p>
        ) : null}
      </div>
      {answer.week ? <WeekStrip days={answer.week} label={answer.label} /> : null}
      {answer.note ? <p className="text-sm text-[color:var(--text-muted)]">{answer.note}</p> : null}
      {answer.progress && answer.progress.length > 0 ? <CpdProgress rows={answer.progress} /> : null}
      {answer.area === "all" && answer.items.length > 0 ? (
        <ul className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
          {answer.items.map((item) => (
            <ResultRow key={item.id} item={item} today={today} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
      {answer.action || calendar ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {answer.action ? (
            <Link
              href={answer.action.href}
              onClick={onPlainClick(onOpen)}
              data-work-search-primary=""
              className={cn(
                "inline-flex min-h-12 items-center justify-center rounded-md bg-[color:var(--mode-identity)] px-4 text-sm font-semibold text-[color:var(--mode-identity-contrast)]",
                focusRing,
              )}
            >
              {answer.action.label}
            </Link>
          ) : null}
          {calendar ? (
            <button
              type="button"
              onClick={() => addShiftToCalendar(calendar)}
              className={cn(
                "inline-flex min-h-12 items-center gap-1.5 text-sm font-medium text-[color:var(--mode-identity)]",
                focusRing,
              )}
            >
              <CalendarPlus aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />
              Add to calendar
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="flex items-start gap-2 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
        <Database aria-hidden="true" className="mt-px size-icon-xs shrink-0" strokeWidth={1.6} />
        <span className="min-w-0 flex-1">{answer.source}</span>
      </p>
    </section>
  );
}
