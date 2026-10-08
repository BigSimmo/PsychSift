"use client";

import { ChevronLeft, ChevronRight, CircleHelp, CircleX, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import {
  endsNextDay,
  formatHours,
  gradeLabel,
  hoursBetween,
  kindLabel,
  type OpenShiftListing,
} from "@/lib/open-shifts/model";
import type { RosterCheck } from "@/lib/open-shifts/roster-check";
import { MONTHS, WEEKDAYS, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { zonedDateOf } from "@/lib/work-time/format";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";

/*
 * The pieces every Open shifts page shares, so the last screen is drawn from
 * the same parts as the first. Drawn as Roster's work-mode kit (work-mode
 * redesign, owner request 6 Oct 2026): white hairline cards, the mockup's
 * time column and flag line, one type scale, colour only where it means
 * something (amber a roster flag, red an overlap; "No flags" stays neutral),
 * 48px tap areas.
 */

export const OPEN_SHIFTS_HREF = "/open-shifts";
export const advertHref = (listing: Pick<OpenShiftListing, "serviceId" | "id">) =>
  `${OPEN_SHIFTS_HREF}/shift/${encodeURIComponent(listing.serviceId)}/${encodeURIComponent(listing.id)}`;
export const postedShiftHref = (serviceId: string, id: string) =>
  `${OPEN_SHIFTS_HREF}/post/${encodeURIComponent(serviceId)}/${encodeURIComponent(id)}`;

// Plain tables, not Intl: en-AU's short month for September is "Sept", and
// Roster's own dates use these same three-letter names.
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function dateParts(date: string): { weekday: number; day: number; month: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { weekday: new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay(), day: day!, month: month! - 1 };
}

/** "Wednesday 7 October" for a Perth date. */
export function formatDayLong(date: string): string {
  const { weekday, day, month } = dateParts(date);
  return `${WEEKDAYS_LONG[weekday]} ${day} ${MONTHS_LONG[month]}`;
}

/** "Wed 7 Oct" for a Perth date. */
export function formatDayShort(date: string): string {
  const { weekday, day, month } = dateParts(date);
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month]}`;
}

export function formatWeekday(date: string): string {
  return WEEKDAYS[dateParts(date).weekday]!;
}

/** "08:00–16:30", with the end day named when it ends on a later day ("21:30–08:00 Thu"). */
export function formatShiftTimes(startsAt: string, endsAt: string): string {
  const end = perthTimeOf(endsAt);
  const suffix = endsNextDay(startsAt, endsAt) ? ` ${formatWeekday(perthDateOf(endsAt))}` : "";
  return `${perthTimeOf(startsAt)}–${end}${suffix}`;
}

/** "Starts in 2 days", "Starts today", "Starts tomorrow". */
export function startsIn(startsAt: string, now: Date, zone: string = currentWorkTimeZone()): string {
  const days = Math.round(
    (Date.parse(`${zonedDateOf(startsAt, zone)}T00:00:00Z`) - Date.parse(`${zonedDateOf(now, zone)}T00:00:00Z`)) /
      86_400_000,
  );
  if (days <= 0) return "Starts today";
  if (days === 1) return "Starts tomorrow";
  return `Starts in ${days} days`;
}

/** The row title: level and kind ("Registrar · Day shift"). */
export function shiftTitle(listing: Pick<OpenShiftListing, "minGrade" | "kind">): string {
  return `${gradeLabel(listing.minGrade)} · ${kindLabel(listing.kind)}`;
}

/** Where: the site, then the team. */
export function shiftPlace(listing: Pick<OpenShiftListing, "siteName" | "teamName">): string {
  return [listing.siteName, listing.teamName].filter(Boolean).join(" · ");
}

// ------------------------------------------------------------------ roster check

type CheckTone = "ok" | "warn" | "bad" | "muted";

export function checkSummary(check: RosterCheck): { tone: CheckTone; text: string } {
  switch (check.state) {
    case "ok":
      return { tone: "ok", text: "No flags on your PsychSift roster" };
    case "flag": {
      const shortest = [check.breakBefore, check.breakAfter].filter((hours): hours is number => hours !== null);
      const breakWarning = check.warnings.find((warning) => warning.rule === "minBreakHours");
      if (breakWarning && shortest.length > 0)
        return { tone: "warn", text: `Roster flag: ${formatHours(Math.min(...shortest))} break` };
      return { tone: "warn", text: "Roster flag: check your hours" };
    }
    case "overlap":
      return { tone: "bad", text: "Overlaps your rostered shift" };
    case "clash-only":
      return { tone: "muted", text: "Clash check only" };
    case "none":
      return { tone: "muted", text: "Can't check: no roster" };
    case "loading":
      return { tone: "muted", text: "Checking your roster…" };
    case "unread":
      return { tone: "muted", text: "Can't check: your roster didn't load" };
    case "beyond":
      return { tone: "muted", text: "Can't check: your roster ends earlier" };
  }
}

const TONE_CLASS: Readonly<Record<CheckTone, string>> = {
  // "No flags" stays neutral: green is kept for source status, and a clean check isn't a safety verdict.
  ok: "text-[color:var(--text-heading)]",
  warn: "text-[color:var(--warning-text)]",
  bad: "text-[color:var(--danger-text)]",
  muted: "text-[color:var(--text-muted)]",
};

const TONE_ICON = { ok: Info, warn: TriangleAlert, bad: CircleX, muted: CircleHelp } as const;

export function CheckLine({ check }: { check: RosterCheck }) {
  const { tone, text } = checkSummary(check);
  const Icon = TONE_ICON[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold ${TONE_CLASS[tone]}`}>
      <Icon aria-hidden="true" strokeWidth={2} className="size-icon-xs shrink-0" />
      {text}
    </span>
  );
}

