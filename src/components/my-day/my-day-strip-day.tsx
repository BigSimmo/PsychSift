"use client";

import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { dayCode, perthWeekday, SHIFT_CODE } from "@/lib/my-day/quiet-figures";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { formatPerthDay } from "@/lib/roster/shifts/perth-time";

/** A roster kind's bar colour: the work-mode shift-code tokens (a Late is the same violet everywhere). */
export const SHIFT_BAR: Readonly<Record<ShiftKind, string>> = {
  day: "bg-[color:var(--work-shift-d)]",
  evening: "bg-[color:var(--work-shift-l)]",
  night: "bg-[color:var(--work-shift-n)]",
  on_call: "bg-[color:var(--work-shift-oc)]",
  leave: "bg-[color:var(--work-shift-al)]",
  other: "bg-[color:var(--work-shift-d)]",
};

export function hoursText(value: number): string {
  return `${Number(value.toFixed(1))}`;
}

/** One day in the strip: its weekday, its date, a bar in its shift's colour and the code in words. */
export function StripDay({
  date,
  today,
  kinds,
  due,
  href,
}: {
  readonly date: string;
  readonly today: string;
  /** Null when no roster is available: then no code is drawn, rather than a false "off". */
  readonly kinds: readonly ShiftKind[] | null;
  readonly due: number;
  /** Where a tap goes (the Week page), or nothing. */
  readonly href?: string;
}) {
  const code = kinds ? dayCode(kinds) : null;
  const off = kinds !== null && code === null;
  const isToday = date === today;
  const words = [
    kinds ? (kinds.length ? kinds.map((kind) => SHIFT_KIND_LABEL[kind]).join(" and ") : "Off") : "",
    due ? `${due} due` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const tile = cn(
    "relative grid min-h-13 content-center justify-items-center gap-0.5 rounded-xl border py-1.5 no-underline forced-colors:border",
    isToday
      ? "border-transparent bg-[color:var(--mode-identity)]"
      : "border-[color:var(--work-line)] bg-[color:var(--work-surface)]",
  );
  const inner = (
    <>
      <span className="sr-only">{words ? `${formatPerthDay(date)}: ${words}` : formatPerthDay(date)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "text-3xs font-bold tracking-wider uppercase",
          isToday ? "text-[color:var(--mode-identity-contrast)]" : "text-[color:var(--text-muted)]",
        )}
      >
        {perthWeekday(date)}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "text-lg-minus leading-none font-bold nums",
          isToday
            ? "text-[color:var(--mode-identity-contrast)]"
            : off
              ? "text-[color:var(--text-muted)]"
              : "text-[color:var(--work-ink)]",
        )}
      >
        {Number(date.slice(8, 10))}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-0.75 w-[1.125rem] rounded-full forced-colors:bg-[CanvasText]",
          code ? (isToday ? "bg-[color:var(--mode-identity-contrast)]" : SHIFT_BAR[code]) : "bg-transparent",
        )}
      />
      {due ? (
        <span
          data-testid={`dash-week-due-${date}`}
          data-passed={date < today ? "" : undefined}
          aria-hidden="true"
          className={cn(
            "absolute top-1 right-1 size-1.5 rounded-full forced-colors:bg-[CanvasText]",
            date < today ? "bg-[color:var(--warning-text)]" : "bg-[color:var(--neutral-400)]",
          )}
        />
      ) : null}
    </>
  );
  return (
    <li
      className="grid min-w-0 gap-0.5 text-center"
      data-testid={`dash-week-tile-${date}`}
      data-kind={code ?? (off ? "off" : "none")}
      aria-current={isToday ? "date" : undefined}
    >
      {href ? (
        <Link href={href} className={cn(focusRing, tile)}>
          {inner}
        </Link>
      ) : (
        <span className={tile}>{inner}</span>
      )}
      <span aria-hidden="true" className="min-h-3 text-3xs font-bold text-[color:var(--text-muted)]">
        {code ? SHIFT_CODE[code] : off ? "off" : ""}
      </span>
    </li>
  );
}
