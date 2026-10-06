"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import type { CmeCategory } from "@/lib/cme/types";

/**
 * CPD's quiet building blocks (the 5 Oct mock-up, Work search v12 style): flat
 * lists on the page with hairline dividers, a small uppercase label above each
 * group, grey leading marks and one accent colour. Built on the mode kit's
 * recipes (row heights, inset hairline, pressed state) so sizes and colours
 * stay on the app's tokens; only the bordered card around the list is dropped.
 */

/** A group's label row: the uppercase label, with an optional link or note at the right. */
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
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <Heading
        id={id}
        className="text-2xs font-semibold uppercase leading-4 tracking-label text-[color:var(--text-muted)]"
      >
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
      className={cn("grid min-w-0 gap-1", className)}
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
    wrap ? "whitespace-normal text-left" : "whitespace-nowrap",
    "relative inline-flex min-h-12 items-center gap-1 text-sm-minus font-medium normal-case tracking-normal text-[color:var(--clinical-accent)] no-underline hover:underline",
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

/** The flat list itself: rows on the page surface, hairlines between them. */
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
    <ul role="list" aria-label={label} data-testid={testId} className={cn("grid min-w-0", className)}>
      {children}
    </ul>
  );
}

/** The leading mark on a row: an open circle (still to do), a tick (done), or nothing. */
export function CmeRowMark({ state }: { readonly state: "open" | "done" | "none" }) {
  if (state === "none") return <span aria-hidden="true" className="size-4 shrink-0" />;
  if (state === "done") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-4 shrink-0 fill-none stroke-[color:var(--text-muted)] stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="M3 8.5l3.2 3L13 4.5" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mx-px size-4 shrink-0 rounded-full border-[1.5px] border-[color:var(--border-strong)] forced-colors:border-[CanvasText]"
    />
  );
}

/**
 * One row: optional leading mark or grey icon, a title, a muted second line,
 * and an end slot (a value, a text link or a chevron). With `href` the text is
 * a link and ends in a chevron; a control in `end` always sits beside the
 * link, never inside it.
 */
export function CmeFlatRow({
  title,
  subtitle,
  lead,
  end,
  href,
  muted = false,
  testId,
  className,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly lead?: ReactNode;
  readonly end?: ReactNode;
  readonly href?: string;
  /** Greyed text: a line that does not apply to this person. */
  readonly muted?: boolean;
  readonly testId?: string;
  readonly className?: string;
}) {
  const height = subtitle ? modeRowHeight.double : modeRowHeight.single;
  const text = (
    <span className="grid min-w-0 flex-1 gap-px py-2">
      <span
        className={cn(
          "break-words text-sm font-medium leading-5",
          muted ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-heading)]",
        )}
      >
        {title}
      </span>
      {subtitle ? (
        <span className="line-clamp-2 break-words text-sm-minus leading-4.5 text-[color:var(--text-muted)]">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
  const leadSlot = lead ? (
    <span className="flex shrink-0 items-center text-[color:var(--text-muted)] [&_svg]:size-icon-md">{lead}</span>
  ) : null;
  if (href) {
    return (
      <li className={cn(modeInsetHairline, "flex min-w-0 items-center before:left-0", className)}>
        <Link
          href={href}
          data-testid={testId}
          className={cn(height, modePressable, focusRing, "flex min-w-0 flex-1 items-center gap-3 no-underline")}
        >
          {leadSlot}
          {text}
          {end ? null : (
            <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
          )}
        </Link>
        {end ? <span className="ml-3 flex shrink-0 items-center">{end}</span> : null}
      </li>
    );
  }
  return (
    <li
      data-testid={testId}
      className={cn(modeInsetHairline, height, "flex min-w-0 items-center gap-3 before:left-0", className)}
    >
      {leadSlot}
      {text}
      {end ? <span className="flex shrink-0 items-center">{end}</span> : null}
    </li>
  );
}

/** The three CPD categories as shades of CPD indigo (tokens in globals.css). */
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
        "flex items-start gap-2.5 rounded-lg border bg-[color:var(--surface-raised)] px-3 py-2.5 text-sm-minus text-[color:var(--text-muted)]",
        tone === "warn" ? "border-[color:var(--warning-border)]" : "border-[color:var(--border)]",
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
