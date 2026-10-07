"use client";

import {
  CalendarDays,
  Check,
  ChevronsUp,
  ClipboardCheck,
  KeyRound,
  MapPin,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { WorkCard, WorkIconRow, WorkTag } from "@/components/mode-kit/work";
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
  who: Users,
  expect: ClipboardCheck,
  escalate: ChevronsUp,
  logins: KeyRound,
  "first-day": MapPin,
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

/**
 * A segmented strip with its own screen-reader text: sections read on the
 * pack, logins ready on the Logins section.
 */
export function FirstWeekProgressStrip({
  progress,
  label = "Sections read",
  valueText,
  testId = "on-call-first-week-progress",
}: {
  readonly progress: { readonly read: number; readonly total: number; readonly changed: number };
  readonly label?: string;
  readonly valueText?: string;
  readonly testId?: string;
}) {
  if (progress.total === 0) return null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.read}
      aria-valuetext={valueText ?? firstWeekProgressLabel(progress)}
      data-testid={testId}
      className="mt-2 flex gap-1"
    >
      {Array.from({ length: progress.total }, (_, index) => (
        <span
          key={index}
          className={
            index < progress.read
              ? "h-1 flex-1 rounded-full bg-[color:var(--mode-identity)]"
              : "h-1 flex-1 rounded-full border border-[color:var(--mode-identity-border)] bg-[color:var(--surface-raised)]"
          }
        />
      ))}
    </div>
  );
}

/** The round "read" tick at a row's end. */
function ReadTick() {
  return (
    <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]">
      <Check aria-hidden="true" strokeWidth={2.6} className="size-icon-xs" />
      <span className="sr-only">Read</span>
    </span>
  );
}

function statusEnd(
  section: FirstWeekSection,
  readAt: string | undefined,
  logins: readonly FirstWeekLogin[],
  loginsState: FirstWeekLoginsState,
): ReactNode | undefined {
  if (section.count === 0) return undefined;
  const status = firstWeekSectionStatus(section, readAt);
  if (status === "changed") return <WorkTag>Changed</WorkTag>;
  if (status === "read") return <ReadTick />;
  if (section.id === "logins" && loginsState === "ready") {
    const { ready, own } = firstWeekLoginCounts(logins);
    if (own - ready > 0) return <WorkTag tone="amber">{`${own - ready} to do`}</WorkTag>;
  }
  return undefined;
}

/**
 * The signature "Your first week" pack card: a tinted header with the
 * start-date tile, the countdown ("Starts in 7 days"), the hospital and the
 * five-segment read strip, then one row per section, each opening that
 * section, and a footer line. Presentational: the page owns the data.
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
  /** Under the hospital: the start date, how to add one, or why it could not be read. */
  readonly startLine?: ReactNode;
  readonly footer?: ReactNode;
  /** Said on every handbook row instead of its count while the handbook is not ready ("Loading"). */
  readonly pendingText?: string | null;
}) {
  const startsOn = phase.kind === "no-date" ? null : phase.startsOn;
  return (
    <WorkCard as="section" aria-label="Your first week" testId="on-call-first-week-pack">
      <div className="flex items-center gap-3 border-b border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] px-3 py-3">
        <DateTile startsOn={startsOn} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p
            className="text-2xs font-semibold uppercase tracking-widest text-[color:var(--mode-identity)]"
            data-testid="on-call-first-week-eyebrow"
          >
            {firstWeekEyebrow(phase)}
          </p>
          <h2 className="text-lg font-semibold leading-6 text-[color:var(--text-heading)]">Your first week</h2>
          {hospitalName ? <p className="break-words text-sm text-[color:var(--text)]">{hospitalName}</p> : null}
          {startLine}
          {pendingText !== null ? null : <FirstWeekProgressStrip progress={progress} />}
        </div>
      </div>
      <ul aria-label="Sections" className="work-rows">
        {sections.map((section) => {
          const pending = pendingText !== null && section.id !== "logins";
          return (
            <li key={section.id} className="min-w-0">
              <WorkIconRow
                icon={FIRST_WEEK_SECTION_ICONS[section.id]}
                tone={!pending && section.count === 0 ? "neutral" : undefined}
                title={section.title}
                sub={pending ? pendingText : section.summary}
                href={firstWeekSectionHref(section.id)}
                end={pending ? undefined : statusEnd(section, marks[section.id], logins, loginsState)}
                testId={`on-call-first-week-row-${section.id}`}
              />
            </li>
          );
        })}
      </ul>
      {footer ? <div className="border-t border-[color:var(--border)] px-3 py-0.5">{footer}</div> : null}
    </WorkCard>
  );
}
