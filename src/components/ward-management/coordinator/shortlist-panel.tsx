"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import { useMemo, useState, type Dispatch, type FormEvent } from "react";

import { clockState, formatInstant, minutesUntil, type Instant } from "@/components/ward-management/ward-clock";
import {
  candidateReason,
  destinationUnit,
  elapsedLabel,
  eligibleCandidates,
  referralBlockedReason,
  restrictionNotice,
  unitCapacity,
} from "@/components/ward-management/ward-derivations";
import { eligibility, type GateResult } from "@/components/ward-management/ward-eligibility";
import type { WardFlowEvent } from "@/components/ward-management/ward-flow-events";
import { PARALLEL_REFERRAL_CAP, type Movement, type Unit } from "@/components/ward-management/ward-model";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { operationalScore } from "@/components/ward-management/ward-priority";
import { allEmergencyDepartments, unitById } from "@/components/ward-management/ward-sites";
import { ignoreUnavailableActivation } from "@/components/ui-primitives";

import styles from "./coordinator.module.css";

type ShortlistPanelProps = {
  movement: Movement | undefined;
  now: Instant;
  selectedUnitId: string | undefined;
  onSelectUnit: (unitId: string) => void;
  dispatch: Dispatch<WardFlowEvent>;
};

/**
 * Task 5 fix round 1. Refer no longer carries any local "you just did this" record — see the
 * comment above `handleRefer` for why: the "Parallel referral" badges above already render
 * straight from `movement.referredUnitIds`, the reducer's own live output, so a second,
 * optimistic local flag would only ever be a second place for the truth to diverge from.
 *
 * Override still needs local state, because the typed reason has nowhere else to live —
 * `REFER_TO_UNITS` carries no reason field, so a typed override reason is never written to
 * shared state. But this record is never trusted at face value: `overrideSucceeded` below reads
 * `movement.referredUnitIds` fresh on every render and only renders a success message when those
 * ids are actually present there, so a refused override (the movement was not in a referable
 * stage, or any other reducer-side reason) can never be reported as one that happened.
 */
type OverrideRecord = { unitIds: string[]; at: Instant; reason: string };

/**
 * Human labels for the eight `eligibility()` gates. Order here is irrelevant — the rendered list
 * is sorted failures-first from the real `GateResult[]`, never from this map's key order.
 */
const GATE_LABELS: Record<string, string> = {
  authorisation: "Mental Health Act authorisation",
  cohort: "Cohort match",
  security: "Security level",
  sex_mix: "Sex mix",
  specialling: "Specialling capacity",
  prior_decline: "Prior decline",
  capacity_freshness: "Capacity freshness",
  allocatable_bed: "Allocatable bed",
};

function capacityLine(unit: Unit) {
  const capacity = unitCapacity(unit);
  return `Ready ${capacity.available} · Held ${capacity.held} · Blocked ${capacity.blocked} · Occupied ${capacity.occupied}`;
}

/**
 * Task 6A: a Form 3B honestly carries no `dueAt` — the Mental Health Act imposes no
 * post-examination deadline (clinician-confirmed). For that case this states the form and the
 * real elapsed ED time via the existing `elapsedLabel` (never a new formatter), worded as time
 * IN the department rather than time left against anything, so it can never be misread as a
 * statutory countdown the way a bare number next to a form code could be.
 */
function legalFormLine(movement: Movement, now: Instant) {
  if (!movement.legalForm) return "No legal form recorded for this movement";
  const named = `Form ${movement.legalForm.code} (${movement.legalForm.label})`;
  if (movement.legalForm.dueAt === undefined) {
    return `${named} — no statutory deadline; ${elapsedLabel(movement, now)} in the emergency department`;
  }
  const remaining = minutesUntil(movement.legalForm.dueAt, now);
  return remaining < 0
    ? `${named} passed its deadline ${Math.abs(remaining)} min ago`
    : `${named} due in ${remaining} min`;
}

