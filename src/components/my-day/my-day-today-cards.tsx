"use client";

import {
  Award,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  Moon,
  Phone,
  Shield,
  SlidersHorizontal,
  TriangleAlert,
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
  QuietLabel,
  QuietList,
  QuietNote,
  QuietRow,
  QuietSection,
  QuietStamp,
  QuietTextLink,
  quietCard,
  quietLink,
  quietLinkMuted,
  quietPill,
  quietPillAmber,
  quietPillQuiet,
} from "@/components/my-day/my-day-quiet";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { kindOf } from "@/components/roster/roster-format";
import { cn } from "@/components/ui-primitives";
import { cmeWeeklyPace } from "@/lib/cme/pace";
import { cmeCategories, type CmeCategory } from "@/lib/cme/types";
import type { MyDayTimedEvent } from "@/lib/my-day/dashboard";
import { addMonths, monthTitle, monthWeeks, myDayActionLabel, RUNWAY_DAYS } from "@/lib/my-day/figures";
import { duePerthDate } from "@/lib/my-day/merge";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import {
  codeKey,
  dayCode,
  daysBetween,
  durationWords,
  fullDate,
  heroTrack,
  heroWords,
  itemLine,
  MY_DAY_AREA_NAME,
  perthWeekday,
  relativeDays,
  SHIFT_CODE,
  shiftTitle,
  shortMonth,
  weekdayTime,
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

/** The hero's small capitals line. */
const heroEyebrow = "text-3xs font-bold uppercase tracking-widest";

/** A see-through white wash on the hero, in either theme (it follows the hero's own text colour). */
const heroWash = "bg-[color-mix(in_srgb,currentColor_14%,transparent)]";

/** The hero's white button ("Log a call", "Details"): a 36px pill, its tap stretched to 48px by the
 * `before:` layer. A smaller pill stretches that layer further, so the tap never drops under 48px. */
const heroButton = cn(
  focusRing,
  "relative inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[color:var(--mode-identity-contrast)] px-3.5 text-xs font-bold text-[color:var(--mode-identity)] no-underline before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] forced-colors:border",
);

/** The hero's glass button beside the white one ("Handover"). */
const heroGlassButton = cn(
  focusRing,
  heroWash,
  "relative inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-bold text-inherit no-underline shadow-[var(--work-edge-inset)_color-mix(in_srgb,currentColor_22%,transparent)] before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] forced-colors:border",
);

// ---------------------------------------------------------------- the blue card

/** The ring on the hero: a white arc out of the whole, with a figure over a small word. */
function HeroRing({
  figure,
  word,
  fraction,
  testId,
}: {
  readonly figure: string;
  readonly word: string;
  readonly fraction: number;
  readonly testId?: string;
}) {
  const circumference = 175.9;
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return (
    <span aria-hidden="true" className="relative grid size-16 shrink-0 place-items-center text-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-full -rotate-90">
        <circle
          cx="32"
          cy="32"
          r="28"
          fill="none"
          strokeWidth="4.5"
          className="stroke-[color-mix(in_srgb,currentColor_22%,transparent)]"
        />
        <circle
          cx="32"
          cy="32"
          r="28"
          fill="none"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={(circumference * (1 - clamped)).toFixed(1)}
          className="stroke-current"
        />
      </svg>
      <span className="relative grid leading-none" data-testid={testId}>
        <span className="text-lg-minus font-bold tracking-tight nums">{figure}</span>{" "}
        <span className="mt-0.5 text-3xs font-semibold">{word}</span>
      </span>
    </span>
  );
}

/** "13 h" over "20 min": the ring's figure and word for a stretch of time. */
function ringParts(ms: number): { readonly figure: string; readonly rest: string | null } {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes >= 24 * 60) return { figure: `${Math.floor(minutes / (24 * 60))} d`, rest: null };
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return { figure: `${minutes}`, rest: "min" };
  const rest = minutes % 60;
  return { figure: `${hours} h`, rest: rest ? `${rest} min` : null };
}

