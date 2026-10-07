"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";

import { cardSurface } from "@/components/card-recipes";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText, fieldControlPlain, InlineNotice, textMuted } from "@/components/ui-primitives";
import { formatCalendarDateLong, perthCalendarDate } from "@/lib/cme/cpd-year";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";
import type { CmeEntry, CmeRequirementSet, CmeYearClose } from "@/lib/cme/types";
import { buildCmeYearEndActions, canOfferCmeYearEnd } from "@/lib/cme/year-close-actions";
import {
  amendedVersionHours,
  canCloseCmeYear,
  closedRequirementSummaryText,
  cmeYearClosableFromLabel,
  CME_SHORTFALL_NOTE_MAX,
} from "@/lib/cme/year-close";

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Not JSON. Fall through to the status line below.
  }
  return `Could not close this year (${response.status}).`;
}

function formatInstantDate(instant: string): string {
  return formatCalendarDateLong(perthCalendarDate(new Date(instant)));
}

/** A single year-end checklist. Each row opens the existing owner-scoped screen where that task is done. */
export function CmeYearEndActions({
  set,
  entries,
  goals,
  now,
  nextYearConfirmed = null,
  nextYearGoals,
}: {
  set: CmeRequirementSet;
  entries: readonly CmeEntry[];
  goals: readonly CmePlanGoal[];
  now: Date;
  /** Null means the next year's targets have not been read; never guess their status. */
  nextYearConfirmed?: boolean | null;
  nextYearGoals?: readonly CmePlanGoal[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!canOfferCmeYearEnd(set, now)) return null;
  const actions = buildCmeYearEndActions({ set, entries, goals, now, nextYearConfirmed, nextYearGoals });
  return (
    <>
      <Button ref={triggerRef} testId="cme-year-end-open" onClick={() => setOpen(true)}>
        Close the year
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Close the ${set.year} year`}
        description="Your year-end tasks, based on the records you have saved. Open each one to finish it."
        placement="responsive-right"
        mobilePlacement="bottom"
        returnFocusRef={triggerRef}
        testId="cme-year-end-sheet"
      >
        <ul className="divide-y divide-[color:var(--border)]" data-testid="cme-year-end-actions">
          {actions.map((action) => (
            <li key={action.id}>
              <Link
                href={action.href}
                className="flex min-h-tap items-center justify-between gap-3 py-3 text-sm text-[color:var(--text)]"
                data-testid={`cme-year-end-${action.id}`}
              >
                <span className="min-w-0 font-medium">{action.label}</span>
                <span className={cn(textMuted, "shrink-0 text-right")}>{action.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

/** The record of a closed year: what the snapshot froze, the shortfall note, and every amendment since. */
function ClosedYearRecord({ year, close }: { year: number; close: CmeYearClose }) {
  return (
    <section className={cn(cardSurface, "mt-4 grid gap-2 p-4 text-sm")} data-testid="cme-year-closed-record">
      <h2 className="text-base font-semibold text-[color:var(--text-heading)]">
        {year} closed on {formatInstantDate(close.closedAt)}
      </h2>
      <p className="tabular-nums">
        At closing: {close.totalHours} of {close.targetHours} hours from {close.entryCount}{" "}
        {close.entryCount === 1 ? "activity" : "activities"}.
      </p>
      {close.requirements.length ? (
        <ul className="grid gap-0.5">
          {close.requirements.map((requirement) => (
            <li key={requirement.requirementId}>
              <span className={requirement.met ? undefined : "font-semibold"}>{requirement.label}</span>:{" "}
              {closedRequirementSummaryText(requirement.summary)}
            </li>
          ))}
        </ul>
      ) : null}
      {close.shortfallNote ? (
        <div className="grid gap-0.5">
          <p className="font-semibold text-[color:var(--text-heading)]">Note on the record</p>
          <p className="whitespace-pre-wrap">{close.shortfallNote}</p>
          <p className={textMuted}>A note explains a shortfall. It does not reduce any requirement.</p>
        </div>
      ) : null}
      <p className={textMuted}>
        The snapshot keeps the year as it stood when it was closed. The totals and activities on this page include any
        amendments made since.
      </p>
      <h3 className={cn(eyebrowText, "mt-2")}>Amendments since closing</h3>
      {close.amendments.length ? (
        <ol className="grid gap-2" data-testid="cme-year-amendments">
          {close.amendments.map((amendment) => (
            <li key={amendment.id} className="grid gap-0.5">
              <span className="font-semibold text-[color:var(--text-heading)]">
                {formatInstantDate(amendment.amendedAt)}: {amendment.after.title}
              </span>
              <span className="tabular-nums">
                {amendment.before.title !== amendment.after.title ? `Was "${amendment.before.title}". ` : ""}
                {amendedVersionHours(amendment.before)} h on {formatCalendarDateLong(amendment.before.date)}, changed to{" "}
                {amendedVersionHours(amendment.after)} h on {formatCalendarDateLong(amendment.after.date)}
              </span>
              <span>Reason: {amendment.reason}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={textMuted}>None.</p>
      )}
    </section>
  );
}

/**
 * Year close, as designed in cme-design-decisions.md section 9: closing saves a permanent
 * snapshot of the year; afterwards a change to one of its activities is a dated amendment
 * with a reason, kept beside the original. A closed year is never reopened.
 */
export function CmeYearClosePanel({
  year,
  close,
  closedAt,
  now,
  unmetCount,
  demoMode,
}: {
  year: number;
  close: CmeYearClose | null;
  closedAt: string | null | undefined;
  now: Date;
  unmetCount: number;
  demoMode: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (closedAt) {
    return close ? (
      <ClosedYearRecord year={year} close={close} />
    ) : (
      <section className={cn(cardSurface, "mt-4 p-4 text-sm")} data-testid="cme-year-closed-record">
        <p>
          {year} was closed on {formatInstantDate(closedAt)}. Its closing snapshot could not be read just now. It has
          not been changed.
        </p>
      </section>
    );
  }

  const closable = canCloseCmeYear(now, year);

  async function closeYear() {
    const trimmed = note.trim();
    // The note is stored with the closed year, so it goes through the one shared patient-detail check first.
    const problem = checkPatientDetail(trimmed);
    if (problem) {
      setError(`${problem.title}. ${problem.body}`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/cme/year/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed ? { year, shortfallNote: trimmed } : { year }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      router.refresh();
    } catch (caught) {
      setError(cmeSaveErrorText(caught, "Could not close this year."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={cn(cardSurface, "cme-print-controls mt-4 grid gap-3 p-4 text-sm")}
      aria-labelledby="cme-year-close-heading"
      data-testid="cme-year-close-panel"
    >
      <h2 id="cme-year-close-heading" className="text-base font-semibold text-[color:var(--text-heading)]">
        Close {year}
      </h2>
      <p>
        Closing saves a permanent snapshot of this year as it stands. Afterwards, any change to one of its activities is
        recorded as a dated amendment with your reason, beside the original. A closed year cannot be reopened.
      </p>
      {demoMode ? (
        <InlineNotice tone="neutral">Demo mode is read-only. Sign in to close a private CPD year.</InlineNotice>
      ) : !closable ? (
        <p className={textMuted} data-testid="cme-year-close-not-yet">
          You can close {year} from {cmeYearClosableFromLabel(year)}.
        </p>
      ) : (
        <>
          <FormField
            label="Note on a shortfall (optional)"
            id="cme-year-close-note"
            hint={
              unmetCount > 0
                ? `${unmetCount} ${unmetCount === 1 ? "target is" : "targets are"} not reached yet. A note about leave, illness or anything else goes on the record where an explanation belongs. It does not reduce the requirement.`
                : "A note goes on the record where an explanation belongs. It does not reduce any requirement."
            }
          >
            {(field) => (
              <textarea
                id={field.id}
                aria-describedby={field.describedBy}
                rows={3}
                maxLength={CME_SHORTFALL_NOTE_MAX}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={cn(fieldControlPlain, "h-auto min-h-16 resize-y py-2 leading-6")}
              />
            )}
          </FormField>
          <div>
            <Button
              variant="primary"
              testId="cme-year-close"
              busy={pending}
              busyLabel="Closing…"
              onClick={() => setConfirmOpen(true)}
            >
              Close {year}
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void closeYear();
        }}
        title={`Close your ${year} CPD year?`}
        description="This saves a permanent snapshot of the year. You can still correct an activity afterwards, but each change is recorded as a dated amendment with your reason. The year cannot be reopened."
        confirmLabel={`Yes, close ${year}`}
        tone="primary"
      />
    </section>
  );
}