export function ToneIcon({ tone }: { tone: CheckTone }) {
  const Icon = TONE_ICON[tone];
  return <Icon aria-hidden="true" strokeWidth={1.6} className={`size-icon-md shrink-0 ${TONE_CLASS[tone]}`} />;
}

// ------------------------------------------------------------------ rows

/** A list on one white hairline card, rows divided by inset hairlines. */
export function FlatList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="work-card mx-3 my-0 flex list-none flex-col p-0" aria-label={label}>
      {children}
    </ul>
  );
}

export function ShiftRow({
  listing,
  check,
  href,
  status,
}: {
  listing: OpenShiftListing;
  check?: RosterCheck | null;
  href: string;
  status?: ReactNode;
}) {
  const hours = hoursBetween(listing.startsAt, listing.endsAt);
  const meta = [
    endsNextDay(listing.startsAt, listing.endsAt) ? "Ends next day" : null,
    listing.urgent ? "Urgent" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={modeInsetHairline}>
      <Link
        href={href}
        className={`flex min-h-12 items-start gap-2.5 px-3 py-2.5 no-underline ${modePressable} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--mode-identity)]`}
      >
        <span className="nums flex basis-11 shrink-0 flex-col text-2xs font-semibold leading-tight text-[color:var(--text-muted)]">
          <span className="text-sm-minus font-bold text-[color:var(--text-heading)]">
            {perthTimeOf(listing.startsAt)}
          </span>
          <span className="mt-0.5">{perthTimeOf(listing.endsAt)}</span>
          <span className="mt-0.5">{formatHours(hours)}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm-minus font-bold leading-snug text-[color:var(--text-heading)]">
            {shiftTitle(listing)}
          </span>
          <span className="text-2xs text-[color:var(--text-muted)]">{shiftPlace(listing)}</span>
          {meta ? <span className="text-2xs text-[color:var(--text-muted)]">{meta}</span> : null}
          {status ?? (check ? <span className="mt-1.5">{<CheckLine check={check} />}</span> : null)}
        </span>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2}
          className="mt-1 size-3.5 shrink-0 text-[color:var(--decoration-soft)]"
        />
      </Link>
    </li>
  );
}

/** A grey section heading over a flat list, with an optional count on the right. */
export function SectionHeading({ children, count, id }: { children: ReactNode; count?: number; id?: string }) {
  return (
    <h2
      id={id}
      className="mt-3 flex items-baseline justify-between px-4 pb-1.5 text-3xs font-bold uppercase leading-4 tracking-kicker text-[color:var(--text-muted)]"
    >
      <span>{children}</span>
      {count !== undefined ? (
        <span className="nums text-2xs font-semibold normal-case tracking-normal">{count}</span>
      ) : null}
    </h2>
  );
}

/** A grey note with an icon: never amber unless it really is a warning. */
export function Note({
  icon,
  children,
  tone = "muted",
}: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <div
      className={`flex items-start gap-2.5 px-1 py-2 text-xs font-medium leading-snug ${tone === "warn" ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]"}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The back row on a sub-page (where the mode band steps aside). */
export function SubHeader({
  backHref,
  backLabel,
  title,
  action,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center gap-1 px-1">
      <Link
        href={backHref}
        aria-label={`Back to ${backLabel}`}
        className="work-glass-button inline-flex min-h-12 min-w-12 items-center justify-center rounded-full text-[color:var(--text-heading)] focus-visible:outline-2 focus-visible:outline-[color:var(--mode-identity)]"
      >
        <ChevronLeft aria-hidden="true" strokeWidth={1.6} className="size-icon-lg" />
      </Link>
      <h1 className="min-w-0 flex-1 text-lg font-bold tracking-tight text-[color:var(--text-heading)]">{title}</h1>
      {action}
    </div>
  );
}

/** An on/off switch: a real button with role="switch", so it reads as one and works from the keyboard. */
export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-7 w-12 rounded-full border transition-colors duration-[var(--duration-instant)] motion-reduce:transition-none forced-colors:border-[CanvasText] forced-colors:[forced-color-adjust:none] ${
          checked
            ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]"
            : "border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] forced-colors:bg-[Canvas]"
        } group-disabled:border-[color:var(--border)] group-disabled:bg-[color:var(--surface-subtle)] forced-colors:group-disabled:border-[GrayText]`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5.5 rounded-full shadow-[var(--e1)] transition-transform duration-[var(--duration-instant)] motion-reduce:transition-none group-disabled:bg-[color:var(--disabled)] group-disabled:shadow-none forced-colors:group-disabled:bg-[GrayText] ${
            checked
              ? "translate-x-5 bg-[color:var(--mode-identity-contrast)] forced-colors:bg-[HighlightText]"
              : "bg-[color:var(--surface-raised)] forced-colors:bg-[CanvasText]"
          }`}
        />
      </span>
    </button>
  );
}

/** The one filled action at the foot of a screen, with an optional grey line under it. */
export function FootAction({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mt-4 flex flex-col gap-2 px-1 pb-6">
      {children}
      {note ? <p className="text-center text-2xs font-medium text-[color:var(--text-muted)]">{note}</p> : null}
    </div>
  );
}

/** Loading rows: the shape of the list, never "nothing open". */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading open shifts" className="flex flex-col gap-2 py-2">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-[var(--work-radius-card,14px)] bg-[color:var(--surface-wash)] motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