function HeroTrackLine({
  shift,
  running,
  now,
}: {
  readonly shift: RosterDisplayShift;
  readonly running: boolean;
  readonly now: Date;
}) {
  const kind = kindOf(shift);
  const track = heroTrack({ kind, startsAt: shift.startsAt, endsAt: shift.endsAt, place: null }, running, now);
  const start = Date.parse(shift.startsAt);
  const end = Date.parse(shift.endsAt);
  const hours = Math.round(((end - start) / 3_600_000) * 2) / 2;
  const blockWidth = track.fillTo - track.fillFrom;
  // The mockup's ticks: now (bold) where it sits, the shift's start, its end.
  const nowLabel = running ? perthTimeOf(now) : `Now ${perthTimeOf(now)}`;
  const ticks = running
    ? [
        { at: 0, label: track.ticks[0]?.label ?? "", now: false },
        { at: track.now, label: nowLabel, now: true },
        { at: 100, label: track.ticks[track.ticks.length - 1]?.label ?? "", now: false },
      ]
    : [
        { at: track.now, label: nowLabel, now: true },
        { at: track.fillFrom, label: perthTimeOf(shift.startsAt), now: false },
        { at: 100, label: track.ticks[track.ticks.length - 1]?.label ?? "", now: false },
      ];
  // A label that would sit on top of its neighbour is dropped, keeping now and the end. Before the shift the
  // now label reads "Now 05:08", nearly twice as wide, so it needs more room (the two ran together at 320 px).
  const nowGap = running ? 18 : 26;
  const kept = ticks.filter(
    (tick, index) =>
      tick.now ||
      index === ticks.length - 1 ||
      ticks.every((other) => other === tick || !other.now || Math.abs(other.at - tick.at) >= nowGap),
  );
  const middleKept = kept.filter((tick) => !tick.now && tick.at < 100);
  const shown = middleKept.every((tick) => 100 - tick.at >= 16) ? kept : kept.filter((t) => t.now || t.at >= 100);
  const label = blockWidth >= 26 ? `${shiftTitle(kind)} ${hours} h`.replace(" shift", "") : null;
  // Drawn as SVG so the positions are attributes, not inline styles.
  return (
    <div aria-hidden="true" data-testid="my-day-ribbon" className="mt-3">
      <svg className="block h-[1.125rem] w-full overflow-visible" role="presentation">
        <rect
          x="0"
          y="0"
          width="100%"
          height="18"
          rx="9"
          className="fill-current opacity-15 forced-colors:opacity-100 forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText]"
        />
        {running ? (
          <rect
            x="2"
            y="2"
            width={`${Math.max(0, track.fillTo - 1)}%`}
            height="14"
            rx="7"
            className="fill-current opacity-55 forced-colors:fill-[CanvasText] forced-colors:opacity-100"
          />
        ) : (
          <>
            <rect
              x={`${track.fillFrom}%`}
              y="2"
              width={`${Math.max(0, 100 - track.fillFrom - 0.6)}%`}
              height="14"
              rx="7"
              className="fill-[color:var(--mode-identity-contrast)] forced-colors:fill-[CanvasText]"
            />
            {label ? (
              <text
                x={`${(track.fillFrom + 100) / 2}%`}
                y="12.5"
                textAnchor="middle"
                className="fill-[color:var(--mode-identity)] text-3xs font-bold nums forced-colors:fill-[Canvas]"
              >
                {label}
              </text>
            ) : null}
          </>
        )}
        <rect
          data-testid="my-day-ribbon-now"
          x={`${track.now}%`}
          y="-4"
          width="2"
          height="26"
          rx="1"
          className="-translate-x-px fill-current forced-colors:fill-[CanvasText]"
        />
      </svg>
      <svg className="mt-1.5 block h-3.5 w-full overflow-visible" role="presentation">
        {shown.map((tick) => (
          <text
            key={`${tick.at}-${tick.label}`}
            x={tick.at <= 2 ? "0" : tick.at >= 98 ? "100%" : `${tick.at}%`}
            y="10"
            // Near the left edge a centred label would start outside the card, so it starts at its mark instead.
            textAnchor={tick.at <= 8 ? "start" : tick.at >= 98 ? "end" : "middle"}
            className={cn("fill-current text-3xs font-semibold nums", tick.now ? "font-bold" : undefined)}
          >
            {tick.label}
          </text>
        ))}
      </svg>
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
  /** "Starts as on call ends.": shown only when the session meets or overlaps the hero's shift. */
  readonly clash?: string | null;
}

/** A glass panel inside the blue card: small capitals, a title, a line, its action, and an optional clash line. */
function HeroPanel({
  eyebrow,
  title,
  where,
  href,
  actionLabel,
  clash,
  testId,
  openTestId,
  onHide,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly where: string | null;
  readonly href: string;
  readonly actionLabel: string;
  readonly clash?: string | null;
  readonly testId: string;
  readonly openTestId: string;
  readonly onHide?: () => void;
}) {
  return (
    <div
      className={cn(
        "relative mt-3 grid gap-0.5 rounded-xl px-3 py-2.5 shadow-[var(--work-edge-inset)_color-mix(in_srgb,currentColor_14%,transparent)] forced-colors:border",
        "bg-[color-mix(in_srgb,currentColor_10%,transparent)]",
      )}
      data-testid={testId}
    >
      <span className={cn(heroEyebrow, onHide && "pr-8")}>{eyebrow}</span>
      <span className="flex min-w-0 items-center justify-between gap-2.5">
        <span className="grid min-w-0">
          <span className="text-sm-minus font-bold leading-snug tracking-tight break-words">{title}</span>
          {where ? <span className="mt-px text-2xs break-words">{where}</span> : null}
        </span>
        <Link
          href={withMyDayReturn(href)}
          aria-label={`${actionLabel}: ${title}`}
          data-testid={openTestId}
          className={cn(heroButton, "h-7 px-3 before:-inset-y-2.5")}
        >
          {actionLabel}
        </Link>
      </span>
      {clash ? (
        <span
          className="mt-1.5 flex items-center gap-1.5 border-t border-[color-mix(in_srgb,currentColor_16%,transparent)] pt-1.5 text-2xs font-semibold"
          data-testid={`${testId}-clash`}
        >
          <TriangleAlert aria-hidden="true" className="size-3.25 shrink-0" strokeWidth={2} />
          {clash}
        </span>
      ) : null}
      {onHide ? <QuietHideButton label="Next teaching" onHide={onHide} testId="my-day-next-up" onHero inset /> : null}
    </div>
  );
}

/** The shift that ended earlier today, for the "off" form of the blue card. */
export interface HeroFinishedShift {
  readonly kind: ShiftKind;
  readonly endsAt: string;
}

/** The last half hour of a rostered shift (`endOfShiftCard`), with what the call log counts. */
export interface HeroEndOfShift {
  readonly label: string;
  readonly endsAt: string;
  readonly minutesLeft: number;
  /** Counts only, from this phone's call log; null when it is not an on-call shift. */
  readonly calls: { readonly logged: number; readonly open: number } | null;
}

/** The ring and words row at the top of the hero. */
function HeroTop({
  ring,
  eyebrow,
  title,
  sub,
  spoken,
  titleTestId,
}: {
  readonly ring: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
  readonly sub: string;
  readonly spoken?: string;
  readonly titleTestId?: string;
}) {
  return (
    <Link
      href={withMyDayReturn("/roster")}
      data-testid="my-day-shift"
      className={cn(focusRing, "-m-1 flex min-w-0 items-center gap-3 rounded-xl p-1 text-inherit no-underline")}
    >
      {spoken ? <span className="sr-only">{spoken}</span> : null}
      {ring}
      <span aria-hidden={spoken ? "true" : undefined} className="grid min-w-0 flex-1 gap-0.5">
        <span className={heroEyebrow}>{eyebrow}</span>
        <span
          className="text-lg-minus leading-tight font-bold tracking-tight break-words nums"
          data-testid={titleTestId}
        >
          {title}
        </span>
        <span className="text-xs break-words nums">{sub}</span>
      </span>
    </Link>
  );
}

/**
 * The blue card: the shift on now or still to start today, with a ring
 * counting to it and its line drawn to scale, and the next thing inside it.
 * On a day with no shift left it says so, with the next shift. During on call
 * its buttons are Log a call and Handover; in a shift's last half hour it
 * becomes "Time to hand over".
 */
export function HeroCard({
  shift,
  running,
  upNext,
  nextTeaching = null,
  finished = null,
  nextShift = null,
  endOfShift = null,
  offlineAt = null,
  sample = false,
  now,
  onHide,
  onHideNextTeaching,
}: {
  /** The shift on now, or the one still to start today. */
  readonly shift: RosterDisplayShift | null;
  readonly running: boolean;
  readonly upNext: {
    readonly event: MyDayTimedEvent;
    readonly state: "upcoming" | "on-now";
    readonly clash?: string | null;
  } | null;
  /** The next teaching session, as a glass panel at the bottom of the card. */
  readonly nextTeaching?: HeroNextTeaching | null;
  /** No shift left today: the one that ended earlier today, if any. */
  readonly finished?: HeroFinishedShift | null;
  /** No shift left today: the next shift on a later day, if the roster has one. */
  readonly nextShift?: RosterDisplayShift | null;
  /** The shift's last half hour. */
  readonly endOfShift?: HeroEndOfShift | null;
  /** Offline: "as of 02:41" joins the eyebrow, so the countdown is not taken as live. */
  readonly offlineAt?: string | null;
  /** The signed-out sample: a "Sample" chip in the corner. */
  readonly sample?: boolean;
  readonly now: Date;
  readonly onHide?: () => void;
  /** Hides the teaching panel (the "next-up" card). */
  readonly onHideNextTeaching?: () => void;
}) {
  const onCallNow = shift !== null && running && kindOf(shift) === "on_call";
  const asOf = offlineAt ? ` · as of ${offlineAt}` : "";
  let top: ReactNode = null;
  if (shift && running && endOfShift) {
    const ends = perthTimeOf(endOfShift.endsAt);
    const start = Date.parse(shift.startsAt);
    const end = Date.parse(shift.endsAt);
    top = (
      <HeroTop
        ring={
          <HeroRing
            figure={`${endOfShift.minutesLeft}`}
            word="min left"
            fraction={(now.getTime() - start) / Math.max(1, end - start)}
            testId="my-day-shift-countdown"
          />
        }
        eyebrow={`${shiftTitle(kindOf(shift)).replace(" shift", "")} ends ${ends}${asOf}`}
        title="Time to hand over"
        sub={
          endOfShift.calls
            ? `${endOfShift.calls.logged} ${endOfShift.calls.logged === 1 ? "call" : "calls"} logged · ${endOfShift.calls.open} still open`
            : `${weekdayTime(shift.startsAt)} to ${ends}`
        }
        spoken={`${shiftTitle(kindOf(shift))} ends at ${ends}, ${endOfShift.minutesLeft} ${endOfShift.minutesLeft === 1 ? "minute" : "minutes"} left. Time to hand over.`}
      />
    );
  } else if (shift) {
    const kind = kindOf(shift);
    const place = shift.workplace ?? shift.location ?? shift.teamName ?? null;
    const words = heroWords({ kind, startsAt: shift.startsAt, endsAt: shift.endsAt, place }, running, now);
    const start = Date.parse(shift.startsAt);
    const end = Date.parse(shift.endsAt);
    const at = now.getTime();
    if (running) {
      const left = ringParts(end - at);
      const until = words.sub.split(" · ")[0] ?? words.sub;
      top = (
        <HeroTop
          ring={
            <HeroRing
              figure={left.figure}
              word={left.rest ? `${left.rest} left` : "left"}
              fraction={(at - start) / Math.max(1, end - start)}
            />
          }
          eyebrow={`${words.eyebrow}${asOf}`}
          title={words.big}
          titleTestId="my-day-shift-countdown"
          sub={`${until} · started ${perthTimeOf(shift.startsAt)}${place ? ` · ${place}` : ""}`}
          spoken={words.spoken}
        />
      );
    } else {
      const toStart = ringParts(start - at);
      // The ring fills over the last twelve hours before the start.
      const fraction = 1 - Math.min(1, (start - at) / (12 * 3_600_000));
      top = (
        <HeroTop
          ring={<HeroRing figure={toStart.figure} word="to start" fraction={fraction} />}
          eyebrow={`${words.eyebrow}${asOf}`}
          title={words.big}
          titleTestId="my-day-shift-countdown"
          sub={words.sub}
          spoken={words.spoken}
        />
      );
    }
    top = (
      <>
        {top}
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
        className={cn(focusRing, "-m-1 flex min-w-0 items-center gap-3 rounded-xl p-1 text-inherit no-underline")}
      >
        <span aria-hidden="true" className={cn("grid size-12 shrink-0 place-items-center rounded-full", heroWash)}>
          <Moon aria-hidden="true" className="size-5" strokeWidth={2} />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={heroEyebrow}>
            {`${finished ? (finished.kind === "on_call" ? "Post on call" : "Finished for today") : "Day off"}${asOf}`}
          </span>
          <span className="text-lg-minus leading-tight font-bold tracking-tight break-words">
            {finished ? "Off for the rest of today" : "Off today"}
          </span>
          <span className="text-xs break-words">{[ended, next].filter(Boolean).join(" · ")}</span>
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
            clash={upNext.clash ?? null}
            testId="my-day-up-next"
            openTestId="my-day-up-next-open"
          />
        );
      })()
    : null;
  const endingOnCall = endOfShift !== null && onCallNow;
  return (
    <section
      aria-label="Up next"
      data-testid="my-day-card-up-next"
      data-tone="hero"
      className="work-hero relative grid min-w-0"
    >
      {sample ? (
        <span
          className={cn(
            heroWash,
            "absolute top-3 right-3 rounded-full px-2 py-0.5 text-3xs font-bold tracking-widest uppercase ring-1 ring-[color-mix(in_srgb,currentColor_25%,transparent)] ring-inset",
          )}
          data-testid="my-day-hero-sample"
        >
          Sample
        </span>
      ) : null}
      {top}
      {onCallNow ? (
        <span className="mt-3 grid grid-cols-2 gap-2" data-testid="my-day-hero-actions">
          {endingOnCall ? (
            <>
              <Link
                href={withMyDayReturn("/on-call/handover")}
                className={heroButton}
                data-testid="my-day-hero-handover"
              >
                <FileText aria-hidden="true" className="size-3.5" strokeWidth={2} />
                Open handover
              </Link>
              <Link
                href={withMyDayReturn("/on-call/call#on-call-call-log-heading")}
                className={heroGlassButton}
                data-testid="my-day-hero-log-call"
              >
                <Phone aria-hidden="true" className="size-3.5" strokeWidth={2} />
                Log a call
              </Link>
            </>
          ) : (
            <>
              <Link
                href={withMyDayReturn("/on-call/call#on-call-call-log-heading")}
                className={heroButton}
                data-testid="my-day-hero-log-call"
              >
                <Phone aria-hidden="true" className="size-3.5" strokeWidth={2} />
                Log a call
              </Link>
              <Link
                href={withMyDayReturn("/on-call/handover")}
                className={heroGlassButton}
                data-testid="my-day-hero-handover"
              >
                <FileText aria-hidden="true" className="size-3.5" strokeWidth={2} />
                Handover
              </Link>
            </>
          )}
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
          clash={nextTeaching.clash ?? null}
          testId="my-day-next-up"
          openTestId="my-day-next-up-open"
          onHide={onHideNextTeaching}
        />
      ) : null}
      {onHide ? <QuietHideButton label="Up next" onHide={onHide} testId="my-day-card-up-next" onHero /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- the warn strip

/** "Date passed 23 Sep, 13 days ago", "Overdue since 15 Sep, 22 days ago", "Due 31 Oct, in 24 days". */
function warnLine(item: MyDayItem, today: string): string {
  const date = duePerthDate(item.due);
  if (!date)
    return item.severity === "overdue"
      ? item.mode === "my-work"
        ? "Date passed"
        : "Overdue"
      : MY_DAY_AREA_NAME[item.mode];
  const day = `${Number(date.slice(8, 10))} ${shortMonth(date)}`;
  const days = Math.abs(daysBetween(date, today));
  const ago = days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`;
  if (item.severity === "overdue") {
    return item.mode === "my-work" ? `Date passed ${day}, ${ago}` : `Overdue since ${day}, ${ago}`;
  }
  return `Due ${day}, ${relativeDays(date, today)}`;
}

/**
 * The warn strip: the single most important real item (overdue first) with
 * its one action. Red marks only a recorded Admin date that has passed (a
 * lapsed credential); anything else late is amber; an item still to come is a
 * grey note. The others are in Needs you.
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
  const lapsed = current.severity === "overdue" && current.mode === "my-work";
  const late = current.severity === "overdue";
  const more = items.length > 1 ? ` · 1 of ${items.length} reminders` : "";
  return (
    <section aria-label="Most important now" data-testid="my-day-card-flag" className="relative">
      <div data-testid="my-day-flag">
        <QuietNote
          icon={lapsed ? Shield : late ? TriangleAlert : FileText}
          warn={late && !lapsed}
          danger={lapsed}
          title={lapsed ? `${current.title}: date passed` : current.title}
          body={`${warnLine(current, today)}${more}`}
          action={
            <Link
              href={withMyDayReturn(current.href)}
              aria-label={`${action}: ${current.title}`}
              data-testid="my-day-flag-action"
              className={late ? quietPillAmber : quietPill}
            >
              {action}
            </Link>
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
  readonly icon: LucideIcon;
  readonly testId: string;
  /** The area the tap leads to: its colour tints the icon. */
  readonly mode: MyDaySourceMode | "my-day";
  readonly href?: string;
}

/** Real destinations only: each opens an existing page of its mode. Four fit across a phone. */
const MY_DAY_QUICK_ACTIONS: readonly MyDayQuickAction[] = [
  {
    label: "Log a call",
    href: "/on-call/call#on-call-call-log-heading",
    icon: Phone,
    testId: "my-day-qa-call",
    mode: "on-call",
  },
  { label: "Log CPD", href: "/cme/new", icon: Award, testId: "my-day-qa-cpd", mode: "cme" },
  { label: "Who's on", href: "/on-call/whos-on", icon: Users, testId: "my-day-qa-whos-on", mode: "roster" },
  { label: "Roster", href: "/roster", icon: CalendarDays, testId: "my-day-qa-roster", mode: "roster" },
];

/** During on call (the mockup's 03:10 screen): Handover and Remind me take CPD's and Roster's places. */
const MY_DAY_ON_CALL_ACTIONS: readonly MyDayQuickAction[] = [
  MY_DAY_QUICK_ACTIONS[0]!,
  { label: "Handover", href: "/on-call/handover", icon: FileText, testId: "my-day-qa-handover", mode: "on-call" },
  MY_DAY_QUICK_ACTIONS[2]!,
  { label: "Remind me", icon: Bell, testId: "my-day-qa-remind", mode: "my-day" },
];

const quickTile = cn(
  focusRing,
  quietCard,
  "grid min-h-18 content-center justify-items-center gap-1.5 px-0.5 py-2.5 text-center text-2xs leading-tight font-bold text-[color:var(--work-ink)] no-underline",
);

export function QuickActionsCard({
  onHide,
  onCall = false,
  onRemindMe,
}: {
  readonly onHide?: () => void;
  /** On call now: the night's four. */
  readonly onCall?: boolean;
  /** Opens Remind me (the on-call set's fourth tile). Without it the tile is left out. */
  readonly onRemindMe?: () => void;
}) {
  const actions = (onCall ? MY_DAY_ON_CALL_ACTIONS : MY_DAY_QUICK_ACTIONS).filter(
    (action) => action.href || onRemindMe,
  );
  return (
    <section aria-label="Quick actions" data-testid="my-day-card-quick-actions" className="relative">
      <ul
        role="list"
        className={cn("m-0 grid list-none gap-1.75 p-0", actions.length === 4 ? "grid-cols-4" : "grid-cols-3")}
        data-testid="dash-quick-actions"
      >
        {actions.map((action) => {
          const inner = (
            <>
              <span
                aria-hidden="true"
                data-mode-identity={action.mode}
                className="grid size-8.5 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
              >
                <action.icon aria-hidden="true" className="size-4" strokeWidth={2} />
              </span>
              <span className="break-words">{action.label}</span>
            </>
          );
          return (
            <li key={action.testId} className="min-w-0">
              {action.href ? (
                <Link href={withMyDayReturn(action.href)} data-testid={action.testId} className={quickTile}>
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onRemindMe}
                  data-testid={action.testId}
                  className={cn(quickTile, "w-full")}
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
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

/** A roster kind's bar colour: the work-mode shift-code tokens (a Late is the same violet everywhere). */
export const SHIFT_BAR: Readonly<Record<ShiftKind, string>> = {
  day: "bg-[color:var(--work-shift-d)]",
  evening: "bg-[color:var(--work-shift-l)]",
  night: "bg-[color:var(--work-shift-n)]",
  on_call: "bg-[color:var(--work-shift-oc)]",
  leave: "bg-[color:var(--work-shift-al)]",
  other: "bg-[color:var(--work-shift-d)]",
};

/** The legend's words for each kind, in the order the mockup lists them. */
const SHIFT_LEGEND: readonly (readonly [ShiftKind, string])[] = [
  ["day", "Day"],
  ["evening", "Late"],
  ["night", "Night"],
  ["on_call", "On call"],
  ["leave", "Leave"],
  ["other", "Other"],
];

/** The dot key under a strip or a month: only the kinds that appear, plus Due when it is used. */
export function ShiftLegend({
  kinds,
  due = false,
  end,
}: {
  readonly kinds: ReadonlySet<ShiftKind>;
  readonly due?: boolean;
  readonly end?: ReactNode;
}) {
  const shown = SHIFT_LEGEND.filter(([kind]) => kinds.has(kind));
  return (
    <div className="flex min-w-0 items-center gap-3 px-1">
      <ul
        role="list"
        aria-label="Key"
        className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-x-3 gap-y-1 p-0 text-2xs font-semibold text-[color:var(--text-muted)]"
      >
        {shown.map(([kind, label]) => (
          <li key={kind} className="inline-flex items-center gap-1.25">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full forced-colors:bg-[CanvasText]", SHIFT_BAR[kind])}
            />
            {label}
          </li>
        ))}
        {due ? (
          <li className="inline-flex items-center gap-1.25">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-[color:var(--neutral-400)] forced-colors:bg-[CanvasText]"
            />
            Due
          </li>
        ) : null}
      </ul>
      {end}
    </div>
  );
}

/** A two or three part segmented control (Week | Month), with 48px tap areas. */
export function MyDaySegmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  testId,
}: {
  readonly options: readonly (readonly [T, string])[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
  /** `sm` is the small pill in a card's label line; `md` is the page-wide control. */
  readonly size?: "sm" | "md";
  readonly testId?: string;
}) {
  return (
    <span
      role="group"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "inline-flex rounded-full bg-[color:var(--work-wash)] p-0.5 forced-colors:border",
        size === "md" && "flex w-full p-0.75",
      )}
    >
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            focusRing,
            "relative rounded-full font-semibold tracking-normal normal-case before:absolute before:inset-x-0 before:content-[''] motion-safe:transition-colors",
            size === "sm" ? "h-5.5 px-2.5 text-2xs before:-inset-y-3.5" : "h-7.5 flex-1 text-xs before:-inset-y-2.25",
            value === option
              ? "bg-[color:var(--work-surface)] font-bold text-[color:var(--work-ink)] shadow-[var(--work-shadow-card)] forced-colors:border"
              : "text-[color:var(--text-muted)]",
          )}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** "Friday 9 October". */
export function longDay(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return `${DAY_NAMES[weekday]} ${Number(date.slice(8, 10))} ${monthTitle(date.slice(0, 7)).split(" ")[0]}`;
}

/**
 * The month: a calendar of the reader's shifts (a bar in the shift's colour
 * under each date) and due dates (a small dot, amber once passed), and the
 * chosen day's detail under it.
 */
export function MonthView({
  today,
  kindsByDate,
  dueByDate,
  detailFor,
  onMonth,
}: {
  readonly today: string;
  readonly kindsByDate: ReadonlyMap<string, readonly ShiftKind[]> | null;
  readonly dueByDate: ReadonlyMap<string, number>;
  readonly detailFor: (date: string) => readonly DayDetail[];
  /** Told the shown month ("2026-10"), so a page can name it in its header. */
  readonly onMonth?: (month: string) => void;
}) {
  const [month, setMonthState] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const setMonth = (next: string) => {
    setMonthState(next);
    onMonth?.(next);
  };
  const titleId = useId();
  const weeks = monthWeeks(month);
  const details = detailFor(selected);
  const usedKinds = new Set<ShiftKind>();
  let usedDue = false;
  for (const week of weeks)
    for (const date of week) {
      if (!date) continue;
      const code = dayCode(kindsByDate?.get(date) ?? []);
      if (code) usedKinds.add(code);
      if ((dueByDate.get(date) ?? 0) > 0) usedDue = true;
    }
  const navButton = cn(
    focusRing,
    "relative grid size-7 place-items-center rounded-full bg-[color:var(--work-wash)] text-[color:var(--text-muted)] before:absolute before:-inset-2.5 before:content-['']",
  );
  return (
    <div className="grid gap-2.5" data-testid="my-day-month">
      <div className={cn(quietCard, "grid gap-2 px-3 py-3")}>
        <div className="flex items-center justify-between">
          <h3 id={titleId} className="m-0 text-sm-minus font-bold text-[color:var(--work-ink)]">
            {monthTitle(month)}
          </h3>
          {/* The month change is announced from a hidden line, not the visible heading (SPEC §9.2). */}
          <p className="sr-only" aria-live="polite">
            {monthTitle(month)}
          </p>
          <span className="flex gap-3">
            <button
              type="button"
              onClick={() => setMonth(addMonths(month, -1))}
              aria-label="Previous month"
              className={navButton}
            >
              <ChevronLeft aria-hidden="true" className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMonth(addMonths(month, 1))}
              aria-label="Next month"
              className={navButton}
            >
              <ChevronRight aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        </div>
        <table className="w-full table-fixed border-collapse text-center" aria-labelledby={titleId}>
          <thead>
            <tr>
              {DAY_NAMES.map((name) => (
                <th
                  key={name}
                  scope="col"
                  className="pb-1 text-3xs font-bold tracking-wider text-[color:var(--text-muted)]"
                >
                  <span aria-hidden="true">{name.slice(0, 3).toUpperCase()}</span>
                  <span className="sr-only">{name}</span>
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
                      <MonthDay
                        date={date}
                        today={today}
                        selected={date === selected}
                        weekend={column > 4}
                        kinds={kindsByDate?.get(date) ?? []}
                        due={dueByDate.get(date) ?? 0}
                        onSelect={() => setSelected(date)}
                      />
                    </td>
                  ) : (
                    <td key={`pad-${row}-${column}`} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <ShiftLegend kinds={usedKinds} due={usedDue} />
      </div>
      <div className="px-1">
        <QuietLabel as="h3" title={longDay(selected)} />
      </div>
      {details.length ? (
        <div className={quietCard}>
          <QuietList testId="my-day-month-detail">
            {details.map((detail) => (
              <QuietRow
                key={detail.key}
                lead={<AreaIcon mode={detail.mode} icon={MODE_ICON[detail.mode]} />}
                title={detail.title}
                subtitle={
                  detail.subtitle ? (
                    <span className={detail.passed ? "font-semibold text-[color:var(--warning-text)]" : undefined}>
                      {detail.subtitle}
                    </span>
                  ) : undefined
                }
                end={
                  detail.href ? (
                    <QuietTextLink
                      href={detail.href}
                      pill
                      ariaLabel={`${detail.actionLabel ?? "Open"}: ${detail.title}`}
                    >
                      {detail.actionLabel ?? "Open"}
                    </QuietTextLink>
                  ) : undefined
                }
              />
            ))}
          </QuietList>
        </div>
      ) : (
        <p className="m-0 px-1 text-xs font-semibold text-[color:var(--text-muted)]" data-testid="my-day-month-nothing">
          Nothing recorded for this day.
        </p>
      )}
    </div>
  );
}

function MonthDay({
  date,
  today,
  selected,
  weekend,
  kinds,
  due,
  onSelect,
}: {
  readonly date: string;
  readonly today: string;
  readonly selected: boolean;
  readonly weekend: boolean;
  readonly kinds: readonly ShiftKind[];
  readonly due: number;
  readonly onSelect: () => void;
}) {
  const code = dayCode(kinds);
  const isToday = date === today;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-current={isToday ? "date" : undefined}
      aria-label={`${formatPerthDay(date)}${kinds.length ? `: ${kinds.map((kind) => SHIFT_KIND_LABEL[kind]).join(" and ")}` : ""}${due ? `, ${due} due` : ""}`}
      onClick={onSelect}
      className={cn(focusRing, "grid min-h-12 w-full content-center justify-items-center gap-0.75 rounded-lg py-0.5")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6.5 place-items-center rounded-full text-xs nums forced-colors:border",
          isToday
            ? "bg-[color:var(--mode-identity)] font-bold text-[color:var(--mode-identity-contrast)]"
            : selected
              ? "font-bold text-[color:var(--mode-identity)] shadow-[var(--work-edge-inset-strong)_var(--mode-identity)]"
              : weekend
                ? "font-semibold text-[color:var(--text-muted)]"
                : "font-semibold text-[color:var(--work-ink)]",
        )}
      >
        {Number(date.slice(8, 10))}
      </span>
      <span aria-hidden="true" className={cn("h-1 w-4 rounded-full", code ? SHIFT_BAR[code] : "bg-transparent")} />
      {due ? (
        <span
          aria-hidden="true"
          data-due={date < today ? "passed" : ""}
          className={cn(
            "-mt-px size-1 rounded-full",
            date < today ? "bg-[color:var(--warning-text)]" : "bg-[color:var(--neutral-400)]",
          )}
        />
      ) : null}
    </button>
  );
}

/** One day in the strip: its weekday, its date, a bar in its shift's colour and the code in words. */
export function StripDay({
  date,
  today,
  kinds,
  due,
  href,
}: {
  readonly date: string;
  readonly today: string;
  /** Null when no roster is available: then no code is drawn, rather than a false "off". */
  readonly kinds: readonly ShiftKind[] | null;
  readonly due: number;
  /** Where a tap goes (the Week page), or nothing. */
  readonly href?: string;
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
  const tile = cn(
    "relative grid min-h-13 content-center justify-items-center gap-0.5 rounded-xl border py-1.5 no-underline forced-colors:border",
    isToday
      ? "border-transparent bg-[color:var(--mode-identity)]"
      : "border-[color:var(--work-line)] bg-[color:var(--work-surface)]",
  );
  const inner = (
    <>
      <span className="sr-only">{words ? `${formatPerthDay(date)}: ${words}` : formatPerthDay(date)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "text-3xs font-bold tracking-wider uppercase",
          isToday ? "text-[color:var(--mode-identity-contrast)]" : "text-[color:var(--text-muted)]",
        )}
      >
        {perthWeekday(date)}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "text-lg-minus leading-none font-bold nums",
          isToday
            ? "text-[color:var(--mode-identity-contrast)]"
            : off
              ? "text-[color:var(--text-muted)]"
              : "text-[color:var(--work-ink)]",
        )}
      >
        {Number(date.slice(8, 10))}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-0.75 w-[1.125rem] rounded-full forced-colors:bg-[CanvasText]",
          code ? (isToday ? "bg-[color:var(--mode-identity-contrast)]" : SHIFT_BAR[code]) : "bg-transparent",
        )}
      />
      {due ? (
        <span
          data-testid={`dash-week-due-${date}`}
          data-passed={date < today ? "" : undefined}
          aria-hidden="true"
          className={cn(
            "absolute top-1 right-1 size-1.5 rounded-full forced-colors:bg-[CanvasText]",
            date < today ? "bg-[color:var(--warning-text)]" : "bg-[color:var(--neutral-400)]",
          )}
        />
      ) : null}
    </>
  );
  return (
    <li
      className="grid min-w-0 gap-0.5 text-center"
      data-testid={`dash-week-tile-${date}`}
      data-kind={code ?? (off ? "off" : "none")}
      aria-current={isToday ? "date" : undefined}
    >
      {href ? (
        <Link href={href} className={cn(focusRing, tile)}>
          {inner}
        </Link>
      ) : (
        <span className={tile}>{inner}</span>
      )}
      <span aria-hidden="true" className="min-h-3 text-3xs font-bold text-[color:var(--text-muted)]">
        {code ? SHIFT_CODE[code] : off ? "off" : ""}
      </span>
    </li>
  );
}

/** The strip of seven days. Opts out of the tab swipe, so a sideways drag here never changes the page. */
export function WeekStrip({ children, testId }: { readonly children: ReactNode; readonly testId: string }) {
  return (
    <ol role="list" data-no-tab-swipe="" className="m-0 grid list-none grid-cols-7 gap-1 p-0" data-testid={testId}>
      {children}
    </ol>
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
  const codes = kindsByDate ? week.map((date) => dayCode(kindsByDate.get(date) ?? [])) : [];
  const key = kindsByDate ? codeKey(codes) : "";
  const kinds = new Set(codes.filter((code): code is ShiftKind => code !== null));
  return (
    <section aria-label="This week" data-testid="my-day-card-this-week" className="relative grid min-w-0 gap-2.25">
      <div className={cn(quietCard, "grid gap-2.25 px-3 py-3")}>
        <QuietLabel
          title={view === "week" ? "This week" : "Calendar"}
          aside={
            <>
              <span data-testid="my-day-week-switch" className="contents">
                <MyDaySegmented
                  label="Show"
                  size="sm"
                  value={view}
                  onChange={setView}
                  options={[
                    ["week", "Week"],
                    ["month", "Month"],
                  ]}
                />
              </span>
              {onHide ? (
                <QuietHideButton label="This week" onHide={onHide} testId="my-day-card-this-week" inline />
              ) : null}
            </>
          }
        />
        {view === "week" ? (
          <WeekStrip testId="my-day-week">
            {week.map((date) => (
              <StripDay
                key={date}
                date={date}
                today={today}
                kinds={kindsByDate ? (kindsByDate.get(date) ?? []) : null}
                due={dueByDate.get(date) ?? 0}
              />
            ))}
          </WeekStrip>
        ) : null}
      </div>
      {view === "week" ? (
        <>
          {rows.length > 0 ? (
            <div className={quietCard}>
              <QuietList label="Coming up this week" testId="my-day-agenda">
                {rows.map((row) => {
                  const date = perthDateOf(new Date(row.at).toISOString());
                  return (
                    <QuietRow
                      key={row.key}
                      testId={`my-day-week-row-${row.key}`}
                      lead={<DateBlock mode={row.mode} number={Number(date.slice(8, 10))} word={perthWeekday(date)} />}
                      title={row.title}
                      subtitle={row.subtitle}
                    />
                  );
                })}
              </QuietList>
            </div>
          ) : null}
          <ShiftLegend
            kinds={kinds}
            end={
              <>
                <span className="sr-only">{key}</span>
                <QuietTextLink href={withMyDayReturn("/my-day/week")} testId="my-day-open-week">
                  Open week
                </QuietTextLink>
              </>
            }
          />
        </>
      ) : (
        <MonthView today={today} kindsByDate={kindsByDate} dueByDate={dueByDate} detailFor={detailFor} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- needs you

/** One Needs you row: the area's icon, the title, the line (late in amber, lapsed in red), the verb and Later. */
export function NeedsYouRow({
  item,
  today,
  onLater,
}: {
  readonly item: MyDayItem;
  readonly today: string;
  readonly onLater?: (item: MyDayItem) => void;
}) {
  const line = itemLine(item, today);
  const action = myDayActionLabel(item);
  const lapsed = item.severity === "overdue" && item.mode === "my-work";
  return (
    <QuietRow
      testId={`my-day-item-${item.id}`}
      lead={<AreaIcon mode={item.mode} icon={MODE_ICON[item.mode]} />}
      title={item.title}
      subtitle={
        <>
          {line.late ? (
            <span
              className={cn(
                "font-bold",
                lapsed ? "text-[color:var(--danger-text)]" : "text-[color:var(--warning-text)]",
              )}
            >{`${line.late} · `}</span>
          ) : null}
          {line.rest}
        </>
      }
      end={
        <span className="grid justify-items-end">
          <Link
            href={withMyDayReturn(item.href)}
            aria-label={`${action}: ${item.title}`}
            data-testid={`my-day-open-${item.id}`}
            // Later's 48px box is pulled up under this pill. Raising the pill keeps the
            // whole drawn pill the pill's own target (axe target-size), and ending its
            // tap layer at its bottom edge leaves the word Later to Later.
            className={cn(lapsed ? quietPillAmber : quietPill, onLater && "z-10 before:bottom-0")}
          >
            {action}
          </Link>
          {onLater ? (
            <button
              type="button"
              onClick={() => onLater(item)}
              aria-label={`Later: ${item.title}`}
              data-testid={`my-day-later-${item.id}`}
              className={cn(quietLinkMuted, "-my-3.5 pr-0.5")}
            >
              Later
            </button>
          ) : null}
        </span>
      }
    />
  );
}

/**
 * What Later just did: "1 hidden until tomorrow" with the item's title, a
 * Remind me (a timed reminder on this phone instead) and, where the app has
 * no toast to carry it, Undo.
 */
export function HiddenNote({
  hidden,
  inlineUndo,
  onUndo,
  onRemindMe,
}: {
  readonly hidden: {
    readonly id: string;
    readonly title: string;
    readonly until: string;
    readonly count: number;
  } | null;
  /** True when no toast carries Undo, so the note offers it itself. */
  readonly inlineUndo: boolean;
  readonly onUndo: () => void;
  readonly onRemindMe?: (title: string) => void;
}) {
  return (
    <div role="status" className="empty:hidden">
      {hidden ? (
        <div data-testid="my-day-undo">
          <QuietNote
            icon={Clock}
            title={`${hidden.count} hidden until ${hidden.until}`}
            body={hidden.title}
            action={
              <span className="flex items-center gap-3">
                {onRemindMe ? (
                  <button
                    type="button"
                    onClick={() => onRemindMe(hidden.title)}
                    className={quietLink}
                    data-testid="my-day-undo-remind"
                  >
                    Remind me
                  </button>
                ) : null}
                {inlineUndo ? (
                  <button type="button" onClick={onUndo} className={quietLink}>
                    Undo
                  </button>
                ) : null}
              </span>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

export function NeedsYouCard({
  shown,
  waiting,
  total,
  checked,
  checkedAt,
  incomplete = false,
  missing = [],
  offline = false,
  today,
  hidden,
  inlineUndo = true,
  onLater,
  onUndo,
  onRemindMe,
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
  /** The sources that did not load ("Roster"), for the stamp. */
  readonly missing?: readonly string[];
  /** The phone is offline: counts are "as of" the last load. */
  readonly offline?: boolean;
  readonly today: string;
  readonly hidden: {
    readonly id: string;
    readonly title: string;
    readonly until: string;
    readonly count: number;
  } | null;
  readonly inlineUndo?: boolean;
  readonly onLater: (item: MyDayItem) => void;
  readonly onUndo: () => void;
  readonly onRemindMe?: (title: string) => void;
  readonly onShowAll: () => void;
  readonly onRetry: () => void;
  readonly onHide?: () => void;
}) {
  let body: ReactNode;
  if (total === 0) {
    body = (
      <div data-testid="my-day-empty" className="grid gap-0.5 px-3.5 py-3">
        {checked.length > 0 ? (
          <>
            <p className="m-0 text-sm-minus font-bold text-[color:var(--work-ink)]">
              {incomplete ? "Nothing found in the sources that loaded" : "Nothing needs you right now"}
            </p>
            <p className="m-0 text-2xs text-[color:var(--text-muted)]">
              {`Checked ${listNames(checked)}${checkedAt ? ` at ${checkedAt}` : ""}.`}
            </p>
          </>
        ) : (
          <>
            <p className="m-0 text-sm-minus font-bold text-[color:var(--work-ink)]">Couldn&apos;t check your day</p>
            <p className="m-0 text-2xs text-[color:var(--text-muted)]">No source could be checked just now.</p>
            <div className="mt-1.5">
              <button type="button" onClick={onRetry} className={quietPillQuiet}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <p
        className="m-0 px-3.5 py-3 text-xs font-semibold text-[color:var(--text-muted)]"
        data-testid="my-day-needs-you-snoozed"
      >
        {`${incomplete ? "Nothing else found in the sources that loaded." : "Nothing else needs you today."} ${total - waiting} hidden until tomorrow.`}
      </p>
    );
  } else {
    body = (
      <QuietList>
        {shown.map((item) => (
          <NeedsYouRow key={item.id} item={item} today={today} onLater={onLater} />
        ))}
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
  const stampTone = checked.length === 0 ? "off" : incomplete ? "warn" : "ok";
  const stamp =
    checked.length === 0
      ? `Nothing checked yet${checkedAt ? ` · ${checkedAt}` : ""}`
      : `Checked ${checkedAt ?? "just now"}${offline ? ", now offline" : ""} · ${
          incomplete && missing.length ? `${listNames(missing)} not loaded` : checked.join(", ")
        }`;
  return (
    <div className="grid min-w-0 gap-2">
      <QuietSection
        title="Needs you"
        count={count}
        variant="rows"
        onHide={onHide}
        testId="my-day-card-needs-you"
        aside={
          total > 0 ? (
            <button
              type="button"
              onClick={onShowAll}
              data-testid="my-day-show-all"
              aria-label={`See all ${total}`}
              className={quietLink}
            >
              {`All ${total}`}
            </button>
          ) : null
        }
      >
        {body}
      </QuietSection>
      <HiddenNote hidden={hidden} inlineUndo={inlineUndo} onUndo={onUndo} onRemindMe={onRemindMe} />
      <QuietStamp tone={stampTone} testId="my-day-stamp">
        {stamp}
      </QuietStamp>
    </div>
  );
}

// ---------------------------------------------------------------- CPD

const CPD_LABEL: Readonly<Record<CmeCategory, string>> = {
  educational: "Educational",
  reviewing: "Reviewing performance",
  measuring: "Measuring outcomes",
};

/** The meter and key colours for the three CPD types: the area colour, its lighter step, its soft step. */
const CPD_TONE: Readonly<Record<CmeCategory, string>> = {
  educational: "bg-[color:var(--mode-identity)]",
  reviewing: "bg-[color:var(--mode-identity-2)]",
  measuring: "bg-[color:var(--mode-identity-border)]",
};

export function hoursText(value: number): string {
  return `${Number(value.toFixed(1))}`;
}

/** The figure, the meter by CPD type and the hours per type: shared by Today and My records. */
export function CpdSummary({
  loggedHours,
  targetHours,
  byCategory,
  categoryTargets,
}: {
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly byCategory: Readonly<Record<CmeCategory, number>>;
  readonly categoryTargets?: Readonly<Record<CmeCategory, number | null>>;
}) {
  const left = Math.max(0, targetHours - loggedHours);
  const whole = Math.max(loggedHours, targetHours, 1);
  const percent = Math.round((loggedHours / Math.max(1, targetHours)) * 100);
  const segments = cmeCategories
    .filter((category) => byCategory[category] > 0)
    .map((category, index, shown) => ({
      category,
      from: shown.slice(0, index).reduce((sum, earlier) => sum + (byCategory[earlier] / whole) * 100, 0),
      width: (byCategory[category] / whole) * 100,
    }));
  return (
    <Link
      href={withMyDayReturn("/cme")}
      data-testid="my-day-cpd"
      data-mode-identity="cme"
      className={cn(focusRing, "-mx-1 grid min-w-0 gap-2 rounded-lg px-1 py-0.5 text-inherit no-underline")}
    >
      <span className="sr-only">
        {`${hoursText(loggedHours)} of ${hoursText(targetHours)} CPD hours logged this year: ${cmeCategories
          .map((category) => `${CPD_LABEL[category]} ${hoursText(byCategory[category])}`)
          .join(
            ", ",
          )}. ${left > 0 ? `${hoursText(left)} hours to go by 31 December.` : "Your target hours are logged."}`}
      </span>
      <span aria-hidden="true" className="flex items-baseline justify-between gap-2">
        <span className="text-2xl-minus font-bold tracking-tight text-[color:var(--work-ink)] nums">
          {hoursText(loggedHours)}
          <span className="ml-1 text-xs font-semibold tracking-normal text-[color:var(--text-muted)]">
            {`of ${hoursText(targetHours)} h`}
          </span>
        </span>
        <span className="text-2xs font-bold text-[color:var(--mode-identity)] nums">
          {left > 0 ? `${percent}%` : "Target hours logged"}
        </span>
      </span>
      <svg
        aria-hidden="true"
        data-testid="my-day-cpd-ring"
        data-fraction={Math.min(1, loggedHours / Math.max(1, targetHours)).toFixed(3)}
        className="block h-2 w-full overflow-hidden rounded-full"
        role="presentation"
      >
        <rect
          width="100%"
          height="8"
          className="fill-[color:var(--work-wash)] forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText]"
        />
        {segments.map((segment) => (
          <rect
            key={segment.category}
            x={`${segment.from}%`}
            width={`${Math.max(0, segment.width - 0.6)}%`}
            height="8"
            className={cn(CPD_FILL[segment.category], "forced-colors:fill-[CanvasText]")}
          />
        ))}
      </svg>
      <span aria-hidden="true" className="grid">
        {cmeCategories.map((category) => {
          const target = categoryTargets?.[category] ?? null;
          const met = target !== null && byCategory[category] >= target;
          return (
            <span
              key={category}
              className="flex items-center gap-2 border-[color:var(--work-line)] py-1.5 text-xs font-semibold text-[color:var(--text-muted)] [&+&]:border-t"
            >
              <span className={cn("size-2 shrink-0 rounded-full", CPD_TONE[category])} />
              <span className="min-w-0 flex-1 break-words">{CPD_LABEL[category]}</span>
              <span className="font-bold text-[color:var(--work-ink)] nums">{`${hoursText(byCategory[category])} h`}</span>
              {met ? <span className="text-2xs font-bold text-[color:var(--text-muted)]">met</span> : null}
            </span>
          );
        })}
      </span>
    </Link>
  );
}

/**
 * CPD this year: the logged hours out of the year's target, a meter split by
 * Medical Board CPD type, the hours per type, and what is left with the pace
 * that reaches the target. Only the year's total (and any per-type minimum
 * the plan states) is a real target.
 */
export function CpdRingsCard({
  loggedHours,
  targetHours,
  byCategory,
  categoryTargets,
  today,
  year,
  onHide,
}: {
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly byCategory: Readonly<Record<CmeCategory, number>>;
  readonly categoryTargets?: Readonly<Record<CmeCategory, number | null>>;
  readonly today?: string;
  readonly year?: number | null;
  readonly onHide?: () => void;
}) {
  const left = Math.max(0, targetHours - loggedHours);
  const pace = today && year ? cmeWeeklyPace({ targetHours, loggedHours, today, year }) : null;
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
      <CpdSummary
        loggedHours={loggedHours}
        targetHours={targetHours}
        byCategory={byCategory}
        categoryTargets={categoryTargets}
      />
      <QuietFoot icon={CalendarDays}>
        {left > 0
          ? `${hoursText(left)} h to go by 31 Dec${pace ? `, about ${hoursText(pace.weeklyHours)} h a week` : ""}. Your ${hoursText(targetHours)} h target is the one you confirmed in CPD.`
          : `Target hours logged. Your ${hoursText(targetHours)} h target is the one you confirmed in CPD.`}
      </QuietFoot>
    </QuietSection>
  );
}

/** The same three steps as SVG fills, for the meter. */
const CPD_FILL: Readonly<Record<CmeCategory, string>> = {
  educational: "fill-[color:var(--mode-identity)]",
  reviewing: "fill-[color:var(--mode-identity-2)]",
  measuring: "fill-[color:var(--mode-identity-border)]",
};

// ---------------------------------------------------------------- renewals

export interface RenewalsListRow {
  readonly entryId: string;
  readonly title: string;
  readonly date: string;
  readonly href: string;
  readonly passed: boolean;
}

const RENEWALS_SHOWN = 3;

/** Where a date sits on the six-month runway, 0 to 100. */
function runwayAt(date: string, today: string): number {
  return Math.min(100, Math.max(0, (daysBetween(today, date) / RUNWAY_DAYS) * 100));
}

/**
 * The recorded Admin dates over the next six months: a runway line with now
 * and each date marked (the nearest ringed), month labels under it, then the
 * soonest three as date rows, with Renew on the first.
 */
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
  const months = Array.from({ length: 6 }, (_, index) => addMonths(today.slice(0, 7), index));
  const ahead = points.filter((point) => point.date >= today);
  return (
    <section
      aria-labelledby="my-day-renewals-label"
      data-testid="my-day-card-renewals"
      data-mode-identity="my-work"
      className={cn(quietCard, "relative grid min-w-0")}
    >
      <div className="grid gap-1 px-3.5 pt-3 pb-1">
        <QuietLabel
          id="my-day-renewals-label"
          title="Renewals, next 6 months"
          aside={
            <>
              <QuietTextLink href={withMyDayReturn("/admin/renewals")}>Admin</QuietTextLink>
              {onHide ? (
                <QuietHideButton label="Renewals" onHide={onHide} testId="my-day-card-renewals" inline />
              ) : null}
            </>
          }
        />
        <svg
          aria-hidden="true"
          role="presentation"
          data-testid="my-day-runway-line"
          className="mx-1.5 mt-2 mb-0.5 block h-9 w-[calc(100%-0.75rem)] overflow-visible"
        >
          <rect
            x="0"
            y="8"
            width="100%"
            height="3"
            rx="1.5"
            className="fill-[color:var(--work-wash)] forced-colors:fill-[CanvasText]"
          />
          <rect
            x="-1"
            y="1"
            width="2"
            height="17"
            rx="1"
            className="fill-[color:var(--work-ink)] forced-colors:fill-[CanvasText]"
          />
          {ahead.map((point, index) => (
            <circle
              key={point.entryId}
              cx={`${runwayAt(point.date, today)}%`}
              cy="9.5"
              r={index === 0 ? 5 : 4.5}
              strokeWidth="2.5"
              className={cn(
                "fill-[color:var(--work-surface)] forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText]",
                index === 0 ? "stroke-[color:var(--mode-identity)]" : "stroke-[color:var(--neutral-400)]",
              )}
            />
          ))}
          {months.map((month, index) => (
            <text
              key={month}
              x={`${(index / 6) * 100}%`}
              y="32"
              className="fill-[color:var(--text-muted)] text-3xs font-bold forced-colors:fill-[CanvasText]"
            >
              {monthTitle(month).split(" ")[0]!.slice(0, 3)}
            </text>
          ))}
        </svg>
      </div>
      <QuietList testId="my-day-runway">
        {shown.map((point, index) => (
          <QuietRow
            key={point.entryId}
            testId={index === 0 ? "my-day-runway-lead" : `my-day-runway-${point.entryId}`}
            lead={<DateBlock number={Number(point.date.slice(8, 10))} word={shortMonth(point.date)} />}
            title={point.title}
            subtitle={
              point.passed ? (
                <span className="font-bold text-[color:var(--danger-text)]">{`Date passed · ${fullDate(point.date)}`}</span>
              ) : (
                `${relativeDays(point.date, today).replace(/^i/, "I").replace(/^t/, "T")} · ${fullDate(point.date)}`
              )
            }
            end={
              index === 0 ? (
                <Link
                  href={withMyDayReturn(point.href)}
                  aria-label={`Renew: ${point.title}`}
                  data-testid="my-day-runway-lead-action"
                  className={point.passed ? quietPillAmber : quietPill}
                >
                  Renew
                </Link>
              ) : undefined
            }
          />
        ))}
      </QuietList>
      {more > 0 ? (
        <p className="m-0 border-t border-[color:var(--work-line)] px-3.5 py-2.5 text-2xs font-semibold text-[color:var(--text-muted)]">{`${more} more in Admin.`}</p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- customise

/** The last row on Today: opens the Customise sheet. */
export function CustomiseRow({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid="my-day-customise"
      className={cn(focusRing, quietCard, "flex min-h-14 w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left")}
    >
      <AreaIcon icon={SlidersHorizontal} />
      <span className="grid min-w-0 flex-1">
        <span className="text-sm-minus font-bold text-[color:var(--work-ink)]">Customise My Day</span>
        <span className="text-2xs text-[color:var(--text-muted)]">Show or hide these cards</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[color:var(--text-muted)]" />
    </button>
  );
}
