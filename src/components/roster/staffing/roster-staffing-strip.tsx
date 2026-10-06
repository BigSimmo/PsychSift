import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { WEEKDAYS } from "@/lib/roster/shifts/perth-time";
import {
  inRange,
  onIfAway,
  staffingDayLabel,
  type StaffingDay,
  type StaffingWindow,
} from "@/lib/roster/staffing/team-staffing";

/**
 * The staffing strip: one column per day, seven to a row, each a flat bar
 * whose height is how many of the team are on. Leave days sit on a soft violet
 * tile and show your own place as a hollow block (you come off). A day the
 * published roster does not reach is hatched with a "?", never drawn as fine.
 * There is no safe line: PsychSift does not hold the team's safe number.
 *
 * Every column carries its full sentence for screen readers. With `onPick`
 * each column is a 48px button that picks dates. Presentational only.
 */

const BAR_PX = 56;

export function RosterStaffingStrip({
  days,
  leave,
  today,
  lowestDays = [],
  onPick,
  label = "How many of the team are on each day",
  testId,
}: {
  readonly days: readonly StaffingDay[];
  readonly leave: StaffingWindow | null;
  readonly today: string;
  /** The leave days with the fewest on, marked for the eye and for screen readers. */
  readonly lowestDays?: readonly string[];
  readonly onPick?: (date: string) => void;
  readonly label?: string;
  readonly testId?: string;
}) {
  const known = days.map((day) => day.on ?? 0);
  const top = Math.max(1, ...known);
  const weeks: StaffingDay[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));

  return (
    <div className="grid gap-3" data-mode-identity="roster" data-testid={testId}>
      {weeks.map((week, weekIndex) => (
        <ul
          key={week[0]!.date}
          role="list"
          aria-label={weekIndex === 0 ? label : `${label}, week ${weekIndex + 1}`}
          className="nums grid grid-cols-7 gap-1"
        >
          {week.map((day) => {
            const away = inRange(day.date, leave);
            const unknown = day.on === null;
            const count = unknown ? null : away ? onIfAway(day)! : day.on!;
            const lowest = away && lowestDays.includes(day.date);
            const past = day.date < today;
            const filled = count ?? 0;
            const height = unknown ? BAR_PX * 0.7 : Math.max(2, Math.round((filled / top) * BAR_PX));
            const youHeight = away && day.youWork && !unknown ? Math.max(4, Math.round(BAR_PX / top)) : 0;
            const weekday = WEEKDAYS[new Date(`${day.date}T00:00:00Z`).getUTCDay()]!;
            const sentence = `${staffingDayLabel(day, leave)}${lowest ? ", fewest on" : ""}${away ? ", in your leave" : ""}${past ? ", past" : ""}`;
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-xs font-bold leading-none",
                    unknown
                      ? "text-[color:var(--text-muted)]"
                      : lowest
                        ? "text-[color:var(--mode-identity)]"
                        : "text-[color:var(--text-heading)]",
                  )}
                >
                  {unknown ? "?" : count}
                </span>
                <span aria-hidden="true" className="flex w-5 flex-col justify-end" style={{ height: BAR_PX }}>
                  {youHeight ? (
                    <span
                      className="mb-0.5 block w-full rounded-sm border-[1.5px] border-[color:var(--mode-identity)] bg-[color:var(--surface-raised)]"
                      style={{ height: youHeight }}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "block w-full rounded-sm",
                      unknown
                        ? "border border-[color:var(--border-strong)] bg-[repeating-linear-gradient(135deg,var(--surface-subtle)_0_3px,var(--surface-raised)_3px_5px)]"
                        : "bg-[color:var(--mode-identity)]",
                      past && !unknown && "opacity-45",
                    )}
                    style={{ height }}
                  />
                </span>
                <span aria-hidden="true" className="grid justify-items-center leading-tight">
                  <span
                    className={cn(
                      "text-2xs font-semibold uppercase tracking-wide",
                      away ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
                    )}
                  >
                    {weekday}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      day.date === today ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-heading)]",
                    )}
                  >
                    {Number(day.date.slice(8, 10))}
                  </span>
                </span>
              </>
            );
            const tile = cn(
              "grid min-h-12 w-full justify-items-center gap-1.5 rounded-lg py-2",
              away && "border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)]",
              !away && "border border-transparent",
            );
            return (
              <li key={day.date} className="min-w-0" data-staffing-day={day.date}>
                {onPick && !past ? (
                  <button
                    type="button"
                    aria-label={sentence}
                    aria-pressed={away}
                    onClick={() => onPick(day.date)}
                    className={cn(tile, focusRing)}
                  >
                    {body}
                  </button>
                ) : (
                  <span role="img" aria-label={sentence} className={tile}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

export function RosterStaffingLegend({ showYou }: { readonly showYou: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-2xs font-semibold text-[color:var(--text-muted)]"
      data-mode-identity="roster"
    >
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-2 w-3 rounded-sm bg-[color:var(--mode-identity)]" />
        On
      </span>
      {showYou ? (
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-3 rounded-sm border-[1.5px] border-[color:var(--mode-identity)] bg-[color:var(--surface-raised)]" />
          You, on leave
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-2 w-3 rounded-sm border border-[color:var(--border-strong)] bg-[repeating-linear-gradient(135deg,var(--surface-subtle)_0_3px,var(--surface-raised)_3px_5px)]" />
        Not published
      </span>
    </div>
  );
}
