"use client";

import { Archive, CalendarClock, ChevronRight, Plus, Repeat } from "lucide-react";
import type { ReactNode } from "react";

import { CmeBandAction, CmeDot, CmeHint } from "@/components/cme/cme-work-kit";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkBody } from "@/components/mode-kit/work";
import { cpdYearOf, perthCalendarDate } from "@/lib/cme/cpd-year";
import { routineOccurrencesBeforeYearEnd } from "@/lib/cme/pace";
import {
  cmeRoutineCadenceLabels,
  formatRoutineDueDate,
  formatRoutineHours,
  routineLogPrefill,
  routinesDueOn,
  type CmeRoutine,
  type CmeRoutineLogPrefill,
} from "@/lib/cme/routines";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Monthly · usually 1.5 h", with the dot of the routine's first category. */
function routineLine(routine: CmeRoutine) {
  const category = routine.usualAllocations[0]?.category;
  return (
    <>
      {category ? (
        <span className="mr-1.5 inline-flex align-[1px]">
          <CmeDot cat={category} />
        </span>
      ) : null}
      {`${cmeRoutineCadenceLabels[routine.cadence]} · usually `}
      <span className="nums font-normal">{formatRoutineHours(routine.usualHours)}</span>
      {" h"}
    </>
  );
}

