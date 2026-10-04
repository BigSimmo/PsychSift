import type { AppModeId } from "@/lib/app-modes";
import { formatPerthDateTime } from "@/lib/mha-timeline";
import type { MhaTimersResult } from "@/lib/on-call/mha-timers";
import type { FatigueResult } from "@/lib/roster/fatigue-rules";

/**
 * The Mental Health Act timer and roster fatigue results as Today items, for My Day and each mode's
 * Today page. The CPD adapter is `src/lib/cme/coaching-today-items.ts`, because Admin reads no CPD data.
 *
 * `TodayItem` below mirrors `src/lib/today/today-item.ts` from the Today layout branch (PR #3224),
 * field for field. Once that lands on main, delete this copy and import the shared type instead.
 *
 * Every adapter returns NOTHING while its engine is switched off: an unsigned rule set produces no
 * item, rather than an item saying it is unsigned. Severity bands use no invented threshold:
 * - a Mental Health Act countdown is `soon` while running (a statutory clock is always time-bound)
 *   and `overdue` once its deadline has passed;
 * - fatigue warnings and CPD lines are `info`, because they are neutral memory aids, not deadlines.
 * Items carry no patient identifiers: a countdown names the form and the limit, never the person.
 */

export type TodaySeverity = "overdue" | "soon" | "info";

export interface TodayItem {
  readonly id: string;
  readonly mode: AppModeId;
  readonly title: string;
  readonly detail?: string;
  readonly due: string | null;
  readonly severity: TodaySeverity;
  readonly href: string;
}

/** Countdowns only; quote-only entries stay on the form page's Timeline, not in Today. */
export function mhaTimerTodayItems(result: MhaTimersResult): TodayItem[] {
  if (!result.gate.on) return [];
  return result.items.flatMap((item): TodayItem[] =>
    item.kind === "countdown"
      ? [
          {
            id: `on-call:mha-timer:${item.timerId}:${item.entry.id}${item.occurrence > 1 ? `:${item.occurrence}` : ""}`,
            mode: "on-call",
            title: `Form ${item.entry.formCodes.join(" / ")}: ${item.entry.trigger}`,
            detail: `${item.expired ? "Time limit passed" : "Time limit"} ${formatPerthDateTime(item.deadline)}. ${item.repeatsEveryHours === null ? "" : `Repeats every ${item.repeatsEveryHours} hours while the order is in force. `}Section ${item.entry.section}; the Act, not this reminder, decides.`,
            due: item.deadline.toISOString(),
            severity: item.expired ? "overdue" : "soon",
            href: "/on-call",
          },
        ]
      : [],
  );
}

/** One item per fatigue warning, dated to the shift it sits on. */
export function fatigueTodayItems(result: FatigueResult, shiftStarts: ReadonlyMap<string, string>): TodayItem[] {
  if (!result.gate.on) return [];
  return result.warnings.map((warning) => ({
    id: `roster:fatigue:${warning.shiftId}:${warning.rule}`,
    mode: "roster",
    title: warning.words,
    detail: `Clause ${warning.citation.clause}: "${warning.citation.quote}"`,
    due: shiftStarts.get(warning.shiftId) ?? null,
    severity: "info",
    href: "/roster",
  }));
}
