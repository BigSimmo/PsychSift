import { addDays, dayParts, mondayOf, perthDateKey } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { cn, textMuted } from "@/components/ui-primitives";

/*
 * Sessions attended per week for 12 weeks: plum bars, a 2px stub for none,
 * this week in product blue, and the same facts in words. Counts only; no
 * denominator, which would read as a score of the doctor.
 */
export type AttendanceWeek = { key: string; label: string; count: number };

export function attendanceWeeks(startsAt: readonly string[], today: string): AttendanceWeek[] {
  const thisWeek = mondayOf(today);
  const weeks: AttendanceWeek[] = Array.from({ length: 12 }, (_, index) => {
    const key = addDays(thisWeek, (index - 11) * 7);
    const parts = dayParts(key);
    return { key, label: `${parts.day} ${parts.month}`, count: 0 };
  });
  const byKey = new Map(weeks.map((week) => [week.key, week]));
  for (const iso of startsAt) {
    const week = byKey.get(mondayOf(perthDateKey(iso)));
    if (week) week.count += 1;
  }
  return weeks;
}

/** "Attended in 11 of the last 12 weeks. None in the week of 7 Sep." A single gap is named. */
export function attendanceSentence(weeks: readonly AttendanceWeek[]): string {
  const attended = weeks.filter((week) => week.count > 0).length;
  const missed = weeks.filter((week) => week.count === 0);
  const first = `Attended in ${withUnit(attended, "of")} the last ${withUnit(weeks.length, "weeks")}.`;
  return missed.length === 1 ? `${first} None in the week of ${missed[0].label}.` : first;
}

export function AttendanceChart({ weeks, currentKey }: { weeks: readonly AttendanceWeek[]; currentKey: string }) {
  const max = Math.max(1, ...weeks.map((week) => week.count));
  const slot = 100 / weeks.length;
  return (
    <figure data-testid="teaching-attendance-chart" className="grid gap-2 px-3 pt-2 pb-3">
      <svg aria-hidden="true" viewBox="0 0 100 40" preserveAspectRatio="none" className="h-10 w-full">
        {weeks.map((week, index) => {
          const isCurrent = week.key === currentKey;
          const height = week.count === 0 ? 1.5 : Math.max(3, (week.count / max) * 37);
          const fill =
            week.count === 0
              ? "fill-[color:var(--border)]"
              : isCurrent
                ? "fill-[color:var(--mode-identity)]"
                : "fill-[color:var(--mode-identity-soft)] forced-colors:fill-[GrayText]";
          return (
            <rect
              key={week.key}
              data-week={week.key}
              data-current={String(isCurrent)}
              x={String(index * slot + slot * 0.3)}
              y={String(39 - height)}
              width={String(slot * 0.4)}
              height={String(height)}
              rx="0.6"
              className={fill}
            />
          );
        })}
        <line x1="0" y1="39.5" x2="100" y2="39.5" className="stroke-[color:var(--border)]" strokeWidth="1" />
      </svg>
      <div className={cn("flex justify-between text-xs", textMuted)}>
        <span>12 weeks ago</span>
        <span>This week</span>
      </div>
      <figcaption className={cn("text-sm", textMuted)}>{attendanceSentence(weeks)}</figcaption>
    </figure>
  );
}
