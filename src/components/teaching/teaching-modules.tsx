"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { ModeFactTile } from "@/components/mode-kit/fact-tile";
import { modeDot, modeIconTile, modeModuleSurface } from "@/components/mode-kit/recipes";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { modeNumberText } from "@/components/mode-kit/type";
import { withUnit } from "@/components/teaching/teaching-number";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import type { TeamSummary } from "@/lib/teaching/model";

/*
 * The modules that are Teaching's own (the kit covers the rest). One edge,
 * one 12px radius, one 12px inner padding. List layouts are container
 * queries, so larger text reflows a row rather than squeezing it (review
 * focus 1).
 */

/** Which service the page shows, with the demo tag. A switch appears only for a doctor in two or more. */
export function TeachingContextBar({
  teams,
  value,
  onChange,
  demoTag,
  label = "Service",
}: {
  teams: readonly TeamSummary[];
  value: string;
  onChange: (value: string) => void;
  demoTag: boolean;
  label?: string;
}) {
  if (teams.length === 0) return null;
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-0.5">
      {teams.length === 1 ? (
        <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-[color:var(--text-heading)]">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[color:var(--mode-identity)]" />
          <span className="truncate">{teams[0].name}</span>
        </span>
      ) : (
        <Select
          label={label}
          hideLabel
          value={value}
          onChange={(event) => onChange(event.target.value)}
          options={[
            { value: "all", label: "All services" },
            ...teams.map((team) => ({ value: team.id, label: team.name })),
          ]}
          fieldClassName="min-w-0 max-w-[70%]"
        />
      )}
      {demoTag ? (
        <span className={cn("work-tag shrink-0")} data-tone="neutral">
          Demo · made-up people
        </span>
      ) : null}
    </div>
  );
}

/**
 * The kit's state label has no live tone, so this is Teaching's: a --success
 * dot that pulses once per `freshKey` (600ms, motion-safe only), then our
 * words in the surrounding muted colour. Keyframes live in U1's globals block.
 */
export function LiveLabel({
  freshKey,
  className,
  children,
}: {
  freshKey?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span data-live className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        key={freshKey}
        aria-hidden="true"
        data-live-dot
        className={cn(modeDot, "bg-[color:var(--success)] motion-safe:animate-[teaching-live-pulse_600ms_ease-out_1]")}
      />
      {children}
    </span>
  );
}

