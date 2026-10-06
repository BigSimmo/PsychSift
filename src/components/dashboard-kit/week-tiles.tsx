import { cn } from "@/components/ui-primitives";

/** How a day's tile is drawn. "none" draws no tile at all (no roster to say). */
export type DashDayTileKind = "work" | "night" | "on-call" | "leave" | "off" | "none";

export interface DashWeekDay {
  readonly date: string;
  /** "M", "T", … */
  readonly letter: string;
  /** The tile's short code: "D", "N", "OC", "off". */
  readonly code: string;
  readonly kind: DashDayTileKind;
  readonly today: boolean;
  /** Something falls due that day (a small amber mark, a passed or due date). */
  readonly due: boolean;
  /** The whole day in words, for screen readers. */
  readonly spoken: string;
}

const TILE: Readonly<Record<Exclude<DashDayTileKind, "none">, string>> = {
  work: "border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] text-[color:var(--dash-ink)]",
  night: "border border-[color:var(--dash-night)] bg-[color:var(--dash-night)] text-[color:var(--dash-page)]",
  "on-call": "border-2 border-[color:var(--dash-blue)] bg-[color:var(--dash-raised)] text-[color:var(--dash-blue)]",
  leave: "border border-dashed border-[color:var(--dash-line-strong)] text-[color:var(--dash-muted)]",
  off: "border border-dashed border-[color:var(--dash-line)] font-semibold text-[color:var(--dash-faint)]",
};

/** Seven day tiles, Monday first: the week strip in "This week". */
export function DashWeekTiles({ days, testId }: { readonly days: readonly DashWeekDay[]; readonly testId?: string }) {
  return (
    <ol className="grid grid-cols-7 gap-1 text-center" data-testid={testId}>
      {days.map((day) => (
        <li
          key={day.date}
          aria-current={day.today ? "date" : undefined}
          aria-label={day.spoken}
          className="grid justify-items-center gap-1"
          data-date={day.date}
        >
          <span aria-hidden="true" className="text-3xs font-dash-title text-[color:var(--dash-faint)]">
            {day.letter}
          </span>
          {day.kind === "none" ? (
            <span aria-hidden="true" className="size-8" />
          ) : (
            <span
              aria-hidden="true"
              data-kind={day.kind}
              className={cn(
                "grid size-8 place-items-center rounded-lg text-xs font-dash-title forced-colors:border",
                TILE[day.kind],
                // An outline, not a ring: the tile already owns its border edge.
                day.today && "outline-2 outline-offset-2 outline-[color:var(--dash-ink)] outline-solid",
              )}
            >
              {day.code}
            </span>
          )}
          <span
            aria-hidden="true"
            className={cn("size-1 rounded-full", day.due ? "bg-[color:var(--dash-amber)]" : "bg-transparent")}
          />
        </li>
      ))}
    </ol>
  );
}
