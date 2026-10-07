"use client";

import Link from "next/link";

import type { LucideIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cardInteractive, cardPadding, cardSurface } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

export interface OnCallEntryRowProps {
  /** Row heading — a role, a scenario name, a place. Section-agnostic on purpose. */
  title: string;
  /** Give contact names a full line above their number on narrow screens. */
  stackOnPhone?: boolean;
  subtitle?: string;
  icon?: LucideIcon;
  /** Metadata pills, freshness badge, section-specific detail — rendered below the heading. */
  children?: ReactNode;
  /**
   * A right-hand affordance inside the row — the drawing's round call disc.
   *
   * Decorative by contract, never a control: the whole row is already the tap
   * target, and a real button here would be invalid markup inside the `<a>`
   * and a second announcement of one action. Callers pass a `<span>`.
   */
  trailing?: ReactNode;
  /**
   * When present, the WHOLE row is this link (e.g. a `tel:` number, so ringing
   * someone is a single tap). Mutually exclusive with `onClick`.
   */
  href?: string;
  /** Alternative to `href` for a row that opens something in place instead of navigating. */
  onClick?: () => void;
  /**
   * Fires when the row is activated (dial or in-place open). Used to record
   * Recent — the list is never populated unless a production click path calls
   * `recordOnCallRecent`.
   */
  onActivate?: () => void;
  testId?: string;
  anchorProps?: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;
}

/**
 * The shared row primitive every On Call section renders its entries through
 * (Task 9 contacts, Task 10's remaining five). The whole row is one tap
 * target of at least 48px (`min-h-tap`) — never a small control floating
 * inside a larger, inert card — because the page this shell exists for is
 * read one-handed, in a corridor, at 2am.
 *
 * Exactly one of `href`/`onClick` should be supplied for an interactive row;
 * supplying neither renders a static, non-interactive row (a plain
 * informational line — e.g. a contact with no dialable number on file).
 */
export function OnCallEntryRow({
  title,
  stackOnPhone = false,
  subtitle,
  icon: Icon,
  children,
  trailing,
  href,
  onClick,
  onActivate,
  testId,
  anchorProps,
}: OnCallEntryRowProps) {
  function handleActivate() {
    onActivate?.();
  }
  const content = (
    <>
      {Icon ? (
        <span
          aria-hidden
          className={cn(
            // A flat teal tint circle (work-mode redesign, owner request 6 Oct 2026).
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
            stackOnPhone && "hidden sm:grid",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block break-words text-sm font-semibold text-[color:var(--text)]">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block break-words text-xs text-[color:var(--text-muted)]">{subtitle}</span>
        ) : null}
        {children ? <span className="mt-1.5 flex flex-wrap items-center gap-1.5">{children}</span> : null}
      </span>
      {trailing ? <span className="mt-0.5 shrink-0">{trailing}</span> : null}
    </>
  );

  // `min-w-0` is load-bearing, not tidiness. These rows sit in a `grid`, and a
  // grid item's default `min-width: auto` means a row that cannot shrink sets
  // the track's width — so one long number pushed the whole page column past
  // the viewport and every sibling, headings included, was silently clipped
  // rather than scrolled. Found by capturing the board at 390px and looking at
  // it; no offline gate could see it, and the horizontal-overflow check could
  // not either, because the page never became scrollable.
  const rowClassName = cn(
    cardInteractive,
    cardPadding.standard,
    "flex min-h-tap w-full min-w-0 items-start gap-3 text-left",
    stackOnPhone && "flex-col sm:flex-row",
  );

  if (href?.startsWith("/")) {
    return (
      <Link
        href={href}
        data-testid={testId}
        data-on-call-entry-card=""
        className={rowClassName}
        onClick={handleActivate}
        {...anchorProps}
      >
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        data-testid={testId}
        data-on-call-entry-card=""
        className={rowClassName}
        onClick={handleActivate}
        {...anchorProps}
      >
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => {
          handleActivate();
          onClick();
        }}
        data-testid={testId}
        data-on-call-entry-card=""
        className={rowClassName}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      data-testid={testId}
      data-on-call-entry-card=""
      className={cn(cardSurface, cardPadding.standard, "flex min-h-tap w-full min-w-0 items-start gap-3")}
    >
      {content}
    </div>
  );
}
