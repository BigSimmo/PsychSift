"use client";

import {
  Award,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  CalendarPlus,
  Check,
  Moon,
  Phone,
  Plane,
  Presentation,
  RotateCcw,
  Sunset,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type KeyboardEvent } from "react";

import { WorkRing } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { AREA_ICONS, onPlainClick, ResultRow } from "@/components/work-search/work-search-parts";
import { downloadTextFile } from "@/lib/admin/download-file";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import { perthTimeOf } from "@/lib/perth-time";
import type { WorkAnswer, WorkAnswerDay, WorkAnswerIcon, WorkAnswerProgress } from "@/lib/work-search/answers";
import type { WorkItem } from "@/lib/work-search/model";
import { guardExampleAction, isExampleRecord } from "@/lib/example-data/guards";

/**
 * A built-in answer, worked out on the device from the reader's own records,
 * drawn as the mockup's answer hero (work-mode redesign, owner request 6 Oct
 * 2026): one mode-colour card with a date tile or ring, the headline, a pill
 * line and two buttons, then the source line in the open beneath it. "What is
 * due" and "Days off" are white cards instead, because they list rather than
 * answer. One hero per screen at most, flat, no glow.
 */

const ANSWER_ICONS: Readonly<Record<WorkAnswerIcon, LucideIcon>> = {
  night: Moon,
  evening: Sunset,
  shift: CalendarDays,
  "on-call": Phone,
  due: CalendarCheck,
  leave: Plane,
  presenting: Presentation,
  cpd: Award,
  free: CalendarOff,
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Bar widths in twentieths, listed whole so the stylesheet keeps every one. The words carry the state. */
const BAR_WIDTHS = [
  "w-0",
  "w-[5%]",
  "w-[10%]",
  "w-[15%]",
  "w-1/5",
  "w-1/4",
  "w-[30%]",
  "w-[35%]",
  "w-2/5",
  "w-[45%]",
  "w-1/2",
  "w-[55%]",
  "w-3/5",
  "w-[65%]",
  "w-[70%]",
  "w-3/4",
  "w-4/5",
  "w-[85%]",
  "w-[90%]",
  "w-[95%]",
  "w-full",
] as const;

function barWidth(fraction: number): string {
  return BAR_WIDTHS[Math.min(20, Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * 20)))] as string;
}

/** A calendar file for one timed record, made on the device and handed over as a download. Nothing is sent. */
function addToCalendar(item: WorkItem) {
  // An example record never leaves the app.
  if (isExampleRecord(item) && !guardExampleAction(true, "export")) return;
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

/** The source line under every answer: where it came from, in the area's colour. Never hidden. */
export function AnswerSource({ answer }: { answer: WorkAnswer }) {
  const Icon = answer.area === "all" ? CalendarCheck : AREA_ICONS[answer.area];
  return (
    <p
      data-mode-identity={answer.area === "all" ? "my-work" : answer.area}
      className="m-0 flex items-start gap-1.5 px-1 text-2xs font-semibold leading-snug text-[color:var(--mode-identity)]"
    >
      <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2} />
      <span className="min-w-0 flex-1">{answer.source}</span>
    </p>
  );
}

/** The hero's buttons: a white filled one and a see-through one, 48px taps with 36px shapes. */
const tap = "group inline-flex min-h-12 min-w-0 items-center focus-visible:outline-none";
const face =
  "inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-bold group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[color:var(--focus)] forced-colors:outline-1 forced-colors:outline-[ButtonBorder]";
const heroFaceSolid = cn(face, "bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)]");
const heroFaceGhost = cn(
  face,
  "bg-[color:color-mix(in_srgb,currentColor_14%,transparent)] ring-1 ring-inset ring-[color:color-mix(in_srgb,currentColor_22%,transparent)]",
);

/** The big glass date tile in the hero: month over day. */
function HeroDate({ date }: { date: string }) {
  const day = new Date(`${date}T00:00:00Z`);
  return (
    <span
      aria-hidden="true"
      className="grid h-15 w-14 shrink-0 content-center justify-items-center rounded-2xl bg-[color:color-mix(in_srgb,currentColor_16%,transparent)] leading-none tabular-nums ring-1 ring-inset ring-[color:color-mix(in_srgb,currentColor_22%,transparent)]"
    >
      <span className="mb-1 text-3xs font-bold uppercase tracking-widest">{MONTH_SHORT[day.getUTCMonth()]}</span>
      <span className="text-2xl font-bold tracking-tight">{day.getUTCDate()}</span>
    </span>
  );
}

