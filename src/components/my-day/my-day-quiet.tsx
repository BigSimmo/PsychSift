"use client";

import { X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import type { MyDaySourceMode } from "@/lib/my-day/model";

/*
 * My Day's quiet pieces (mock-up v2, 5 October 2026): flat sections with a
 * small-capitals label, lists with hairline dividers, grey icons with an area
 * dot, and text links in place of pill buttons. One filled button per screen.
 * They read the `--dash-*` tokens, so they belong inside `.dash-surface`.
 */

/** A text link or button: 13px, the link colour, with a 48px tap area round its words. */
export const quietLink = cn(
  focusRing,
  "relative inline-flex min-h-12 items-center whitespace-nowrap rounded-md text-sm font-medium text-[color:var(--dash-blue)] no-underline hover:underline",
);

/** The same, in the muted colour, for the quieter of two actions ("Later"). */
export const quietLinkMuted = cn(quietLink, "text-[color:var(--dash-muted)]");

/** The one filled button on a screen. */
export const quietPrimary = cn(
  focusRing,
  "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-dash-title no-underline",
);

/** Small capitals over a section, with an optional count and a link at the right. */
export function QuietSection({
  title,
  count,
  aside,
  onHide,
  testId,
  className,
  children,
}: {
  readonly title: string;
  readonly count?: string;
  readonly aside?: ReactNode;
  /** Edit mode only: shows a Hide button beside the label. */
  readonly onHide?: () => void;
  readonly testId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  const editing = onHide !== undefined;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn(
        "relative grid min-w-0 content-start gap-1",
        editing && "rounded-xl outline-2 outline-offset-4 outline-dashed outline-[color:var(--dash-line-strong)]",
        className,
      )}
    >
      <div className="flex min-h-6 min-w-0 items-center justify-between gap-2.5">
        <h2 id={headingId} className="text-2xs font-dash-title uppercase tracking-wider text-[color:var(--dash-faint)]">
          {title}
          {count ? (
            <span className="ml-1.5 text-xs font-medium normal-case tracking-normal text-[color:var(--dash-muted)]">
              {count}
            </span>
          ) : null}
        </h2>
        <div className={cn("-my-3 flex shrink-0 items-center gap-1", editing && "mr-10")}>{aside}</div>
      </div>
      {children}
      {editing ? <QuietHideButton label={title} onHide={onHide} testId={testId} /> : null}
    </section>
  );
}

/** The edit mode's Hide button: a small face inside a 48px tap area. */
export function QuietHideButton({
  label,
  onHide,
  testId,
  onHero = false,
  inset = false,
}: {
  readonly label: string;
  readonly onHide: () => void;
  readonly testId?: string;
  readonly onHero?: boolean;
  /** Sits inside its box, so it cannot overlap a parent's own Hide button. */
  readonly inset?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onHide}
      aria-label={`Hide ${label}`}
      data-testid={testId ? `${testId}-hide` : undefined}
      className={cn(
        focusRing,
        "absolute grid size-12 place-items-center rounded-full",
        inset ? "top-0 right-0" : "-top-3 -right-3",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6 place-items-center rounded-full forced-colors:border",
          onHero
            ? "bg-[color:var(--dash-hero-ink)] text-[color:var(--dash-hero-2)]"
            : "bg-[color:var(--dash-ink)] text-[color:var(--dash-page)]",
        )}
      >
        <X aria-hidden="true" className="size-icon-xs" />
      </span>
    </button>
  );
}

/** A flat list: rows divided by hairlines, no box. */
export function QuietList({
  label,
  testId,
  className,
  children,
}: {
  readonly label?: string;
  readonly testId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <ul
      role="list"
      aria-label={label}
      data-testid={testId}
      className={cn("grid min-w-0 [&>li+li]:border-t [&>li+li]:border-[color:var(--dash-line)]", className)}
    >
      {children}
    </ul>
  );
}

