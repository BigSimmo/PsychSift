"use client";

import {
  ArrowLeftRight,
  CalendarOff,
  CalendarRange,
  Clock,
  Flag,
  Plane,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { WorkButton, WorkCard, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { shiftSpan } from "@/lib/roster/shifts-overview";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { formatHours, kindOf } from "./roster-format";
import { RosterInitials } from "./roster-list";
import { longDay, RosterShiftChip } from "./roster-month-grid";
import { RosterWhoCanCover, rosterRequestHref } from "./roster-who-can-cover";

/**
 * The day sheet (mockup `rost_day`): tap a day on the Month calendar. Says
 * what is rostered, any rest warning on it, who from your team overlaps, and
 * offers the real hand-offs for that day: Swap, Give away and Can't make for
 * a team shift; Can't work, Prefer off and Plan leave for a day off. Nothing
 * here is invented: a row shows only when its data loaded.
 */

export type RosterDayCue = { readonly warning?: string | null };
export type RosterDayColleague = { readonly name: string; readonly kind: string; readonly until: string };

function relativeWords(date: string, today: string): string | undefined {
  if (date === today) return "Today";
  if (date === addDaysToDate(today, 1)) return "Tomorrow";
  if (date === addDaysToDate(today, -1)) return "Yesterday";
  return undefined;
}

function hoursOf(shift: OnCallShift): number {
  return Math.round(((Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 3_600_000) * 100) / 100;
}

export function RosterDaySheet({
  date,
  today,
  shifts,
  cues,
  holiday,
  colleagues,
  teamId,
  actorId,
  notLoaded = false,
  onClose,
}: {
  /** The open day, or null when the sheet is shut. */
  readonly date: string | null;
  readonly today: string;
  /** Your shifts that start on this day. */
  readonly shifts: readonly OnCallShift[];
  readonly cues: ReadonlyMap<string, RosterDayCue>;
  readonly holiday: boolean;
  /** Team members whose shifts overlap yours on this day, once the team roster loaded; null while unknown. */
  readonly colleagues: readonly RosterDayColleague[] | null;
  /** Your one team, for the dates hand-offs. */
  readonly teamId: string | null;
  readonly actorId: string | null;
  /** The day is before the part of your roster that loads. */
  readonly notLoaded?: boolean;
  readonly onClose: () => void;
}) {
  const open = date !== null;
  const day = date ?? today;
  const past = day < today;
  const working = shifts.filter((shift) => kindOf(shift) !== "leave");
  const team = working.find((shift) => shift.source === "team" && shift.assignmentId && shift.serviceId) ?? null;
  const teamParam = teamId ? `&team=${encodeURIComponent(teamId)}` : "";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={longDay(day)}
      description={relativeWords(day, today)}
      mobilePlacement="bottom"
      testId="roster-day-sheet"
    >
      <div className="grid gap-3 pb-2">
        <WorkCard as="ul" aria-label="This day">
          {notLoaded ? (
            <li>
              <WorkIconRow
                icon={CalendarRange}
                tone="neutral"
                title="Not loaded"
                sub="Your roster loads from three weeks back, so this day can't be shown."
              />
            </li>
          ) : shifts.length ? (
            shifts.map((shift) => {
              const kind = kindOf(shift);
              const place = shift.workplace ?? shift.location;
              const leave = kind === "leave";
              return (
                <li key={shift.id} data-testid="roster-day-sheet-shift">
                  <WorkIconRow
                    icon={leave ? Plane : Clock}
                    title={
                      leave ? shift.title || SHIFT_KIND_LABEL.leave : `${SHIFT_KIND_LABEL[kind]} · ${shiftSpan(shift)}`
                    }
                    sub={(leave ? ["All day", place] : [place, formatHours(hoursOf(shift))])
                      .filter(Boolean)
                      .join(" · ")}
                    end={<RosterShiftChip kind={kind} />}
                  />
                </li>
              );
            })
          ) : (
            <li>
              <WorkIconRow
                icon={CalendarOff}
                tone="neutral"
                title="Nothing rostered"
                sub={past ? "A day off in your roster" : "A day off, as your roster stands"}
              />
            </li>
          )}
          {working.map((shift) =>
            cues.get(shift.id)?.warning ? (
              <li key={`cue-${shift.id}`}>
                <WorkIconRow
                  icon={TriangleAlert}
                  tone="amber"
                  title={cues.get(shift.id)!.warning!}
                  sub="Open Hours and rest"
                  href="/roster?view=hours"
                  testId="roster-day-sheet-cue"
                />
              </li>
            ) : null,
          )}
          {holiday ? (
            <li>
              <WorkIconRow
                icon={Flag}
                tone="amber"
                title="WA public holiday"
                sub="Check your payslip for holiday rates"
              />
            </li>
          ) : null}
        </WorkCard>

        {colleagues && colleagues.length ? (
          <section className="grid gap-2" aria-labelledby="roster-day-sheet-with">
            <WorkSectionLabel id="roster-day-sheet-with">On with you</WorkSectionLabel>
            <WorkCard as="ul">
              {colleagues.map((person) => (
                <li key={`${person.name}-${person.until}`} className="work-row">
                  <RosterInitials name={person.name} />
                  <span className="work-row__text">
                    <span className="work-row__title">{person.name}</span>
                    <span className="work-row__sub nums">
                      {person.kind} · until {person.until}
                    </span>
                  </span>
                </li>
              ))}
            </WorkCard>
          </section>
        ) : null}

        {!past && team ? (
          <div className="grid gap-2" data-testid="roster-day-sheet-actions">
            <div className="grid grid-cols-3 gap-1.5">
              <WorkButton
                variant="secondary"
                icon={ArrowLeftRight}
                href={rosterRequestHref("swap", team.assignmentId!, team.serviceId!)}
              >
                Swap
              </WorkButton>
              <WorkButton
                variant="secondary"
                icon={Send}
                href={rosterRequestHref("give_away", team.assignmentId!, team.serviceId!)}
              >
                Give away
              </WorkButton>
              <WorkButton
                variant="secondary"
                icon={XCircle}
                href={`/roster/requests?start=cant_make&assignment=${encodeURIComponent(team.assignmentId!)}&team=${encodeURIComponent(team.serviceId!)}`}
              >
                Can&apos;t make
              </WorkButton>
            </div>
            {actorId ? (
              <RosterWhoCanCover
                variant="button"
                label="Who can cover?"
                serviceId={team.serviceId!}
                assignmentId={team.assignmentId!}
                actorId={actorId}
                startsAt={team.startsAt}
              />
            ) : null}
          </div>
        ) : null}

        {!past && !notLoaded && working.length === 0 ? (
          <div className="grid gap-2" data-testid="roster-day-sheet-off-actions">
            {teamId && actorId ? (
              <div className="grid grid-cols-2 gap-1.5">
                <WorkButton variant="secondary" href={`/roster/requests?start=dates&date=${day}${teamParam}&kind=cant`}>
                  Can&apos;t work
                </WorkButton>
                <WorkButton
                  variant="secondary"
                  href={`/roster/requests?start=dates&date=${day}${teamParam}&kind=prefer_off`}
                >
                  Prefer off
                </WorkButton>
              </div>
            ) : null}
            <WorkButton variant="tinted" icon={Plane} href={`/roster/requests?start=leave&date=${day}`}>
              Plan leave from this day
            </WorkButton>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
