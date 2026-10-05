"use client";

import {
  Award,
  BookPlus,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Phone,
  Shield,
  Sunrise,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { DashCard } from "@/components/dashboard-kit/dash-card";
import { IconChip, type DashTint } from "@/components/dashboard-kit/icon-chip";
import { DashItemList, DashItemRow } from "@/components/dashboard-kit/item-row";
import { DashPill } from "@/components/dashboard-kit/pill";
import { DashQuickActions, type DashQuickAction } from "@/components/dashboard-kit/quick-actions";
import { dashFigure, dashLink, dashMuted } from "@/components/dashboard-kit/recipes";
import { ProgressRing } from "@/components/dashboard-kit/rings";
import { DashSegmented } from "@/components/dashboard-kit/segmented";
import { DashWeekTiles, type DashDayTileKind, type DashWeekDay } from "@/components/dashboard-kit/week-tiles";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { kindOf } from "@/components/roster/roster-format";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { cmeCategories, type CmeCategory } from "@/lib/cme/types";
import { formatCountdown, formatRingFigure, type MyDayTimedEvent } from "@/lib/my-day/dashboard";
import {
  addMonths,
  monthTitle,
  monthWeeks,
  myDayActionLabel,
  shortDayMonth,
  WEEKDAY_LETTERS,
  RUNWAY_DAYS,
  type DayRibbon,
  type RunwayPoint,
} from "@/lib/my-day/figures";
import { duePerthDate } from "@/lib/my-day/merge";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift } from "@/lib/roster/team/team-view";

/*
 * The Today page's cards, built on the dashboard kit
 * (`src/components/dashboard-kit/`). Each takes already-selected data from
 * `MyDayDashboard`, which decides whether a card shows at all.
 */

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------- shared words

export const MODE_CHIP: Readonly<
  Record<MyDaySourceMode, { readonly code: string; readonly tint: DashTint; readonly icon: LucideIcon }>
> = {
  cme: { code: "CPD", tint: "blue", icon: Award },
  "my-work": { code: "ADM", tint: "amber", icon: Shield },
  "on-call": { code: "OC", tint: "green", icon: Phone },
  teaching: { code: "TCH", tint: "blue-2", icon: GraduationCap },
  roster: { code: "ROS", tint: "blue-2", icon: CalendarDays },
};

/**
 * A grey outline icon with a small dot in the area's colour: colour marks
 * meaning, not decoration. Decorative; the row says the same thing in words.
 */
export function AreaIcon({ mode, icon: Icon }: { readonly mode: MyDaySourceMode; readonly icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="relative grid size-10 shrink-0 place-items-center text-[color:var(--dash-muted)]"
    >
      <Icon aria-hidden="true" className="size-icon-lg" strokeWidth={1.6} />
      <span
        data-mode-identity={mode}
        className="absolute right-1 bottom-1.5 size-2 rounded-full bg-[color:var(--mode-identity)] ring-2 ring-[color:var(--dash-raised)] forced-colors:bg-[CanvasText]"
      />
    </span>
  );
}

const MODE_NAME: Readonly<Record<MyDaySourceMode, string>> = {
  cme: "CPD",
  "my-work": "Admin",
  "on-call": "On Call",
  teaching: "Teaching",
  roster: "Roster",
};

/** "Overdue · 15 Sep" / "Date passed · 21 Sep" / "Due 5 Oct" / "Teaching". */
function itemStateLine(item: MyDayItem): { readonly text: string; readonly passed: boolean } {
  const date = duePerthDate(item.due);
  if (item.severity === "overdue") {
    const word = item.mode === "my-work" ? "Date passed" : "Overdue";
    return { text: date ? `${word} · ${shortDayMonth(date)}` : word, passed: true };
  }
  if (date) return { text: `Due ${shortDayMonth(date)} · ${MODE_NAME[item.mode]}`, passed: false };
  return { text: item.detail ?? MODE_NAME[item.mode], passed: false };
}

export function shiftName(kind: ShiftKind): string {
  return kind === "on_call" ? "On call" : `${SHIFT_KIND_LABEL[kind]} shift`;
}

// ---------------------------------------------------------------- hero

function heroEyebrow(shift: RosterDisplayShift, running: boolean, now: Date): string {
  if (running) return "On now";
  const day = perthDateOf(shift.startsAt);
  if (day !== perthDateOf(now)) return formatPerthDay(day);
  return Number(perthTimeOf(shift.startsAt).slice(0, 2)) >= 17 ? "Tonight" : "Today";
}

