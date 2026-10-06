"use client";

import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  ChevronsUp,
  KeyRound,
  ListChecks,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { flatCard, flatIconCircle, flatRow, flatTag, flatTintBand } from "@/components/on-call/flat-recipes";
import { cn } from "@/components/ui-primitives";
import {
  firstWeekDateTile,
  firstWeekEyebrow,
  firstWeekLoginCounts,
  firstWeekProgressLabel,
  firstWeekSectionHref,
  firstWeekSectionStatus,
  type FirstWeekLogin,
  type FirstWeekLoginsState,
  type FirstWeekPhase,
  type FirstWeekSection,
  type FirstWeekSectionId,
} from "@/lib/on-call/first-week-pack";

export const FIRST_WEEK_SECTION_ICONS: Readonly<Record<FirstWeekSectionId, LucideIcon>> = {
  before: CalendarClock,
  logins: KeyRound,
  who: Users,
  "first-days": ListChecks,
  escalate: ChevronsUp,
};

/** The start-date tile: month, day, weekday. A calendar glyph when there is no date. */
function DateTile({ startsOn }: { readonly startsOn: string | null }) {
  const tile = startsOn ? firstWeekDateTile(startsOn) : null;
  return (
    <span
      aria-hidden="true"
      className="grid h-15 w-13.5 shrink-0 place-content-center justify-items-center rounded-xl border border-[color:var(--mode-identity-border)] bg-[color:var(--surface-raised)] leading-none"
    >
      {tile ? (
        <>
          <span className="text-2xs font-semibold tracking-widest text-[color:var(--mode-identity)]">{tile.month}</span>
          <span className="nums my-0.5 text-2xl font-semibold text-[color:var(--text-heading)]">{tile.day}</span>
          <span className="text-2xs font-semibold tracking-widest text-[color:var(--text-muted)]">{tile.weekday}</span>
        </>
      ) : (
        <CalendarDays aria-hidden="true" className="size-icon-lg text-[color:var(--mode-identity)]" />
      )}
    </span>
  );
}

/** Sections read, as a segmented strip with its own screen-reader text. */
export function FirstWeekProgressStrip({
  progress,
  testId = "on-call-first-week-progress",
}: {
  readonly progress: { readonly read: number; readonly total: number; readonly changed: number };
  readonly testId?: string;
}) {
  if (progress.total === 0) return null;
  const label = firstWeekProgressLabel(progress);
  return (
    <div
      role="progressbar"
      aria-label="Sections read"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.read}
      aria-valuetext={label}
      data-testid={testId}
      className="mt-2 flex gap-1"
    >
      {Array.from({ length: progress.total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1 flex-1 rounded-full",
            index < progress.read
              ? "bg-[color:var(--mode-identity)]"
              : "border border-[color:var(--mode-identity-border)] bg-[color:var(--surface-raised)]",
          )}
        />
      ))}
    </div>
  );
}

function StatusEnd({
  section,
  readAt,
  logins,
  loginsState,
}: {
  readonly section: FirstWeekSection;
  readonly readAt: string | undefined;
  readonly logins: readonly FirstWeekLogin[];
  readonly loginsState: FirstWeekLoginsState;
}) {
  if (section.count === 0) return null;
  const status = firstWeekSectionStatus(section, readAt);
  if (status === "changed") return <span className={flatTag.mode}>Changed</span>;
  if (status === "read")
    return (
      <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]">
        <Check aria-hidden="true" strokeWidth={2.5} className="size-icon-xs" />
        <span className="sr-only">Read</span>
      </span>
    );
  if (section.id === "logins" && loginsState === "ready") {
    const { ready, own } = firstWeekLoginCounts(logins);
    if (own - ready > 0) return <span className={flatTag.amber}>{`${own - ready} to do`}</span>;
  }
  return null;
}

/**
 * The pack: a tinted header band with the start-date tile, the eyebrow ("Starts
 * in 7 days"), the hospital and the sections-read strip, then one row per
 * section, each opening that section. Presentational: the page owns the data.
 */
export function FirstWeekPackCard({
  phase,
  hospitalName,
  sections,
  marks,
  progress,
  logins,
  loginsState,
  startLine,
  footer,
  pendingText = null,
}: {
  readonly phase: FirstWeekPhase;
  readonly hospitalName: string | null;
  readonly sections: readonly FirstWeekSection[];
  readonly marks: Readonly<Partial<Record<FirstWeekSectionId, string>>>;
  readonly progress: { readonly read: number; readonly total: number; readonly changed: number };
  readonly logins: readonly FirstWeekLogin[];
  readonly loginsState: FirstWeekLoginsState;
  /** Under the hospital: how to add a start date, or why it could not be read. */
  readonly startLine?: ReactNode;
  readonly footer?: ReactNode;
  /** Said on every handbook row instead of its count while the handbook is not ready ("Loading"). */
  readonly pendingText?: string | null;
}) {
  const startsOn = phase.kind === "no-date" ? null : phase.startsOn;
  return (
    <section className={flatCard} aria-labelledby="on-call-first-week-title" data-testid="on-call-first-week-pack">
      <div className={cn(flatTintBand, "flex items-center gap-3 px-3 py-3")}>
        <DateTile startsOn={startsOn} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p
            className="text-2xs font-semibold uppercase tracking-widest text-[color:var(--mode-identity)]"
            data-testid="on-call-first-week-eyebrow"
          >
            {firstWeekEyebrow(phase)}
          </p>
          <h2
            id="on-call-first-week-title"
            className="text-lg font-semibold leading-6 text-[color:var(--text-heading)]"
          >
            Your first week
          </h2>
          {hospitalName ? <p className="break-words text-sm text-[color:var(--text)]">{hospitalName}</p> : null}
          {startLine}
          {pendingText !== null ? null : <FirstWeekProgressStrip progress={progress} />}
        </div>
      </div>
      <ul aria-label="Sections" className="grid">
        {sections.map((section) => {
          const Icon = FIRST_WEEK_SECTION_ICONS[section.id];
          const pending = pendingText !== null && section.id !== "logins";
          const empty = !pending && section.count === 0;
          return (
            <li key={section.id} className={cn(flatRow, "p-0")}>
              <Link
                href={firstWeekSectionHref(section.id)}
                data-testid={`on-call-first-week-row-${section.id}`}
                className={cn(
                  focusRing,
                  "flex min-h-13 min-w-0 flex-1 items-center gap-3 px-3 py-2 no-underline transition-colors duration-[var(--duration-instant)] active:bg-[color:var(--surface-wash)]",
                )}
              >
                <span className={cn(flatIconCircle, empty && "opacity-60")}>
                  <Icon aria-hidden="true" className="size-icon-md" />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="break-words text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                    {section.title}
                  </span>
                  <span className="break-words text-sm leading-5 text-[color:var(--text-muted)]">
                    {pending ? pendingText : section.summary}
                  </span>
                </span>
                {pending ? null : (
                  <StatusEnd section={section} readAt={marks[section.id]} logins={logins} loginsState={loginsState} />
                )}
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            </li>
          );
        })}
      </ul>
      {footer ? <div className="border-t border-[color:var(--border)] px-3 py-1">{footer}</div> : null}
    </section>
  );
}