/**
 * The explainable shortlist: where the placement decision is actually made. Every gate row states
 * its own verdict in real text (never icon-only), all eight gates render every time (never
 * `.slice()`), an ineligible candidate is never presented or styled as a recommendation, and
 * nothing is allocated until a human clicks Confirm or records an override reason.
 *
 * Controller finding this task exists to close: the whole-branch review found a green tick
 * rendered beside "is not authorised under the Mental Health Act" — a gate row whose icon was
 * driven by something other than the gate's own `pass` boolean. Every icon below reads directly
 * off `gate.pass`; nothing else is permitted to decide it (see the report's red/green proof).
 */
export function ShortlistPanel({ movement, now, selectedUnitId, onSelectUnit, dispatch }: ShortlistPanelProps) {
  const { units } = useWardFlow();
  const shortlist = useMemo(
    () => (movement ? eligibleCandidates(movement, now, PARALLEL_REFERRAL_CAP, units) : []),
    [movement, now, units],
  );

  // The unit whose gates this panel currently explains. A selection carried over from another
  // page (the diagram shares the same `selectedUnitId` state) is honoured even when it falls
  // outside this movement's own candidate list — the truth about an arbitrary unit against this
  // movement is still real data, never fabricated. With nothing selected, this defaults to the
  // list's own first (eligible-first) candidate, so the gate list is never empty the moment a
  // movement is chosen.
  //
  // Whole-branch review Critical 2: this default is ORIENTATION ONLY. It may never be the thing
  // Refer acts on — see `canRefer` below.
  const activeUnit = useMemo(() => {
    if (selectedUnitId) return unitById(selectedUnitId);
    return shortlist[0]?.unit;
  }, [selectedUnitId, shortlist]);

  const activeVerdict = useMemo(() => {
    if (!movement || !activeUnit) return undefined;
    const cached = shortlist.find((candidate) => candidate.unit.id === activeUnit.id);
    return cached ? cached.verdict : eligibility(movement, activeUnit, now);
  }, [movement, activeUnit, shortlist, now]);

  // Failures first, stable otherwise — never a `.slice()`. All eight gates render every time.
  const sortedGates: GateResult[] = useMemo(
    () => (activeVerdict ? [...activeVerdict.gates].sort((a, b) => Number(a.pass) - Number(b.pass)) : []),
    [activeVerdict],
  );

  const [overrideRecord, setOverrideRecord] = useState<OverrideRecord | undefined>(undefined);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmationMovementId, setConfirmationMovementId] = useState(movement?.id);
  // Task 5: which candidate wards a human has explicitly picked to refer to, capped at
  // `PARALLEL_REFERRAL_CAP`. This is a separate, multi-select truth from `selectedUnitId` (which
  // stays single-valued and shared with the diagram, driving only which candidate's gates are
  // shown) — a coordinator can refer to up to three wards at once, but the diagram and the gate
  // list can only ever explain one at a time.
  const [referTargets, setReferTargets] = useState<string[]>([]);

  // A confirmation, an open override form, or a referral selection all belong to the movement
  // they were made against — moving to a different movement must never leave a stale "Referred"
  // record from the last one on screen, a half-typed override reason attached to the wrong
  // patient, or a ward selection meant for a different patient. Reset during render (React's
  // documented "adjusting state when a prop changes" pattern) rather than in an effect — an
  // effect body calling `setState` synchronously forces an extra, avoidable render pass.
  if (movement?.id !== confirmationMovementId) {
    setConfirmationMovementId(movement?.id);
    setOverrideRecord(undefined);
    setOverrideOpen(false);
    setOverrideReason("");
    setReferTargets([]);
  }

  if (!movement) {
    return (
      <p className={styles.placeholder}>Select a movement from the priority queue to see its explainable shortlist.</p>
    );
  }

  // TypeScript's narrowing of `movement` above does not reach into the `handleRefer` /
  // `handleOverrideSubmit` closures defined further down, so this plain string is what they
  // close over instead of re-checking `movement` themselves.
  const movementId = movement.id;

  const originEd = allEmergencyDepartments().find((ed) => ed.id === movement.originEdId);
  // Neutral "currently at" language, never framed as an authorisation requirement — authorisation
  // gates the destination only, and a patient's current ED is never itself a compliance problem.
  const originLabel = originEd
    ? `Currently at ${originEd.siteCode} — ${originEd.name}`
    : "Currently at an unresolved department";

  // A form with no `dueAt` (Task 6A: a Form 3B honestly carries none) is never breached —
  // `undefined` must never reach `clockState`'s arithmetic.
  const legalDueAt = movement.legalForm?.dueAt;
  const legalBreached = legalDueAt !== undefined && clockState(legalDueAt, now) === "breached";

  // The destination slot. An accepted unit and every outstanding referral are independent facts
  // a coordinator acts on differently (same reasoning `flow-diagram.tsx` already applies), so
  // each renders its own badge below from the raw movement fields — never only the first
  // referral, and never conflated with an acceptance (review Minor 6). `destinationUnit`
  // ("accepted, or else the first referral") is consulted only for ruling 5's exact condition:
  // when it is `undefined`, the top ELIGIBLE candidate — never merely the first-listed ineligible
  // one — is offered instead, and only ever labelled "Suggested destination": a computed
  // suggestion must never sit unlabelled in the destination slot, and an ineligible candidate must
  // never be presented as a suggestion at all (review Important 3).
  const acceptedUnit = movement.acceptedUnitId ? unitById(movement.acceptedUnitId) : undefined;
  const referredUnits = movement.referredUnitIds.map((id) => ({ id, unit: unitById(id) }));
  const recordedDestination = destinationUnit(movement);
  const hasRecordedReferral =
    recordedDestination !== undefined || Boolean(movement.acceptedUnitId) || movement.referredUnitIds.length > 0;
  const topEligible = shortlist.find((candidate) => candidate.verdict.eligible);
  const topEligibleNotice = topEligible ? restrictionNotice(movement, topEligible.unit) : undefined;

  // Whole-branch review Critical 2, carried forward into Task 5's Refer/Override. The old Confirm
  // acted on `activeUnit`, which falls back to `shortlist[0]` — a system-chosen default that no
  // human ever picked and that no candidate row reported as `aria-pressed`. A default that Refer
  // will act on IS an auto-allocation with one tap of consent, which is the one thing this phase
  // says it never does. So referring now requires `referTargets` — the real, explicit multi-select
  // state driven by the same candidate-row clicks `aria-pressed` reports below — never a fallback
  // to a default nobody chose. Showing the default's gate list for orientation is still fine;
  // acting on it is not.
  const referredCandidates = referTargets.map((unitId) => shortlist.find((candidate) => candidate.unit.id === unitId));
  const hasReferSelection = referTargets.length > 0;
  const allSelectedEligible = referredCandidates.every((candidate) => candidate?.verdict.eligible === true);
  // Fix round 1, Finding 1: `REFER_TO_UNITS` only accepts a movement at `placement_requested` or
  // `destination_review` (`ward-flow-reducer.ts`'s `REFERRABLE_MOVEMENT_STAGES`) — nine of the
  // eighteen hand-authored fixture movements sit outside that, at stages like `bed_held`, while
  // still open and still offering eligible candidates. Refer used to dispatch anyway and
  // unconditionally claim success, so a coordinator on one of those nine read "Referred by a
  // human coordinator" while the reducer had silently refused every one of them. Folding this
  // into `canRefer` stops the control from ever advertising an action it cannot perform — the
  // stated reason below names the movement's own real stage, never a generic string.
  const referralBlocked = referralBlockedReason(movement);
  const canRefer = hasReferSelection && allSelectedEligible && referralBlocked === undefined;
  // Override deliberately carries only the explicit-selection guard, NOT the stage guard above.
  // It is the "a human decided to try anyway, with a stated reason" path — for an ineligible
  // candidate (its original purpose) and, now, for a non-referable stage too. Its own success
  // message is never optimistic either: `overrideSucceeded` below reads `movement.referredUnitIds`
  // fresh, so an override attempted against a non-referable movement is refused by the reducer
  // exactly like Refer would be, the refusal surfaces on the Exceptions drawer via `rejections`,
  // and no local flag here is ever left claiming a success that did not happen.
  const canOverride = hasReferSelection;
  const firstIneligibleSelected = referredCandidates.find((candidate) => candidate && !candidate.verdict.eligible);
  const referUnavailableReason = referralBlocked
    ? referralBlocked
    : !hasReferSelection
      ? "Choose at least one candidate ward before referring — nothing is referred against a default."
      : firstIneligibleSelected
        ? `Not eligible — ${candidateReason(firstIneligibleSelected.verdict)}. Use Override instead.`
        : "Eligibility could not be determined for one of the selected wards.";
  const overrideUnavailableReason =
    "Choose at least one candidate ward before overriding — nothing is overridden against a default.";
  const activeNotice = activeUnit ? restrictionNotice(movement, activeUnit) : undefined;

  const { score, factors } = operationalScore(movement, now);

  /** Adds or removes a unit from the referral selection, capped at `PARALLEL_REFERRAL_CAP` — a
   * click past the cap on a NOT-yet-selected unit is a no-op (never silently swaps out an earlier
   * choice), but a click on an already-selected unit can always toggle it back off. */
  function toggleReferTarget(unitId: string) {
    setReferTargets((current) => {
      if (current.includes(unitId)) return current.filter((id) => id !== unitId);
      if (current.length >= PARALLEL_REFERRAL_CAP) return current;
      return [...current, unitId];
    });
  }

  /**
   * Dispatches `REFER_TO_UNITS` and nothing else — deliberately no local "it worked" flag.
   * `canRefer` already gates on `referralBlockedReason`, so this can only be reached when the
   * reducer is expected to accept the event; the honest record of whether it actually did is
   * `movement.referredUnitIds` on the next render (the "Parallel referral" badges above), sourced
   * straight from the provider, never a value this function sets and then leaves behind.
   */
  function handleRefer() {
    if (!canRefer) return;
    dispatch({ type: "REFER_TO_UNITS", role: "coordinator", now, movementId, unitIds: [...referTargets] });
    setOverrideOpen(false);
  }

  function handleOverrideSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canOverride) return;
    const reason = overrideReason.trim();
    if (reason.length === 0) return;
    dispatch({ type: "REFER_TO_UNITS", role: "coordinator", now, movementId, unitIds: [...referTargets] });
    setOverrideRecord({ unitIds: [...referTargets], at: now, reason });
    setOverrideOpen(false);
    setOverrideReason("");
  }

  // Structurally incapable of claiming an override succeeded when it did not: this checks the
  // movement's OWN post-dispatch `referredUnitIds` — read fresh on every render from the live
  // provider — not a flag captured once at click time. Override is not stage-gated (see the
  // comment above `canOverride`), so a movement outside `REFERRABLE_MOVEMENT_STAGES` really can
  // reach this dispatch; when the reducer refuses it, `referredUnitIds` is untouched, every id
  // below is missing, `overrideSucceeded` is `false`, and nothing renders here — the refusal is
  // instead visible through `rejections` on the Exceptions drawer.
  const overrideSucceeded =
    overrideRecord !== undefined &&
    overrideRecord.unitIds.length > 0 &&
    overrideRecord.unitIds.every((id) => movement.referredUnitIds.includes(id));
  const overrideRecordUnits = overrideRecord
    ? overrideRecord.unitIds.map((id) => unitById(id)?.name ?? "an unresolved unit")
    : [];

  return (
    <div className={styles.shortlistBody} data-testid={`ward-shortlist-${movement.id}`}>
      <header className={styles.shortlistHeader}>
        <div className={styles.shortlistHeaderTop}>
          <h3 className={styles.shortlistMovementId}>{movement.id}</h3>
          <span className={styles.shortlistTierBadge} data-tier={movement.urgency}>
            Tier {movement.urgency}
          </span>
        </div>
        <span className={styles.shortlistMetaLine}>
          {movement.cohort} · {movement.security}
        </span>
        <span className={styles.shortlistMetaLine}>{originLabel}</span>
        <span className={legalBreached ? styles.shortlistLegalBreach : styles.shortlistMetaLine}>
          {movement.legalStatus} · {legalFormLine(movement, now)}
        </span>

        {hasRecordedReferral ? (
          <>
            {movement.acceptedUnitId ? (
              acceptedUnit ? (
                <span className={styles.shortlistAcceptedBadge}>Accepted destination: {acceptedUnit.name}</span>
              ) : (
                <span className={styles.shortlistUnresolvedBadge}>Accepted destination could not be resolved.</span>
              )
            ) : null}
            {/* Every parallel referral, not only `referredUnitIds[0]` — a movement can carry up
                to PARALLEL_REFERRAL_CAP live referrals at once, and each is a fact a coordinator
                acts on (review Minor 6: a hidden parallel referral is exactly the trust failure
                the cap and this record exist to prevent). "Parallel referral" is the label Task
                5's Refer action uses everywhere this fact is surfaced. */}
            {referredUnits.map(({ id, unit }) =>
              unit ? (
                <span key={id} className={styles.shortlistReferredBadge}>
                  Parallel referral: {unit.name}
                </span>
              ) : (
                <span key={id} className={styles.shortlistUnresolvedBadge}>
                  Parallel referral to an unresolved unit.
                </span>
              ),
            )}
          </>
        ) : topEligible ? (
          <>
            <span className={styles.shortlistSuggestedBadge}>Suggested destination: {topEligible.unit.name}</span>
            {/* Whole-branch review Important 5: on WF-001 (an OPEN-status movement) the top
                eligible candidate is a locked ward, and the security gate passes it with an
                affirmative "Secure ward meets an open requirement". The suggestion is not
                withdrawn — the gate is a protected surface and a locked ward really can hold this
                patient — but a coordinator must read the restriction here, in the destination
                slot, rather than infer it from a ward's name. Task 5: `restrictionNotice` covers
                both this and the sharper voluntary-on-locked warning; the badge renders whichever
                one applies rather than assuming the older, narrower case. */}
            {topEligibleNotice ? (
              <span
                className={
                  topEligibleNotice.level === "voluntary_on_locked"
                    ? styles.shortlistRestrictiveBadgeProminent
                    : styles.shortlistRestrictiveBadge
                }
                data-testid="ward-shortlist-suggested-restrictive"
                data-level={topEligibleNotice.level}
              >
                {topEligibleNotice.text}
              </span>
            ) : null}
          </>
        ) : (
          <span className={styles.shortlistUnresolvedBadge}>No eligible destination found yet.</span>
        )}
      </header>

      <section aria-label="Candidate units">
        {/* Whole-branch review Critical 1: this list was headed "Nearest candidates", a proximity
            claim the model cannot support — `Unit` has no distance, geo, locality or catchment
            field, and `eligibleCandidates` filters on cohort and sorts eligible-first, breaking
            ties on `allUnits()` array order. WF-018, sitting in SCGH's own emergency department,
            was shown RPH Older Adult above SCGH Older Adult under that heading. The subtitle
            states the real ordering rather than leaving the reader to assume one. */}
        <h4 className={styles.shortlistSectionHeading}>Candidates</h4>
        <p className={styles.shortlistSectionNote}>
          Units matching this movement&apos;s cohort, listed eligible first. Not ranked by distance — this prototype
          holds no location data.
        </p>
        {shortlist.length === 0 ? (
          <p className={styles.placeholder}>No cohort-matching units found.</p>
        ) : (
          <ul className={styles.shortlistCandidateList}>
            {shortlist.map((candidate) => {
              // `data-showing` is purely visual — which candidate's gates this panel is
              // currently displaying, including the default (nothing explicitly selected)
              // case. `aria-pressed` is Task 5's real, explicit MULTI-select state
              // (`referTargets`) — a screen-reader user must never be told a control is pressed
              // when nobody pressed it, and a default-only "selection" is not clearable the way
              // a real one is (review Minor 5, extended to referral selection).
              const isShown = activeUnit?.id === candidate.unit.id;
              const isSelected = referTargets.includes(candidate.unit.id);
              const notice = restrictionNotice(movement, candidate.unit);
              return (
                <li key={candidate.unit.id}>
                  <button
                    type="button"
                    data-testid={`ward-shortlist-candidate-${candidate.unit.id}`}
                    data-eligible={String(candidate.verdict.eligible)}
                    data-more-restrictive={notice ? "true" : undefined}
                    data-showing={isShown ? "true" : undefined}
                    aria-pressed={isSelected}
                    className={styles.shortlistCandidateRow}
                    onClick={() => {
                      onSelectUnit(candidate.unit.id);
                      toggleReferTarget(candidate.unit.id);
                    }}
                  >
                    <span className={styles.shortlistCandidateName}>{candidate.unit.name}</span>
                    <span className={styles.shortlistCandidateCapacity}>{capacityLine(candidate.unit)}</span>
                    <span
                      className={
                        candidate.verdict.eligible
                          ? styles.shortlistCandidateReasonOk
                          : styles.shortlistCandidateReasonBad
                      }
                    >
                      {candidateReason(candidate.verdict)}
                    </span>
                    {/* Real visible text, not colour or an attribute alone — a coordinator
                        scanning the list sees which of these wards is locked when the movement
                        does not require one, and the voluntary-on-locked case reads more
                        prominently than the plain over-restrictive one (review Important 5,
                        Task 5). */}
                    {notice ? (
                      <span
                        className={
                          notice.level === "voluntary_on_locked"
                            ? styles.shortlistCandidateRestrictiveProminent
                            : styles.shortlistCandidateRestrictive
                        }
                        data-level={notice.level}
                      >
                        {notice.text}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Eligibility checks">
        <h4 className={styles.shortlistSectionHeading}>
          Eligibility checks{activeUnit ? ` for ${activeUnit.name}` : ""}
        </h4>
        {/* The security gate below will read "Met — Secure ward meets an open requirement" for this
            pairing, which is true and is deliberately left alone (`ward-eligibility.ts` is a
            protected surface). What a tick cannot say is that this is a clinical decision rather
            than a neutral match, so it is said here, immediately above the gate list a coordinator
            reads before referring (review Important 5, Task 5: wording now comes from
            `restrictionNotice`, which distinguishes the sharper voluntary-on-locked case). */}
        {activeNotice ? (
          <p
            className={
              activeNotice.level === "voluntary_on_locked"
                ? styles.shortlistRestrictiveNoteProminent
                : styles.shortlistRestrictiveNote
            }
            data-testid="ward-shortlist-restrictive-note"
            data-level={activeNotice.level}
          >
            {activeNotice.level === "voluntary_on_locked"
              ? `${activeNotice.text}. The security check below passes, but a voluntary patient held on a locked ward is a decision for a human, not a match.`
              : `${activeNotice.text}. The security check below passes, but placing an open-status patient on a locked ward is a decision for a human, not a match.`}
          </p>
        ) : null}
        {sortedGates.length === 0 ? (
          <p className={styles.placeholder}>Select a candidate unit to see its eligibility checks.</p>
        ) : (
          <ol className={styles.shortlistGateList}>
            {sortedGates.map((gate) => (
              <li
                key={gate.gate}
                data-testid={`ward-gate-${gate.gate}`}
                data-pass={String(gate.pass)}
                className={styles.shortlistGateRow}
              >
                {gate.pass ? (
                  <CheckCircle2 aria-hidden="true" className={styles.shortlistGateIconOk} />
                ) : (
                  <CircleAlert aria-hidden="true" className={styles.shortlistGateIconBad} />
                )}
                <span className={styles.shortlistGateLabel}>{GATE_LABELS[gate.gate] ?? gate.gate}</span>
                <strong className={gate.pass ? styles.shortlistGateVerdictOk : styles.shortlistGateVerdictBad}>
                  {gate.pass ? "Met" : "Not met"}
                </strong>
                <span className={styles.shortlistGateDetail}>{gate.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Declines">
        <h4 className={styles.shortlistSectionHeading}>Declines</h4>
        {movement.declines.length === 0 ? (
          <p className={styles.placeholder}>No destination has declined this movement.</p>
        ) : (
          <ul className={styles.shortlistDeclineList}>
            {movement.declines.map((decline, index) => {
              const unit = unitById(decline.unitId);
              return (
                <li
                  key={`${decline.unitId}-${index}`}
                  data-testid="ward-decline-row"
                  className={styles.shortlistDeclineRow}
                >
                  <strong>{unit ? unit.name : "Unresolved unit"}</strong>
                  <span>
                    {decline.reason.replace(/_/g, " ")}
                    {decline.note ? ` — ${decline.note}` : ""}
                  </span>
                  <span>{formatInstant(decline.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className={styles.shortlistScoreDetails}>
        <summary className={styles.shortlistScoreSummary}>Operational score {score}</summary>
        <p className={styles.shortlistScoreNote}>
          Urgency tier orders the queue; this operational score only breaks ties inside a tier and never represents the
          patient&apos;s clinical presentation.
        </p>
        {factors.length === 0 ? (
          <p className={styles.placeholder}>No contributing factors currently.</p>
        ) : (
          <ul className={styles.shortlistScoreList}>
            {factors.map((factor) => (
              <li key={factor.label} className={styles.shortlistScoreFactor}>
                <strong>{factor.label}</strong> +{factor.points} — {factor.detail}
              </li>
            ))}
          </ul>
        )}
      </details>

      <footer className={styles.shortlistActions}>
        <p className={styles.shortlistAutoAllocationNote}>
          System suggests, you decide. No automatic allocation — up to {PARALLEL_REFERRAL_CAP} parallel referrals at
          once.
        </p>

        {/* Task 5 fix round 1: rendered only when `overrideSucceeded` — a real check against
            `movement.referredUnitIds`, not the mere existence of `overrideRecord`. A refused
            override leaves this silent here; the refusal is visible on the Exceptions drawer
            instead (`rejections`), never claimed as a success on this footer. */}
        {overrideRecord && overrideSucceeded ? (
          <p className={styles.shortlistConfirmationRecord} data-testid="ward-shortlist-confirmation-record">
            {`Overridden by a human coordinator — referred to ${overrideRecordUnits.join(", ")} at ${formatInstant(overrideRecord.at)} — reason: "${overrideRecord.reason}". No bed was allocated automatically.`}
          </p>
        ) : null}

        <div className={styles.shortlistActionRow}>
          <button
            type="button"
            data-testid="ward-shortlist-refer"
            aria-disabled={canRefer ? undefined : "true"}
            aria-describedby={canRefer ? undefined : "ward-shortlist-refer-unavailable"}
            title={canRefer ? undefined : referUnavailableReason}
            className={styles.shortlistConfirmButton}
            onClick={canRefer ? handleRefer : ignoreUnavailableActivation}
          >
            Refer
          </button>
          <button
            type="button"
            data-testid="ward-shortlist-override-toggle"
            aria-disabled={canOverride ? undefined : "true"}
            aria-describedby={canOverride ? undefined : "ward-shortlist-override-unavailable"}
            title={canOverride ? undefined : overrideUnavailableReason}
            aria-expanded={overrideOpen}
            className={styles.shortlistOverrideButton}
            onClick={canOverride ? () => setOverrideOpen((open) => !open) : ignoreUnavailableActivation}
          >
            Override
          </button>
        </div>
        {!canRefer ? (
          <span id="ward-shortlist-refer-unavailable" className="sr-only">
            {referUnavailableReason}
          </span>
        ) : null}
        {!canOverride ? (
          <span id="ward-shortlist-override-unavailable" className="sr-only">
            {overrideUnavailableReason}
          </span>
        ) : null}

        {overrideOpen && canOverride ? (
          <form className={styles.shortlistOverrideForm} onSubmit={handleOverrideSubmit}>
            <label className={styles.shortlistOverrideLabel} htmlFor="ward-shortlist-override-reason">
              Reason for overriding the shortlist for{" "}
              {referredCandidates.map((c) => c?.unit.name ?? "an unresolved unit").join(", ")}
            </label>
            <textarea
              id="ward-shortlist-override-reason"
              required
              className={styles.shortlistOverrideTextarea}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
            />
            <button type="submit" className={styles.shortlistOverrideSubmit}>
              Record override
            </button>
          </form>
        ) : null}
      </footer>
    </div>
  );
}
