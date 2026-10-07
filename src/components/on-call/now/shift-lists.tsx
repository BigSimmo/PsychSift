"use client";

import { Check, ChevronRight, ListChecks } from "lucide-react";
import { useId, useState } from "react";
import { focusRing } from "@/components/card-recipes";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { OnCallTrackBar } from "@/components/on-call/kit/track-bar";
import { OnCallStateLabel } from "@/components/on-call/kit/state-label";
import { onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { OnCallNextShift } from "@/components/on-call/on-call-next-shift";
import type { RosterShiftsState } from "@/components/roster/use-roster-shifts";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import {
  ON_CALL_SHIFT_PERIOD_LABELS,
  saveOnCallShiftPick,
  type OnCallShiftContext,
  type OnCallShiftPeriod,
} from "@/lib/on-call/shift-context";
const PERIODS: readonly OnCallShiftPeriod[] = ["day", "evening", "night"];
type ShiftList = { readonly key: "start" | "end"; readonly label: string; readonly items: readonly HandbookItem[] };
/**
 * The hospital's start- and end-of-shift lists: the orientation entries in the
 * `first_shift` and `ongoing` phases only. Before-start, first-week and leaving
 * entries belong to First night and orientation, never to a shift.
 */
function onCallShiftLists(items: readonly HandbookItem[]): { start: HandbookItem[]; end: HandbookItem[] } {
  const orientation = items.filter((item) => item.section === "orientation");
  return {
    start: orientation.filter((item) => item.orientationPhase === "first_shift"),
    end: orientation.filter((item) => item.orientationPhase === "ongoing"),
  };
}
function TickList({
  list,
  ticked,
  onToggle,
}: {
  readonly list: ShiftList;
  readonly ticked: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}) {
  const headingId = useId();
  if (list.items.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-2"
      data-testid={`on-call-now-checklist-${list.key}`}
    >
      <h3 id={headingId} className={cn(eyebrowText, "px-3")}>
        {list.label}
      </h3>
      <ul role="list" className={modeModuleSurface}>
        {list.items.map((item) => {
          const done = ticked.has(item.id);
          return (
            <li key={item.id} className={modeInsetHairline}>
              <button
                type="button"
                aria-pressed={done}
                onClick={() => onToggle(item.id)}
                data-testid={`on-call-now-checklist-item-${item.id}`}
                className={cn(
                  modeRowHeight.single,
                  modePressable,
                  focusRing,
                  "flex w-full min-w-0 items-center gap-3 px-3 text-left",
                )}
              >
                {/* A box and a tick, and struck-through text: never colour alone. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-sm border",
                    done
                      ? "border-[color:var(--text-muted)] text-[color:var(--text-muted)]"
                      : "border-[color:var(--border-strong)]",
                  )}
                >
                  {done ? <Check aria-hidden="true" strokeWidth={2} className="size-icon-xs" /> : null}
                </span>
                <span
                  className={cn(
                    modeNameText,
                    "min-w-0 flex-1 break-words text-base-minus leading-5",
                    done ? "text-[color:var(--text-muted)] line-through" : "text-[color:var(--text-heading)]",
                  )}
                >
                  {item.parsed.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
/**
 * "Shift lists" (v6 moved it behind the mode button; the page menu has no link
 * slot yet, so it sits in Now's footer group as one 52px row).
 *
 * The row says which list is current and how far through it the reader is. It
 * opens a sheet with the shift (the roster's, or a one-tap Day / Evening /
 * Night) and the lists, end-of-shift first in the last hour.
 *
 * Ticks are NOT kept (owner card 19:06Z): they live in this component's memory
 * for the current shift only, and a new shift key starts the lists unticked.
 */
export function NowShiftLists({
  context,
  shifts,
  items,
  now,
}: {
  readonly context: OnCallShiftContext;
  readonly shifts: RosterShiftsState;
  readonly items: readonly HandbookItem[];
  readonly now: Date;
}) {
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState<{ readonly shiftKey: string; readonly ids: ReadonlySet<string> }>(() => ({
    shiftKey: context.shiftKey,
    ids: new Set(),
  }));
  // A new shift starts unticked: ticks from another shift key are ignored.
  const ticked = ticks.shiftKey === context.shiftKey ? ticks.ids : new Set<string>();
  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicks({ shiftKey: context.shiftKey, ids: next });
  };
  const { start, end } = onCallShiftLists(items);
  const startList: ShiftList = { key: "start", label: "Start of shift", items: start };
  const endList: ShiftList = { key: "end", label: "End of shift", items: end };
  const current = context.phase === "end" && end.length > 0 ? endList : start.length > 0 ? startList : endList;
  const lists = context.phase === "end" ? [endList, startList] : [startList, endList];
  const doneCount = current.items.filter((item) => ticked.has(item.id)).length;
  const hasLists = start.length + end.length > 0;
  return (
    <>
      <li className={modeInsetHairline}>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          data-testid="on-call-now-checklists"
          className={cn(
            modeRowHeight.double,
            modePressable,
            focusRing,
            "flex w-full min-w-0 items-center gap-3 pl-3 pr-2 text-left",
          )}
        >
          <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
            <ListChecks aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
          </span>
          <span className="grid min-w-0 flex-1 gap-1 py-1">
            <span
              className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}
            >
              Shift lists
            </span>
            {hasLists ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className={cn(modeSecondaryText, modeNumberText, "break-words")}>
                  {`${current.label} · ${doneCount} of ${current.items.length}`}
                </span>
                <OnCallTrackBar
                  percent={current.items.length ? (doneCount / current.items.length) * 100 : 0}
                  className="w-16 shrink-0"
                />
              </span>
            ) : (
              <OnCallStateLabel state={{ kind: "not-set-up" }} />
            )}
          </span>
          <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        </button>
      </li>
      <Sheet open={open} onClose={() => setOpen(false)} title="This shift" testId="on-call-now-checklists-sheet">
        <div data-mode-identity="on-call" className="grid min-w-0 gap-5">
          {context.kind === "roster" ? (
            <OnCallNextShift state={shifts} now={now} />
          ) : (
            <div data-testid="on-call-now-shift-pick">
              <SegmentedControl
                label="Which shift are you on?"
                layout="equal"
                value={context.period}
                onChange={(period) => saveOnCallShiftPick(period)}
                options={PERIODS.map((period) => ({ value: period, label: ON_CALL_SHIFT_PERIOD_LABELS[period] }))}
              />
            </div>
          )}
          {lists.map((list) => (
            <TickList key={list.key} list={list} ticked={ticked} onToggle={toggle} />
          ))}
          {hasLists ? (
            <div className="flex min-w-0 items-center justify-between gap-3 px-3">
              <p className={modeSecondaryText}>Nothing is saved</p>
              {ticked.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setTicks({ shiftKey: context.shiftKey, ids: new Set() })}
                  data-testid="on-call-now-checklists-clear"
                  className={cn(
                    focusRing,
                    "inline-flex min-h-12 items-center rounded-md px-2 text-sm text-[color:var(--text-muted)]",
                  )}
                >
                  Clear ticks
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
