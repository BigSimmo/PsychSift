import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { modeNumberText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";

import { RosterAskButton } from "./ask/roster-ask-box";
import { PageTitleUnderBand, WithoutModeBand } from "@/components/mode-band/mode-band";

/**
 * Roster's shared page furniture, so every Roster page opens the same way:
 * a violet identity tile, the page title, one quiet line under it, and the
 * Ask Roster icon at the top right. Colour comes only from the roster
 * identity tokens, scoped to the elements that carry `data-mode-identity`.
 */

/** The violet rounded-square that carries a page or section icon. */
export function RosterIdentityTile({
  icon: Icon,
  size = "md",
}: {
  readonly icon: LucideIcon;
  readonly size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity="roster"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)] forced-colors:border",
        size === "md" ? "size-10" : "size-7",
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} className={size === "md" ? "size-icon-lg" : "size-icon-sm"} />
    </span>
  );
}

export function RosterPageHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  actions,
  ask = true,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly eyebrow?: ReactNode;
  readonly title: string;
  readonly subtitle?: ReactNode;
  /** Page actions shown before the Ask icon (e.g. a New button). */
  readonly actions?: ReactNode;
  /** Pages that cannot act on a roster (join, settings) leave Ask out. */
  readonly ask?: boolean;
  readonly testId?: string;
}) {
  return (
    <header className="flex min-w-0 items-start gap-3" data-testid={testId}>
      <WithoutModeBand>
        <RosterIdentityTile icon={icon} />
      </WithoutModeBand>
      <div className="grid min-w-0 flex-1 gap-0.5 pt-0.5">
        {/* The band already says "Roster" (its eyebrow on most pages). */}
        {eyebrow ? (
          <WithoutModeBand>
            <p className="nums text-xs text-[color:var(--text-muted)]">{eyebrow}</p>
          </WithoutModeBand>
        ) : null}
        <PageTitleUnderBand className="text-lg-minus font-semibold leading-tight text-[color:var(--text-heading)]">
          {title}
        </PageTitleUnderBand>
        {/* Under the work-mode band a plain description repeats the band; live
            words (counts, a chosen week) still show (work-mode redesign, 6 Oct 2026). */}
        {subtitle ? (
          typeof subtitle === "string" ? (
            <WithoutModeBand>
              <div className="text-sm text-[color:var(--text-muted)]">{subtitle}</div>
            </WithoutModeBand>
          ) : (
            <div className="text-xs text-[color:var(--text-muted)]">{subtitle}</div>
          )
        ) : null}
      </div>
      {actions || ask ? (
        <div className="-my-1 -mr-1 flex shrink-0 items-center gap-1">
          {actions}
          {/* Under the band the Ask icon would sit alone on its own row (the mockups have none; the header's
              AI Search and the Shifts page's Ask box stay). Page actions are the New button, which floats. */}
          {ask ? (
            <WithoutModeBand>
              <RosterAskButton />
            </WithoutModeBand>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

/** A titled group: small identity tile + eyebrow heading, optional trailing action. */
export function RosterSection({
  icon,
  title,
  id,
  action,
  children,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly id: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <section className="grid gap-2" aria-labelledby={id} data-testid={testId}>
      <div className="flex min-h-7 items-center gap-2 px-1">
        <WithoutModeBand>
          <RosterIdentityTile icon={icon} size="sm" />
        </WithoutModeBand>
        <h2
          id={id}
          className="flex-1 text-3xs font-bold uppercase leading-4 tracking-kicker text-[color:var(--text-muted)]"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A stat tile with a leading icon: label over value, values wrap, never truncate. */
export function RosterStat({
  icon: Icon,
  label,
  value,
  testId,
  stacked = false,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: ReactNode;
  readonly testId?: string;
  /** Icon above the words, so three tiles fit one row on a 320 px phone. */
  readonly stacked?: boolean;
}) {
  return (
    <div
      className={cn("work-card flex min-w-0 gap-2.5 p-3", stacked ? "h-full flex-col items-start" : "items-start")}
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        data-mode-identity="roster"
        className="grid size-[1.875rem] shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-icon-md" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-2xs font-semibold text-[color:var(--text-muted)]">{label}</span>
        <span className={cn(modeNumberText, "break-words text-base-minus font-bold text-[color:var(--text-heading)]")}>
          {value}
        </span>
      </span>
    </div>
  );
}

export function RosterStats({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-3" data-testid={testId}>
      {children}
    </div>
  );
}

/** One field look for every roster select and input: 48px, hairline, violet focus. */
export const rosterField =
  "min-h-12 w-full min-w-0 rounded-[var(--work-radius-field)] border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-base-minus text-[color:var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mode-identity)]";

/** A calm empty state: a soft icon disc over one line, centred in a dashed card. */
export function RosterEmpty({
  icon: Icon,
  children,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="work-card grid justify-items-center gap-2 px-4 py-6 text-center" data-testid={testId}>
      <span
        aria-hidden="true"
        data-mode-identity="roster"
        className="grid size-10 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-icon-lg" />
      </span>
      <p className="text-xs text-[color:var(--text-muted)]">{children}</p>
    </div>
  );
}