function Ribbon({ ribbon }: { readonly ribbon: DayRibbon }) {
  return (
    <div className="grid gap-1" aria-hidden="true" data-testid="my-day-ribbon">
      <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="block h-4 w-full overflow-visible">
        <rect x="0" y="4" width="100" height="8" rx="4" className="fill-[color:var(--dash-hero-track)]" />
        {ribbon.segments.map((segment) => (
          <rect
            key={segment.key}
            x={segment.from * 100}
            y="4"
            width={Math.max(1.5, (segment.to - segment.from) * 100)}
            height="8"
            rx="4"
            data-tone={segment.tone}
            className={
              segment.tone === "other"
                ? "fill-[color:var(--dash-hero-ribbon-other)]"
                : "fill-[color:var(--dash-hero-ink)] opacity-75"
            }
          />
        ))}
        {ribbon.now !== null ? (
          <rect
            x={Math.min(99, ribbon.now * 100)}
            y="0"
            width="1"
            height="16"
            rx="0.5"
            data-testid="my-day-ribbon-now"
            className="fill-[color:var(--dash-hero-ink)]"
          />
        ) : null}
      </svg>
      <div className="flex justify-between text-3xs font-dash-title nums opacity-80">
        {ribbon.labels.map((label) => (
          <span key={`${label.at}-${label.text}`}>{label.text}</span>
        ))}
      </div>
    </div>
  );
}

function HeroUpNext({
  event,
  state,
  now,
}: {
  readonly event: MyDayTimedEvent;
  readonly state: "upcoming" | "on-now";
  readonly now: Date;
}) {
  const countdown =
    state === "upcoming"
      ? formatCountdown(Date.parse(event.startsAt) - now.getTime())
      : formatCountdown(Date.parse(event.endsAt) - now.getTime());
  const eyebrow = state === "upcoming" ? `Up next · in ${countdown.short}` : `On now · ${countdown.short} left`;
  const spoken =
    state === "upcoming"
      ? `Up next, in ${countdown.spoken}: ${event.title} at ${perthTimeOf(event.startsAt)}.`
      : `On now, ends in ${countdown.spoken}: ${event.title}.`;
  return (
    <div
      className="grid gap-2 rounded-2xl border border-[color:var(--dash-hero-glass-line)] bg-[color:var(--dash-hero-glass)] px-3 py-2.5"
      data-testid="my-day-up-next"
    >
      <p className="sr-only">{spoken}</p>
      <div aria-hidden="true" className="grid gap-0.5">
        <span className="text-3xs font-dash-title uppercase tracking-widest opacity-80">{eyebrow}</span>
        <span className="break-words font-dash-figure text-base-minus leading-snug">
          {`${perthTimeOf(event.startsAt)} ${event.title}`}
        </span>
        {event.where ? <span className="break-words text-xs opacity-90">{event.where}</span> : null}
      </div>
      <div className="-my-2 flex gap-2">
        <Link
          href={withMyDayReturn(event.href)}
          data-testid="my-day-up-next-open"
          className={cn(focusRing, "inline-flex min-h-12 items-center rounded-full no-underline")}
        >
          <span className="rounded-full bg-[color:var(--dash-hero-ink)] px-4 py-1.5 text-sm font-dash-title text-[color:var(--dash-hero-button-ink)] forced-colors:border">
            {event.actionLabel}
          </span>
        </Link>
      </div>
    </div>
  );
}

/** The next teaching session, shown inside the hero. Built by the dashboard from the session already read. */
export interface HeroNextTeaching {
  readonly key: string;
  readonly title: string;
  /** "Tue 6 Oct, 12:30 to 13:30". */
  readonly when: string;
  readonly href: string;
  readonly actionLabel: string;
}

