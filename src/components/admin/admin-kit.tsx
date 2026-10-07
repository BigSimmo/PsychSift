"use client";

import { ChevronRight, CloudOff, Phone, RotateCw, ShieldHalf, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkButton, WorkCard, WorkSectionLabel, type WorkSectionLabelProps } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";

import styles from "./admin-work.module.css";

/**
 * Admin's small layout pieces on top of the shared work kit (work-mode
 * redesign, owner request 6 Oct 2026). Each one exists because Admin's mockup
 * repeats it on several pages: the page column, a labelled section, the
 * centred shield note under a list, a row with its own action beside it, the
 * flat meter, the grey alert card and the glass sheet.
 */

/** The page: one `<main>` (the frame's band names it) around the work column. */
export function AdminPage({
  testId,
  wide,
  children,
}: {
  readonly testId: string;
  /** Two columns from a laptop width (Today). */
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <main data-testid={testId} className={styles.page}>
      <div className={cn("work-body", wide && styles.wide)}>{children}</div>
    </main>
  );
}

/** Two columns from a laptop width; one column, in order, on a phone. */
export function AdminColumns({ children }: { readonly children: ReactNode }) {
  return <div className={styles.columns}>{children}</div>;
}

export function AdminColumn({ children }: { readonly children: ReactNode }) {
  return <div className={styles.column}>{children}</div>;
}

/** A section: the small-caps label, then its card. */
export function AdminSection({
  label,
  count,
  action,
  id,
  labelId,
  testId,
  as = "h2",
  children,
}: {
  readonly label: ReactNode;
  readonly count?: ReactNode;
  readonly action?: WorkSectionLabelProps["action"];
  /** The section's own anchor (scroll target). */
  readonly id?: string;
  /** The heading's id, when something else names the section by it. */
  readonly labelId?: string;
  readonly testId?: string;
  readonly as?: "h2" | "h3";
  readonly children: ReactNode;
}) {
  return (
    <section id={id} data-testid={testId} className={styles.section} aria-labelledby={labelId}>
      <WorkSectionLabel count={count} action={action} as={as} id={labelId}>
        {label}
      </WorkSectionLabel>
      {children}
    </section>
  );
}

