"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { announce } from "@/components/ui/live-announcer";
import { cn } from "@/components/ui-primitives";

export type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Accessible name for the nav landmark. */
  label?: string;
  /** Optional "1–20 of 340 sources" line, rendered with tabular figures. */
  summary?: string;
  className?: string;
};

// Truncated window: first, last, and a three-wide band around the current page.
// `null` marks an elision, which renders as a non-interactive ellipsis rather
// than a disabled button — there is nothing to activate.
function pageWindow(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) out.push(null);
    out.push(value);
  });
  return out;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = "Pagination",
  summary,
  className,
}: PaginationProps) {
  // Props are clamped rather than trusted. `page` and `pageCount` arrive from a
  // URL query, a saved filter or a result count that changed under the user, so
  // `page=0` and `page > pageCount` are ordinary states, not caller bugs — and
  // unclamped they produced `onPageChange(-1)` from the Previous button and a
  // window with no current page in it.
  const total = Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0;
  const current = Number.isFinite(page) ? Math.min(Math.max(1, Math.floor(page)), Math.max(total, 1)) : 1;

  const currentRef = useRef<HTMLButtonElement | null>(null);
  const currentValueRef = useRef(current);
  // Set when the control the user just activated is about to disable itself.
  const restoreFocus = useRef(false);
  const pendingTarget = useRef<number | null>(null);

  useEffect(() => {
    currentValueRef.current = current;
  }, [current]);

  useEffect(() => {
    const target = pendingTarget.current;
    if (target === null || current !== target) return;
    if (restoreFocus.current) {
      restoreFocus.current = false;
      currentRef.current?.focus();
    }
    announce(`Page ${current} of ${total}`, { eventId: `pagination:${label}` });
    pendingTarget.current = null;
  }, [current, total, label]);

  if (total <= 1) return null;
  const items = pageWindow(current, total);

  // Every page move goes through here, so the announcement and the boundary
  // focus rule cannot be forgotten by one of the three call sites below.
  function goTo(next: number) {
    const target = Math.min(Math.max(1, next), total);
    if (target === current) return;
    // Reaching a boundary disables the very button that was pressed, which drops
    // focus to <body> and loses the user's place in the list. Hand it to the
    // current-page button, which is always rendered (1 and `total` are both
    // permanent members of the window).
    if (target <= 1 || target >= total) restoreFocus.current = true;
    pendingTarget.current = target;
    onPageChange(target);
    // `onPageChange` does not guarantee the parent accepts `target`. Announce and
    // restore focus only after `current` commits to the pending page; if the
    // parent rejects the change, clear the pending state without announcing.
    // Parent may reject `onPageChange`; defer the check until after React can
    // commit a synchronous controlled update (microtasks run too early).
    window.setTimeout(() => {
      if (pendingTarget.current === target && currentValueRef.current !== target) {
        restoreFocus.current = false;
        pendingTarget.current = null;
      }
    }, 0);
  }

  const step =
    "grid size-tap shrink-0 place-items-center rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] transition hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:cursor-not-allowed disabled:border-[color:var(--border)] disabled:bg-[color:var(--surface-subtle)] disabled:text-[color:var(--disabled)] disabled:shadow-none";

  return (
    <nav aria-label={label} className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      {summary ? <p className="nums text-xs text-[color:var(--text-muted)]">{summary}</p> : <span />}
      {/* Wraps: at 320px a seven-page window plus both steps is ~456px, so the
          row used to push the whole page into a horizontal scroll. */}
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => goTo(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
          className={step}
        >
          <ChevronLeft aria-hidden="true" className="size-icon-md" />
        </button>
        {items.map((item, index) =>
          item === null ? (
            <span key={`gap-${index}`} aria-hidden className="px-1 text-xs text-[color:var(--text-muted)]">
              …
            </span>
          ) : (
            <button
              key={item}
              ref={item === current ? currentRef : undefined}
              type="button"
              onClick={() => goTo(item)}
              // `aria-current="page"` is what tells assistive technology which page
              // is showing; the visual fill alone says nothing.
              aria-current={item === current ? "page" : undefined}
              aria-label={`Page ${item}`}
              className={cn(
                "nums grid size-tap shrink-0 place-items-center rounded-lg px-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                item === current
                  ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
              )}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => goTo(current + 1)}
          disabled={current >= total}
          aria-label="Next page"
          className={step}
        >
          <ChevronRight aria-hidden="true" className="size-icon-md" />
        </button>
      </div>
    </nav>
  );
}