function HeroNextTeachingPanel({ next, onHide }: { readonly next: HeroNextTeaching; readonly onHide?: () => void }) {
  return (
    <div
      className="relative grid gap-2 rounded-2xl border border-[color:var(--dash-hero-glass-line)] bg-[color:var(--dash-hero-glass)] px-3 py-2.5"
      data-testid="my-day-next-up"
    >
      <div className="grid gap-0.5 pr-8">
        <span className="text-3xs font-dash-title uppercase tracking-widest opacity-80">{`Next up · ${next.when}`}</span>
        <span className="break-words font-dash-figure text-base-minus leading-snug">{next.title}</span>
      </div>
      <div className="-my-2 flex gap-2">
        <Link
          href={withMyDayReturn(next.href)}
          aria-label={`${next.actionLabel}: ${next.title}`}
          data-testid="my-day-next-up-open"
          className={cn(focusRing, "inline-flex min-h-12 items-center rounded-full no-underline")}
        >
          <span className="rounded-full bg-[color:var(--dash-hero-ink)] px-4 py-1.5 text-sm font-dash-title text-[color:var(--dash-hero-button-ink)] forced-colors:border">
            {next.actionLabel}
          </span>
        </Link>
      </div>
      {onHide ? (
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide Next teaching"
          data-testid="my-day-next-up-hide"
          className={cn(focusRing, "absolute -top-1 -right-1 grid size-12 place-items-center rounded-full")}
        >
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded-full bg-[color:var(--dash-hero-ink)] text-[color:var(--dash-hero-button-ink)] forced-colors:border"
          >
            <X aria-hidden="true" className="size-icon-xs" />
          </span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The hero: the shift ring (time to the shift, or left in it), the day ribbon
 * with a now marker, and "Up next" nested inside. Drawn only when there is a
 * shift ahead or something timed today.
 */
export function HeroCard({
  shift,
  running,
  upNext,
  ribbon,
  nextTeaching = null,
  now,
  onHide,
  onHideNextTeaching,
}: {
  readonly shift: RosterDisplayShift | null;
  readonly running: boolean;
  readonly upNext: { readonly event: MyDayTimedEvent; readonly state: "upcoming" | "on-now" } | null;
  readonly ribbon: DayRibbon | null;
  /** The next teaching session, as a glass panel at the bottom of the hero. */
  readonly nextTeaching?: HeroNextTeaching | null;
  readonly now: Date;
  readonly onHide?: () => void;
  /** Edit mode only: hides the teaching panel (the "next-up" card). */
  readonly onHideNextTeaching?: () => void;
}) {
  let top: ReactNode = null;
  if (shift) {
    const kind = kindOf(shift);
    const name = shiftName(kind);
    const start = Date.parse(shift.startsAt);
    const end = Date.parse(shift.endsAt);
    const remaining = running ? end - now.getTime() : start - now.getTime();
    const fraction = running ? remaining / Math.max(1, end - start) : 1 - Math.min(1, remaining / (12 * HOUR_MS));
    const countdown = formatCountdown(remaining);
    const place = shift.workplace ?? shift.location ?? shift.teamName ?? null;
    const spoken = running
      ? `${name} on now, ${countdown.spoken} left, until ${perthTimeOf(shift.endsAt)}.`
      : `${countdown.spoken} until your ${name.toLowerCase()} starts, ${formatPerthDay(perthDateOf(shift.startsAt))} at ${perthTimeOf(shift.startsAt)}, until ${perthTimeOf(shift.endsAt)}.`;
    top = (
      <Link
        href={withMyDayReturn("/roster")}
        data-testid="my-day-shift"
        className={cn(
          focusRing,
          "-m-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 rounded-2xl p-1 text-[color:var(--dash-hero-ink)] no-underline",
        )}
      >
        <span className="sr-only">{`${spoken}${place ? ` ${place}.` : ""}`}</span>
        <ProgressRing
          fraction={fraction}
          size={92}
          strokeWidth={7}
          stroke="stroke-[color:var(--dash-hero-ink)]"
          track="stroke-[color:var(--dash-hero-track)]"
          testId="my-day-shift-ring"
        >
          <span className={cn(dashFigure, "block text-2xl-minus")}>{formatRingFigure(remaining)}</span>
          <span className="mt-0.5 block text-3xs font-dash-title opacity-85">
            {running ? "left" : `to ${name.toLowerCase()}`}
          </span>
        </ProgressRing>
        <span aria-hidden="true" className="grid min-w-0 gap-0.5">
          <span className="text-3xs font-dash-title uppercase tracking-widest opacity-80">
            {heroEyebrow(shift, running, now)}
          </span>
          <span className="break-words font-dash-figure text-lg leading-tight">
            {`${name} ${perthTimeOf(shift.startsAt)} to ${perthTimeOf(shift.endsAt)}`}
          </span>
          {place ? <span className="break-words text-sm opacity-90">{place}</span> : null}
        </span>
      </Link>
    );
  }
  return (
    <DashCard title="Up next" showTitle={false} tone="hero" onHide={onHide} testId="my-day-card-up-next">
      {top}
      {ribbon ? <Ribbon ribbon={ribbon} /> : null}
      {upNext ? <HeroUpNext event={upNext.event} state={upNext.state} now={now} /> : null}
      {nextTeaching ? <HeroNextTeachingPanel next={nextTeaching} onHide={onHideNextTeaching} /> : null}
    </DashCard>
  );
}

// ---------------------------------------------------------------- the flag

/**
 * The flag: the single most important real item (overdue first) with its one
 * action. With more than one, dots below step through them.
 */
export function FlagCard({ items, onHide }: { readonly items: readonly MyDayItem[]; readonly onHide?: () => void }) {
  const [index, setIndex] = useState(0);
  const current = items[Math.min(index, items.length - 1)];
  if (!current) return null;
  const state = itemStateLine(current);
  const action = myDayActionLabel(current);
  return (
    <DashCard
      title="Most important now"
      showTitle={false}
      tone="flag"
      onHide={onHide}
      testId="my-day-card-flag"
      className="gap-1"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5" data-testid="my-day-flag">
        <IconChip tint="neutral" size="md" className="bg-[color:var(--dash-card)]">
          !
        </IconChip>
        <span className="grid min-w-0 gap-0.5">
          <span className="break-words font-dash-title text-base-minus leading-snug text-[color:var(--dash-ink)]">
            {current.title}
          </span>
          <span className={dashMuted}>{`${state.text}${state.passed ? ` · ${MODE_NAME[current.mode]}` : ""}`}</span>
        </span>
        <Link
          href={withMyDayReturn(current.href)}
          aria-label={`${action}: ${current.title}`}
          data-testid="my-day-flag-action"
          className={cn(focusRing, "inline-flex min-h-12 items-center rounded-full no-underline")}
        >
          <span className="rounded-full border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-4 py-2 text-sm font-dash-title text-[color:var(--dash-ink)] forced-colors:border">
            {action}
          </span>
        </Link>
      </div>
      {items.length > 1 ? (
        <div className="flex justify-center gap-1" role="group" aria-label="Flagged items">
          {items.map((item, position) => {
            const selected = position === index;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`Show flag ${position + 1} of ${items.length}: ${item.title}`}
                aria-current={selected ? "true" : undefined}
                onClick={() => setIndex(position)}
                // A small face with a 48px-tall hit area that overlaps the card padding, not the layout.
                className={cn(
                  focusRing,
                  "relative grid h-3 min-w-4 place-items-center rounded-full before:absolute before:-inset-x-1 before:-inset-y-4",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "block h-1.5 rounded-full forced-colors:border",
                    selected ? "w-5 bg-[color:var(--dash-ink)]" : "w-1.5 bg-[color:var(--dash-line-strong)]",
                  )}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </DashCard>
  );
}

// ---------------------------------------------------------------- quick actions

/** Real destinations only: each opens an existing page of its mode. */
export const MY_DAY_QUICK_ACTIONS: readonly DashQuickAction[] = [
  {
    label: "Log a call",
    hint: "note it for handover",
    href: "/on-call/call#on-call-call-log-heading",
    icon: Phone,
    testId: "my-day-qa-call",
  },
  { label: "Log CPD", hint: "add hours", href: "/cme/new", icon: BookPlus, testId: "my-day-qa-cpd" },
  { label: "Who's on", hint: "team now", href: "/on-call/whos-on", icon: Users, testId: "my-day-qa-whos-on" },
  { label: "Roster", hint: "your shifts", href: "/roster", icon: CalendarDays, testId: "my-day-qa-roster" },
  { label: "Teaching", hint: "this week", href: "/teaching/week", icon: GraduationCap, testId: "my-day-qa-teaching" },
];

export function QuickActionsCard({ onHide }: { readonly onHide?: () => void }) {
  return (
    <DashCard
      title="Quick actions"
      showTitle={false}
      onHide={onHide}
      testId="my-day-card-quick-actions"
      className="my-day-quiet-icons"
    >
      <DashQuickActions
        actions={MY_DAY_QUICK_ACTIONS.map((action) => ({ ...action, href: withMyDayReturn(action.href) }))}
      />
    </DashCard>
  );
}

// ---------------------------------------------------------------- this week / month

export interface AgendaLine {
  readonly key: string;
  readonly at: number;
  readonly time: string;
  readonly text: string;
  readonly past: boolean;
}

const TILE_CODE: Readonly<Record<ShiftKind, string>> = {
  day: "D",
  evening: "E",
  night: "N",
  on_call: "OC",
  leave: "L",
  other: "W",
};

function tileKind(kinds: readonly ShiftKind[]): { readonly kind: DashDayTileKind; readonly code: string } {
  if (kinds.includes("on_call")) return { kind: "on-call", code: TILE_CODE.on_call };
  if (kinds.includes("night")) return { kind: "night", code: TILE_CODE.night };
  const worked = kinds.find((kind) => kind !== "leave");
  if (worked) return { kind: "work", code: TILE_CODE[worked] };
  if (kinds.includes("leave")) return { kind: "leave", code: TILE_CODE.leave };
  return { kind: "off", code: "off" };
}

export interface DayDetail {
  readonly key: string;
  readonly code: string;
  readonly tint: DashTint;
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
        <h3 id={titleId} className="font-dash-title text-base-minus text-[color:var(--dash-ink)]">
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
              <th key={index} scope="col" className="pb-1 text-3xs font-dash-title text-[color:var(--dash-faint)]">
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
                        "grid min-h-12 w-full content-center justify-items-center gap-0.5 rounded-xl text-sm nums",
                        date === selected
                          ? "bg-[color:var(--dash-ink)] font-dash-title text-[color:var(--dash-page)] forced-colors:border"
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
        className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-[color:var(--dash-muted)]"
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
      <h3 className="font-dash-title text-sm text-[color:var(--dash-ink)]">{formatPerthDay(selected)}</h3>
      {details.length ? (
        <DashItemList testId="my-day-month-detail">
          {details.map((detail) => (
            <DashItemRow
              key={detail.key}
              chip={<IconChip tint={detail.tint}>{detail.code}</IconChip>}
              title={detail.title}
              subtitle={detail.subtitle}
              subtitleTone={detail.passed ? "passed" : "muted"}
              actions={
                detail.href ? (
                  <DashPill href={detail.href} ariaLabel={`${detail.actionLabel}: ${detail.title}`}>
                    {detail.actionLabel}
                  </DashPill>
                ) : undefined
              }
            />
          ))}
        </DashItemList>
      ) : (
        <p className={dashMuted}>Nothing recorded for this day.</p>
      )}
    </div>
  );
}

export function ThisWeekCard({
  week,
  today,
  kindsByDate,
  dueByDate,
  agenda,
  detailFor,
  onHide,
}: {
  readonly week: readonly string[];
  readonly today: string;
  /** Null when no roster is available: then no tile is drawn, rather than a false "off". */
  readonly kindsByDate: ReadonlyMap<string, readonly ShiftKind[]> | null;
  readonly dueByDate: ReadonlyMap<string, number>;
  readonly agenda: readonly AgendaLine[];
  readonly detailFor: (date: string) => readonly DayDetail[];
  readonly onHide?: () => void;
}) {
  const [view, setView] = useState<"week" | "month">("week");
  const days: DashWeekDay[] = week.map((date, index) => {
    const kinds = kindsByDate?.get(date) ?? [];
    const due = dueByDate.get(date) ?? 0;
    const tile = kindsByDate ? tileKind(kinds) : { kind: "none" as const, code: "" };
    const words = [
      kindsByDate ? (kinds.length ? kinds.map((kind) => SHIFT_KIND_LABEL[kind]).join(" and ") : "Off") : "",
      due ? `${due} due` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return {
      date,
      letter: WEEKDAY_LETTERS[index] ?? "",
      code: tile.code,
      kind: tile.kind,
      today: date === today,
      due: due > 0,
      spoken: words ? `${formatPerthDay(date)}: ${words}` : formatPerthDay(date),
    };
  });
  const nextIndex = agenda.findIndex((line) => !line.past);
  return (
    <DashCard
      title={view === "week" ? "This week" : "Calendar"}
      onHide={onHide}
      testId="my-day-card-this-week"
      aside={
        <DashSegmented
          label="Show"
          value={view}
          onChange={setView}
          testId="my-day-week-switch"
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
      }
    >
      {view === "week" ? (
        <>
          <DashWeekTiles days={days} testId="my-day-week" />
          {agenda.length > 0 ? (
            <ul
              role="list"
              aria-label="Today"
              data-testid="my-day-agenda"
              className="-mx-3 flex snap-x scroll-px-3 gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {agenda.map((line, index) => (
                <li
                  key={line.key}
                  className={cn(
                    "grid min-w-26 shrink-0 snap-start gap-0.5 rounded-xl border px-2.5 py-1.5 text-sm forced-colors:border",
                    index === nextIndex
                      ? "border-[color:var(--dash-blue-tint-2)] bg-[color:var(--dash-blue-tint)]"
                      : "border-[color:var(--dash-line)] bg-[color:var(--dash-raised)]",
                    line.past && "text-[color:var(--dash-faint)]",
                  )}
                >
                  <span className="font-dash-title nums">{line.time}</span>
                  <span className="whitespace-nowrap">
                    {line.text}
                    {line.past ? <span className="sr-only"> (finished)</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <MonthView today={today} kindsByDate={kindsByDate} dueByDate={dueByDate} detailFor={detailFor} />
      )}
    </DashCard>
  );
}

// ---------------------------------------------------------------- needs you

export function NeedsYouCard({
  shown,
  waiting,
  total,
  checked,
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
      <div data-testid="my-day-empty">
        {checked.length > 0 ? (
          <EmptyState icon={Sunrise} title="Nothing needs you right now" body={`Checked ${listNames(checked)}.`} />
        ) : (
          <EmptyState
            icon={Sunrise}
            title="Couldn't check your day"
            body="No source could be checked just now."
            actions={
              <Button variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            }
          />
        )}
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <p className={dashMuted} data-testid="my-day-needs-you-snoozed">
        {`Nothing else needs you today. ${total - waiting} moved to tomorrow.`}
      </p>
    );
  } else {
    body = (
      <DashItemList>
        {shown.map((item) => {
          const state = itemStateLine(item);
          const chip = MODE_CHIP[item.mode];
          const action = myDayActionLabel(item);
          return (
            <li
              key={item.id}
              data-testid={`my-day-item-${item.id}`}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-[color:var(--dash-line)] px-3 py-2.5 first:border-t-0"
            >
              <AreaIcon mode={item.mode} icon={chip.icon} />
              <span className="grid min-w-0 gap-0.5">
                <span className="break-words font-dash-title text-base-minus leading-tight text-[color:var(--dash-ink)]">
                  {item.title}
                </span>
                <span
                  className={cn(
                    "break-words",
                    state.passed ? "font-dash-title text-xs text-[color:var(--dash-amber)]" : dashMuted,
                  )}
                >
                  {state.text}
                </span>
              </span>
              <span className="col-start-2 -mb-2 flex items-center gap-1">
                <DashPill
                  href={withMyDayReturn(item.href)}
                  ariaLabel={`${action}: ${item.title}`}
                  testId={`my-day-open-${item.id}`}
                >
                  {action}
                </DashPill>
                <DashPill
                  onClick={() => onLater(item)}
                  ariaLabel={`Later: ${item.title}`}
                  testId={`my-day-later-${item.id}`}
                >
                  Later
                </DashPill>
              </span>
            </li>
          );
        })}
      </DashItemList>
    );
  }
  return (
    <DashCard
      title={waiting > 0 ? `Needs you · ${waiting}` : "Needs you"}
      onHide={onHide}
      testId="my-day-card-needs-you"
      aside={
        total > 0 ? (
          <button
            type="button"
            onClick={onShowAll}
            data-testid="my-day-show-all"
            className={cn(focusRing, dashLink, "-my-3 inline-flex min-h-12 items-center rounded-md px-1")}
          >
            {`All ${total}`}
          </button>
        ) : null
      }
    >
      {body}
      <div role="status" className="empty:hidden">
        {undo ? (
          <div
            className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-[color:var(--dash-ink)] pl-3 text-sm text-[color:var(--dash-page)]"
            data-testid="my-day-undo"
          >
            <span className="min-w-0 break-words">{`Moved to tomorrow: ${undo.title}`}</span>
            <button
              type="button"
              onClick={onUndo}
              className={cn(
                focusRing,
                "min-h-12 shrink-0 rounded-xl px-3 font-dash-title text-[color:var(--dash-blue-2)]",
              )}
            >
              Undo
            </button>
          </div>
        ) : null}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------- CPD rings

const CPD_TYPE: Readonly<
  Record<CmeCategory, { readonly label: string; readonly stroke: string; readonly dot: string }>
> = {
  educational: {
    label: "Educational",
    stroke: "stroke-[color:var(--dash-blue)]",
    dot: "bg-[color:var(--dash-blue)]",
  },
  reviewing: {
    label: "Performance",
    stroke: "stroke-[color:var(--dash-green)]",
    dot: "bg-[color:var(--dash-green)]",
  },
  measuring: {
    label: "Outcomes",
    stroke: "stroke-[color:var(--dash-amber)]",
    dot: "bg-[color:var(--dash-amber)]",
  },
};

function hoursText(value: number): string {
  return `${Number(value.toFixed(1))}`;
}

const CPD_RING_SIZE = 108;
const CPD_RING_STROKE = 12;
/** A hairline between neighbouring segments, in ring pixels. */
const CPD_SEGMENT_GAP = 2;

/** One ring out of the year's target: a segment per CPD type, grey for what is left. */
function CpdSegmentedRing({
  loggedHours,
  targetHours,
  byCategory,
}: {
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly byCategory: Readonly<Record<CmeCategory, number>>;
}) {
  const radius = (CPD_RING_SIZE - CPD_RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = CPD_RING_SIZE / 2;
  const target = Math.max(1, targetHours);
  const segments = cmeCategories.flatMap((category, index) => {
    const before = cmeCategories.slice(0, index).reduce((sum, other) => sum + Math.max(0, byCategory[other]), 0);
    const from = Math.min(1, before / target);
    const to = Math.min(1, (before + Math.max(0, byCategory[category])) / target);
    const length = (to - from) * circumference;
    if (length <= 0) return [];
    // Keep a small gap between segments, but never erase a short one.
    const drawn = Math.max(1, length - (length > CPD_SEGMENT_GAP * 2 ? CPD_SEGMENT_GAP : 0));
    return [{ category, start: from * circumference, drawn }];
  });
  return (
    <span
      aria-hidden="true"
      className="relative grid shrink-0 place-items-center"
      data-testid="my-day-cpd-ring"
      data-fraction={Math.min(1, loggedHours / target).toFixed(3)}
    >
      <svg
        width={CPD_RING_SIZE}
        height={CPD_RING_SIZE}
        viewBox={`0 0 ${CPD_RING_SIZE} ${CPD_RING_SIZE}`}
        className="-rotate-90"
        data-testid="my-day-cpd-rings"
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={CPD_RING_STROKE}
          className="stroke-[color:var(--dash-line)]"
        />
        {segments.map((segment) => (
          <circle
            key={segment.category}
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            strokeWidth={CPD_RING_STROKE}
            strokeDasharray={`${segment.drawn} ${circumference}`}
            strokeDashoffset={-segment.start}
            data-ring={segment.category}
            className={cn(CPD_TYPE[segment.category].stroke, "forced-colors:stroke-[CanvasText]")}
          />
        ))}
      </svg>
      <span className="absolute inset-0 grid place-content-center text-center leading-none">
        <span className={cn(dashFigure, "block text-2xl-minus text-[color:var(--dash-ink)]")}>
          {hoursText(loggedHours)}
        </span>
        <span className="mt-1 block text-3xs font-dash-title text-[color:var(--dash-muted)]">{`of ${hoursText(targetHours)} h`}</span>
      </span>
    </span>
  );
}

/**
 * CPD this year by Medical Board CPD type: one ring out of the year's target,
 * a segment per type, with the hours per type beside it. No per-type targets
 * are shown: only the year's total is a real target.
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
  const left = Math.max(0, targetHours - loggedHours);
  return (
    <DashCard
      title="CPD this year"
      onHide={onHide}
      testId="my-day-card-cpd"
      aside={
        <span className="font-dash-title text-2xs uppercase tracking-widest text-[color:var(--dash-faint)] nums">
          {`${hoursText(loggedHours)} / ${hoursText(targetHours)} h`}
        </span>
      }
    >
      <Link
        href={withMyDayReturn("/cme")}
        data-testid="my-day-cpd"
        className={cn(
          focusRing,
          "-m-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-2xl p-1 no-underline",
        )}
      >
        <CpdSegmentedRing loggedHours={loggedHours} targetHours={targetHours} byCategory={byCategory} />
        <span className="grid gap-1.5 text-sm text-[color:var(--dash-ink)]">
          {cmeCategories.map((category) => (
            <span key={category} className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full forced-colors:border", CPD_TYPE[category].dot)}
                />
                {CPD_TYPE[category].label}
              </span>
              <span className="font-dash-title nums">{`${hoursText(byCategory[category])} h`}</span>
            </span>
          ))}
          <span className="flex items-center justify-between gap-2 border-t border-[color:var(--dash-line)] pt-1.5">
            <span>{left > 0 ? "To go by 31 Dec" : "Target reached"}</span>
            {left > 0 ? <span className="font-dash-title nums">{`${hoursText(left)} h`}</span> : null}
          </span>
        </span>
      </Link>
    </DashCard>
  );
}

// ---------------------------------------------------------------- renewals runway

const RUNWAY_MAX_POINTS = 4;
const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Month marks along the runway: this month at the start, then each month's first day that falls within it. */
function runwayMonths(today: string): readonly { readonly name: string; readonly at: number }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const start = Date.UTC(year, month, Number(today.slice(8, 10)));
  const marks = [{ name: SHORT_MONTH_NAMES[month] ?? "", at: 0 }];
  for (let step = 1; step <= 6; step += 1) {
    const first = Date.UTC(year, month + step, 1);
    const at = (first - start) / (RUNWAY_DAYS * 86_400_000);
    if (at > 0.97) break;
    marks.push({ name: SHORT_MONTH_NAMES[new Date(first).getUTCMonth()] ?? "", at });
  }
  return marks;
}

function daysUntil(point: RunwayPoint): number {
  return Math.round(point.at * RUNWAY_DAYS);
}

/** "In 40 days · 14 Nov", or "Date passed · 21 Sep". */
function runwayCountdown(point: RunwayPoint): string {
  if (point.passed) return `Date passed · ${shortDayMonth(point.date)}`;
  const days = daysUntil(point);
  const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
  return `${when} · ${shortDayMonth(point.date)}`;
}

/** The nearest recorded Admin date over the next six months, then every one on a line with month marks. */
export function RenewalsRunwayCard({
  points,
  today,
  onHide,
}: {
  readonly points: readonly RunwayPoint[];
  /** `YYYY-MM-DD`, for the month marks under the line. */
  readonly today: string;
  readonly onHide?: () => void;
}) {
  const width = 320;
  const inset = 20;
  const span = width - inset * 2;
  const shown = points.slice(0, RUNWAY_MAX_POINTS);
  const more = points.length - shown.length;
  const lead = points[0] ?? null;
  const months = runwayMonths(today);
  return (
    <DashCard
      title="Renewals, next 6 months"
      onHide={onHide}
      testId="my-day-card-renewals"
      aside={
        <Link
          href={withMyDayReturn("/admin/renewals")}
          className={cn(focusRing, dashLink, "-my-3 inline-flex min-h-12 items-center rounded-md px-1")}
        >
          Admin
        </Link>
      }
    >
      {lead ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3" data-testid="my-day-runway-lead">
          <AreaIcon mode="my-work" icon={Shield} />
          <span className="grid min-w-0 gap-0.5">
            <span className="break-words font-dash-title text-base-minus leading-tight text-[color:var(--dash-ink)]">
              {lead.title}
            </span>
            <span className="break-words font-dash-title text-xs text-[color:var(--dash-amber)]">
              {runwayCountdown(lead)}
            </span>
          </span>
          <DashPill
            href={withMyDayReturn(lead.href)}
            ariaLabel={`Renew: ${lead.title}`}
            testId="my-day-runway-lead-action"
          >
            Renew
          </DashPill>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} 56`}
        className="mx-auto block w-full max-w-md overflow-visible"
        data-testid="my-day-runway"
      >
        <line
          x1={inset}
          x2={width - inset}
          y1="22"
          y2="22"
          strokeWidth="2"
          className="stroke-[color:var(--dash-line-strong)]"
        />
        {months.map((mark) => (
          <text
            key={`${mark.name}-${mark.at}`}
            x={inset + mark.at * span}
            y="52"
            textAnchor={mark.at === 0 ? "start" : "middle"}
            aria-hidden="true"
            className="fill-[color:var(--dash-muted)] font-dash-title text-3xs"
          >
            {mark.name}
          </text>
        ))}
        {shown.map((point) => {
          const x = inset + point.at * span;
          const spoken = `${point.title}: ${point.passed ? "date has passed" : "recorded date"}, ${formatPerthDay(point.date)}`;
          return (
            <a key={point.entryId} href={withMyDayReturn(point.href)} aria-label={spoken} className={focusRing}>
              <rect x={x - 24} y="0" width="48" height="48" fill="transparent" />
              <circle
                cx={x}
                cy="22"
                r="6"
                strokeWidth="3"
                data-passed={point.passed ? "" : undefined}
                className={cn(
                  "stroke-[color:var(--dash-card)]",
                  point.passed ? "fill-[color:var(--dash-amber)]" : "fill-[color:var(--dash-blue)]",
                )}
              />
            </a>
          );
        })}
      </svg>
      <p className={dashMuted}>
        {more > 0 ? `Tap a dot for details. ${more} more in Admin.` : "Tap a dot for details."}
      </p>
    </DashCard>
  );
}
