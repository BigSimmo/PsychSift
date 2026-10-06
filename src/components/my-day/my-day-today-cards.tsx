"use client";

import {
  Award,
  BookPlus,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  GraduationCap,
  Phone,
  Shield,
  SlidersHorizontal,
  Info,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import {
  AreaIcon,
  DateBlock,
  QuietFoot,
  QuietHideButton,
  QuietKeyValue,
  QuietList,
  QuietNote,
  QuietRing,
  QuietRow,
  QuietSection,
  QuietTextLink,
  quietLink,
  quietLinkMuted,
  quietPrimary,
} from "@/components/my-day/my-day-quiet";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { kindOf } from "@/components/roster/roster-format";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { cmeCategories, type CmeCategory } from "@/lib/cme/types";
import type { MyDayTimedEvent } from "@/lib/my-day/dashboard";
import { addMonths, monthTitle, monthWeeks, myDayActionLabel, WEEKDAY_LETTERS } from "@/lib/my-day/figures";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import {
  codeKey,
  dayCode,
  durationWords,
  fullDate,
  heroTrack,
  heroWords,
  itemLine,
  perthWeekday,
  relativeDays,
  reminderLine,
  SHIFT_CODE,
  shiftTitle,
  shortMonth,
  type WeekRow,
} from "@/lib/my-day/quiet-figures";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift } from "@/lib/roster/team/team-view";

/*
 * The Today page's cards in the quiet style of mock-up v2 (5 October 2026):
 * one flat blue card, then flat sections with hairline lists, grey icons with
 * an area dot and text links. Each takes data `MyDayDashboard` already chose.
 */

// ---------------------------------------------------------------- shared words

const MODE_ICON: Readonly<Record<MyDaySourceMode, LucideIcon>> = {
  cme: Award,
  "my-work": Shield,
  "on-call": Phone,
  teaching: GraduationCap,
  roster: CalendarDays,
};

export function shiftName(kind: ShiftKind): string {
  return shiftTitle(kind);
}

/** The blue card's small capitals line. */
const heroEyebrow = "text-2xs font-dash-title uppercase tracking-wider text-[color:var(--dash-hero-muted)]";

/** A text link on the blue card: white, underlined. */
const heroLink = cn(
  focusRing,
  "relative inline-flex min-h-12 items-center whitespace-nowrap rounded-md text-sm font-medium text-[color:var(--dash-hero-ink)] underline decoration-[color:var(--dash-hero-glass-line)] underline-offset-3",
);

/** The one filled button on the blue card. */
const heroButton = cn(
  quietPrimary,
  "bg-[color:var(--dash-hero-ink)] text-[color:var(--dash-hero-button-ink)] forced-colors:border",
);

// ---------------------------------------------------------------- the blue card

