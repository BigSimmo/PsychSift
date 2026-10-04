"use client";

import { CalendarClock, ChevronDown, Plus } from "lucide-react";

import { cmePageTitle, cmePageWidth } from "@/components/cme/cme-page-frame";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { cn, EmptyState, eyebrowText, InlineNotice, textMuted } from "@/components/ui-primitives";
import {
  cmeRoutineCadenceLabels,
  formatRoutineDueDate,
  formatRoutineHours,
  routineLogPrefill,
  routinesDueOn,
  type CmeRoutine,
  type CmeRoutineLogPrefill,
} from "@/lib/cme/routines";

export type CmeRoutinesPageProps = {
  /** Every routine the owner has, active or archived. Defaults to none. */
  readonly routines?: readonly CmeRoutine[];
  /** The instant "now" is evaluated against — required, not defaulted, so a server render and the client it hydrates into always agree on what is due. */
  readonly now: Date;
  /**
   * Due-routine "Log N h": the route saves immediately when the usual category
   * split is already known (with Undo), otherwise opens the entry form. The
   * labelled tap is the explicit log.
   */
  readonly onLogDueRoutine: (prefill: CmeRoutineLogPrefill) => void;
  /**
   * Not-yet-due "Log now": always opens a pre-filled entry form. Required so a
   * missing wire fails at compile time rather than painting a silent button.
   */
  readonly onLogRoutine: (prefill: CmeRoutineLogPrefill) => void;
  /** Called when the owner taps "New routine". Required for the same reason as `onLogRoutine`. */
  readonly onNewRoutine: () => void;
  readonly onEditRoutine?: (routine: CmeRoutine) => void;
  /** True while a one-tap due log is in flight — disables the due Log buttons. */
  readonly loggingDue?: boolean;
};

/**
 * ROUTINES — the recurring activities an owner does every month or term:
 * supervision, a journal club, a peer-review meeting.
 *
 * Due "Log N h" is the explicit one-tap save (with Undo upstream). "Log now"
 * and routines without a usual category split still open the entry form.
 * Nothing here auto-logs from attendance, timers, or search.
 *
 * This is a sub-screen, not the CME mode home — it does not mount
 * `CmeNavHeader`. See `docs/search-chrome-behaviour.md` for when a page owns
 * that header and when, like this one, it does not need to.
 */
export function CmeRoutinesPage({
  routines = [],
  now,
  onLogDueRoutine,
  onLogRoutine,
  onNewRoutine,
  onEditRoutine,
  loggingDue = false,
}: CmeRoutinesPageProps) {
  const dueRoutines = routinesDueOn(routines, now);
  const dueIds = new Set(dueRoutines.map((routine) => routine.id));
  // ONE list. A due routine used to appear twice — under "Due now" and again
  // under "Your routines". Now due routines sort first and carry a Due chip;
  // after them, routines with a scheduled date, soonest first; unscheduled
  // ones trail the list rather than sorting arbitrarily by insertion order.
  const activeRoutines = routines
    .filter((routine) => routine.archivedAt === null)
    .slice()
    .sort(
      (a, b) =>
        Number(dueIds.has(b.id)) - Number(dueIds.has(a.id)) ||
        (a.nextDue ?? "9999-99-99").localeCompare(b.nextDue ?? "9999-99-99"),
    );

  return (
    <main className={cn(cmePageWidth, "px-4 py-6 sm:px-6")}>
      <h1 className={cmePageTitle}>Routines</h1>
      <p className={cn(textMuted, "mt-1 text-sm")}>
        The things you do every month or term. Log one whenever it happens.
      </p>

      {/* Folded, wording unchanged intent: read once, then out of the way. */}
      <details data-testid="cme-routines-how" className="group mt-3">
        <summary className="inline-flex min-h-tap cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-[color:var(--clinical-accent)] [&::-webkit-details-marker]:hidden">
          How this works
          <ChevronDown
            aria-hidden="true"
            className="size-icon-sm transition-transform motion-reduce:transition-none group-open:rotate-180"
          />
        </summary>
        <div data-testid="cme-routines-confirmation-note" className="mt-1">
          <InlineNotice tone="neutral">
            Tapping Log on a due routine with a usual category split saves that activity straight away and offers Undo.
            Log now, and routines without a usual split, still open a form to check first. Nothing is recorded from
            attendance, timers, or search.
          </InlineNotice>
        </div>
      </details>

      {dueRoutines.length === 0 && activeRoutines.length > 0 && (
        <p data-testid="cme-routines-due-empty" className={cn(textMuted, "mt-4 text-sm")}>
          Nothing is due right now.
        </p>
      )}

      {activeRoutines.length === 0 ? (
        <section aria-labelledby="cme-routines-list-heading" className="mt-6">
          <h2 id="cme-routines-list-heading" className={eyebrowText}>
            Your routines
          </h2>
          <div className="mt-3">
            <EmptyState
              testId="cme-routines-empty"
              icon={CalendarClock}
              title="You have not added any routines yet."
              body="A routine is a reminder to log something you do regularly. Nothing is scheduled or recorded until you add one."
            />
          </div>
        </section>
      ) : (
        <ModeGroupedList eyebrow="Your routines" testId="cme-routines-list" className="mt-6">
          {activeRoutines.map((routine) => {
            const due = dueIds.has(routine.id);
            return (
              <ModeRow
                key={routine.id}
                testId={due ? "cme-routines-due-row" : undefined}
                title={routine.title}
                subtitle={`${cmeRoutineCadenceLabels[routine.cadence]} · usually ${formatRoutineHours(routine.usualHours)} h`}
                meta={
                  <span className={cn(modeSecondaryText, "flex flex-wrap items-center gap-2 leading-5")}>
                    {due ? (
                      <Chip size="compact" appearance={{ kind: "information", tone: "accent" }}>
                        Due
                      </Chip>
                    ) : null}
                    {routine.nextDue ? `Next due ${formatRoutineDueDate(routine.nextDue)}` : "Not scheduled yet"}
                  </span>
                }
                trailing={
                  <>
                    {due ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        busy={loggingDue}
                        busyLabel="Saving…"
                        aria-label={`Log ${formatRoutineHours(routine.usualHours)} h for ${routine.title}`}
                        onClick={() => onLogDueRoutine(routineLogPrefill(routine, now))}
                      >
                        {`Log ${formatRoutineHours(routine.usualHours)} h`}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Log now for ${routine.title}`}
                        onClick={() => onLogRoutine(routineLogPrefill(routine, now))}
                      >
                        Log now
                      </Button>
                    )}
                    {onEditRoutine ? (
                      <Button
                        variant="toolbar"
                        size="sm"
                        aria-label={`Edit ${routine.title}`}
                        onClick={() => onEditRoutine(routine)}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </ModeGroupedList>
      )}

      <div className="mt-6">
        <Button variant="secondary" icon={Plus} onClick={onNewRoutine}>
          New routine
        </Button>
      </div>
    </main>
  );
}
