"use client";

import { ArrowLeftRight, Phone, Users } from "lucide-react";
import Link from "next/link";

import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { formatSpanUntil, relativeDay, shiftSpan } from "@/lib/roster/shifts-overview";
import { WEEKDAYS, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { kindOf } from "./roster-format";
import { rosterOutlineButton } from "./roster-list";
import { RosterWhoCanCover, rosterRequestHref } from "./roster-who-can-cover";

/**
 * The card that leads Shifts: the shift on now, or the next one. A thin
 * 24-hour strip shows where it falls in the day; an overnight shift is drawn
 * on a noon-to-noon axis so it shows in one piece. Swap and Find cover are
 * offered only for a team shift, because only a team roster can be swapped.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function weekdayName(instant: string): string {
  return WEEKDAYS[new Date(`${perthDateOf(instant)}T00:00:00Z`).getUTCDay()]!;
}

function hoursFromPerthMidnight(instant: string, date: string): number {
  return (Date.parse(instant) - Date.parse(`${date}T00:00:00+08:00`)) / HOUR_MS;
}

function DayStrip({ shift }: { readonly shift: OnCallShift }) {
  const date = perthDateOf(shift.startsAt);
  const overnight = perthDateOf(shift.endsAt) !== date && perthTimeOf(shift.endsAt) !== "00:00";
  const origin = overnight ? 12 : 0;
  const from = Math.max(0, hoursFromPerthMidnight(shift.startsAt, date) - origin);
  const to = Math.min(24, hoursFromPerthMidnight(shift.endsAt, date) - origin);
  const ticks = overnight ? ["12", "18", "00", "06", "12"] : ["00", "06", "12", "18", "24"];
  return (
    <div aria-hidden="true" className="grid gap-1" data-testid="roster-next-shift-strip">
      <svg className="h-2 w-full overflow-visible">
        <rect width="100%" height="100%" rx="4" className="fill-[color:var(--surface-inset)]" />
        {to > from ? (
          <rect
            x={`${(from / 24) * 100}%`}
            width={`${((to - from) / 24) * 100}%`}
            height="100%"
            rx="4"
            className="fill-[color:var(--mode-identity)]"
          />
        ) : null}
      </svg>
      <span className="nums flex justify-between text-2xs text-[color:var(--text-muted)]">
        {ticks.map((tick, index) => (
          <span key={`${tick}-${index}`}>{tick}</span>
        ))}
      </span>
      {overnight ? (
        <span className="text-2xs text-[color:var(--text-muted)]">
          {weekdayName(shift.startsAt)} 12:00 to{" "}
          {weekdayName(new Date(Date.parse(shift.startsAt) + DAY_MS).toISOString())} 12:00
        </span>
      ) : null}
    </div>
  );
}

export function RosterNextShift({
  shift,
  onNow,
  now,
  actorId,
}: {
  readonly shift: OnCallShift;
  readonly onNow: boolean;
  readonly now: Date;
  readonly actorId: string | null;
}) {
  const kind = kindOf(shift);
  const date = perthDateOf(shift.startsAt);
  const place = shift.workplace ?? shift.location;
  const endWords = `${weekdayName(shift.endsAt)} ${perthTimeOf(shift.endsAt)}`;
  const eyebrow = onNow
    ? `On shift now · ${formatPerthDay(date)} ${SHIFT_KIND_LABEL[kind].toLowerCase()}`
    : `Next shift · ${relativeDay(date, perthDateOf(now))}`;
  const big = onNow ? shiftSpan(shift) : `${formatPerthDay(date)} · ${shiftSpan(shift)}`;
  const sub = onNow
    ? [place, `${formatSpanUntil(Date.parse(shift.endsAt) - now.getTime())} left`, `ends ${endWords}`]
    : [SHIFT_KIND_LABEL[kind], place, `starts in ${formatSpanUntil(Date.parse(shift.startsAt) - now.getTime())}`];
  const team = shift.source === "team" && shift.assignmentId && shift.serviceId ? shift : null;

  return (
    <section
      data-mode-identity="roster"
      aria-label={onNow ? "On shift now" : "Next shift"}
      className={cn(modeModuleSurface, "grid gap-3 p-4 shadow-none")}
      data-testid="roster-next-shift"
    >
      <h2 className="text-2xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]">{eyebrow}</h2>
      <div className="-mt-2 grid gap-0.5">
        <p className="nums text-xl font-semibold leading-tight text-[color:var(--text-heading)]">{big}</p>
        <p className="text-sm text-[color:var(--text-muted)]">{sub.filter(Boolean).join(" · ")}</p>
      </div>
      <DayStrip shift={shift} />
      {onNow ? (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/roster/team" className={rosterOutlineButton}>
            <Users aria-hidden="true" strokeWidth={1.6} className="size-icon-md text-[color:var(--text-muted)]" />
            Who is on
          </Link>
          <Link href="/on-call/contacts" className={rosterOutlineButton}>
            <Phone aria-hidden="true" strokeWidth={1.6} className="size-icon-md text-[color:var(--text-muted)]" />
            Phone numbers
          </Link>
        </div>
      ) : team ? (
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={rosterRequestHref("swap", team.assignmentId!, team.serviceId!)}
            className={rosterOutlineButton}
            aria-label={`Swap your ${SHIFT_KIND_LABEL[kind].toLowerCase()} shift on ${formatPerthDay(date)}`}
          >
            <ArrowLeftRight
              aria-hidden="true"
              strokeWidth={1.6}
              className="size-icon-md text-[color:var(--text-muted)]"
            />
            Swap
          </Link>
          {actorId ? (
            <RosterWhoCanCover
              variant="button"
              label="Find cover"
              serviceId={team.serviceId!}
              assignmentId={team.assignmentId!}
              actorId={actorId}
              startsAt={team.startsAt}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
