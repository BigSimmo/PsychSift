import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { WEEKDAYS } from "@/lib/roster/shifts/perth-time";
import {
  STAFFING_COUNTS_WORDS,
  hasSafeNumber,
  inRange,
  judgeDay,
  onIfAway,
  staffingDayLabel,
  type StaffingDay,
  type StaffingNeed,
  type StaffingWindow,
} from "@/lib/roster/staffing/team-staffing";

/**
 * The staffing strip: one column per day, a week to a row, each a flat bar
 * whose height is how many of the team are on. Leave days sit on a soft violet
 * tile and show your own place as a hollow block (you come off). A day the
 * published roster does not reach is hatched with a "?", never drawn as fine.
 * There is no safe line: PsychSift does not hold the team's safe number.
 *
 * Only Day and Evening shifts count as people on, and the strip says so under
 * the bars. Every column carries its full sentence for screen readers. With
 * `onPick` each column is a button at least 48px wide: on a narrow phone the
 * week scrolls sideways inside its own row, never the page. Presentational
 * only.
 */

/** Bar track height in px; the track itself is `h-14` (56px), so keep the two in step. */
const BAR_PX = 56;

/** The amber review tag the roster already uses for a crossed rule: border, tint and text together. */
export const BELOW_SAFE_TAG =
  "border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]";

export function RosterStaffingStrip({
  days,
  leave,
  today,
  lowestDays = [],
  needs = null,
  onPick,
  label = "How many of the team are on a Day or Evening shift each day",
  testId,
}: {
  readonly days: readonly StaffingDay[];
  readonly leave: StaffingWindow | null;
  readonly today: string;
  /** The leave days with the fewest on, marked for the eye and for screen readers. */
  readonly lowestDays?: readonly string[];
  /** The team's cover needs. Null or absent: no safe number to judge against. */
  readonly needs?: readonly StaffingNeed[] | null;
  readonly onPick?: (date: string) => void;
  readonly label?: string;
  readonly testId?: string;
}) {
  const known = days.map((day) => day.on ?? 0);
  const top = Math.max(1, ...known);
  const judging = hasSafeNumber(needs);
  const weeks: StaffingDay[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));

  return (
    <div className="grid gap-3" data-mode-identity="roster" data-testid={testId}>
      {weeks.map((week, weekIndex) => (
        <ul
          key={week[0]!.date}
          role="list"
          aria-label={weekIndex === 0 ? label : `${label}, week ${weekIndex + 1}`}
          data-no-tab-swipe
          className="nums grid min-w-0 auto-cols-fr grid-flow-col gap-1 overflow-x-auto overscroll-x-contain"
        >
          {week.map((day) => {
            const away = inRange(day.date, leave);
            const unknown = day.on === null;
            const count = unknown ? null : away ? onIfAway(day)! : day.on!;
            const lowest = away && lowestDays.includes(day.date);
            const judgement = judging && needs ? judgeDay(day, needs, away) : null;
            const below = !!judgement?.below;
            const past = day.date < today;
            const filled = count ?? 0;
            const height = unknown ? BAR_PX * 0.7 : Math.max(2, Math.round((filled / top) * BAR_PX));
            const youHeight = away && day.youWork && !unknown ? Math.max(4, Math.round(BAR_PX / top)) : 0;
            const weekday = WEEKDAYS[new Date(`${day.date}T00:00:00Z`).getUTCDay()]!;
            const sentence = `${staffingDayLabel(day, leave, judging ? needs : null)}${lowest ? ", fewest on" : ""}${away ? ", in your leave" : ""}${past ? ", past" : ""}`;
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-xs font-bold leading-none",
                    unknown
                      ? "text-[color:var(--text-muted)]"
                      : below
                        ? "text-[color:var(--warning-text)]"
                        : lowest
                          ? "text-[color:var(--mode-identity)]"
                          : "text-[color:var(--text-heading)]",
                  )}
                >
                  {unknown ? "?" : count}
                </span>
                <span aria-hidden="true" className="flex h-14 w-5 flex-col justify-end">
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
                {judging ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "nums min-h-4 whitespace-nowrap rounded-sm px-1 text-2xs font-semibold leading-4",
                      below ? BELOW_SAFE_TAG : "text-[color:var(--text-muted)]",
                    )}
                    data-staffing-need={judgement ? judgement.needed : undefined}
                  >
                    {judgement ? `needs ${judgement.needed}` : ""}
                  </span>
                ) : null}
              </>
            );
            const tile = cn(
              "grid min-h-12 w-full justify-items-center gap-1.5 rounded-lg py-2",
              away && "border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)]",
              !away && "border border-transparent",
            );
            return (
              <li
                key={day.date}
                className="min-w-12"
                data-staffing-day={day.date}
                data-below-safe={below ? "true" : undefined}
              >
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
      <p className="text-xs text-[color:var(--text-muted)]" data-testid="staffing-counts">
        {STAFFING_COUNTS_WORDS}
      </p>
    </div>
  );
}

export function RosterStaffingLegend({
  showYou,
  showBelow = false,
}: {
  readonly showYou: boolean;
  /** Some day shown is below the safe number. */
  readonly showBelow?: boolean;
}) {
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
      {showBelow ? (
        <span className="inline-flex items-center gap-1.5">
          <i className={cn("inline-block h-2 w-3 rounded-sm", BELOW_SAFE_TAG)} />
          Below safe number
        </span>
      ) : null}
    </div>
  );
}
