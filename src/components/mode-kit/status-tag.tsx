import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

/**
 * The clinical lists' one quiet status tag (Clinical audit, 13 Oct 2026, item 8).
 *
 * The same shapes as the work kit's `.work-tag` and Admin's status mark (Ward
 * Flow review, 12 Oct 2026), for pages outside the work frame: the word is
 * always plain grey and only the small shape carries colour.
 *
 *   urgent      red triangle   (overdue, emergent, crisis)
 *   soon        amber dot      (due soon, urgent but not emergent)
 *   done        tick           (done, active, current)
 *   unrecorded  dashed ring    (not recorded, not verified)
 *   none        no shape       (a plain grey label)
 *
 * Colour is never the only signal: the word always travels with the shape, and
 * the shape is `aria-hidden` so a screen reader hears the word once.
 */
export type StatusTagShape = "urgent" | "soon" | "done" | "unrecorded" | "none";

export function StatusTagMark({ shape, className }: { readonly shape: StatusTagShape; readonly className?: string }) {
  const base = cn("size-2.5 shrink-0 forced-colors:text-[CanvasText]", className);
  if (shape === "urgent") {
    return (
      <svg
        viewBox="0 0 10 10"
        aria-hidden="true"
        data-status-shape="triangle"
        className={cn(base, "text-[color:var(--danger-text)]")}
      >
        <path d="M5 .8 9.4 9H.6z" fill="currentColor" />
      </svg>
    );
  }
  if (shape === "soon") {
    return (
      <svg
        viewBox="0 0 10 10"
        aria-hidden="true"
        data-status-shape="dot"
        className={cn(base, "text-[color:var(--warning-text)]")}
      >
        <circle cx="5" cy="5" r="4" fill="currentColor" />
      </svg>
    );
  }
  if (shape === "done") {
    return (
      <svg
        viewBox="0 0 10 10"
        aria-hidden="true"
        data-status-shape="tick"
        className={cn(base, "text-[color:var(--success-text)]")}
      >
        <path
          d="M1.2 5.4 4 8.1 8.8 2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (shape === "unrecorded") {
    return (
      <svg
        viewBox="0 0 10 10"
        aria-hidden="true"
        data-status-shape="ring"
        className={cn(base, "text-[color:var(--text-muted)]")}
      >
        <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 1.6" />
      </svg>
    );
  }
  return null;
}

/** A grey word on a flat wash with a hairline, led by its status shape. */
export function StatusTag({
  shape = "none",
  children,
  className,
  testId,
}: {
  readonly shape?: StatusTagShape;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <span
      data-status-tag={shape}
      data-testid={testId}
      className={cn(
        "inline-flex w-fit max-w-full shrink-0 items-center gap-1 rounded-full bg-[color:var(--surface-wash)] px-2 py-0.5 text-xs leading-snug font-semibold text-[color:var(--text-muted)] border border-[color:var(--border)] forced-colors:border-[CanvasText]",
        className,
      )}
    >
      <StatusTagMark shape={shape} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
