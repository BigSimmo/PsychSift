"use client";

import { ModeGroupedList } from "@/components/mode-kit/grouped-list";
import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment } from "@/lib/roster/team/model";
import { groupByGrade, timelineSpan } from "@/lib/roster/team/team-view";

/**
 * One day as a timeline per person, grouped by grade. The rows are already
 * filtered; the read window includes the day before, so a night that began
 * yesterday still shows "to 07:30".
 */
export function DayView({
  actorId,
  now,
  day,
  today,
  rows,
  onSelect,
}: {
  actorId: string | null;
  now: Date;
  day: string;
  today: string;
  rows: readonly RosterAssignment[];
  onSelect: (shift: RosterAssignment) => void;
}) {
  const visible = rows.filter((row) => timelineSpan(row, day));
  const nowMinute = Number(perthTimeOf(now).slice(0, 2)) * 60 + Number(perthTimeOf(now).slice(3, 5));
  return (
    <>
      <div className="mx-px flex items-center justify-between gap-3 pl-3 pr-1 text-sm text-[color:var(--text-muted)]">
        <span>{day === today ? `Now ${perthTimeOf(now)}` : "Perth time"}</span>
        <span
          data-testid="roster-timeline-axis"
          className="flex w-36 shrink-0 justify-between nums text-xs"
          aria-hidden="true"
        >
          {["00", "06", "12", "18", "24"].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </span>
      </div>
      {groupByGrade(visible).map((group) => (
        <ModeGroupedList key={group.label} eyebrow={group.label} mode="roster">
          {group.assignments.map((row) => {
            const span = timelineSpan(row, day)!;
            const displayName = row.userId === actorId ? "You" : (row.name ?? "Name not available");
            const initial = row.name?.trim().charAt(0).toUpperCase() ?? "?";
            return (
              <li key={row.id} className={cn(modeInsetHairline, "flex min-w-0")}>
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  className={cn(
                    modePressable,
                    focusRing,
                    "flex min-h-12 min-w-0 flex-1 items-center gap-3 py-1 pl-3 pr-1 text-left",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      className="grid size-8 shrink-0 place-items-center rounded-full border border-[color:var(--border)] text-sm"
                    >
                      {initial}
                    </span>
                    <span className="break-words">{displayName}</span>
                  </span>
                  <span
                    data-mode-identity="roster"
                    className="grid w-36 shrink-0 gap-1 nums text-right text-sm font-normal"
                  >
                    <span>{span.label}</span>
                    <svg
                      data-testid="roster-timeline-bar"
                      viewBox="0 0 1440 32"
                      preserveAspectRatio="none"
                      className="h-3 w-full"
                      aria-hidden="true"
                    >
                      <rect width="1440" height="32" rx="12" fill="var(--surface-wash)" />
                      <rect
                        x={span.startMinute}
                        width={span.endMinute - span.startMinute}
                        height="32"
                        rx="12"
                        fill={row.userId === actorId ? "var(--mode-identity)" : "var(--text-muted)"}
                      />
                      {day === today ? (
                        <line
                          x1={nowMinute}
                          x2={nowMinute}
                          y1="0"
                          y2="32"
                          stroke="var(--info)"
                          strokeWidth="2"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                    </svg>
                  </span>
                </button>
              </li>
            );
          })}
        </ModeGroupedList>
      ))}
      {!visible.length ? <p>No shifts on this day.</p> : null}
    </>
  );
}
