"use client";

import { useState, type FormEvent } from "react";

import {
  elapsedLabel,
  stageCopy,
  transportLeg,
  unitCapacity,
  wardServiceOrder,
} from "@/components/ward-management/ward-derivations";
import { splitDuration, type Instant } from "@/components/ward-management/ward-clock";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { ClinicalRail } from "@/components/ward-management/ward-management-navigation";
import {
  ED_ACCESS_TARGET_MINUTES,
  type Cohort,
  type LegalStatus,
  type Movement,
  type Security,
  type Sex,
} from "@/components/ward-management/ward-model";
import { edById, siteByCode, unitById } from "@/components/ward-management/ward-sites";
import { ignoreUnavailableActivation } from "@/components/ui-primitives";

import styles from "./ed.module.css";

type EdScreenProps = { edId: string };

const COHORT_OPTIONS: Cohort[] = ["Adult", "Older adult"];
const SECURITY_OPTIONS: Security[] = ["Open", "Secure"];
const SEX_OPTIONS: Sex[] = ["Female", "Male"];
const LEGAL_STATUS_OPTIONS: LegalStatus[] = [
  "Voluntary",
  "Referred for psychiatric examination",
  "Detained awaiting examination",
  "Involuntary inpatient",
];
const URGENCY_OPTIONS = [1, 2, 3] as const;

type ReferralDraftState = {
  cohort: Cohort;
  security: Security;
  sex: Sex;
  specialling: boolean;
  legalStatus: LegalStatus;
  urgency: 1 | 2 | 3;
};

const DEFAULT_DRAFT: ReferralDraftState = {
  cohort: "Adult",
  security: "Open",
  sex: "Female",
  specialling: false,
  legalStatus: "Voluntary",
  urgency: 3,
};

/**
 * `RECORD_EXAMINATION`'s own preconditions (`ward-flow-reducer.ts`'s `case "RECORD_EXAMINATION"`),
 * named here in the same order so the control can never advertise an action the reducer would
 * refuse — the same discipline `ward-screen.tsx`'s `referralAnswerBlocked`/`holdBlockedReason` and
 * `officer-screen.tsx`'s four `*BlockedReason` functions already hold to.
 */
function examinationBlockedReason(movement: Movement): string | undefined {
  if (movement.legalForm?.code !== "1A") {
    return `${movement.id} cannot have an examination recorded while its form is ${movement.legalForm?.code ?? "none"}, not 1A.`;
  }
  if (movement.examination) {
    return `${movement.id} was already examined.`;
  }
  return undefined;
}

/** Mirrors `case "HANDOVER_READY"` exactly: the only precondition is stage `bed_held`. */
function handoverBlockedReason(movement: Movement): string | undefined {
  if (movement.stage !== "bed_held") {
    return `${movement.id} is ${stageCopy[movement.stage].label.toLowerCase()}, not bed held — a handover can only be marked ready once a bed is held.`;
  }
  return undefined;
}

type OutstandingItem = { kind: "handover" | "transport" | "examination" | "form"; label: string; detail: string };

/**
 * The single outstanding item spec §7 asks for — a form, an examination, a transport request,
 * or handover — never more than one at once. Ordered by the movement's actual live stage first,
 * not by which fact is clinically "biggest" in the abstract: WF-005 (re-measured against this
 * branch's fixture, see the task report) carries an un-examined Form 1A AND an already-accepted
 * transport job. Showing "Examination" for it would bury the operational truth — a vehicle is
 * right now waiting to depart — behind a fact that has been sitting unresolved for hours without
 * blocking anything. Stage governs first; the examination gap only surfaces here once the
 * movement is not already at `bed_held`/`handover_ready`/`moving`, i.e. once nothing more urgent
 * is already in motion.
 *
 * Reads only `movement.stage`, `movement.transport` and `movement.legalForm`/`.examination` —
 * never `ED_ACCESS_TARGET_MINUTES`, and never writes a `dueAt` anywhere (see that constant's own
 * doc comment and Task 6A).
 */
