"use client";

import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";

/*
 * A grouped-list row that opens something in place (`onClick`) or leaves the
 * app (`externalHref`, a new tab). The kit's `ModeRow` on main renders only an
 * in-app `next/link` or a static row: it has no `onClick` and no external link
 * (U1 report, R14). So this composes the same row from the kit's own recipes
 * and type, with the kit's 48/52px heights and inset hairline, and sits inside
 * a `ModeGroupedList` beside ordinary `ModeRow`s. In-app links still use
 * `ModeRow` itself. No icon on the row (standard §4).
 *
 * A `trailing` control (Resources' save toggle, U9) sits beside an external
 * link, never inside it, exactly as the kit's `ModeRow` places one.
 */
export function TeachingRow({
  title,
  subtitle,
  meta,
  onClick,
  externalHref,
  trailing,
  busy = false,
  testId,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Extra muted lines under the subtitle, such as a state label. */
  readonly meta?: ReactNode;
  readonly onClick?: () => void;
  readonly externalHref?: string | null;
  /** A control beside an external link, such as a save toggle. */
  readonly trailing?: ReactNode;
  /** An `onClick` row whose work is running: announced busy and not pressable again until it ends. */
  readonly busy?: boolean;
  readonly testId?: string;
}) {
  const twoLine = Boolean(subtitle) || Boolean(meta);
  const height = twoLine ? modeRowHeight.double : modeRowHeight.single;
  const text = (
    <span className="grid min-w-0 flex-1 basis-40 gap-0.5 py-1">
      <span className={cn(modeNameText, "text-base-minus leading-5 break-words text-[color:var(--text-heading)]")}>
        {title}
      </span>
      {subtitle ? <span className={cn(modeSecondaryText, "leading-5 break-words")}>{subtitle}</span> : null}
      {meta}
    </span>
  );
  const control = cn(
    height,
    modePressable,
    focusRing,
    "flex w-full min-w-0 flex-wrap items-center gap-x-3 pr-2 pl-3 text-left no-underline",
  );
  const chevron = "ml-auto size-icon-md shrink-0 text-[color:var(--text-muted)]";

  if (externalHref) {
    return (
      <li className={cn(modeInsetHairline, "flex min-w-0 items-center pr-1")}>
        <a href={externalHref} target="_blank" rel="noreferrer" data-testid={testId} className={control}>
          {text}
          <span className="sr-only"> (opens in a new tab)</span>
          <ExternalLink aria-hidden="true" className={chevron} />
        </a>
        {trailing ? <span className="flex shrink-0 items-center gap-1">{trailing}</span> : null}
      </li>
    );
  }
  if (onClick) {
    return (
      <li className={cn(modeInsetHairline, "flex min-w-0 items-center pr-1")}>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          aria-busy={busy || undefined}
          data-testid={testId}
          className={cn(control, "disabled:cursor-progress")}
        >
          {text}
          {busy ? (
            <Loader2 aria-hidden="true" className={cn(chevron, "animate-spin motion-reduce:animate-none")} />
          ) : (
            <ChevronRight aria-hidden="true" className={chevron} />
          )}
        </button>
      </li>
    );
  }
  return (
    <li
      className={cn(modeInsetHairline, height, "flex min-w-0 flex-wrap items-center gap-x-3 pr-1 pl-3")}
      data-testid={testId}
    >
      {text}
    </li>
  );
}

/**
 * The 10-second Undo bar (v5.2): fixed above the page's bottom edge in the toast layer, one line and
 * one Undo. Organise's delayed posts, Supervision's held confirmations and a collection's removals
 * all use this one bar, so an unsent change always looks and behaves the same.
 */
export function TeachingUndoBar({
  children,
  onUndo,
  testId,
}: {
  readonly children: ReactNode;
  readonly onUndo: () => void;
  readonly testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="fixed inset-x-4 bottom-4 z-[var(--z-toast)] mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] py-1 pr-1 pl-3 shadow-[var(--e4)]"
    >
      <span className="min-w-0 text-sm text-[color:var(--text-heading)]">{children}</span>
      <button
        type="button"
        onClick={onUndo}
        className={cn(
          "min-h-tap min-w-tap shrink-0 px-3 text-sm font-medium text-[color:var(--mode-identity)]",
          focusRing,
        )}
      >
        Undo
      </button>
    </div>
  );
}
