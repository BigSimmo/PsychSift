"use client";

import { X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import type { MyDaySourceMode } from "@/lib/my-day/model";

/*
 * My Day's pieces in the work-mode look (work-mode redesign, owner request
 * 6 Oct 2026): white cards with a hairline, small-capitals labels, flat tinted
 * icon circles in the colour of the area that owns a row, date tiles and small
 * tinted pill buttons. Flat by the owner's decision: no lift, no gloss.
 *
 * Colours come from tokens only: the work frame's `--work-*` recipes and the
 * area palettes (`--mode-identity*`), selected by `data-mode-identity`. The
 * frame sets My Day's palette on the page, so a piece with no area is blue.
 */

/** A text link or button: the area colour, with a 48px tap area round its words. */
export const quietLink = cn(
  focusRing,
  "relative inline-flex min-h-12 min-w-12 items-center justify-center whitespace-nowrap rounded-md text-xs font-bold text-[color:var(--mode-identity)] no-underline hover:underline",
);

/** The same, in the muted colour, for the quieter of two actions ("Later"). */
export const quietLinkMuted = cn(
  focusRing,
  "relative inline-flex min-h-12 min-w-12 items-center justify-center whitespace-nowrap rounded-md text-2xs font-bold text-[color:var(--text-muted)] no-underline hover:underline",
);

/**
 * A small tinted pill ("Answer", "Renew"): 28px drawn, with a 48px tap area
 * round it, so a row keeps its height.
 */
export const quietPill = cn(
  focusRing,
  "relative inline-flex h-7 items-center justify-center whitespace-nowrap rounded-full bg-[color:var(--mode-identity-soft)] px-3 text-xs font-bold text-[color:var(--mode-identity)] no-underline before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] forced-colors:border",
);

/** The same pill in white with a hairline, for a secondary action ("Review", "Add"). */
export const quietPillQuiet = cn(
  quietPill,
  "border border-[color:var(--work-line-strong)] bg-[color:var(--work-surface)] text-[color:var(--work-ink)]",
);

/** The amber pill for a lapsed or late item's one action ("Book"). */
export const quietPillAmber = cn(
  quietPill,
  "border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]",
);

/** The one filled button on a screen. */
export const quietPrimary = cn(
  focusRing,
  "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-[color:var(--work-primary)] px-4 text-sm font-bold text-[color:var(--work-primary-text)] no-underline forced-colors:border",
);

/** The small-capitals label line: the words at the left, a count, a link at the right. */
export function QuietLabel({
  id,
  title,
  count,
  aside,
  as: Tag = "h2",
}: {
  readonly id?: string;
  readonly title: ReactNode;
  readonly count?: ReactNode;
  readonly aside?: ReactNode;
  readonly as?: "h2" | "h3" | "p";
}) {
  return (
    <div className="flex min-h-4 min-w-0 items-center justify-between gap-2.5">
      <Tag id={id} className="m-0 min-w-0 text-3xs font-bold tracking-widest text-[color:var(--text-muted)] uppercase">
        {title}
        {count ? <span className="ml-1.5 text-2xs font-semibold tracking-normal normal-case nums">{count}</span> : null}
      </Tag>
      {aside ? <div className="-my-4 flex shrink-0 items-center gap-1">{aside}</div> : null}
    </div>
  );
}

/** The card recipe: white, a hairline, the work radius, a barely visible shadow. */
export const quietCard =
  "min-w-0 overflow-hidden rounded-[var(--work-radius-card)] border border-[color:var(--work-line)] bg-[color:var(--work-surface)] shadow-[var(--work-shadow-card)] forced-colors:border";

/**
 * A section. `card` (the default) puts the label inside one padded card with
 * its content, as the mockup's This week, CPD and Renewals cards are. `rows`
 * puts the label above and the content in a card of rows (Needs you). `bare`
 * puts the label above content that brings its own cards.
 */
export function QuietSection({
  title,
  count,
  aside,
  onHide,
  testId,
  className,
  variant = "card",
  children,
}: {
  readonly title: string;
  readonly count?: string;
  readonly aside?: ReactNode;
  /** Hides the card (a Hide button beside the label). */
  readonly onHide?: () => void;
  readonly testId?: string;
  readonly className?: string;
  readonly variant?: "card" | "rows" | "bare";
  readonly children: ReactNode;
}) {
  const headingId = useId();
  const label = (
    <QuietLabel
      id={headingId}
      title={title}
      count={count}
      aside={
        aside || onHide ? (
          <>
            {aside}
            {onHide ? <QuietHideButton label={title} onHide={onHide} testId={testId} inline /> : null}
          </>
        ) : undefined
      }
    />
  );
  if (variant === "card") {
    return (
      <section
        aria-labelledby={headingId}
        data-testid={testId}
        className={cn(quietCard, "relative grid content-start gap-1.5 px-3.5 py-3", className)}
      >
        {label}
        {children}
      </section>
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn("relative grid min-w-0 content-start gap-2", className)}
    >
      <div className="px-1">{label}</div>
      {variant === "rows" ? <div className={quietCard}>{children}</div> : children}
    </section>
  );
}

/** A Hide button: a small round face inside a 48px tap area. */
export function QuietHideButton({
  label,
  onHide,
  testId,
  onHero = false,
  inset = false,
  inline = false,
}: {
  readonly label: string;
  readonly onHide: () => void;
  readonly testId?: string;
  readonly onHero?: boolean;
  /** Sits inside its box, so it cannot overlap a parent's own Hide button. */
  readonly inset?: boolean;
  /** Sits in the label line instead of the corner. */
  readonly inline?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onHide}
      aria-label={`Hide ${label}`}
      data-testid={testId ? `${testId}-hide` : undefined}
      className={cn(
        focusRing,
        "grid size-12 place-items-center rounded-full",
        inline ? "relative -mr-3" : cn("absolute", inset ? "top-0 right-0" : "-top-3 -right-3"),
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6 place-items-center rounded-full forced-colors:border",
          onHero
            ? "bg-[color:var(--mode-identity-contrast)] text-[color:var(--mode-identity)]"
            : "bg-[color:var(--work-wash)] text-[color:var(--text-muted)]",
        )}
      >
        <X aria-hidden="true" className="size-icon-xs" />
      </span>
    </button>
  );
}