/** The row's text: a button that opens the routine's edit form, when the route offers one. */
function RoutineText({
  routine,
  sub,
  onEdit,
}: {
  routine: CmeRoutine;
  sub: ReactNode;
  onEdit?: (routine: CmeRoutine) => void;
}) {
  const text = (
    <span className="work-row__text">
      <span className="work-row__title">{routine.title}</span>
      <span className="work-row__sub">{sub}</span>
    </span>
  );
  return onEdit ? (
    <button
      type="button"
      aria-label={`Edit ${routine.title}`}
      onClick={() => onEdit(routine)}
      className="flex min-h-tap min-w-0 flex-1 items-center border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
    >
      {text}
    </button>
  ) : (
    text
  );
}

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
  const active = routines.filter((routine) => routine.archivedAt === null);
  // Coming up: scheduled ones soonest first, then unscheduled ones.
  const comingUp = active
    .filter((routine) => !dueIds.has(routine.id))
    .sort((a, b) => (a.nextDue ?? "9999-99-99").localeCompare(b.nextDue ?? "9999-99-99"));
  const archived = routines.filter((routine) => routine.archivedAt !== null);

  // The band says what the routines would likely add by the year's end: arithmetic, never logged hours.
  const today = perthCalendarDate(now);
  const year = cpdYearOf(now);
  const likely = active.reduce(
    (sum, routine) => sum + routineOccurrencesBeforeYearEnd(routine, today, year) * routine.usualHours,
    0,
  );
  useModeBandHeading({
    eyebrow: likely > 0 ? `Likely add ${Math.round(likely * 10) / 10} h by 31 Dec` : "Routines",
    title: "Log",
  });

  return (
    <main data-mode-identity="cme" data-testid="cme-routines-page" className="w-full">
      <CmeBandAction icon={Plus} label="New routine" onClick={onNewRoutine} testId="cme-routines-new-action" />
      <WorkBody>
        <h1 className="sr-only">Routines</h1>

        {active.length === 0 ? (
          <div className="work-card" data-testid="cme-routines-empty">
            <div className="work-empty">
              <span aria-hidden="true" className="work-empty__badge">
                <CalendarClock aria-hidden="true" strokeWidth={2} />
              </span>
              <p className="work-empty__title">No routines yet</p>
              <p className="work-empty__body">
                A routine is a reminder to log something you do regularly, like a peer review group. Nothing is
                scheduled or recorded until you add one.
              </p>
            </div>
          </div>
        ) : (
          <div data-testid="cme-routines-list" className="grid gap-2.5">
            {dueRoutines.length > 0 ? (
              <section aria-labelledby="cme-routines-due-heading" className="grid gap-1.5">
                <h2 id="cme-routines-due-heading" className="work-label m-0">
                  <span>
                    Due today · <span className="nums font-normal">{dueRoutines.length}</span>
                  </span>
                </h2>
                <ul role="list" className="m-0 grid gap-2 p-0">
                  {dueRoutines.map((routine) => (
                    <li
                      key={routine.id}
                      data-testid="cme-routines-due-row"
                      className="work-card work-row cpd-next min-w-0 list-none"
                    >
                      <span aria-hidden="true" className="cpd-lead" data-tone="mode">
                        <Repeat aria-hidden="true" strokeWidth={2} />
                      </span>
                      <RoutineText routine={routine} sub={routineLine(routine)} onEdit={onEditRoutine} />
                      <button
                        type="button"
                        className="work-button min-h-tap shrink-0"
                        data-variant="primary"
                        disabled={loggingDue}
                        aria-busy={loggingDue || undefined}
                        aria-label={`Log ${formatRoutineHours(routine.usualHours)} h for ${routine.title}`}
                        onClick={() => onLogDueRoutine(routineLogPrefill(routine, now))}
                      >
                        <span className="nums">
                          {loggingDue ? "Saving…" : `Log ${formatRoutineHours(routine.usualHours)} h`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p data-testid="cme-routines-due-empty" className="cpd-hint m-0">
                Nothing is due right now.
              </p>
            )}

            {comingUp.length > 0 ? (
              <section aria-labelledby="cme-routines-coming-heading" className="grid gap-1.5">
                <h2 id="cme-routines-coming-heading" className="work-label m-0">
                  Coming up
                </h2>
                <ul role="list" className="work-card work-rows m-0 grid p-0">
                  {comingUp.map((routine) => (
                    <li key={routine.id} className="work-row min-w-0 list-none">
                      {routine.nextDue ? (
                        <span className="work-date">
                          <span aria-hidden="true" className="work-date__month">
                            {SHORT_MONTHS[Number(routine.nextDue.slice(5, 7)) - 1]}
                          </span>
                          <span aria-hidden="true" className="work-date__day">
                            {Number(routine.nextDue.slice(8, 10))}
                          </span>
                          <span className="sr-only">{`Next due ${formatRoutineDueDate(routine.nextDue)}`}</span>
                        </span>
                      ) : (
                        <span className="work-date">
                          <span aria-hidden="true" className="work-date__day">
                            ?
                          </span>
                          <span className="sr-only">Not scheduled yet</span>
                        </span>
                      )}
                      <RoutineText routine={routine} sub={routineLine(routine)} onEdit={onEditRoutine} />
                      <button
                        type="button"
                        className="work-button min-h-tap shrink-0"
                        data-variant="secondary"
                        aria-label={`Log now for ${routine.title}`}
                        onClick={() => onLogRoutine(routineLogPrefill(routine, now))}
                      >
                        Log now
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}

        <CmeHint testId="cme-routines-confirmation-note">
          Log on a due routine saves that activity straight away, with Undo. Log now, and a routine without a usual
          split, open the form first. Nothing is recorded from attendance, timers or search.
        </CmeHint>

        {archived.length > 0 ? (
          <section
            aria-labelledby="cme-routines-archived-heading"
            className="grid gap-1.5"
            data-testid="cme-routines-archived"
          >
            <h2 id="cme-routines-archived-heading" className="work-label m-0">
              Archived
            </h2>
            <ul role="list" className="work-card work-rows m-0 grid p-0">
              {archived.map((routine) => (
                <li key={routine.id} className="work-row min-w-0 list-none">
                  <span aria-hidden="true" className="cpd-lead">
                    <Archive aria-hidden="true" strokeWidth={2} />
                  </span>
                  <RoutineText
                    routine={routine}
                    sub={`Archived ${formatRoutineDueDate(perthCalendarDate(new Date(routine.archivedAt!)))}`}
                    onEdit={onEditRoutine}
                  />
                  {onEditRoutine ? <ChevronRight aria-hidden="true" className="work-row__chev" /> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="work-dock" role="group" aria-label="Routine actions">
          <div className="work-dock__capsule">
            <button type="button" className="work-button min-h-tap" data-variant="primary" onClick={onNewRoutine}>
              <Plus aria-hidden="true" strokeWidth={2.2} />
              New routine
            </button>
          </div>
        </div>
      </WorkBody>
    </main>
  );
}
