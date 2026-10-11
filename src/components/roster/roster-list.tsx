import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";

/**
 * Roster's list pieces, drawn as the work-mode kit (work-mode redesign, owner
 * request 6 Oct 2026; flat, per the owner's 19:58 note): one white hairline
 * card per list, rows with a date tile or a flat tinted icon circle, a bold
 * first line, a muted second line and a quiet trailing word. Colour only
 * where it means something: the roster violet for a link word and the date
 * tile's weekday, amber for an hours-and-rest warning. Every interactive row
 * is at least the 48px tap floor.
 */

/** A section heading: a small uppercase label and an optional link or note on the right. */
export function RosterSectionHead({
  title,
  id,
  right,
  isNew = false,
}: {
  readonly title: ReactNode;
  readonly id?: string;
  readonly right?: ReactNode;
  readonly isNew?: boolean;
}) {
  return (
    <div className="-my-2 flex min-h-12 min-w-0 items-center justify-between gap-3 px-1">
      <h2
        id={id}
        className="flex min-w-0 items-center gap-1.5 text-3xs font-bold uppercase leading-4 tracking-kicker text-[color:var(--text-muted)]"
      >
        {title}
        {isNew ? (
          <span className="rounded-full bg-[color:var(--mode-identity-soft)] px-1.5 text-2xs font-bold normal-case tracking-normal text-[color:var(--mode-identity)]">
            New
          </span>
        ) : null}
      </h2>
      {right ? <div className="shrink-0 text-right">{right}</div> : null}
    </div>
  );
}