/** One module: an 11px label with a 24px plum icon tile (or a live state), a muted aside, then the body. */
export function TeachingModule({
  title,
  icon: Icon,
  live = false,
  freshKey,
  aside,
  testId,
  children,
}: {
  title?: string;
  icon?: LucideIcon;
  live?: boolean;
  freshKey?: string;
  aside?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      data-testid={testId}
      className={cn(modeModuleSurface, "overflow-hidden")}
    >
      {title ? (
        <div className="flex items-center justify-between gap-3 px-3 pt-3">
          <h2 id={headingId} className={cn(eyebrowText, "flex min-w-0 items-center gap-2")}>
            {live ? (
              <LiveLabel freshKey={freshKey}>{title}</LiveLabel>
            ) : (
              <>
                {Icon ? (
                  <span aria-hidden="true" data-icon-tile data-mode-identity="teaching" className={modeIconTile}>
                    <Icon aria-hidden="true" className="size-icon-sm" />
                  </span>
                ) : null}
                <span className="min-w-0">{title}</span>
              </>
            )}
          </h2>
          {aside ? <span className={cn(modeNumberText, "shrink-0 text-sm", textMuted)}>{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type TimelineRow = {
  id: string;
  href: string | null;
  /** Opens something in place (a sheet) instead of navigating. Ignored when `href` is set. */
  onSelect?: () => void;
  timeTop: string;
  timeBottom: string | null;
  /** A moved session's previous start, struck through under the new time. */
  was?: string | null;
  title: string;
  meta: string;
  /** "live" renders Teaching's LiveLabel; the others are the kit's state label tones. */
  status?: { tone: "muted" | "warning" | "live"; text: string } | null;
  cancelled?: boolean;
  /** Replaces the chevron, for example What's on's add button. */
  trailing?: ReactNode;
};
export type TimelineGroup = {
  id: string;
  label: string;
  count: string | null;
  rows: readonly TimelineRow[];
  anchor?: string;
};

function GroupLabel({ label, aside, testId }: { label: string; aside: string | null; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
      <h2 className={eyebrowText}>{label}</h2>
      {aside ? (
        <span data-testid={testId} className={cn(modeNumberText, "text-sm", textMuted)}>
          {aside}
        </span>
      ) : null}
    </div>
  );
}

const insetRule =
  "before:absolute before:top-0 before:right-0 before:left-3 before:h-px before:bg-[color:var(--border)] @min-[17rem]:before:left-[4.5rem]";

function TimelineRowBody({ row }: { row: TimelineRow }) {
  return (
    <>
      <span
        data-row-time
        className="col-start-1 row-start-1 flex items-baseline gap-1.5 @min-[17rem]:grid @min-[17rem]:content-center @min-[17rem]:gap-0"
      >
        <span className={cn(modeNumberText, "text-base-minus text-[color:var(--text-heading)]")}>{row.timeTop}</span>
        {row.was ? (
          <span
            data-testid={`teaching-was-${row.id}`}
            className={cn(modeNumberText, "text-xs line-through", textMuted)}
          >
            <span className="sr-only">was </span>
            {row.was}
          </span>
        ) : row.timeBottom ? (
          <span className={cn(modeNumberText, "text-xs", textMuted)}>{row.timeBottom}</span>
        ) : null}
      </span>
      <span
        data-row-body
        className="col-start-1 row-start-2 grid min-w-0 content-center gap-0.5 @min-[17rem]:col-start-2 @min-[17rem]:row-start-1"
      >
        <span
          className={cn(
            "text-base-minus font-medium [overflow-wrap:anywhere]",
            row.cancelled ? "text-[color:var(--text-muted)] line-through" : "text-[color:var(--text-heading)]",
          )}
        >
          {row.title}
        </span>
        {row.meta ? <span className={cn("text-sm [overflow-wrap:anywhere]", textMuted)}>{row.meta}</span> : null}
        {row.status?.tone === "live" ? (
          <LiveLabel freshKey={row.id} className={cn("text-sm", textMuted)}>
            {row.status.text}
          </LiveLabel>
        ) : row.status ? (
          <ModeStateLabel tone={row.status.tone === "warning" ? "warning" : "muted"}>{row.status.text}</ModeStateLabel>
        ) : null}
      </span>
      <span className="relative col-start-2 row-span-2 row-start-1 grid place-items-center @min-[17rem]:col-start-3 @min-[17rem]:row-span-1">
        {row.trailing ??
          (row.href || row.onSelect ? (
            <ChevronRight aria-hidden="true" className={cn("size-icon-sm", textMuted)} />
          ) : null)}
      </span>
    </>
  );
}

/**
 * Grouped sessions (v4.2 "tl"): a 3.5rem time column, the title and meta, a
 * chevron. Below a 17rem list the time moves above the title. A group's
 * `anchor` becomes its section id so Week's rail can scroll to it.
 */
export function SessionTimeline({ groups, testId }: { groups: readonly TimelineGroup[]; testId: string }) {
  return (
    <div className="grid gap-4" data-testid={testId}>
      {groups.map((group) => (
        <section key={group.id} id={group.anchor} aria-label={group.label} className="scroll-mt-4">
          <GroupLabel label={group.label} aside={group.count} />
          <ul className={cn(modeModuleSurface, "@container overflow-hidden")}>
            {group.rows.map((row, index) => {
              const rowClass = cn(
                "grid min-h-13 grid-cols-[minmax(0,1fr)_3rem] gap-x-2 gap-y-0.5 py-2 pr-1 pl-3",
                "@min-[17rem]:grid-cols-[3.5rem_minmax(0,1fr)_3rem] @min-[17rem]:gap-x-2.5",
              );
              const hover = "hover:bg-[color:var(--surface-subtle)]";
              return (
                <li
                  key={row.id}
                  data-testid={`teaching-row-${row.id}`}
                  className={cn("relative", index > 0 && insetRule)}
                >
                  {row.href && !row.trailing ? (
                    <Link href={row.href} className={cn(rowClass, "no-underline", hover, focusRing)}>
                      <TimelineRowBody row={row} />
                    </Link>
                  ) : row.onSelect && !row.trailing ? (
                    <button
                      type="button"
                      onClick={row.onSelect}
                      className={cn(rowClass, "w-full text-left", hover, focusRing)}
                    >
                      <TimelineRowBody row={row} />
                    </button>
                  ) : row.trailing && (row.href || row.onSelect) ? (
                    // A row with its own control (What's on's add toggle) still opens: the
                    // link stretches under the row and the control paints above it.
                    <div className={cn(rowClass, hover)}>
                      {row.href ? (
                        <Link
                          href={row.href}
                          aria-label={row.title}
                          data-row-open
                          className={cn("absolute inset-0", focusRing)}
                        />
                      ) : (
                        <button
                          type="button"
                          aria-label={row.title}
                          data-row-open
                          onClick={row.onSelect}
                          className={cn("absolute inset-0", focusRing)}
                        />
                      )}
                      <TimelineRowBody row={row} />
                    </div>
                  ) : (
                    <div className={rowClass}>
                      <TimelineRowBody row={row} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export type LedgerRow = {
  id: string;
  day: string;
  weekday: string;
  title: string;
  status: string;
  hours: string;
  href: string | null;
  onSelect?: () => void;
};
export type LedgerGroup = { id: string; label: string; total: string; rows: readonly LedgerRow[] };

/** Past these lengths the hours move under the status instead of squeezing the title (v4.2 frame 17). */
const LONG_TITLE = 44;
const LONG_STATUS = 48;

/** The logbook as a statement: a date column, the entry and its status, hours on the right, the month's total above. */
export function LogbookLedger({ groups }: { groups: readonly LedgerGroup[] }) {
  return (
    <div className="grid gap-4" data-testid="teaching-ledger">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <GroupLabel label={group.label} aside={group.total} testId={`teaching-ledger-total-${group.id}`} />
          <ul className={cn(modeModuleSurface, "@container overflow-hidden")}>
            {group.rows.map((row, index) => {
              const long = row.title.length > LONG_TITLE || row.status.length > LONG_STATUS;
              const body = (
                <>
                  <span className="grid content-start">
                    <span className={cn(modeNumberText, "text-base-minus text-[color:var(--text-heading)]")}>
                      {row.day}
                    </span>
                    <span className={cn("text-xs", textMuted)}>{row.weekday}</span>
                  </span>
                  <span className="grid min-w-0 content-center gap-0.5">
                    <span className="text-base-minus font-medium text-[color:var(--text-heading)] [overflow-wrap:anywhere]">
                      {row.title}
                    </span>
                    <ModeStateLabel tone="muted">{row.status}</ModeStateLabel>
                    {long ? (
                      <span data-ledger-hours data-below="true" className={cn(modeNumberText, "text-sm", textMuted)}>
                        {withUnit(row.hours, "h")}
                      </span>
                    ) : null}
                  </span>
                  {long ? null : (
                    <span
                      data-ledger-hours
                      data-below="false"
                      className={cn(
                        modeNumberText,
                        "col-start-2 text-sm text-[color:var(--text-heading)] @min-[17rem]:col-start-3 @min-[17rem]:row-start-1 @min-[17rem]:self-center @min-[17rem]:text-right @min-[17rem]:text-base-minus",
                      )}
                    >
                      {row.hours}
                    </span>
                  )}
                </>
              );
              const rowClass = cn(
                "grid min-h-13 w-full gap-x-2.5 gap-y-0.5 py-2 pr-3 pl-3 text-left",
                long
                  ? "grid-cols-[2.75rem_minmax(0,1fr)]"
                  : "grid-cols-[2.75rem_minmax(0,1fr)] @min-[17rem]:grid-cols-[2.75rem_minmax(0,1fr)_auto]",
              );
              return (
                <li
                  key={row.id}
                  className={cn(
                    "relative",
                    index > 0 &&
                      "before:absolute before:top-0 before:right-0 before:left-[3.5rem] before:h-px before:bg-[color:var(--border)]",
                  )}
                >
                  {row.href ? (
                    <Link href={row.href} className={cn(rowClass, "no-underline", focusRing)}>
                      {body}
                    </Link>
                  ) : row.onSelect ? (
                    <button type="button" onClick={row.onSelect} className={cn(rowClass, focusRing)}>
                      {body}
                    </button>
                  ) : (
                    <div className={rowClass}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export type DayRailDay = { key: string; weekday: string; day: string; count: number; past: boolean };

/** Seven days: the picked day in product blue with a 2px underline, past days muted, up to two dots per day. */
export function DayRail({
  days,
  value,
  onChange,
  label,
}: {
  days: readonly DayRailDay[];
  value: string;
  onChange: (key: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-7 border-b border-[color:var(--border)]">
      {days.map((day) => {
        const selected = day.key === value;
        // Split the plural from the count: a template literal with a digit or
        // `}` immediately before a literal space and a unit word ("sessions")
        // is exactly the hand-rolled-unit shape `teaching-type-weight.test.ts`
        // guards against, even inside an aria-label with nothing visual to wrap.
        const sessionWord = day.count === 1 ? "session" : "sessions";
        const countWords = day.count === 0 ? `no ${sessionWord}` : `${day.count} ${sessionWord}`;
        return (
          <button
            key={day.key}
            type="button"
            aria-pressed={selected}
            aria-label={`${day.weekday} ${day.day}, ${countWords}`}
            onClick={() => onChange(day.key)}
            className={cn(
              "-mb-px grid min-h-12 justify-items-center gap-0.5 border-b-2 py-1.5",
              selected
                ? "border-[color:var(--primary)] text-[color:var(--primary)]"
                : cn(
                    "border-transparent",
                    day.past ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-heading)]",
                  ),
              focusRing,
            )}
          >
            <span className="text-xs">{day.weekday}</span>
            <span className={cn(modeNumberText, "text-base-minus")}>{day.day}</span>
            <span aria-hidden="true" className="flex h-1 gap-0.5">
              {Array.from({ length: Math.min(day.count, 2) }, (_, index) => (
                <span key={index} className="size-0.75 rounded-full bg-current" />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The live `SegmentedControl`, recoloured through its own tokens to a raised
 * neutral segment, scrolling sideways at large text with a fade at the end
 * while there is more. Measured in listeners, never set synchronously in the
 * effect (`react-hooks/set-state-in-effect`).
 */
export function TeachingSwitch<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  label: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () =>
      setFade(node.scrollWidth > node.clientWidth + 1 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  // The `--teaching-segment-*` pair lives in the Teaching identity block, so a
  // layout-free wrapper carries it; on the scroller itself the block's plum
  // `--clinical-accent` would beat the overrides below.
  return (
    <div data-mode-identity="teaching" className="contents">
      <div
        ref={scroller}
        data-testid="teaching-switch"
        data-fade={fade ? "true" : "false"}
        className={cn(
          "min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none]",
          "[--clinical-accent:var(--text-heading)] [--clinical-accent-soft:var(--teaching-segment-on)] [--clinical-accent-border:var(--teaching-segment-line)]",
          fade && "[mask-image:linear-gradient(90deg,black_80%,transparent)]",
        )}
      >
        <SegmentedControl
          value={value}
          onChange={onChange}
          options={options}
          label={label}
          layout="equal"
          className="w-max min-w-full"
        />
      </div>
    </div>
  );
}

/**
 * The code's 30-second life as a draining 2px hairline, never a ticking
 * counter. An SVG stroke in `currentColor`, so forced colours keep it (review
 * focus 2), set by attribute rather than inline style.
 */
export function DrainingHairline({
  windowStartMs,
  windowMs,
  nowMs,
}: {
  windowStartMs: number;
  windowMs: number;
  nowMs: number;
}) {
  const left = Math.min(1, Math.max(0, 1 - (nowMs - windowStartMs) / windowMs));
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 2"
      preserveAspectRatio="none"
      className="h-0.5 w-full text-[color:var(--text-muted)]"
    >
      <line x1="0" y1="1" x2={String(Math.round(left * 100))} y2="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** The attendance counts as one compact row: three tiles fit across a 390px phone, four from a little wider. */
export function AttendanceTileRow({
  tiles,
  label,
}: {
  tiles: readonly { id: string; label: string; value: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2">
      {tiles.map((tile) => (
        <ModeFactTile key={tile.id} label={tile.label} value={tile.value} />
      ))}
    </div>
  );
}