function HeroTrackLine({
  shift,
  running,
  now,
}: {
  readonly shift: RosterDisplayShift;
  readonly running: boolean;
  readonly now: Date;
}) {
  const track = heroTrack(
    { kind: kindOf(shift), startsAt: shift.startsAt, endsAt: shift.endsAt, place: null },
    running,
    now,
  );
  return (
    <div aria-hidden="true" data-testid="my-day-ribbon">
      <div className="relative mt-1 h-1 rounded-full bg-[color:var(--dash-hero-glass-line)] forced-colors:border">
        <i
          className="absolute inset-y-0 rounded-full bg-[color:var(--dash-hero-ink)] opacity-55 forced-colors:bg-[CanvasText]"
          style={{ left: `${track.fillFrom}%`, right: `${100 - track.fillTo}%` }}
        />
        <em
          data-testid="my-day-ribbon-now"
          className="absolute -top-1 h-3 w-0.5 rounded-full bg-[color:var(--dash-hero-ink)] forced-colors:bg-[CanvasText]"
          style={{ left: `calc(${track.now}% - 1px)` }}
        />
      </div>
      <div className="relative mt-1 h-4 text-2xs text-[color:var(--dash-hero-muted)] nums">
        {track.ticks.map((tick, index) => (
          <span
            key={`${tick.at}-${tick.label}`}
            className="absolute whitespace-nowrap"
            style={
              index === 0
                ? { left: 0 }
                : tick.at >= 100
                  ? { right: 0 }
                  : { left: `${tick.at}%`, transform: "translateX(-50%)" }
            }
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The next teaching session, shown inside the blue card. Built by the dashboard from the session already read. */
export interface HeroNextTeaching {
  readonly key: string;
  readonly title: string;
  /** "Tue 6 Oct, 12:30 to 13:30". */
  readonly when: string;
  /** "Seminar Room 1 · you lead". */
  readonly where: string | null;
  readonly href: string;
  readonly actionLabel: string;
}

/** A glass panel inside the blue card: small capitals, a title, a line, and its action. */
function HeroPanel({
  eyebrow,
  title,
  where,
  href,
  actionLabel,
  filled,
  testId,
  openTestId,
  onHide,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly where: string | null;
  readonly href: string;
  readonly actionLabel: string;
  /** The screen's one filled button; otherwise a text link. */
  readonly filled: boolean;
  readonly testId: string;
  readonly openTestId: string;
  readonly onHide?: () => void;
}) {
  return (
    <div
      className="relative grid gap-1 rounded-lg border border-[color:var(--dash-hero-glass-line)] bg-[color:var(--dash-hero-glass)] p-3 forced-colors:border"
      data-testid={testId}
    >
      <span className={cn(heroEyebrow, onHide && "pr-8")}>{eyebrow}</span>
      <span className="break-words text-base font-dash-title leading-snug">{title}</span>
      {where ? <span className="break-words text-sm text-[color:var(--dash-hero-muted)]">{where}</span> : null}
      <span className="mt-1 -mb-1 flex items-center gap-4.5">
        <Link
          href={withMyDayReturn(href)}
          aria-label={`${actionLabel}: ${title}`}
          data-testid={openTestId}
          className={filled ? heroButton : heroLink}
        >
          {actionLabel}
        </Link>
      </span>
      {onHide ? <QuietHideButton label="Next teaching" onHide={onHide} testId="my-day-next-up" onHero inset /> : null}
    </div>
  );
}

/** The shift that ended earlier today, for the "off" form of the blue card. */
export interface HeroFinishedShift {
  readonly kind: ShiftKind;
  readonly endsAt: string;
}

/**
 * The blue card: the shift on now or still to start today, with its line
 * drawn to scale, and the next thing inside it. On a day with no shift left it
 * says so, with the next shift. During on call its one button is Log a call.
 */
export function HeroCard({
  shift,
  running,
  upNext,
  nextTeaching = null,
  finished = null,
  nextShift = null,
  now,
  onHide,
  onHideNextTeaching,
}: {
  /** The shift on now, or the one still to start today. */
  readonly shift: RosterDisplayShift | null;
  readonly running: boolean;
  readonly upNext: { readonly event: MyDayTimedEvent; readonly state: "upcoming" | "on-now" } | null;
  /** The next teaching session, as a glass panel at the bottom of the card. */
  readonly nextTeaching?: HeroNextTeaching | null;
  /** No shift left today: the one that ended earlier today, if any. */
  readonly finished?: HeroFinishedShift | null;
  /** No shift left today: the next shift on a later day, if the roster has one. */
  readonly nextShift?: RosterDisplayShift | null;
  readonly now: Date;
  readonly onHide?: () => void;
  /** Edit mode only: hides the teaching panel (the "next-up" card). */
  readonly onHideNextTeaching?: () => void;
}) {
  const onCallNow = shift !== null && running && kindOf(shift) === "on_call";
  let top: ReactNode = null;
  if (shift) {
    const place = shift.workplace ?? shift.location ?? shift.teamName ?? null;
    const words = heroWords(
      { kind: kindOf(shift), startsAt: shift.startsAt, endsAt: shift.endsAt, place },
      running,
      now,
    );
    top = (
      <>
        <Link
          href={withMyDayReturn("/roster")}
          data-testid="my-day-shift"
          className={cn(focusRing, "-m-1 grid gap-0.5 rounded-lg p-1 text-[color:var(--dash-hero-ink)] no-underline")}
        >
          <span className="sr-only">{words.spoken}</span>
          <span aria-hidden="true" className={heroEyebrow}>
            {words.eyebrow}
          </span>
          <span
            aria-hidden="true"
            className="break-words text-xl font-dash-title leading-tight nums"
            data-testid="my-day-shift-countdown"
          >
            {words.big}
          </span>
          <span aria-hidden="true" className="break-words text-sm text-[color:var(--dash-hero-muted)]">
            {words.sub}
          </span>
        </Link>
        <HeroTrackLine shift={shift} running={running} now={now} />
      </>
    );
  } else if (finished || nextShift) {
    const ended = finished ? `${shiftTitle(finished.kind)} ended ${perthTimeOf(finished.endsAt)}` : null;
    const next = nextShift
      ? `next: ${shiftTitle(kindOf(nextShift)).toLowerCase()} ${formatPerthDay(perthDateOf(nextShift.startsAt))}, ${perthTimeOf(nextShift.startsAt)}`
      : null;
    top = (
      <Link
        href={withMyDayReturn("/roster")}
        data-testid="my-day-shift"
        className={cn(focusRing, "-m-1 grid gap-0.5 rounded-lg p-1 text-[color:var(--dash-hero-ink)] no-underline")}
      >
        <span className={heroEyebrow}>
          {finished ? (finished.kind === "on_call" ? "Post on call" : "Finished for today") : "Day off"}
        </span>
        <span className="break-words text-xl font-dash-title leading-tight">
          {finished ? "Off for the rest of today" : "Off today"}
        </span>
        <span className="break-words text-sm text-[color:var(--dash-hero-muted)]">
          {[ended, next].filter(Boolean).join(" · ")}
        </span>
      </Link>
    );
  }
  const upNextPanel = upNext
    ? (() => {
        const ends = upNext.state === "on-now";
        const left = durationWords(
          Date.parse(ends ? upNext.event.endsAt : upNext.event.startsAt) - now.getTime(),
        ).short;
        return (
          <HeroPanel
            eyebrow={
              ends
                ? `On now · ${left} left`
                : `Next up · ${perthTimeOf(upNext.event.startsAt)} to ${perthTimeOf(upNext.event.endsAt)} · in ${left}`
            }
            title={upNext.event.title}
            where={upNext.event.where || null}
            href={upNext.event.href}
            actionLabel={upNext.event.actionLabel}
            filled={!onCallNow}
            testId="my-day-up-next"
            openTestId="my-day-up-next-open"
          />
        );
      })()
    : null;
  return (
    <section
      aria-label="Up next"
      data-testid="my-day-card-up-next"
      data-tone="hero"
      className={cn(
        "dash-hero relative grid gap-3.5 rounded-xl p-4 text-[color:var(--dash-hero-ink)] forced-colors:border",
        onHide && "outline-2 outline-offset-4 outline-dashed outline-[color:var(--dash-line-strong)]",
      )}
    >
      {top}
      {onCallNow ? (
        <span className="-my-1 flex flex-wrap items-center gap-x-4.5" data-testid="my-day-hero-actions">
          <Link
            href={withMyDayReturn("/on-call/call#on-call-call-log-heading")}
            className={heroButton}
            data-testid="my-day-hero-log-call"
          >
            <Phone aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />
            Log a call
          </Link>
          <Link href={withMyDayReturn("/on-call/handover")} className={heroLink}>
            Handover
          </Link>
          <Link href={withMyDayReturn("/on-call/whos-on")} className={heroLink}>
            Who&apos;s on
          </Link>
        </span>
      ) : null}
      {upNextPanel}
      {nextTeaching ? (
        <HeroPanel
          eyebrow={`Next up · ${nextTeaching.when}`}
          title={nextTeaching.title}
          where={nextTeaching.where}
          href={nextTeaching.href}
          actionLabel={nextTeaching.actionLabel}
          filled={!onCallNow && !upNext}
          testId="my-day-next-up"
          openTestId="my-day-next-up-open"
          onHide={onHideNextTeaching}
        />
      ) : null}
      {onHide ? <QuietHideButton label="Up next" onHide={onHide} testId="my-day-card-up-next" onHero /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- the reminder

/**
 * The reminder: the single most important real item (overdue first) as one
 * grey note with its one action. The others are in Needs you.
 */
export function FlagCard({
  items,
  today,
  onHide,
}: {
  readonly items: readonly MyDayItem[];
  readonly today: string;
  readonly onHide?: () => void;
}) {
  const current = items[0];
  if (!current) return null;
  const action = myDayActionLabel(current);
  return (
    <section aria-label="Most important now" data-testid="my-day-card-flag" className="relative">
      <div data-testid="my-day-flag">
        <QuietNote
          icon={FileText}
          title={current.title}
          body={reminderLine(current, today, 1, items.length)}
          action={
            <QuietTextLink
              href={withMyDayReturn(current.href)}
              ariaLabel={`${action}: ${current.title}`}
              testId="my-day-flag-action"
            >
              {action}
            </QuietTextLink>
          }
        />
      </div>
      {onHide ? <QuietHideButton label="Most important now" onHide={onHide} testId="my-day-card-flag" /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- quick actions

interface MyDayQuickAction {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly testId: string;
}

/** Real destinations only: each opens an existing page of its mode. Four fit across a phone. */
const MY_DAY_QUICK_ACTIONS: readonly MyDayQuickAction[] = [
  { label: "Log a call", href: "/on-call/call#on-call-call-log-heading", icon: Phone, testId: "my-day-qa-call" },
  { label: "Log CPD", href: "/cme/new", icon: BookPlus, testId: "my-day-qa-cpd" },
  { label: "Who's on", href: "/on-call/whos-on", icon: Users, testId: "my-day-qa-whos-on" },
  { label: "Roster", href: "/roster", icon: CalendarDays, testId: "my-day-qa-roster" },
];

export function QuickActionsCard({ onHide }: { readonly onHide?: () => void }) {
  return (
    <section aria-label="Quick actions" data-testid="my-day-card-quick-actions" className="relative">
      <ul role="list" className="grid grid-cols-4 gap-1" data-testid="dash-quick-actions">
        {MY_DAY_QUICK_ACTIONS.map((action) => (
          <li key={action.testId} className="min-w-0">
            <Link
              href={withMyDayReturn(action.href)}
              data-testid={action.testId}
              className={cn(
                focusRing,
                "grid min-h-16 justify-items-center gap-1.5 rounded-lg py-2 text-center text-xs font-medium text-[color:var(--dash-ink)] no-underline",
              )}
            >
              <action.icon aria-hidden="true" className="size-5 text-[color:var(--dash-muted)]" strokeWidth={1.6} />
              <span className="break-words">{action.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {onHide ? <QuietHideButton label="Quick actions" onHide={onHide} testId="my-day-card-quick-actions" /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- this week / month

export interface DayDetail {
  readonly key: string;
  readonly mode: MyDaySourceMode;
  readonly title: string;
  readonly subtitle?: string;
  readonly passed?: boolean;
  readonly href?: string;
  readonly actionLabel?: string;
}

const BAR_TONE = {
  day: "fill-[color:var(--dash-line-strong)]",
  night: "fill-[color:var(--dash-night)]",
  call: "fill-[color:var(--dash-blue)]",
  due: "fill-[color:var(--dash-amber)]",
} as const;
type BarTone = keyof typeof BAR_TONE;

function dayBars(kinds: readonly ShiftKind[], due: boolean): BarTone[] {
  const bars: BarTone[] = [];
  if (kinds.includes("on_call")) bars.push("call");
  if (kinds.includes("night")) bars.push("night");
  if (kinds.some((kind) => kind === "day" || kind === "evening" || kind === "other")) bars.push("day");
  if (due) bars.push("due");
  return bars.slice(0, 3);
}

/** The Week and Month switch: a small two-part control. */
function WeekMonthSwitch({
  value,
  onChange,
}: {
  readonly value: "week" | "month";
  readonly onChange: (value: "week" | "month") => void;
}) {
  return (
    <span
      role="group"
      aria-label="Show"
      data-testid="my-day-week-switch"
      className="inline-flex gap-0.5 rounded-lg border border-[color:var(--dash-line-strong)] p-0.5 forced-colors:border"
    >
      {(["week", "month"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            focusRing,
            // A small face; the 48px tap area overlaps the section's spacing, not the layout.
            "relative rounded-md px-2.5 py-0.5 text-xs before:absolute before:inset-x-0 before:-inset-y-3.5",
            value === option
              ? "bg-[color:var(--dash-card)] font-dash-title text-[color:var(--dash-ink)] forced-colors:border"
              : "font-medium text-[color:var(--dash-muted)]",
          )}
        >
          {option === "week" ? "Week" : "Month"}
        </button>
      ))}
    </span>
  );
}

function MonthView({
  today,
  kindsByDate,
  dueByDate,
  detailFor,
}: {
  readonly today: string;
  readonly kindsByDate: ReadonlyMap<string, readonly ShiftKind[]> | null;
  readonly dueByDate: ReadonlyMap<string, number>;
  readonly detailFor: (date: string) => readonly DayDetail[];
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const titleId = useId();
  const weeks = monthWeeks(month);
  const details = detailFor(selected);
  return (
    <div className="grid gap-2" data-testid="my-day-month">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth((value) => addMonths(value, -1))}
          aria-label="Previous month"
          className={cn(focusRing, "grid size-12 -m-3 place-items-center rounded-full text-[color:var(--dash-blue)]")}
        >
          <ChevronLeft aria-hidden="true" className="size-icon-md" />
        </button>
        <h3 id={titleId} className="text-base-minus font-dash-title text-[color:var(--dash-ink)]">
          {monthTitle(month)}
        </h3>
        {/* The month change is announced from a hidden line, not the visible heading (SPEC §9.2). */}
        <p className="sr-only" aria-live="polite">
          {monthTitle(month)}
        </p>
        <button
          type="button"
          onClick={() => setMonth((value) => addMonths(value, 1))}
          aria-label="Next month"
          className={cn(focusRing, "grid size-12 -m-3 place-items-center rounded-full text-[color:var(--dash-blue)]")}
        >
          <ChevronRight aria-hidden="true" className="size-icon-md" />
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-center" aria-labelledby={titleId}>
        <thead>
          <tr>
            {WEEKDAY_LETTERS.map((letter, index) => (
              <th key={index} scope="col" className="pb-1 text-2xs font-medium text-[color:var(--dash-faint)]">
                <span aria-hidden="true">{letter}</span>
                <span className="sr-only">
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, row) => (
            <tr key={row}>
              {week.map((date, column) =>
                date ? (
                  <td key={date} className="p-0">
                    <button
                      type="button"
                      aria-pressed={date === selected}
                      aria-current={date === today ? "date" : undefined}
                      aria-label={`${formatPerthDay(date)}${
                        kindsByDate?.get(date)?.length
                          ? `: ${(kindsByDate.get(date) ?? []).map((kind) => SHIFT_KIND_LABEL[kind]).join(" and ")}`
                          : ""
                      }${dueByDate.get(date) ? `, ${dueByDate.get(date)} due` : ""}`}
                      onClick={() => setSelected(date)}
                      className={cn(
                        focusRing,
                        "grid min-h-12 w-full content-center justify-items-center gap-0.5 rounded-lg text-sm nums",
                        date === selected
                          ? "bg-[color:var(--dash-card)] font-dash-title text-[color:var(--dash-ink)] forced-colors:border"
                          : date === today
                            ? "font-dash-title text-[color:var(--dash-blue)]"
                            : "text-[color:var(--dash-ink)]",
                      )}
                    >
                      <span aria-hidden="true">{Number(date.slice(8, 10))}</span>
                      <svg aria-hidden="true" width="34" height="4" viewBox="0 0 34 4" className="block">
                        {dayBars(kindsByDate?.get(date) ?? [], (dueByDate.get(date) ?? 0) > 0).map(
                          (tone, index, all) => (
                            <rect
                              key={tone}
                              x={17 - (all.length * 12 - 2) / 2 + index * 12}
                              y="0.5"
                              width="10"
                              height="3"
                              rx="1.5"
                              className={BAR_TONE[tone]}
                            />
                          ),
                        )}
                      </svg>
                    </button>
                  </td>
                ) : (
                  <td key={`pad-${row}-${column}`} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <ul
        role="list"
        aria-label="Key"
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--dash-faint)]"
      >
        {(
          [
            ["day", "Day"],
            ["night", "Night"],
            ["call", "On call"],
            ["due", "Due"],
          ] as const
        ).map(([tone, label]) => (
          <li key={tone} className="inline-flex items-center gap-1">
            <svg aria-hidden="true" width="10" height="3" viewBox="0 0 10 3">
              <rect width="10" height="3" rx="1.5" className={BAR_TONE[tone]} />
            </svg>
            {label}
          </li>
        ))}
      </ul>
      <h3 className="text-base-minus font-dash-title text-[color:var(--dash-ink)]">{formatPerthDay(selected)}</h3>
      {details.length ? (
        <QuietList testId="my-day-month-detail">
          {details.map((detail) => (
            <QuietRow
              key={detail.key}
              lead={<AreaIcon mode={detail.mode} icon={MODE_ICON[detail.mode]} />}
              title={detail.title}
              subtitle={
                detail.subtitle ? (
                  <span className={detail.passed ? "font-medium text-[color:var(--dash-amber)]" : undefined}>
                    {detail.subtitle}
                  </span>
                ) : undefined
              }
              end={
                detail.href ? (
                  <QuietTextLink href={detail.href} ariaLabel={`${detail.actionLabel}: ${detail.title}`}>
                    {detail.actionLabel}
                  </QuietTextLink>
                ) : undefined
              }
            />
          ))}
        </QuietList>
      ) : (
        <p className="text-sm text-[color:var(--dash-muted)]">Nothing recorded for this day.</p>
      )}
    </div>
  );
}

/** One day in the strip: its letter, its date in a circle, and its roster code. */
export function StripDay({
  date,
  today,
  kinds,
  due,
}: {
  readonly date: string;
  readonly today: string;
  /** Null when no roster is available: then no code is drawn, rather than a false "off". */
  readonly kinds: readonly ShiftKind[] | null;
  readonly due: number;
}) {
  const code = kinds ? dayCode(kinds) : null;
  const off = kinds !== null && code === null;
  const isToday = date === today;
  const words = [
    kinds ? (kinds.length ? kinds.map((kind) => SHIFT_KIND_LABEL[kind]).join(" and ") : "Off") : "",
    due ? `${due} due` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <li
      className="grid justify-items-center gap-1 text-2xs font-medium text-[color:var(--dash-faint)]"
      data-testid={`dash-week-tile-${date}`}
      data-kind={code ?? (off ? "off" : "none")}
      aria-current={isToday ? "date" : undefined}
    >
      <span className="sr-only">{words ? `${formatPerthDay(date)}: ${words}` : formatPerthDay(date)}</span>
      <span aria-hidden="true">{perthWeekday(date).slice(0, 1)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative grid size-9 place-items-center rounded-full text-sm nums forced-colors:border",
          isToday
            ? "border-2 border-[color:var(--dash-blue)] font-dash-title text-[color:var(--dash-blue)]"
            : off
              ? "border border-dashed border-[color:var(--dash-line-strong)] font-medium text-[color:var(--dash-faint)]"
              : "border border-[color:var(--dash-line-strong)] font-dash-title text-[color:var(--dash-ink)]",
        )}
      >
        {Number(date.slice(8, 10))}
        {due ? (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-[color:var(--dash-amber)] ring-2 ring-[color:var(--dash-page)] forced-colors:bg-[CanvasText]" />
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "min-h-3.5 font-dash-title",
          code === "on_call" ? "text-[color:var(--dash-ink)]" : "text-[color:var(--dash-muted)]",
        )}
      >
        {code ? SHIFT_CODE[code] : off ? "off" : ""}
      </span>
    </li>
  );
}

export function ThisWeekCard({
  week,
  today,
  kindsByDate,
  dueByDate,
  rows,
  detailFor,
  onHide,
}: {
  /** Today and the six days after it: the same seven days as the Week page. */
  readonly week: readonly string[];
  readonly today: string;
  readonly kindsByDate: ReadonlyMap<string, readonly ShiftKind[]> | null;
  readonly dueByDate: ReadonlyMap<string, number>;
  readonly rows: readonly WeekRow[];
  readonly detailFor: (date: string) => readonly DayDetail[];
  readonly onHide?: () => void;
}) {
  const [view, setView] = useState<"week" | "month">("week");
  const key = kindsByDate ? codeKey(week.map((date) => dayCode(kindsByDate.get(date) ?? []))) : "";
  return (
    <QuietSection
      title={view === "week" ? "This week" : "Calendar"}
      onHide={onHide}
      testId="my-day-card-this-week"
      aside={<WeekMonthSwitch value={view} onChange={setView} />}
    >
      {view === "week" ? (
        <>
          <ol role="list" className="grid grid-cols-7 gap-0.5 pt-1.5 pb-1 text-center" data-testid="my-day-week">
            {week.map((date) => (
              <StripDay
                key={date}
                date={date}
                today={today}
                kinds={kindsByDate ? (kindsByDate.get(date) ?? []) : null}
                due={dueByDate.get(date) ?? 0}
              />
            ))}
          </ol>
          {rows.length > 0 ? (
            <QuietList label="Coming up this week" testId="my-day-agenda">
              {rows.map((row) => (
                <QuietRow
                  key={row.key}
                  testId={`my-day-week-row-${row.key}`}
                  lead={
                    <AreaIcon
                      mode={row.mode}
                      icon={row.kind === "on_call" ? Phone : row.mode === "teaching" ? GraduationCap : CalendarDays}
                    />
                  }
                  title={row.title}
                  subtitle={row.subtitle}
                />
              ))}
            </QuietList>
          ) : null}
          <div className="flex min-w-0 items-center justify-between gap-2.5 text-xs text-[color:var(--dash-faint)]">
            <span className="min-w-0 break-words">{key}</span>
            <QuietTextLink href={withMyDayReturn("/my-day/week")} testId="my-day-open-week">
              Open week
            </QuietTextLink>
          </div>
        </>
      ) : (
        <MonthView today={today} kindsByDate={kindsByDate} dueByDate={dueByDate} detailFor={detailFor} />
      )}
    </QuietSection>
  );
}

// ---------------------------------------------------------------- needs you

export function NeedsYouCard({
  shown,
  waiting,
  total,
  checked,
  checkedAt,
  incomplete = false,
  today,
  undo,
  onLater,
  onUndo,
  onShowAll,
  onRetry,
  onHide,
}: {
  readonly shown: readonly MyDayItem[];
  readonly waiting: number;
  readonly total: number;
  readonly checked: readonly string[];
  /** When the sources were last checked, "14:05". */
  readonly checkedAt?: string | null;
  /** Some source failed: counts are "at least". */
  readonly incomplete?: boolean;
  readonly today: string;
  readonly undo: { readonly id: string; readonly title: string } | null;
  readonly onLater: (item: MyDayItem) => void;
  readonly onUndo: () => void;
  readonly onShowAll: () => void;
  readonly onRetry: () => void;
  readonly onHide?: () => void;
}) {
  let body: ReactNode;
  if (total === 0) {
    body = (
      <div data-testid="my-day-empty" className="grid gap-0.5 py-2">
        {checked.length > 0 ? (
          <>
            <p className="text-base-minus font-dash-title text-[color:var(--dash-ink)]">
              {incomplete ? "Nothing found in the sources that loaded" : "Nothing needs you right now"}
            </p>
            <p className="text-sm text-[color:var(--dash-muted)]">
              {`Checked ${listNames(checked)}${checkedAt ? ` at ${checkedAt}` : ""}.`}
            </p>
          </>
        ) : (
          <>
            <p className="text-base-minus font-dash-title text-[color:var(--dash-ink)]">Couldn&apos;t check your day</p>
            <p className="text-sm text-[color:var(--dash-muted)]">No source could be checked just now.</p>
            <div className="mt-1.5">
              <Button variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            </div>
          </>
        )}
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <p className="py-2 text-sm text-[color:var(--dash-muted)]" data-testid="my-day-needs-you-snoozed">
        {`${incomplete ? "Nothing else found in the sources that loaded." : "Nothing else needs you today."} ${total - waiting} hidden until tomorrow.`}
      </p>
    );
  } else {
    body = (
      <QuietList>
        {shown.map((item) => {
          const line = itemLine(item, today);
          const action = myDayActionLabel(item);
          return (
            <QuietRow
              key={item.id}
              testId={`my-day-item-${item.id}`}
              lead={<AreaIcon mode={item.mode} icon={MODE_ICON[item.mode]} />}
              title={item.title}
              subtitle={
                <>
                  {line.late ? (
                    <span className="font-medium text-[color:var(--dash-amber)]">{`${line.late} · `}</span>
                  ) : null}
                  {line.rest}
                </>
              }
              actions={
                <>
                  <Link
                    href={withMyDayReturn(item.href)}
                    aria-label={`${action}: ${item.title}`}
                    data-testid={`my-day-open-${item.id}`}
                    className={quietLink}
                  >
                    {action}
                  </Link>
                  <button
                    type="button"
                    onClick={() => onLater(item)}
                    aria-label={`Later: ${item.title}`}
                    data-testid={`my-day-later-${item.id}`}
                    className={quietLinkMuted}
                  >
                    Later
                  </button>
                </>
              }
            />
          );
        })}
      </QuietList>
    );
  }
  const atLeast = incomplete ? "at least " : "";
  const count =
    waiting === 0
      ? undefined
      : waiting > shown.length
        ? `${atLeast}${shown.length} of ${waiting}`
        : `${atLeast}${waiting}`;
  return (
    <QuietSection
      title="Needs you"
      count={count}
      onHide={onHide}
      testId="my-day-card-needs-you"
      aside={
        total > 0 ? (
          <button type="button" onClick={onShowAll} data-testid="my-day-show-all" className={quietLink}>
            {`See all ${total}`}
          </button>
        ) : null
      }
    >
      {body}
      <div role="status" className="empty:hidden">
        {undo ? (
          <div
            className="flex min-w-0 items-center justify-between gap-2.5 border-t border-[color:var(--dash-line)] pt-1 text-sm text-[color:var(--dash-muted)]"
            data-testid="my-day-undo"
          >
            <span className="min-w-0 break-words">{`Hidden until tomorrow: ${undo.title}`}</span>
            <button type="button" onClick={onUndo} className={quietLink}>
              Undo
            </button>
          </div>
        ) : null}
      </div>
    </QuietSection>
  );
}

// ---------------------------------------------------------------- CPD

const CPD_LABEL: Readonly<Record<CmeCategory, string>> = {
  educational: "Educational",
  reviewing: "Reviewing performance",
  measuring: "Measuring outcomes",
};

export function hoursText(value: number): string {
  return `${Number(value.toFixed(1))}`;
}

/** The ring, the hours per CPD type and what is left: shared by Today and Me. */
export function CpdSummary({
  loggedHours,
  targetHours,
  byCategory,
}: {
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly byCategory: Readonly<Record<CmeCategory, number>>;
}) {
  const left = Math.max(0, targetHours - loggedHours);
  return (
    <Link
      href={withMyDayReturn("/cme")}
      data-testid="my-day-cpd"
      className={cn(focusRing, "-m-1 flex min-w-0 items-center gap-4 rounded-lg p-1 pt-2.5 no-underline")}
    >
      <span className="sr-only">
        {`${hoursText(loggedHours)} of ${hoursText(targetHours)} CPD hours logged this year: ${cmeCategories
          .map((category) => `${CPD_LABEL[category]} ${hoursText(byCategory[category])}`)
          .join(
            ", ",
          )}. ${left > 0 ? `${hoursText(left)} hours to go by 31 December.` : "Your target hours are logged."}`}
      </span>
      <QuietRing fraction={loggedHours / Math.max(1, targetHours)} mode="cme" testId="my-day-cpd-ring">
        <span className="text-base font-dash-title text-[color:var(--dash-ink)] nums">{`${hoursText(loggedHours)} h`}</span>
        <span className="text-2xs text-[color:var(--dash-faint)]">{`of ${hoursText(targetHours)} h`}</span>
      </QuietRing>
      <span className="grid min-w-0 flex-1 gap-1" aria-hidden="true">
        {cmeCategories.map((category) => (
          <QuietKeyValue key={category} label={CPD_LABEL[category]} value={`${hoursText(byCategory[category])} h`} />
        ))}
        <QuietKeyValue
          total
          label={left > 0 ? "To go by 31 Dec" : "Target hours logged"}
          value={left > 0 ? `${hoursText(left)} h` : ""}
        />
      </span>
    </Link>
  );
}

/**
 * CPD this year: one ring out of the year's target, the hours per Medical
 * Board CPD type beside it, and where the figures come from. Only the year's
 * total is a real target, so no per-type target is drawn.
 */
export function CpdRingsCard({
  loggedHours,
  targetHours,
  byCategory,
  onHide,
}: {
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly byCategory: Readonly<Record<CmeCategory, number>>;
  readonly onHide?: () => void;
}) {
  return (
    <QuietSection
      title="CPD this year"
      onHide={onHide}
      testId="my-day-card-cpd"
      aside={
        <QuietTextLink href={withMyDayReturn("/cme")} testId="my-day-cpd-open">
          Open CPD
        </QuietTextLink>
      }
    >
      <CpdSummary loggedHours={loggedHours} targetHours={targetHours} byCategory={byCategory} />
      <QuietFoot icon={Info}>
        {`Hours you have logged in CPD. Your ${hoursText(targetHours)} h target is the one you confirmed in CPD.`}
      </QuietFoot>
    </QuietSection>
  );
}

// ---------------------------------------------------------------- renewals

export interface RenewalsListRow {
  readonly entryId: string;
  readonly title: string;
  readonly date: string;
  readonly href: string;
  readonly passed: boolean;
}

const RENEWALS_SHOWN = 3;

/** The recorded Admin dates over the next six months, soonest first, with Renew on the first. */
export function RenewalsRunwayCard({
  points,
  today,
  onHide,
}: {
  readonly points: readonly RenewalsListRow[];
  readonly today: string;
  readonly onHide?: () => void;
}) {
  const shown = points.slice(0, RENEWALS_SHOWN);
  const more = points.length - shown.length;
  return (
    <QuietSection
      title="Renewals · next 6 months"
      onHide={onHide}
      testId="my-day-card-renewals"
      aside={<QuietTextLink href={withMyDayReturn("/admin/renewals")}>Admin</QuietTextLink>}
    >
      <QuietList testId="my-day-runway">
        {shown.map((point, index) => (
          <QuietRow
            key={point.entryId}
            testId={index === 0 ? "my-day-runway-lead" : `my-day-runway-${point.entryId}`}
            lead={<DateBlock number={Number(point.date.slice(8, 10))} word={shortMonth(point.date)} />}
            title={point.title}
            subtitle={
              point.passed ? (
                <span className="font-medium text-[color:var(--dash-amber)]">{`Date passed · ${fullDate(point.date)}`}</span>
              ) : (
                `${relativeDays(point.date, today).replace(/^i/, "I").replace(/^t/, "T")} · ${fullDate(point.date)}`
              )
            }
            end={
              index === 0 ? (
                <QuietTextLink
                  href={withMyDayReturn(point.href)}
                  ariaLabel={`Renew: ${point.title}`}
                  testId="my-day-runway-lead-action"
                >
                  Renew
                </QuietTextLink>
              ) : undefined
            }
          />
        ))}
      </QuietList>
      {more > 0 ? <p className="text-xs text-[color:var(--dash-faint)]">{`${more} more in Admin.`}</p> : null}
    </QuietSection>
  );
}

// ---------------------------------------------------------------- customise

/** The last row on a page: opens the show-and-hide mode for the cards. */
export function CustomiseRow({ editing, onToggle }: { readonly editing: boolean; readonly onToggle: () => void }) {
  return (
    <div className="border-t border-[color:var(--dash-line)]">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={editing}
        data-testid="my-day-customise"
        className={cn(focusRing, "flex min-h-13 w-full min-w-0 items-center gap-3 rounded-lg py-2 text-left")}
      >
        <AreaIcon icon={SlidersHorizontal} />
        <span className="grid min-w-0 flex-1">
          <span className="text-base-minus font-medium text-[color:var(--dash-ink)]">
            {editing ? "Done customising" : "Customise My Day"}
          </span>
          <span className="text-sm text-[color:var(--dash-muted)]">Show or hide these cards</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--dash-faint)]" />
      </button>
    </div>
  );
}