/** The centred note under a list: "Dates you entered, not a check". */
export function AdminNote({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <p className={styles.note} data-testid={testId}>
      <ShieldHalf aria-hidden="true" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

/**
 * A list row that opens something, with an optional real control BESIDE it
 * (never nested inside it: a button in a button is invalid, and the control
 * needs its own tap). Draws the kit's `work-row` shape.
 */
export function AdminRow({
  lead,
  title,
  sub,
  tags,
  end,
  action,
  href,
  onClick,
  anchorId,
  testId,
  chevron = true,
  "aria-expanded": ariaExpanded,
  className,
}: {
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  readonly sub?: ReactNode;
  /** Small tags under the text ("Rule to confirm"). */
  readonly tags?: ReactNode;
  /** A status at the row's end, read as part of the row. */
  readonly end?: ReactNode;
  /** A real control beside the row ("Add", "Move back", a call button). */
  readonly action?: ReactNode;
  readonly href?: string;
  readonly onClick?: () => void;
  /** The `<li>`'s id, so a link to this row lands here. */
  readonly anchorId?: string;
  readonly testId?: string;
  readonly chevron?: boolean;
  readonly "aria-expanded"?: boolean;
  readonly className?: string;
}) {
  const body = (
    <>
      {lead}
      <span className="work-row__text">
        <span className="work-row__title">{title}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
        {tags ? <span className={styles.rowTags}>{tags}</span> : null}
      </span>
      {end !== undefined && end !== null ? <span className="work-row__end">{end}</span> : null}
      {(href || onClick) && !action && chevron ? (
        <ChevronRight
          aria-hidden="true"
          className={cn("work-row__chev", ariaExpanded !== undefined && styles.disclosureChev)}
          strokeWidth={2}
        />
      ) : null}
    </>
  );
  const control = href ? (
    <Link href={href} className="work-row" data-testid={testId}>
      {body}
    </Link>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn("work-row", ariaExpanded !== undefined && styles.disclosure)}
      aria-expanded={ariaExpanded}
      data-testid={testId}
    >
      {body}
    </button>
  ) : (
    <div className="work-row" data-testid={testId}>
      {body}
    </div>
  );
  return (
    <li id={anchorId} className={cn(styles.rowItem, className)}>
      {control}
      {action ? <div className={styles.rowAction}>{action}</div> : null}
    </li>
  );
}

/** The small pill button at a row's end ("Add", "Record", "Move back"): 34px drawn, 48px tap. */
export function AdminRowButton({
  label,
  icon: Icon,
  onClick,
  testId,
  accessibleLabel,
  variant = "secondary",
}: {
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly onClick: () => void;
  readonly testId?: string;
  /** The full spoken name when the visible word is short ("Add date for Hand hygiene"). */
  readonly accessibleLabel?: string;
  readonly variant?: "secondary" | "tinted";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={accessibleLabel}
      data-variant={variant}
      className={cn("work-button min-h-tap shrink-0 px-3", styles.pill)}
    >
      {Icon ? <Icon aria-hidden="true" strokeWidth={2.2} /> : null}
      {label}
    </button>
  );
}

/** The round call button at a row's end: dials. */
export function AdminCallButton({
  tel,
  label,
  testId,
}: {
  readonly tel: string;
  readonly label: string;
  readonly testId?: string;
}) {
  return (
    <a href={tel} className={styles.call} aria-label={label} data-testid={testId}>
      <Phone aria-hidden="true" strokeWidth={2} />
    </a>
  );
}

/** A flat meter in the mode colour. Drawn as SVG, so it needs no inline style. */
export function AdminMeter({ fraction, label }: { readonly fraction: number; readonly label: string }) {
  const at = Math.round(Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1) * 1000) / 10;
  return (
    <span role="img" aria-label={label} className={styles.meter}>
      <svg aria-hidden="true" width="100%" height="100%" className="block">
        <rect x="0" y="0" width={`${at}%`} height="100%" rx="3" className={styles.meterSvgFill} />
      </svg>
    </span>
  );
}

/**
 * The grey alert card for a load that failed: an icon, what happened, and Try
 * again. Fail-closed by design: it never shows a saved list under it, because
 * printing "nothing due" over a lapsing registration would be unsafe.
 */
export function AdminLoadAlert({
  title,
  body,
  offline,
  onRetry,
  retryTestId,
  testId,
}: {
  readonly title: string;
  readonly body: string;
  readonly offline?: boolean;
  readonly onRetry: () => void;
  readonly retryTestId?: string;
  readonly testId?: string;
}) {
  return (
    <WorkCard testId={testId} className={styles.alert}>
      <div className={styles.alertHead} role="alert">
        <span aria-hidden="true" className="work-ic" data-tone="neutral">
          {offline ? <CloudOff aria-hidden="true" strokeWidth={2} /> : <RotateCw aria-hidden="true" strokeWidth={2} />}
        </span>
        <div className="min-w-0">
          <p className={styles.alertTitle}>{title}</p>
          <p className={styles.alertBody}>{body}</p>
        </div>
      </div>
      <WorkButton variant="secondary" onClick={onRetry} testId={retryTestId} icon={RotateCw}>
        Try again
      </WorkButton>
    </WorkCard>
  );
}

/** The static grey skeleton block (no shimmer). */
export function AdminSkeleton({ className }: { readonly className?: string }) {
  return <span aria-hidden="true" className={cn(styles.skel, className)} />;
}

/**
 * The work-mode glass sheet: the shared Sheet in the More sheet's look (a
 * floating glass panel with a soft close circle).
 */
export function AdminSheet({
  open,
  onClose,
  title,
  description,
  footer,
  testId,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly footer?: ReactNode;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={footer}
      testId={testId}
      contentClassName="work-more-sheet"
      headerClassName="work-more-sheet__header"
      titleClassName="work-more-sheet__title"
      closeButtonClassName="work-more-sheet__close"
      bodyClassName="work-more-sheet__body"
      footerClassName={styles.sheetFoot}
    >
      {children}
    </Sheet>
  );
}

export { styles as adminStyles };