function outstandingItem(movement: Movement): OutstandingItem {
  if (movement.stage === "bed_held") {
    return { kind: "handover", label: "Handover", detail: "Bed held — ready to mark the handover to transport." };
  }
  if (movement.stage === "handover_ready" || movement.stage === "moving") {
    const leg = transportLeg(movement.transport);
    const detail = leg === undefined ? "Not yet requested" : leg;
    return { kind: "transport", label: "Transport", detail };
  }
  if (movement.legalForm?.code === "1A" && movement.examination === undefined) {
    return {
      kind: "examination",
      label: "Examination",
      detail: "Referred for examination — outcome not yet recorded.",
    };
  }
  if (movement.legalForm) {
    return {
      kind: "form",
      label: "Form",
      detail: `Form ${movement.legalForm.code} (${movement.legalForm.label}) — awaiting next step.`,
    };
  }
  return { kind: "form", label: "Form", detail: "No legal form recorded for this movement." };
}

/** Whether `formedAt` genuinely predates `openedAt` — the only condition under which the legal
 * clock and the department clock diverge (spec §3). */
function isCommunityFormed(movement: Movement): boolean {
  return movement.formedAt !== undefined && movement.formedAt < movement.openedAt;
}

/** The legal clock's own reference instant: `formedAt` where that is earlier than `openedAt`,
 * otherwise `openedAt` itself — so the two clocks coincide rather than diverge when there is
 * nothing to diverge from. Never earlier than by construction, so the legal clock can never
 * read as running from a LATER instant than the department clock. */
function legalClockReference(movement: Movement): Instant {
  return isCommunityFormed(movement) ? (movement.formedAt as Instant) : movement.openedAt;
}

/**
 * `ED_ACCESS_TARGET_MINUTES` is a departmental performance measure, counted UP from
 * `movement.openedAt` — never a legal deadline. This function's only inputs are `now` and
 * `movement.openedAt`; it never reads `movement.legalForm`, never constructs a `{code, label,
 * kind}` object, and never writes a `dueAt` anywhere (see the constant's own doc comment and
 * Task 6A — the seven-surface incident this whole task exists to not repeat). Wording is
 * deliberately free of "due", "deadline", "breach", "overdue" and "legal" — every one of those
 * words on this figure would let it be misread as the thing Task 6A deleted.
 */
function accessTargetLine(minutesInDepartment: number): string {
  const over = minutesInDepartment - ED_ACCESS_TARGET_MINUTES;
  const targetLabel = splitDuration(ED_ACCESS_TARGET_MINUTES);
  if (over > 0) return `${splitDuration(over)} over the ${targetLabel} departmental access target`;
  return `${splitDuration(Math.abs(over))} under the ${targetLabel} departmental access target`;
}

/**
 * Task 11: one emergency department's own view — its own patients, both clocks, the
 * departmental access target, and the single outstanding item for each. Never the coordinator's
 * statewide queue, shortlist or flow diagram filtered down (spec §7 says so explicitly).
 *
 * Resolved via `edById` (Task 9's addition to `ward-sites.ts`); an id that resolves to nothing
 * renders an explicit empty state naming the id (Global Constraint, addendum R40 — the same rule
 * `ward-screen.tsx` and `officer-screen.tsx`'s unit/department lookups already follow), never a
 * substituted department.
 */