/** A violet link word for a section head or row end, with its own 48px target. */
export function RosterLinkWord({
  href,
  onClick,
  children,
  label,
  testId,
  disabled = false,
  expanded,
}: {
  readonly href?: string;
  readonly onClick?: () => void;
  /** Transient: a save in flight. */
  readonly disabled?: boolean;
  readonly children: ReactNode;
  /** A fuller accessible name when the word alone is vague ("Add" → "Add a date you can't work"). */
  readonly label?: string;
  readonly testId?: string;
  /** For a word that shows or hides a section: whether it is shown. */
  readonly expanded?: boolean;
}) {
  const className = cn(
    focusRing,
    "inline-grid min-h-12 min-w-12 items-center justify-center whitespace-nowrap rounded-md px-1 text-xs font-bold text-[color:var(--mode-identity)] no-underline disabled:text-[color:var(--disabled)]",
  );
  if (href)
    return (
      <Link href={href} aria-label={label} className={className} data-mode-identity="roster" data-testid={testId}>
        {children}
      </Link>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={expanded}
      className={className}
      data-mode-identity="roster"
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export function RosterList({
  children,
  testId,
  label,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
  readonly label?: string;
}) {
  return (
    <ul role="list" aria-label={label} className="work-card m-0 list-none p-0" data-testid={testId}>
      {children}
    </ul>
  );
}

/** The day lead: weekday over the date number. */
export function RosterDateLead({ weekday, day }: { readonly weekday: string; readonly day: number }) {
  return (
    <span className="work-date">
      <span aria-hidden="true" className="work-date__month">
        {weekday}
      </span>
      <span aria-hidden="true" className="work-date__day text-[color:var(--text-heading)]">
        {day}
      </span>
      {/* Read as "Mon 5," so a row that is not a control still says its day. */}
      <span className="sr-only">{`${weekday} ${day}, `}</span>
    </span>
  );
}

/** The icon lead: a flat tinted circle in the roster violet; amber for a hours-and-rest warning. */
export function RosterIconLead({
  icon: Icon,
  tone = "neutral",
}: {
  readonly icon: LucideIcon;
  readonly tone?: "neutral" | "warning";
}) {
  return (
    <span
      aria-hidden="true"
      className="work-ic forced-colors:border"
      data-tone={tone === "warning" ? "amber" : undefined}
    >
      <Icon aria-hidden="true" strokeWidth={2} />
    </span>
  );
}

/** Initials for a colleague on a soft violet circle: no photo. */
export function RosterInitials({ name }: { readonly name: string }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, "D ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
  return (
    <span
      aria-hidden="true"
      className="grid size-[1.875rem] shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-2xs font-bold text-[color:var(--mode-identity)] forced-colors:border"
    >
      {initials}
    </span>
  );
}

type RowAction =
  | { readonly href: string; readonly onClick?: never }
  | { readonly onClick: () => void; readonly href?: never }
  | { readonly href?: never; readonly onClick?: never };

/**
 * One row. With `href` or `onClick` the whole row is the control and ends in a
 * chevron unless `trail` is given; a separate `action` sits beside it, never
 * inside it. `dim` greys a day off; `tone="warning"` keeps the second line in
 * body ink so the warning words read clearly.
 */
export function RosterRow({
  lead,
  title,
  sub,
  trail,
  action,
  dim = false,
  tone = "neutral",
  label,
  testId,
  ...target
}: {
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  readonly sub?: ReactNode;
  /** Quiet trailing text (a shift type, a total). */
  readonly trail?: ReactNode;
  /** A separate control after the row (a link word or button). */
  readonly action?: ReactNode;
  readonly dim?: boolean;
  readonly tone?: "neutral" | "warning";
  /** The row control's accessible name, when the visible words need more. */
  readonly label?: string;
  readonly testId?: string;
} & RowAction) {
  const body = (
    <>
      {lead}
      <span className="grid min-w-0 flex-1 py-0.5">
        <span
          className={cn(
            "nums break-words text-sm leading-5",
            dim ? "font-medium text-[color:var(--text-muted)]" : "font-bold text-[color:var(--text-heading)]",
          )}
        >
          {title}
        </span>
        {sub ? (
          <span
            className={cn(
              "break-words text-2xs leading-4",
              tone === "warning" ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]",
            )}
          >
            {sub}
          </span>
        ) : null}
      </span>
      {trail ? (
        <span className="shrink-0 whitespace-nowrap text-2xs font-semibold text-[color:var(--text-muted)]">
          {trail}
        </span>
      ) : null}
    </>
  );
  const rowClass = "flex min-h-14 min-w-0 items-center gap-2.5 px-3 py-2";
  const chevron =
    !trail && !action ? (
      <ChevronRight aria-hidden="true" strokeWidth={2} className="size-3.5 shrink-0 text-[color:var(--text-muted)]" />
    ) : null;
  const hairline =
    "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden";

  if (target.href || target.onClick) {
    const controlClass = cn(
      rowClass,
      modePressable,
      focusRing,
      "flex-1 text-left no-underline",
      Boolean(action) && "pr-1",
    );
    return (
      <li className={cn(hairline, "flex min-w-0 items-center")} data-testid={testId}>
        {target.href ? (
          <Link href={target.href} aria-label={label} className={controlClass}>
            {body}
            {chevron}
          </Link>
        ) : (
          <button type="button" onClick={target.onClick} aria-label={label} className={controlClass}>
            {body}
            {chevron}
          </button>
        )}
        {action ? <span className="shrink-0 pr-3">{action}</span> : null}
      </li>
    );
  }
  return (
    <li className={cn(hairline, rowClass)} data-testid={testId}>
      {body}
      {action ? <span className="-mr-1 shrink-0">{action}</span> : null}
    </li>
  );
}

/** A plain note: a grey panel with a small icon; amber edge for a warning. */
export function RosterNote({
  icon: Icon,
  tone = "neutral",
  children,
  testId,
  role = "status",
}: {
  readonly icon: LucideIcon;
  readonly tone?: "neutral" | "warning";
  readonly children: ReactNode;
  readonly testId?: string;
  readonly role?: "status" | "alert" | "note";
}) {
  return (
    <div
      role={role}
      data-testid={testId}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-[var(--work-radius-card,14px)] border px-3 py-2.5 text-xs leading-5 text-[color:var(--text)] forced-colors:border",
        tone === "warning"
          ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]"
          : "border-[color:var(--border)] bg-[color:var(--surface-raised)]",
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        className={cn(
          "mt-0.5 size-icon-md shrink-0",
          tone === "warning" ? "text-[color:var(--warning-text)]" : "text-[color:var(--mode-identity)]",
        )}
      />
      <div className="grid min-w-0 gap-1 break-words">{children}</div>
    </div>
  );
}

/** Small grey footnote text under a section. */
export function RosterFootnote({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <p className="mx-1 text-2xs font-medium leading-snug text-[color:var(--text-muted)]" data-testid={testId}>
      {children}
    </p>
  );
}

/** The one filled button a screen may have, in the roster violet. */
export const rosterFilledButton = cn(
  focusRing,
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[color:var(--work-primary,var(--mode-identity))] bg-[color:var(--work-primary,var(--mode-identity))] px-4 text-sm font-bold text-[color:var(--work-primary-text,var(--mode-identity-contrast))] no-underline forced-colors:border-[ButtonBorder]",
);

/** A plain bordered button. */
export const rosterOutlineButton = cn(
  focusRing,
  modePressable,
  "inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 text-balance rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2.5 py-2 text-center text-sm font-semibold text-[color:var(--text-heading)] no-underline disabled:text-[color:var(--disabled)]",
);