/** "Ward 4 · then Tue 6 Oct, 21:00": the sub line, with what comes next lifted into the pill. */
function splitThen(sub: string | null): { sub: string | null; then: string | null } {
  if (!sub) return { sub, then: null };
  const index = sub.indexOf(" · then ");
  if (index === -1) return { sub, then: null };
  const then = sub.slice(index + " · then ".length);
  return { sub: sub.slice(0, index), then: `Then ${then}` };
}

function AnswerHero({ answer, onOpen }: { answer: WorkAnswer; onOpen: () => void }) {
  const identity = answer.area === "all" ? "my-work" : answer.area;
  const { sub, then } = splitThen(answer.sub);
  // The ring's figure carries the first CPD line ("17.5 h to go"), so the lines below it are the rest.
  const lines = answer.ring ? answer.meta : [];
  // "Night from Mon 5 ends 07:30" reads as its own line inside the hero, with a moon.
  const carried = answer.ring ? undefined : answer.meta.find((line) => line.startsWith("Night from"));
  const rest = answer.ring ? [] : answer.meta.filter((line) => line !== carried);
  const pill = then ?? (rest.length > 0 ? rest.join(" · ") : null);
  const calendar = answer.calendar ?? answer.calendarNext;
  return (
    <section
      aria-label={answer.label}
      data-mode-identity={identity}
      data-testid="work-search-answer"
      className="work-hero"
    >
      <p className="work-hero__eyebrow m-0">{answer.label}</p>
      <div className="mt-2 flex items-center gap-3">
        {answer.date ? (
          <HeroDate date={answer.date} />
        ) : answer.ring ? (
          <WorkRing
            value={answer.ring.value}
            label={answer.ring.unit}
            fraction={answer.ring.fraction}
            accessibleLabel={`${answer.ring.value} ${answer.ring.unit === "h to go" ? "hours to go" : "hours logged"}`}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-lg-minus font-bold leading-tight tracking-tight">{answer.headline}</h3>
          {lines.map((line) => (
            <p key={line} className="m-0 mt-0.5 text-xs tabular-nums">
              {line}
            </p>
          ))}
          {sub ? <p className="m-0 mt-0.5 text-xs">{sub}</p> : null}
          {pill ? (
            <p className="m-0 mt-1.5 inline-block rounded-full bg-[color:color-mix(in_srgb,currentColor_18%,transparent)] px-2 py-0.5 text-2xs font-bold tabular-nums">
              {pill}
            </p>
          ) : null}
        </div>
      </div>
      {carried ? (
        <p className="m-0 mt-2.5 flex items-start gap-2 rounded-xl bg-[color:color-mix(in_srgb,currentColor_10%,transparent)] px-2.5 py-2 text-2xs font-semibold leading-snug">
          <Moon aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          {carried}
        </p>
      ) : null}
      {answer.action || calendar ? (
        <div className={cn("mt-2 grid gap-2", answer.action && calendar ? "grid-cols-2" : "grid-cols-1")}>
          {answer.action ? (
            <Link href={answer.action.href} onClick={onPlainClick(onOpen)} data-work-search-primary="" className={tap}>
              <span className={heroFaceSolid}>
                {(() => {
                  const Icon = ANSWER_ICONS[answer.icon];
                  return <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />;
                })()}
                <span className="truncate">{answer.action.label}</span>
              </span>
            </Link>
          ) : null}
          {calendar ? (
            <button type="button" onClick={() => addToCalendar(calendar)} className={tap}>
              <span className={heroFaceGhost}>
                <CalendarPlus aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
                <span className="truncate">{answer.calendar ? "Add to calendar" : "Add next shift"}</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** CPD: the targets as meters, the short ones first, the met ones folded away until asked for. */
function CpdTargets({ rows }: { rows: readonly WorkAnswerProgress[] }) {
  const [all, setAll] = useState(false);
  const short = rows.filter((row) => !row.met);
  const shown = all || short.length === 0 ? rows : short.slice(0, 2);
  const foldable = shown.length < rows.length || all;
  return (
    <div className="work-card" data-mode-identity="cme">
      <ul className="m-0 list-none p-0">
        {shown.map((row, index) => (
          <li
            key={row.label}
            className={cn("grid gap-1.5 px-3 py-2.5", index > 0 && "border-t border-[color:var(--border)]")}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-start gap-1.5 text-sm-minus font-bold leading-snug text-[color:var(--text-heading)]">
                {row.met ? (
                  <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[color:var(--success)]" />
                ) : null}
                <span>{row.label}</span>
              </span>
              <span
                className={cn(
                  "max-w-[45%] shrink-0 text-right text-xs font-bold leading-snug tabular-nums",
                  row.met ? "text-[color:var(--text-muted)]" : "text-[color:var(--warning)]",
                )}
              >
                {row.summary}
              </span>
            </div>
            {row.fraction !== null ? (
              <span
                role="img"
                aria-label={`${Math.round(row.fraction * 100)} percent of the target`}
                className="flex h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-inset)]"
              >
                <span
                  className={cn(
                    "block h-full rounded-full bg-[linear-gradient(90deg,var(--mode-identity-2,var(--mode-identity)),var(--mode-identity))]",
                    barWidth(row.fraction),
                  )}
                />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {foldable ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((value) => !value)}
          className="flex min-h-12 w-full items-center justify-center border-t border-[color:var(--border)] text-xs font-bold text-[color:var(--mode-identity)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          {all ? "Show only targets still short" : `Show all ${rows.length} targets`}
        </button>
      ) : null}
    </div>
  );
}

/** Monday to Sunday, the free days shaded in the area's colour (the kit's week tiles). */
function FreeWeek({ days, label }: { days: readonly WorkAnswerDay[]; label: string }) {
  return (
    <ul className="work-week" aria-label={`${label}, by day`}>
      {days.map((day) => {
        const date = new Date(`${day.date}T00:00:00Z`);
        const free = day.free && day.inRange;
        return (
          <li key={day.date} className="min-w-0">
            <span
              className="work-week__day"
              {...(free ? { "data-selected": "" } : {})}
              // Days outside the question keep full-contrast text and get a dashed outline instead of fading.
              style={day.inRange ? undefined : { borderStyle: "dashed" }}
            >
              <span aria-hidden="true">{WEEKDAY_SHORT[date.getUTCDay()]?.toUpperCase()}</span>
              <span aria-hidden="true" className="work-week__num">
                {date.getUTCDate()}
              </span>
              <span className="sr-only">
                {`${WEEKDAY_SHORT[date.getUTCDay()]} ${date.getUTCDate()}`}
                {!day.inRange
                  ? ", not asked about"
                  : free
                    ? ", no rostered shift"
                    : day.known
                      ? ", rostered"
                      : ", roster not available"}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const cardTap = cn(tap, "flex-1");
const cardFace = cn(
  face,
  "bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] ring-1 ring-inset ring-[color:var(--border-strong)]",
);

function DaysOffCard({ answer, onOpen }: { answer: WorkAnswer; onOpen: () => void }) {
  return (
    <section
      aria-label={answer.label}
      data-mode-identity="roster"
      data-testid="work-search-answer"
      className="work-card grid gap-1 px-3 pb-1 pt-3"
    >
      <p className="m-0 text-3xs font-bold uppercase tracking-widest text-[color:var(--mode-identity)]">
        {answer.label}
      </p>
      <h3 className="m-0 text-lg-minus font-bold leading-tight tracking-tight text-[color:var(--text-heading)]">
        {answer.headline}
      </h3>
      {answer.sub ? <p className="m-0 text-xs text-[color:var(--text-muted)]">{answer.sub}</p> : null}
      {answer.meta.length > 0 ? (
        <p className="m-0 text-xs text-[color:var(--text-muted)]">{answer.meta.join(" · ")}</p>
      ) : null}
      {answer.week ? (
        <div className="mt-2">
          <FreeWeek days={answer.week} label={answer.label} />
        </div>
      ) : null}
      <div className="mt-1 flex gap-2">
        <Link href="/roster" onClick={onPlainClick(onOpen)} data-work-search-primary="" className={cardTap}>
          <span className={cardFace}>
            <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
            Open Roster
          </span>
        </Link>
        <Link href="/roster/requests" onClick={onPlainClick(onOpen)} className={cardTap}>
          <span className={cardFace}>
            <Plane aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
            Book leave
          </span>
        </Link>
      </div>
    </section>
  );
}

function DueCard({
  answer,
  today,
  now,
  onOpen,
  onListKeyDown,
}: {
  answer: WorkAnswer;
  today: string;
  now: number;
  onOpen: () => void;
  onListKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const overdue = answer.items.some((item) => item.kind === "renewal" && item.date !== null && item.date < today);
  return (
    <section
      aria-label={answer.label}
      data-mode-identity="my-work"
      data-testid="work-search-answer"
      className="work-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-3 pb-2 pt-2.5">
        <div className="min-w-0">
          <h3 className="m-0 text-base-minus font-bold tracking-tight text-[color:var(--text-heading)]">
            {answer.label}
          </h3>
          <p className="m-0 mt-px text-xs text-[color:var(--text-muted)]">{answer.headline}</p>
        </div>
        <span aria-hidden="true" className="work-ic" data-tone={overdue ? "amber" : undefined}>
          {overdue ? (
            <TriangleAlert aria-hidden="true" strokeWidth={2} />
          ) : (
            <CalendarCheck aria-hidden="true" strokeWidth={2} />
          )}
        </span>
      </div>
      {answer.items.length > 0 ? (
        <ul onKeyDown={onListKeyDown} className="work-rows">
          {answer.items.map((item) => (
            <ResultRow key={item.id} item={item} today={today} now={now} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** When an area the question needs has not loaded: say so, never "nothing". */
function UnavailableCard({ answer, onRetry }: { answer: WorkAnswer; onRetry: () => void }) {
  return (
    <section aria-label={answer.label} data-testid="work-search-answer" className="work-card">
      <div className="work-row">
        <span aria-hidden="true" className="work-ic" data-tone="neutral">
          <TriangleAlert aria-hidden="true" strokeWidth={2} />
        </span>
        <span className="work-row__text">
          <span className="work-row__title">{answer.label}</span>
          <span className="work-row__sub">{answer.headline}</span>
        </span>
        {answer.loading ? null : (
          <button
            type="button"
            onClick={onRetry}
            aria-label={`Retry: ${answer.headline}`}
            className="work-button"
            data-variant="secondary"
          >
            <RotateCcw aria-hidden="true" strokeWidth={2} />
            Retry
          </button>
        )}
      </div>
    </section>
  );
}

/** A built-in answer: the hero (or a list card), the source line, then any caution. */
export function AnswerCard({
  answer,
  today,
  now,
  onOpen,
  onRetry,
  onListKeyDown,
}: {
  answer: WorkAnswer;
  today: string;
  now: number;
  onOpen: () => void;
  onRetry: () => void;
  /** Arrow keys between the records listed in the card, as in the lists below it. */
  onListKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  if (answer.unavailable) return <UnavailableCard answer={answer} onRetry={onRetry} />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {answer.readAs && answer.readAs.length > 0 ? (
        <p className="m-0 px-1 text-xs leading-normal text-[color:var(--text-muted)]">
          Read{" "}
          {answer.readAs.map((pair, index) => (
            <span key={pair.typed}>
              {index > 0 ? " and " : null}&ldquo;{pair.typed}&rdquo; as{" "}
              <b className="font-bold text-[color:var(--text-heading)]">{pair.read}</b>
            </span>
          ))}
          .
        </p>
      ) : null}
      {answer.area === "all" ? (
        <DueCard answer={answer} today={today} now={now} onOpen={onOpen} onListKeyDown={onListKeyDown} />
      ) : answer.week || (answer.icon === "free" && !answer.date) ? (
        <DaysOffCard answer={answer} onOpen={onOpen} />
      ) : (
        <AnswerHero answer={answer} onOpen={onOpen} />
      )}
      <AnswerSource answer={answer} />
      {answer.progress && answer.progress.length > 0 ? <CpdTargets rows={answer.progress} /> : null}
      {answer.footnote ? (
        <p className="m-0 flex items-start gap-1.5 px-1 text-2xs font-semibold text-[color:var(--text-muted)]">
          <TriangleAlert
            aria-hidden="true"
            className="mt-px size-3.5 shrink-0 text-[color:var(--warning)]"
            strokeWidth={2}
          />
          {answer.footnote}
        </p>
      ) : null}
      {answer.note ? (
        <p className="m-0 px-4 text-center text-2xs leading-snug text-[color:var(--text-muted)]">{answer.note}</p>
      ) : null}
    </div>
  );
}
