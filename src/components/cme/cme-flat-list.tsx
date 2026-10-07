"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import type { CmeCategory } from "@/lib/cme/types";

/**
 * CPD's building blocks in the work-mode look (work-mode redesign, owner request
 * 6 Oct 2026): a small-caps label above each group, then a white card with a
 * hairline, rows divided by hairlines, a flat icon circle leading each row and
 * one accent colour. Built on the shared work kit's classes (`work-label`,
 * `work-card`, `work-row`) so every CPD page reads like the rest of work mode.
 */

/** A group's label row: the small-caps label, with an optional link or note at the right. */
export function CmeGroupLabel({
  label,
  end,
  id,
  as: Heading = "h2",
}: {
  readonly label: ReactNode;
  readonly end?: ReactNode;
  readonly id?: string;
  readonly as?: "h2" | "h3";
}) {
  return (
    <div className="work-label flex-wrap">
      <Heading id={id} className="m-0 text-inherit font-inherit">
        {label}
      </Heading>
      {end}
    </div>
  );
}

/** A labelled group: label row, then its content (usually a `CmeFlatList`). */
export function CmeGroup({
  label,
  end,
  testId,
  className,
  children,
}: {
  readonly label?: ReactNode;
  readonly end?: ReactNode;
  readonly testId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={label ? headingId : undefined}
      data-testid={testId}
      className={cn("grid min-w-0 gap-2", className)}
    >
      {label ? <CmeGroupLabel id={headingId} label={label} end={end} /> : null}
      {children}
    </section>
  );
}

/** A quiet text link in the accent colour, with a 48px tap area around it. */
export function CmeTextLink({
  href,
  onClick,
  children,
  testId,
  className,
  wrap = false,
}: {
  readonly href?: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly className?: string;
  /** Let a longer label wrap at large text sizes instead of pushing the row wider. */
  readonly wrap?: boolean;
}) {
  const classes = cn(
    focusRing,
    "cpd-text-link",
    wrap ? "whitespace-normal text-left" : "whitespace-nowrap",
    "relative inline-flex min-h-12 items-center gap-1 text-sm-minus font-semibold normal-case tracking-normal text-[color:var(--clinical-accent)] no-underline hover:underline",
    className,
  );
  if (href) {
    return (
      <Link href={href} data-testid={testId} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} data-testid={testId} className={classes}>
      {children}
    </button>
  );
}

/** The list itself: a white card, hairlines between its rows. */
export function CmeFlatList({
  children,
  testId,
  label,
  className,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
  /** Accessible name when the list has no visible group label. */
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <ul role="list" aria-label={label} data-testid={testId} className={cn("work-card work-rows min-w-0", className)}>
      {children}
    </ul>
  );
}

/** The leading mark on a row: a flat circle (still to do), a ticked one (done), or nothing. */
export function CmeRowMark({ state }: { readonly state: "open" | "done" | "none" }) {
  if (state === "none") return <span aria-hidden="true" className="size-7.5 shrink-0" />;
  if (state === "done") {
    return (
      <span aria-hidden="true" className="work-ic" data-tone="neutral">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="work-ic">
      <span className="size-3 rounded-full border-2 border-current forced-colors:border-[CanvasText]" />
    </span>
  );
}

/**
 * One row: optional leading icon (drawn in a flat circle) or mark, a title, a
 * muted second line, and an end slot (a value, a button or a chevron). With
 * `href` the text is a link and ends in a chevron; a control in `end` always
 * sits beside the link, never inside it.
 */
export function CmeFlatRow({
  title,
  subtitle,
  lead,
  leadTone = "neutral",
  end,
  href,
  muted = false,
  testId,
  className,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly lead?: ReactNode;
  /** A bare icon lead sits in a grey circle, or the mode's copper tint. */
  readonly leadTone?: "neutral" | "mode";
  readonly end?: ReactNode;
  readonly href?: string;
  /** Greyed text: a line that does not apply to this person. */
  readonly muted?: boolean;
  readonly testId?: string;
  readonly className?: string;
}) {
  const text = (
    <span className="work-row__text">
      <span className={cn("work-row__title break-words", muted && "text-[color:var(--text-muted)]")}>{title}</span>
      {subtitle ? <span className="work-row__sub line-clamp-2 break-words">{subtitle}</span> : null}
    </span>
  );
  const leadSlot = lead ? (
    <span className="cpd-lead" data-tone={leadTone === "mode" ? "mode" : undefined}>
      {lead}
    </span>
  ) : null;
  if (href) {
    return (
      <li className={cn("flex min-w-0 items-center", className)}>
        <Link href={href} data-testid={testId} className={cn("work-row min-h-tap min-w-0 flex-1", end ? "pr-1" : "")}>
          {leadSlot}
          {text}
          {end ? null : <ChevronRight aria-hidden="true" className="work-row__chev" />}
        </Link>
        {end ? <span className="flex shrink-0 items-center pr-3">{end}</span> : null}
      </li>
    );
  }
  return (
    <li data-testid={testId} className={cn("work-row min-w-0", className)}>
      {leadSlot}
      {text}
      {end ? <span className="flex shrink-0 items-center">{end}</span> : null}
    </li>
  );
}

/** The three CPD categories as copper shades (tokens in cme-work.css and globals.css). */
const cmeCategoryShade: Record<CmeCategory, string> = {
  educational: "bg-[color:var(--cme-cat-1)]",
  reviewing: "bg-[color:var(--cme-cat-2)]",
  measuring: "bg-[color:var(--cme-cat-3)]",
};

/** The same shades as SVG fills. */
export const cmeCategoryShadeFill: Record<CmeCategory, string> = {
  educational: "fill-[color:var(--cme-cat-1)]",
  reviewing: "fill-[color:var(--cme-cat-2)]",
  measuring: "fill-[color:var(--cme-cat-3)]",
};

/** A small category dot. Colour only helps; the category name always sits beside it. */
export function CmeCategoryDot({ category }: { readonly category: CmeCategory }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full forced-colors:bg-[CanvasText]",
        cmeCategoryShade[category],
      )}
    />
  );
}

/** A quiet value at the end of a row: tabular figures, the unit smaller. */
export function CmeRowValue({ value, unit }: { readonly value: ReactNode; readonly unit?: string }) {
  return (
    <span className="nums whitespace-nowrap text-sm text-[color:var(--text-heading)]">
      {value}
      {unit ? <small className="ml-px text-xs text-[color:var(--text-muted)]">{unit}</small> : null}
    </span>
  );
}

/** A plain note: hairline border, grey icon, optional bold first line. `warn` is amber for a real problem. */
export function CmeNote({
  icon,
  title,
  children,
  tone = "plain",
  testId,
  role,
}: {
  readonly icon?: ReactNode;
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  readonly tone?: "plain" | "warn";
  readonly testId?: string;
  readonly role?: "status" | "alert";
}) {
  return (
    <div
      data-testid={testId}
      role={role}
      className={cn(
        "work-card flex items-start gap-2.5 px-3 py-2.5 text-sm-minus text-[color:var(--text-muted)]",
        tone === "warn" ? "border-[color:var(--warning-border)]" : "",
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "mt-px shrink-0 [&_svg]:size-4",
            tone === "warn" ? "text-[color:var(--warning)]" : "text-[color:var(--text-muted)]",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="grid min-w-0 gap-0.5">
        {title ? <b className="font-semibold text-[color:var(--text-heading)]">{title}</b> : null}
        {children}
      </div>
    </div>
  );
}
