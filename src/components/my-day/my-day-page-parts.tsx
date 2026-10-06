"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";
import { appModeDefinition } from "@/lib/app-modes";
import { formatMyDayDue } from "@/lib/my-day/merge";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";

/*
 * The small pieces the My Day page, its dashboard and the home card share.
 * They live apart from the page so the dashboard can use them without the
 * page and the dashboard importing each other.
 */

const TICK_MS = 60_000;

/** The reader's clock, re-read every minute so "Today · 14:30" stays honest and the day rolls over. */
export function useMyDayNow(nowProp?: Date): Date {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    if (nowProp) return;
    const timer = setInterval(() => setTick(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [nowProp]);
  return nowProp ?? tick;
}

export function myDayModeLabel(mode: MyDaySourceMode): string {
  return appModeDefinition(mode).label;
}

/**
 * One My Day row, shared by the page, the dashboard and the home card. An
 * `action` (the dashboard's "Later") sits beside the link, never inside it,
 * and takes the place of the trailing state label. `compact` (the dashboard's
 * "Needs you") drops the detail line: there it only repeated the state the
 * subtitle already gives, so each row is two lines.
 */
export function MyDayItemRow({
  item,
  now,
  action,
  compact = false,
}: {
  readonly item: MyDayItem;
  readonly now: Date;
  readonly action?: ReactNode;
  readonly compact?: boolean;
}) {
  const due = formatMyDayDue(item.due, now);
  // The state word is part of the link's own text, so it never relies on colour or a dot.
  const stateWord =
    item.severity === "overdue"
      ? item.mode === "my-work"
        ? "Date passed"
        : "Overdue"
      : item.severity === "soon"
        ? "Due soon"
        : "";
  const subtitle = [myDayModeLabel(item.mode), stateWord, due].filter(Boolean).join(" · ");
  // Beside an action the row is too narrow for both; the subtitle already says the state in words.
  const label =
    stateWord && !action ? (
      <span aria-hidden="true">
        <ModeStateLabel tone={item.severity === "overdue" ? "warning" : "muted"}>{stateWord}</ModeStateLabel>
      </span>
    ) : null;
  return (
    <ModeRow
      title={item.title}
      subtitle={subtitle}
      meta={
        item.detail && !compact ? (
          <span className={cn(modeSecondaryText, "break-words leading-5")}>{item.detail}</span>
        ) : undefined
      }
      href={item.href}
      testId={`my-day-item-${item.id}`}
      trailing={
        label || action ? (
          <>
            {label}
            {action}
          </>
        ) : undefined
      }
    />
  );
}

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