/**
 * Rows divided by hairlines. In a card of rows each row carries the card's
 * side padding; `inset` rows sit inside a padded card and carry none.
 */
export function QuietList({
  label,
  testId,
  className,
  inset = false,
  children,
}: {
  readonly label?: string;
  readonly testId?: string;
  readonly className?: string;
  readonly inset?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <ul
      role="list"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "m-0 grid min-w-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]",
        inset ? "[&>li]:px-0" : "[&>li]:px-3",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/**
 * One row: an optional lead (icon or date tile), a bold title and a small
 * line under it, optional actions under those, and an optional end (a pill, a
 * tag, a call button). Titles wrap rather than cut off.
 */
export function QuietRow({
  lead,
  title,
  subtitle,
  actions,
  end,
  done = false,
  testId,
  className,
}: {
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  readonly end?: ReactNode;
  /** Finished: greyed, and the title is no longer emphasised. */
  readonly done?: boolean;
  readonly testId?: string;
  readonly className?: string;
}) {
  return (
    <li
      data-testid={testId}
      data-done={done ? "" : undefined}
      className={cn("flex min-h-12 min-w-0 items-center gap-2.5 py-2", className)}
    >
      {lead}
      <span className="grid min-w-0 flex-1">
        <span
          className={cn(
            "text-sm leading-tight break-words",
            done ? "font-semibold text-[color:var(--text-muted)]" : "font-bold text-[color:var(--work-ink)]",
          )}
        >
          {title}
        </span>
        {subtitle ? (
          <span className="mt-px text-2xs leading-snug break-words text-[color:var(--text-muted)]">{subtitle}</span>
        ) : null}
        {actions ? <span className="-my-2 flex flex-wrap items-center gap-x-4.5">{actions}</span> : null}
      </span>
      {end ? (
        <span className="flex shrink-0 items-center gap-2 text-2xs font-semibold text-[color:var(--text-muted)]">
          {end}
        </span>
      ) : null}
    </li>
  );
}

/**
 * A flat tinted circle with the icon in the colour of the area that owns the
 * row: colour marks where a tap goes. Decorative; the row says it in words.
 */
export function AreaIcon({
  mode,
  icon: Icon,
  tone,
  size = "md",
}: {
  readonly mode?: MyDaySourceMode | "my-day";
  readonly icon: LucideIcon;
  /** A status tint in place of the area colour. */
  readonly tone?: "amber" | "red" | "green" | "neutral";
  readonly size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={mode}
      className={cn(
        "grid shrink-0 place-items-center rounded-full forced-colors:border",
        size === "lg" ? "size-9" : "size-7.5",
        tone === "amber"
          ? "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]"
          : tone === "red"
            ? "bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]"
            : tone === "green"
              ? "bg-[color:var(--success-bg)] text-[color:var(--success-text)]"
              : tone === "neutral"
                ? "bg-[color:var(--work-wash)] text-[color:var(--text-muted)]"
                : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
      )}
    >
      <Icon aria-hidden="true" className={size === "lg" ? "size-4" : "size-3.75"} strokeWidth={2} />
    </span>
  );
}

/** A date tile: a small-capitals word over the day number ("OCT / 18", "TUE / 6"). */
export function DateBlock({
  number,
  word,
  today = false,
  mode,
}: {
  readonly number: number | string;
  readonly word: string;
  readonly today?: boolean;
  /** Colours the word in that area's colour. */
  readonly mode?: MyDaySourceMode;
}) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={mode}
      className="grid w-8.5 shrink-0 justify-items-center text-center leading-none"
    >
      <span className="text-3xs font-bold tracking-wider text-[color:var(--mode-identity)] uppercase">{word}</span>
      <span
        className={cn(
          "mt-0.5 text-base font-bold nums",
          today ? "text-[color:var(--mode-identity)]" : "text-[color:var(--work-ink)]",
        )}
      >
        {number}
      </span>
    </span>
  );
}

