"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { cn, codeText } from "@/components/ui-primitives";

/**
 * The list that sits in a `ClinicalSplit` column (work-desktop-layout.tsx):
 * records in collapsible groups (DSM chapters, therapy categories), the open
 * record's group expanded and its row marked with `aria-current="page"`.
 *
 * Every row and group heading is at least 48px tall (`min-h-12`), the
 * production tap target. The column scrolls on its own, so on load the current
 * row is brought into view inside the column without moving the page.
 */

export type DesktopSplitItem = {
  readonly key: string;
  readonly href: string;
  readonly title: string;
  /** A short code shown on the right, such as an ICD code. */
  readonly meta?: string;
  readonly current?: boolean;
};

export type DesktopSplitGroup = {
  readonly key: string;
  readonly label: string;
  readonly items: readonly DesktopSplitItem[];
};

export const desktopSplitHeadingClass =
  "px-2 pb-1 pt-1.5 text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]";

export const desktopSplitRowClass = cn(
  "relative flex min-h-12 items-center gap-2 rounded-md px-2 py-1.5 text-xs leading-4 transition motion-reduce:transition-none",
  focusRing,
);

export const desktopSplitRowIdleClass =
  "font-semibold text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]";

export const desktopSplitRowCurrentClass =
  "bg-[color:var(--clinical-accent-soft)] font-extrabold text-[color:var(--clinical-accent)]";

/** The thin bar on the left of the current row: the second, non-colour cue. */
export function DesktopSplitCurrentBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-[color:var(--clinical-accent)] forced-colors:bg-[Highlight]"
    />
  );
}

export function DesktopSplitList({
  heading,
  groups,
}: {
  readonly heading: ReactNode;
  readonly groups: readonly DesktopSplitGroup[];
}) {
  const currentRef = useRef<HTMLAnchorElement>(null);
  // Moving between records keeps this list mounted, so re-run on each new current row.
  const currentKey = groups.flatMap((group) => group.items).find((item) => item.current)?.key ?? null;

  useEffect(() => {
    const row = currentRef.current;
    const column = row?.closest<HTMLElement>(".clinical-split__list");
    // Below 1024px the column is not drawn; nothing to scroll.
    if (!row || !column || column.clientHeight === 0) return;
    const rowBox = row.getBoundingClientRect();
    const columnBox = column.getBoundingClientRect();
    // Already in view: leave the column where it is (at first load, its top, with its heading showing).
    if (rowBox.top >= columnBox.top && rowBox.bottom <= columnBox.bottom - 16) return;
    column.scrollTop = Math.max(0, column.scrollTop + rowBox.top - columnBox.top - columnBox.height / 3);
  }, [currentKey]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 p-2">
      <div className={desktopSplitHeadingClass}>{heading}</div>
      {groups.map((group) => {
        const hasCurrent = group.items.some((item) => item.current);
        return (
          <details
            key={group.key}
            open={hasCurrent || undefined}
            className="group/split grid min-w-0 grid-cols-[minmax(0,1fr)]"
          >
            <summary
              className={cn(
                "flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[color:var(--surface-subtle)] [&::-webkit-details-marker]:hidden",
                focusRing,
              )}
            >
              <span className="min-w-0 flex-1 text-xs font-extrabold leading-4 text-[color:var(--text-heading)]">
                {group.label}
              </span>
              <span className="shrink-0 text-2xs font-bold tabular-nums text-[color:var(--text-muted)]">
                <span className="sr-only">, </span>
                {group.items.length}
                <span className="sr-only"> {group.items.length === 1 ? "item" : "items"}</span>
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition group-open/split:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <ul className="mb-1 grid gap-0.5 pl-1">
              {group.items.map((item) => (
                <li key={item.key}>
                  <Link
                    ref={item.current ? currentRef : undefined}
                    href={item.href}
                    aria-current={item.current ? "page" : undefined}
                    className={cn(
                      desktopSplitRowClass,
                      item.current ? desktopSplitRowCurrentClass : desktopSplitRowIdleClass,
                    )}
                  >
                    {item.current ? <DesktopSplitCurrentBar /> : null}
                    <span className="min-w-0 flex-1">{item.title}</span>
                    {item.meta ? (
                      <span className={cn(codeText, "shrink-0 text-2xs text-[color:var(--text-muted)]")}>
                        {item.meta}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
