"use client";

import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { MODE_BADGE } from "@/components/my-day/mode-badge";
import { cn } from "@/components/ui-primitives";
import { appModeDefinition } from "@/lib/app-modes";
import { formatMyDayDue } from "@/lib/my-day/merge";
import type { MyDayItem } from "@/lib/my-day/model";

/**
 * The single most important thing right now: the first item of the already
 * sorted merged list, when it is overdue or due soon. It is a pointer, not a
 * move: the item stays in the list below, which remains the full record.
 * Renders nothing when the top item is only "info" (or there are no items).
 */
export function MyDayPriorityFlag({ items, now }: { readonly items: readonly MyDayItem[]; readonly now: Date }) {
  const item = items[0];
  if (!item || (item.severity !== "overdue" && item.severity !== "soon")) return null;
  const due = formatMyDayDue(item.due, now);
  const stateWord = item.severity === "overdue" ? (item.mode === "my-work" ? "Date passed" : "Overdue") : "Due soon";
  const second = [appModeDefinition(item.mode).label, [stateWord, due].filter(Boolean).join(" · ")].join(" · ");
  return (
    <Link
      href={item.href}
      aria-label={`Most important now: ${item.title}`}
      data-testid="my-day-module-priority"
      className={cn(
        focusRing,
        "flex min-h-18 items-center gap-3.5 rounded-2xl border border-[color:var(--success-border)] bg-[color:var(--success-soft)] py-4 pl-4.5 pr-3.5 no-underline",
      )}
    >
      <span
        aria-hidden="true"
        className="w-8 shrink-0 font-mono text-sm-minus font-semibold text-[color:var(--success)]"
      >
        {MODE_BADGE[item.mode]}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="break-words text-base font-semibold leading-tight text-[color:var(--text-heading)]">
          {item.title}
        </span>
        <span className={cn(modeSecondaryText, "break-words text-sm-minus")}>{second}</span>
      </span>
      <span
        aria-hidden="true"
        className="grid min-h-10 shrink-0 place-items-center rounded-full bg-[color:var(--text-heading)] px-4.5 text-sm-minus font-semibold text-[color:var(--surface)]"
      >
        Open
      </span>
    </Link>
  );
}