export function EdScreen({ edId }: EdScreenProps) {
  const { movements, units, now, dispatch } = useWardFlow();
  const department = edById(edId);

  // Declared unconditionally, before the early return below — React hooks must run in the same
  // order on every render, the same discipline `ward-screen.tsx` holds to for its own hooks.
  const [referralOpen, setReferralOpen] = useState(false);
  const [draft, setDraft] = useState<ReferralDraftState>(DEFAULT_DRAFT);
  const [examinationOpenFor, setExaminationOpenFor] = useState<string | undefined>(undefined);
  const [examinationOutcome, setExaminationOutcome] = useState<
    "inpatient_order" | "community_order" | "revoked" | undefined
  >(undefined);

  if (!department) {
    return (
      <div className={styles.screen} data-testid="ward-ed-screen">
        <ClinicalRail />
        <main className={styles.main}>
          <h1 className={styles.notFoundHeading}>Emergency department not found</h1>
          <p className={styles.notFoundBody} data-testid="ward-ed-unresolved">
            No synthetic emergency department matches &ldquo;{edId}&rdquo;. It may have been renamed or removed, or the
            id in the address is incorrect — this never falls back to a different department.
          </p>
        </main>
      </div>
    );
  }

  const site = siteByCode(department.siteCode);
  // TypeScript's narrowing of `department` above does not reach into `submitReferral`'s closure
  // further down (the same reason `ward-screen.tsx`'s `wardUnitId` exists) — this plain string is
  // what it closes over instead.
  const thisEdId = department.id;

  // Its own patients only, and only while still open — an arrived or otherwise closed movement
  // has left the department (see `isOpen`'s own doc comment); this screen is about who is here
  // now, not a historical log.
  const patients = movements.filter(
    (movement) => movement.originEdId === thisEdId && !movement.closure && movement.stage !== "arrived",
  );

  function submitReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({ type: "RAISE_REFERRAL", role: "ed", now, edId: thisEdId, draft });
    setDraft(DEFAULT_DRAFT);
    setReferralOpen(false);
  }

  function toggleExamination(movementId: string) {
    setExaminationOpenFor((current) => (current === movementId ? undefined : movementId));
    setExaminationOutcome(undefined);
  }

  function submitExamination(event: FormEvent<HTMLFormElement>, movementId: string) {
    event.preventDefault();
    if (!examinationOutcome) return;
    dispatch({ type: "RECORD_EXAMINATION", role: "ed", now, movementId, outcome: examinationOutcome });
    setExaminationOpenFor(undefined);
    setExaminationOutcome(undefined);
  }

  return (
    <div className={styles.screen} data-testid="ward-ed-screen">
      <ClinicalRail />
      <main className={styles.main}>
        <div className={styles.governanceBanner} data-testid="ward-ed-governance">
          <span className={styles.prototypeBadge}>Synthetic prototype</span>
          <p>
            This is {department.name}&apos;s own view. The 24-hour figure below is this department&apos;s own access
            target — a performance measure it is judged on, not a Mental Health Act deadline. No bed is ever allocated
            automatically; a human here confirms every step.
          </p>
        </div>

        <header className={styles.unitCard} data-testid={`ward-ed-card-${department.id}`}>
          <h1 className={styles.unitName}>{department.name}</h1>
          <p className={styles.unitMeta}>{site ? `${site.name} (${site.code})` : department.siteCode}</p>
        </header>

        <section aria-label="Raise a referral" className={styles.listSection}>
          <h2 className={styles.sectionHeading}>Raise a referral</h2>
          {!referralOpen ? (
            <button
              type="button"
              data-testid="ward-ed-raise-referral-toggle"
              className={styles.acceptButton}
              onClick={() => setReferralOpen(true)}
            >
              Raise referral
            </button>
          ) : (
            <form className={styles.referralForm} onSubmit={submitReferral} data-testid="ward-ed-referral-form">
              <div className={styles.referralGrid}>
                <label className={styles.referralField}>
                  Cohort
                  <select
                    value={draft.cohort}
                    onChange={(event) => setDraft((current) => ({ ...current, cohort: event.target.value as Cohort }))}
                  >
                    {COHORT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.referralField}>
                  Security
                  <select
                    value={draft.security}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, security: event.target.value as Security }))
                    }
                  >
                    {SECURITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.referralField}>
                  Sex
                  <select
                    value={draft.sex}
                    onChange={(event) => setDraft((current) => ({ ...current, sex: event.target.value as Sex }))}
                  >
                    {SEX_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.referralField}>
                  Legal status
                  <select
                    value={draft.legalStatus}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, legalStatus: event.target.value as LegalStatus }))
                    }
                  >
                    {LEGAL_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.referralField}>
                  Urgency
                  <select
                    value={draft.urgency}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, urgency: Number(event.target.value) as 1 | 2 | 3 }))
                    }
                  >
                    {URGENCY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.referralCheckbox}>
                  <input
                    type="checkbox"
                    checked={draft.specialling}
                    onChange={(event) => setDraft((current) => ({ ...current, specialling: event.target.checked }))}
                  />
                  Specialling required
                </label>
              </div>
              <div className={styles.actionRow}>
                <button type="submit" data-testid="ward-ed-referral-submit" className={styles.acceptButton}>
                  Raise referral
                </button>
                <button
                  type="button"
                  className={styles.declineButton}
                  onClick={() => {
                    setReferralOpen(false);
                    setDraft(DEFAULT_DRAFT);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

        <section aria-label="This department's patients" className={styles.listSection}>
          <h2 className={styles.sectionHeading}>
            {department.name} &middot; {patients.length} patient{patients.length === 1 ? "" : "s"}
          </h2>
          {patients.length === 0 ? (
            <p className={styles.placeholder}>No patient is currently open at {department.name}.</p>
          ) : (
            <ul className={styles.cardList}>
              {patients.map((movement) => {
                const minutesInDepartment = Math.max(now - movement.openedAt, 0);
                const communityFormed = isCommunityFormed(movement);
                const minutesLegalClock = Math.max(now - legalClockReference(movement), 0);
                const item = outstandingItem(movement);
                const examBlocked = examinationBlockedReason(movement);
                const handoverBlocked = handoverBlockedReason(movement);
                const examOpen = examinationOpenFor === movement.id;
                const acceptedUnit = movement.acceptedUnitId ? unitById(movement.acceptedUnitId) : undefined;

                return (
                  <li
                    key={movement.id}
                    data-testid={`ward-ed-patient-${movement.id}`}
                    data-origin-ed={movement.originEdId}
                    data-community-formed={communityFormed ? "true" : undefined}
                    data-minutes-in-department={minutesInDepartment}
                    data-minutes-legal-clock={minutesLegalClock}
                    className={styles.card}
                  >
                    <header className={styles.cardHeader}>
                      <strong>{movement.id}</strong>
                      <span className={styles.cardMeta}>
                        {movement.cohort} &middot; {movement.security} &middot; {movement.sex} &middot;{" "}
                        {movement.legalStatus}
                      </span>
                    </header>

                    {movement.arrivalMode === "police" ? (
                      <span className={styles.policeFlag} data-testid={`ward-ed-police-${movement.id}`}>
                        Police in attendance
                      </span>
                    ) : null}

                    <dl className={styles.clockGrid}>
                      <div className={styles.clockRow}>
                        <dt>Time in department</dt>
                        <dd>{elapsedLabel(movement, now)}</dd>
                      </div>
                      <div className={styles.clockRow} data-testid={`ward-ed-legal-clock-${movement.id}`}>
                        <dt>Legal clock</dt>
                        <dd>
                          {splitDuration(minutesLegalClock)} since {communityFormed ? "formed" : "opened"}
                        </dd>
                      </div>
                      <div
                        className={styles.clockRow}
                        data-testid={`ward-ed-access-target-${movement.id}`}
                        data-state={minutesInDepartment > ED_ACCESS_TARGET_MINUTES ? "over" : "under"}
                      >
                        <dt>Departmental access target</dt>
                        <dd>{accessTargetLine(minutesInDepartment)}</dd>
                      </div>
                    </dl>

                    <p className={styles.referralState}>
                      {acceptedUnit
                        ? `Accepted at ${acceptedUnit.name}`
                        : movement.referredUnitIds.length > 0
                          ? `Referred to ${movement.referredUnitIds.length} unit${movement.referredUnitIds.length === 1 ? "" : "s"}`
                          : stageCopy[movement.stage].label}
                    </p>

                    <p
                      className={styles.outstandingItem}
                      data-testid={`ward-ed-outstanding-${movement.id}`}
                      data-kind={item.kind}
                    >
                      <span className={styles.outstandingLabel}>{item.label}</span>
                      {" — "}
                      {item.detail}
                    </p>

                    <div className={styles.actionRow}>
                      <button
                        type="button"
                        data-testid={`ward-ed-examine-toggle-${movement.id}`}
                        aria-disabled={examBlocked ? "true" : undefined}
                        aria-describedby={examBlocked ? `ward-ed-examine-unavailable-${movement.id}` : undefined}
                        title={examBlocked ?? undefined}
                        aria-expanded={examOpen}
                        className={styles.declineButton}
                        onClick={examBlocked ? ignoreUnavailableActivation : () => toggleExamination(movement.id)}
                      >
                        Record examination
                      </button>
                      <button
                        type="button"
                        data-testid={`ward-ed-handover-${movement.id}`}
                        aria-disabled={handoverBlocked ? "true" : undefined}
                        aria-describedby={handoverBlocked ? `ward-ed-handover-unavailable-${movement.id}` : undefined}
                        title={handoverBlocked ?? undefined}
                        className={styles.acceptButton}
                        onClick={
                          handoverBlocked
                            ? ignoreUnavailableActivation
                            : () => dispatch({ type: "HANDOVER_READY", role: "ed", now, movementId: movement.id })
                        }
                      >
                        Mark handover ready
                      </button>
                    </div>
                    {examBlocked ? (
                      <span id={`ward-ed-examine-unavailable-${movement.id}`} className="sr-only">
                        {examBlocked}
                      </span>
                    ) : null}
                    {handoverBlocked ? (
                      <span id={`ward-ed-handover-unavailable-${movement.id}`} className="sr-only">
                        {handoverBlocked}
                      </span>
                    ) : null}

                    {examOpen && !examBlocked ? (
                      <form
                        className={styles.declineForm}
                        onSubmit={(event) => submitExamination(event, movement.id)}
                        data-testid={`ward-ed-examine-form-${movement.id}`}
                      >
                        <fieldset className={styles.declineFieldset}>
                          <legend className={styles.declineLegend}>Examination outcome for {movement.id}</legend>
                          {(
                            [
                              { value: "inpatient_order", label: "Inpatient treatment order" },
                              { value: "community_order", label: "Community treatment order" },
                              { value: "revoked", label: "Revoked — does not proceed" },
                            ] as const
                          ).map((option) => (
                            <label key={option.value} className={styles.declineOption}>
                              <input
                                type="radio"
                                name={`examination-outcome-${movement.id}`}
                                value={option.value}
                                checked={examinationOutcome === option.value}
                                onChange={() => setExaminationOutcome(option.value)}
                              />
                              {option.label}
                            </label>
                          ))}
                        </fieldset>
                        <button type="submit" disabled={!examinationOutcome} className={styles.declineSubmit}>
                          Confirm examination outcome
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Statewide capacity" className={styles.listSection}>
          <h2 className={styles.sectionHeading}>Statewide capacity (read-only)</h2>
          <p className={styles.placeholder}>
            Every ward&apos;s own confirmed capacity, for context only &mdash; hiding it would recreate the problem this
            system exists to remove. This is not a queue or a shortlist: nothing here can be actioned from this screen.
          </p>
          <div className={styles.capacityTableWrap} data-testid="ward-ed-statewide-capacity">
            <table className={styles.capacityTable}>
              <thead>
                <tr>
                  <th scope="col">Unit</th>
                  <th scope="col">Cohort</th>
                  <th scope="col">Security</th>
                  <th scope="col">Ready</th>
                  <th scope="col">Beds</th>
                </tr>
              </thead>
              <tbody>
                {wardServiceOrder.flatMap((service) =>
                  units
                    .filter((unit) => siteByCode(unit.siteCode)?.service === service)
                    .map((unit) => {
                      const capacity = unitCapacity(unit);
                      return (
                        <tr key={unit.id}>
                          <th scope="row">{unit.name}</th>
                          <td>{unit.cohort}</td>
                          <td>{unit.security}</td>
                          <td>{capacity.available}</td>
                          <td>{unit.beds}</td>
                        </tr>
                      );
                    }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