/**
 * One row: an optional lead (icon or date block), a title and a line under
 * it, optional text actions under those, and an optional end (a link, a call
 * button). Titles wrap rather than cut off.
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
      className={cn("flex min-h-13 min-w-0 items-center gap-3 py-2", className)}
    >
      {lead}
      <span className="grid min-w-0 flex-1">
        <span
          className={cn(
            "break-words text-base-minus leading-snug",
            done ? "text-[color:var(--dash-faint)]" : "font-medium text-[color:var(--dash-ink)]",
          )}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            className={cn(
              "mt-px break-words text-sm",
              done ? "text-[color:var(--dash-faint)]" : "text-[color:var(--dash-muted)]",
            )}
          >
            {subtitle}
          </span>
        ) : null}
        {actions ? <span className="-my-2 flex flex-wrap items-center gap-x-4.5">{actions}</span> : null}
      </span>
      {end ? (
        <span className="flex shrink-0 items-center gap-3 text-sm text-[color:var(--dash-faint)]">{end}</span>
      ) : null}
    </li>
  );
}

/**
 * A grey outline icon with a small dot in the area's colour: colour marks
 * meaning, not decoration. Decorative; the row says the same thing in words.
 */
export function AreaIcon({ mode, icon: Icon }: { readonly mode?: MyDaySourceMode; readonly icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="relative grid size-8 shrink-0 place-items-center text-[color:var(--dash-faint)]"
    >
      <Icon aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />
      {mode ? (
        <span
          data-mode-identity={mode}
          className="absolute right-px bottom-0.5 size-2 rounded-full bg-[color:var(--mode-identity)] ring-2 ring-[color:var(--dash-page)] forced-colors:bg-[CanvasText]"
        />
      ) : null}
    </span>
  );
}

/** A date block: the day number over a small-capitals word ("14 / NOV", "6 / TUE"). */
export function DateBlock({
  number,
  word,
  today = false,
  mode,
}: {
  readonly number: number | string;
  readonly word: string;
  readonly today?: boolean;
  /** Tints the block in the area's colour (used for today). */
  readonly mode?: MyDaySourceMode;
}) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={mode}
      className={cn(
        "grid w-9 shrink-0 justify-items-center leading-none",
        today ? "text-[color:var(--dash-blue)]" : "text-[color:var(--dash-ink)]",
      )}
    >
      <span className="text-base font-dash-title nums">{number}</span>
      <span
        className={cn(
          "mt-1 text-2xs font-dash-title uppercase tracking-wider",
          today ? "text-[color:var(--dash-blue)]" : "text-[color:var(--dash-faint)]",
        )}
      >
        {word}
      </span>
    </span>
  );
}

/** A grey note: an icon, a bold line and a line under it, and an optional link. Amber when something failed. */
export function QuietNote({
  icon: Icon,
  title,
  body,
  action,
  warn = false,
  testId,
  role,
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly body?: ReactNode;
  readonly action?: ReactNode;
  readonly warn?: boolean;
  readonly testId?: string;
  readonly role?: "status" | "alert";
}) {
  return (
    <div
      data-testid={testId}
      role={role}
      data-warn={warn ? "" : undefined}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-xl border bg-[color:var(--dash-raised)] px-3 py-2.5 forced-colors:border",
        warn ? "border-[color:var(--dash-warn-line)]" : "border-[color:var(--dash-line)]",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-px size-icon-sm shrink-0",
          warn ? "text-[color:var(--dash-amber)]" : "text-[color:var(--dash-muted)]",
        )}
        strokeWidth={1.6}
      />
      <span className="grid min-w-0 flex-1">
        <span className="break-words text-base-minus font-dash-title text-[color:var(--dash-ink)]">{title}</span>
        {body ? <span className="mt-px break-words text-sm text-[color:var(--dash-muted)]">{body}</span> : null}
      </span>
      {action ? <span className="-my-2 self-center">{action}</span> : null}
    </div>
  );
}

/** Small print under a section, with a small icon. */
export function QuietFoot({ icon: Icon, children }: { readonly icon: LucideIcon; readonly children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-xs text-[color:var(--dash-faint)]">
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.6} />
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
        "flex min-w-0 justify-between gap-2.5 text-sm text-[color:var(--dash-muted)]",
        total && "mt-0.5 border-t border-[color:var(--dash-line)] pt-1.5",
      )}
    >
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 font-dash-title text-[color:var(--dash-ink)] nums">{value}</span>
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
          className="stroke-[color:var(--dash-line)]"
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
            className={cn(
              mode ? "stroke-[color:var(--mode-identity)]" : "stroke-[color:var(--dash-blue)]",
              "forced-colors:stroke-[CanvasText]",
            )}
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
  ariaLabel,
  testId,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly muted?: boolean;
  readonly ariaLabel?: string;
  readonly testId?: string;
}) {
  return (
    <Link href={href} aria-label={ariaLabel} data-testid={testId} className={muted ? quietLinkMuted : quietLink}>
      {children}
    </Link>
  );
}
