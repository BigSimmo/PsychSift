"use client";

import { ChevronLeft, ChevronRight, CircleCheck, CircleHelp, CircleX, TriangleAlert } from "lucide-react";
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
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

/*
 * The pieces every Open shifts page shares, so the last screen is drawn from
 * the same parts as the first: flat lists with inset hairlines, one type
 * scale, colour only where it means something (green no problem, amber a
 * roster flag, red an overlap), thin icons, 48px tap areas.
 */

export const OPEN_SHIFTS_HREF = "/open-shifts";
export const advertHref = (listing: Pick<OpenShiftListing, "serviceId" | "id">) =>
  `${OPEN_SHIFTS_HREF}/shift/${encodeURIComponent(listing.serviceId)}/${encodeURIComponent(listing.id)}`;
export const postedShiftHref = (serviceId: string, id: string) =>
  `${OPEN_SHIFTS_HREF}/post/${encodeURIComponent(serviceId)}/${encodeURIComponent(id)}`;

const dayLong = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Australia/Perth",
});
const dayShort = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Australia/Perth",
});
const weekdayShort = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Perth" });

/** "Wednesday 7 October" for a Perth date. */
export function formatDayLong(date: string): string {
  return dayLong.format(new Date(`${date}T12:00:00+08:00`));
}

/** "Wed 7 Oct" for a Perth date. */
export function formatDayShort(date: string): string {
  return dayShort.format(new Date(`${date}T12:00:00+08:00`)).replace(/,/g, "");
}

export function formatWeekday(date: string): string {
  return weekdayShort.format(new Date(`${date}T12:00:00+08:00`));
}

/** "08:00–16:30", with the end day named when it ends on a later day ("21:30–08:00 Thu"). */
export function formatShiftTimes(startsAt: string, endsAt: string): string {
  const end = perthTimeOf(endsAt);
  const suffix = endsNextDay(startsAt, endsAt) ? ` ${formatWeekday(perthDateOf(endsAt))}` : "";
  return `${perthTimeOf(startsAt)}–${end}${suffix}`;
}

/** "Starts in 2 days", "Starts today", "Starts tomorrow". */
export function startsIn(startsAt: string, now: Date): string {
  const days = Math.round(
    (Date.parse(`${perthDateOf(startsAt)}T00:00:00Z`) - Date.parse(`${perthDateOf(now)}T00:00:00Z`)) / 86_400_000,
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
      return { tone: "ok", text: "No roster problems found" };
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
  }
}

const TONE_CLASS: Readonly<Record<CheckTone, string>> = {
  ok: "text-[color:var(--success-text)]",
  warn: "text-[color:var(--warning-text)]",
  bad: "text-[color:var(--danger-text)]",
  muted: "text-[color:var(--text-muted)]",
};

const TONE_ICON = { ok: CircleCheck, warn: TriangleAlert, bad: CircleX, muted: CircleHelp } as const;

export function CheckLine({ check }: { check: RosterCheck }) {
  const { tone, text } = checkSummary(check);
  const Icon = TONE_ICON[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      <Icon aria-hidden="true" strokeWidth={1.6} className="size-icon-xs shrink-0" />
      {text}
    </span>
  );
}

export function ToneIcon({ tone }: { tone: CheckTone }) {
  const Icon = TONE_ICON[tone];
  return <Icon aria-hidden="true" strokeWidth={1.6} className={`size-icon-md shrink-0 ${TONE_CLASS[tone]}`} />;
}

// ------------------------------------------------------------------ rows

/** A flat list: rows sit on the page with inset hairlines, no card. */
export function FlatList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="flex flex-col" aria-label={label}>
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
        className={`flex min-h-13 items-start gap-4 px-3 py-3.5 no-underline ${modePressable} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus-ring,var(--command))]`}
      >
        <span className="flex w-12 shrink-0 flex-col text-xs nums text-[color:var(--text-muted)]">
          <span className="font-semibold text-[color:var(--text-heading)]">{perthTimeOf(listing.startsAt)}</span>
          <span>{perthTimeOf(listing.endsAt)}</span>
          <span>{formatHours(hours)}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{shiftTitle(listing)}</span>
          <span className="text-sm text-[color:var(--text-muted)]">{shiftPlace(listing)}</span>
          {meta ? <span className="text-sm text-[color:var(--text-muted)]">{meta}</span> : null}
          {status ?? (check ? <span className="mt-1">{<CheckLine check={check} />}</span> : null)}
        </span>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.6}
          className="mt-3 size-icon-md shrink-0 text-[color:var(--text-soft)]"
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
      className="mt-6 flex items-baseline justify-between px-3 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]"
    >
      <span>{children}</span>
      {count !== undefined ? <span className="nums font-medium">{count}</span> : null}
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
      className={`flex items-start gap-2.5 px-3 py-3 text-sm ${tone === "warn" ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]"}`}
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
        className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
      >
        <ChevronLeft aria-hidden="true" strokeWidth={1.6} className="size-icon-lg" />
      </Link>
      <h1 className="min-w-0 flex-1 text-base font-semibold text-[color:var(--text-heading)]">{title}</h1>
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
      className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-7 w-12 rounded-full border transition-colors duration-[var(--duration-instant)] forced-colors:border-[CanvasText] ${
          checked
            ? "border-[color:var(--command)] bg-[color:var(--command)]"
            : "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5.5 rounded-full shadow-[var(--e1)] transition-[left] duration-[var(--duration-instant)] motion-reduce:transition-none forced-colors:bg-[CanvasText] ${
            checked ? "left-[1.375rem] bg-[color:var(--command-contrast)]" : "left-0.5 bg-[color:var(--surface-raised)]"
          }`}
        />
      </span>
    </button>
  );
}

/** The one filled action at the foot of a screen, with an optional grey line under it. */
export function FootAction({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col gap-2 px-3 pb-6">
      {children}
      {note ? <p className="text-center text-sm text-[color:var(--text-muted)]">{note}</p> : null}
    </div>
  );
}

/** Loading rows: the shape of the list, never "nothing open". */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="img" aria-label="Loading open shifts" className="flex flex-col gap-3 px-3 py-4">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-md bg-[color:var(--surface-subtle)] motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