/**
 * A note strip: an icon circle, a bold line and a line under it, and an
 * optional action. Grey by default; `warn` makes it amber (late or failed),
 * `danger` adds a red icon (a lapsed credential).
 */
export function QuietNote({
  icon: Icon,
  title,
  body,
  action,
  warn = false,
  danger = false,
  testId,
  role,
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly body?: ReactNode;
  readonly action?: ReactNode;
  readonly warn?: boolean;
  readonly danger?: boolean;
  readonly testId?: string;
  readonly role?: "status" | "alert";
}) {
  const tinted = warn || danger;
  return (
    <div
      data-testid={testId}
      role={role}
      data-warn={warn ? "" : undefined}
      data-danger={danger ? "" : undefined}
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-[var(--work-radius-card)] px-3 py-2.5 forced-colors:border",
        tinted
          ? "border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]"
          : "bg-[color:var(--work-wash)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7.5 shrink-0 place-items-center rounded-full",
          danger
            ? "bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]"
            : warn
              ? "bg-[color:var(--work-surface)] text-[color:var(--warning-text)]"
              : "bg-[color:var(--work-surface)] text-[color:var(--text-muted)]",
        )}
      >
        <Icon aria-hidden="true" className="size-3.75" strokeWidth={2} />
      </span>
      <span className="grid min-w-0 flex-1">
        <span
          className={cn(
            "text-sm leading-tight font-bold break-words",
            tinted ? "text-[color:var(--warning-text)]" : "text-[color:var(--work-ink)]",
          )}
        >
          {title}
        </span>
        {body ? (
          <span className="mt-px text-2xs leading-snug break-words text-[color:var(--text-muted)]">{body}</span>
        ) : null}
      </span>
      {action ? <span className="-my-2 shrink-0 self-center">{action}</span> : null}
    </div>
  );
}

/** Small print under a section, with a small icon. */
export function QuietFoot({ icon: Icon, children }: { readonly icon: LucideIcon; readonly children: ReactNode }) {
  return (
    <p className="m-0 flex min-w-0 items-start gap-1.75 px-1 text-2xs leading-snug font-medium text-[color:var(--text-muted)]">
      <Icon aria-hidden="true" className="mt-px size-3.25 shrink-0" strokeWidth={2} />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/**
 * The "Checked 07:40 · On Call, Roster" line: a green dot when every source
 * answered, amber when one did not, grey when nothing is set up or the data
 * is a sample.
 */
export function QuietStamp({
  tone,
  testId,
  children,
}: {
  readonly tone: "ok" | "warn" | "off";
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <p
      data-testid={testId}
      data-tone={tone}
      className="m-0 flex min-w-0 items-center gap-1.5 px-0.5 text-2xs font-semibold text-[color:var(--text-muted)]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.75 shrink-0 rounded-full forced-colors:bg-[CanvasText]",
          tone === "ok"
            ? "bg-[color:var(--success-text)]"
            : tone === "warn"
              ? "bg-[color:var(--warning-text)]"
              : "bg-[color:var(--neutral-400)]",
        )}
      />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** A key and value on one line ("Educational · 16 h"). */
export function QuietKeyValue({
  label,
  value,
  total = false,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly total?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 justify-between gap-2.5 text-xs text-[color:var(--text-muted)]",
        total && "mt-0.5 border-t border-[color:var(--work-line)] pt-1.5",
      )}
    >
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 font-bold text-[color:var(--work-ink)] nums">{value}</span>
    </span>
  );
}

/** A plain ring: one arc out of a whole, in the area's colour, with words in the middle. */
export function QuietRing({
  fraction,
  mode,
  testId,
  children,
}: {
  readonly fraction: number;
  readonly mode?: MyDaySourceMode;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  // 84px, matching the size-21 box below.
  const size = 84;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <span
      aria-hidden="true"
      data-mode-identity={mode}
      data-testid={testId}
      data-fraction={clamped.toFixed(3)}
      className="relative grid size-21 shrink-0 place-items-center text-center"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-[color:var(--work-wash)]"
        />
        {clamped > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${clamped * circumference} ${circumference}`}
            className="stroke-[color:var(--mode-identity)] forced-colors:stroke-[CanvasText]"
          />
        ) : null}
      </svg>
      <span className="relative grid leading-tight">{children}</span>
    </span>
  );
}

/** A link styled as a text link, carrying the "from My Day" marker the caller adds. */
export function QuietTextLink({
  href,
  children,
  muted = false,
  pill = false,
  ariaLabel,
  testId,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly muted?: boolean;
  /** Drawn as a small tinted pill ("Renew"). */
  readonly pill?: boolean;
  readonly ariaLabel?: string;
  readonly testId?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      data-testid={testId}
      className={pill ? quietPill : muted ? quietLinkMuted : quietLink}
    >
      {children}
    </Link>
  );
}
