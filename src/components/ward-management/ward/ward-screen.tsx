"use client";

import { useState, type FormEvent } from "react";

import { formatInstant, formatRemaining, minutesUntil } from "@/components/ward-management/ward-clock";
import {
  elapsedLabel,
  isOpen,
  restrictionNotice,
  stageCopy,
  unitCapacity,
} from "@/components/ward-management/ward-derivations";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { ClinicalRail } from "@/components/ward-management/ward-management-navigation";
import { DECLINE_REASONS, type DeclineReason, type Movement, type Unit } from "@/components/ward-management/ward-model";
import { siteByCode } from "@/components/ward-management/ward-sites";
import { ignoreUnavailableActivation } from "@/components/ui-primitives";

import styles from "./ward.module.css";

type WardScreenProps = { unitId: string };

/**
 * `ACCEPT_IN_PRINCIPLE` and `DECLINE` refuse for exactly the same reasons in
 * `wardFlowReducer` — outside `destination_review`, an already-accepted movement, or this unit
 * holding no live referral for it. Computed once so the two buttons on an incoming-referral card
 * can never advertise different verdicts about whether the reducer would take the action (the
 * defect class this whole phase exists to close — see `shortlist-panel.tsx`'s `canRefer`).
 */
function referralAnswerBlocked(movement: Movement, unit: Unit): string | undefined {
  if (movement.stage !== "destination_review") {
    return `${movement.id} is ${stageCopy[movement.stage].label.toLowerCase()}, not awaiting a destination decision.`;
  }
  if (movement.acceptedUnitId) {
    return `${movement.id} already has an accepted destination.`;
  }
  if (!movement.referredUnitIds.includes(unit.id)) {
    return `${unit.name} does not currently hold a live referral for ${movement.id}.`;
  }
  return undefined;
}

/** `HOLD_BED`'s own preconditions, named so the Hold button can never advertise an action the
 * reducer would refuse. Only rendered at all once `movement.stage === "accepted_awaiting_bed"`;
 * this covers the remaining reasons a hold could still be refused at that stage. */
function holdBlockedReason(movement: Movement, unit: Unit): string | undefined {
  if (movement.acceptedUnitId !== unit.id) {
    return `${movement.id} was accepted at a different unit, not ${unit.name}.`;
  }
  if (unit.allocatable.value <= 0) {
    return `No allocatable bed remains at ${unit.name}.`;
  }
  return undefined;
}

/**
 * Task 8: one inpatient unit's own view — the ward answering what the coordinator refers,
 * never a filtered copy of the coordinator's statewide screen. Everything here is scoped to
 * exactly one `Unit`, resolved from the provider's live `units` by id. An id that resolves to nothing renders an
 * explicit empty state naming the id (Global Constraint, addendum R40) — never a substituted
 * unit, never `?? allUnits()[0]`.
 *
 * Every figure is derived fresh from the live `movements`/`units` the provider hands back on
 * every render, never cached in local state — the same discipline `ward-flow-queue-selection`
 * proves for the coordinator screen. Once a referral is accepted, it disappears from "incoming"
 * and appears under "accepted, held or en route" on the very next render, because both lists are
 * plain filters over the same live array; there is no local "it worked" flag anywhere in this
 * file for the reasons `shortlist-panel.tsx`'s own comment on `OverrideRecord` explains.
 */
export function WardScreen({ unitId }: WardScreenProps) {
  const { movements, units, now, dispatch } = useWardFlow();
  // Resolved from the provider's live `units`, not the frozen `unitById()` fixture — after
  // `CONFIRM_CAPACITY` or `HOLD_BED` updates `state.units`, this screen must show the current
  // bed counts (and gate `holdBlockedReason` on them) rather than the stale fixture value.
  const unit = units.find((candidate) => candidate.id === unitId);

  // Declared unconditionally, before the early return below — React hooks must run in the same
  // order on every render, and the not-found branch never touches either of these.
  const [declineOpenFor, setDeclineOpenFor] = useState<string | undefined>(undefined);
  const [declineReason, setDeclineReason] = useState<DeclineReason | undefined>(undefined);
  const [capacityValue, setCapacityValue] = useState<string>(() => String(unit?.allocatable.value ?? 0));

  if (!unit) {
    return (
      <div className={styles.screen} data-testid="ward-unit-screen">
        <ClinicalRail />
        <main className={styles.main}>
          <h1 className={styles.notFoundHeading}>Ward not found</h1>
          <p className={styles.notFoundBody} data-testid="ward-unit-unresolved">
            No synthetic unit matches &ldquo;{unitId}&rdquo;. It may have been renamed or removed, or the id in the
            address is incorrect — this never falls back to a different ward.
          </p>
        </main>
      </div>
    );
  }

  const site = siteByCode(unit.siteCode);
  const capacity = unitCapacity(unit);
  // TypeScript's narrowing of `unit` above does not reach into the `submitDecline` /
  // `submitCapacity` closures defined further down (the same reason `shortlist-panel.tsx`'s
  // `handleRefer` closes over a plain `movementId` rather than re-checking `movement`), so this
  // plain string is what they close over instead.
  const wardUnitId = unit.id;

  // Awaiting an answer: this unit holds a live referral and nothing has been decided yet.
  const incoming = movements.filter(
    (movement) =>
      isOpen(movement) && movement.stage === "destination_review" && movement.referredUnitIds.includes(unit.id),
  );
  // Accepted, held, or en route: this unit is the recorded destination, at any stage from
  // acceptance through transport. `isOpen` excludes `arrived` — once a patient arrives the record
  // closes and the bed shows as occupied in the grid above, not as a card here.
  const accepted = movements.filter((movement) => isOpen(movement) && movement.acceptedUnitId === unit.id);
  // What was withdrawn from this ward specifically, and why — `withdrawnReferrals` is per
  // movement, so this reads each movement's own array rather than assuming only one entry exists.
  const withdrawn = movements.filter((movement) =>
    movement.withdrawnReferrals.some((entry) => entry.unitId === unit.id),
  );

  function toggleDecline(movementId: string) {
    setDeclineOpenFor((current) => (current === movementId ? undefined : movementId));
    setDeclineReason(undefined);
  }

  function submitDecline(event: FormEvent<HTMLFormElement>, movementId: string) {
    event.preventDefault();
    if (!declineReason) return;
    dispatch({ type: "DECLINE", role: "ward", now, movementId, unitId: wardUnitId, reason: declineReason });
    setDeclineOpenFor(undefined);
    setDeclineReason(undefined);
  }

  function submitCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(capacityValue);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    dispatch({ type: "CONFIRM_CAPACITY", role: "ward", now, unitId: wardUnitId, value: Math.floor(parsed) });
  }

  return (
    <div className={styles.screen} data-testid="ward-unit-screen">
      <ClinicalRail />
      <main className={styles.main}>
        <div className={styles.governanceBanner} data-testid="ward-unit-governance">
          <span className={styles.prototypeBadge}>Synthetic prototype</span>
          <p>
            This is {unit.name}&apos;s own view. Every figure and referral below belongs to this ward &mdash; never
            another one. No bed is ever allocated automatically; a human here confirms every step.
          </p>
        </div>

        <header className={styles.unitCard} data-testid={`ward-unit-card-${unit.id}`}>
          <h1 className={styles.unitName}>{unit.name}</h1>
          <p className={styles.unitMeta}>
            {site ? `${site.name} (${site.code})` : unit.siteCode} &middot; {unit.cohort} &middot; {unit.security}
            {unit.authorised ? "" : " · Not authorised under the Mental Health Act 2014"}
          </p>
        </header>

        <section aria-label="Bed capacity" className={styles.bedSection}>
          <h2 className={styles.sectionHeading}>Bed capacity</h2>
          <div className={styles.bedGrid} data-testid="ward-unit-beds">
            <span className={styles.bedChip} data-state="available">
              Ready {capacity.available}
            </span>
            <span className={styles.bedChip} data-state="held">
              Held {capacity.held}
            </span>
            <span className={styles.bedChip} data-state="blocked">
              Blocked {capacity.blocked}
            </span>
            <span className={styles.bedChip} data-state="occupied">
              Occupied {capacity.occupied}
            </span>
            <span className={styles.bedChip} data-state="potential">
              Potential {capacity.potential}
            </span>
          </div>
          <p className={styles.bedNote}>
            Ready, held, blocked and occupied add up to all {unit.beds} beds at {unit.name}. Potential is beds expected
            to free up &mdash; it is never counted into the four above.
          </p>

          <form className={styles.capacityForm} onSubmit={submitCapacity} data-testid="ward-capacity-form">
            <label className={styles.capacityLabel} htmlFor="ward-capacity-input">
              Confirm allocatable beds for {unit.name}
            </label>
            <div className={styles.capacityRow}>
              <input
                id="ward-capacity-input"
                data-testid="ward-capacity-input"
                type="number"
                min={0}
                max={unit.beds}
                value={capacityValue}
                onChange={(event) => setCapacityValue(event.target.value)}
                className={styles.capacityInput}
              />
              <button type="submit" data-testid="ward-capacity-submit" className={styles.capacitySubmit}>
                Confirm capacity
              </button>
            </div>
            <p className={styles.capacityConfirmed}>
              Currently confirmed {unit.allocatable.value} at {formatInstant(unit.allocatable.confirmedAt)}. Writes to{" "}
              {unit.name} only &mdash; never any other ward.
            </p>
          </form>
        </section>

        <section aria-label="Incoming referrals" className={styles.listSection}>
          <h2 className={styles.sectionHeading}>Incoming referrals awaiting an answer</h2>
          {incoming.length === 0 ? (
            <p className={styles.placeholder}>No referral is currently awaiting an answer from {unit.name}.</p>
          ) : (
            <ul className={styles.cardList}>
              {incoming.map((movement) => {
                const blocked = referralAnswerBlocked(movement, unit);
                const notice = restrictionNotice(movement, unit);
                const parallel = movement.referredUnitIds.length > 1;
                const declineOpen = declineOpenFor === movement.id;
                return (
                  <li key={movement.id} data-testid={`ward-incoming-${movement.id}`} className={styles.card}>
                    <header className={styles.cardHeader}>
                      <strong>{movement.id}</strong>
                      <span className={styles.cardMeta}>
                        {movement.cohort} &middot; {movement.security} &middot; {movement.sex} &middot;{" "}
                        {movement.legalStatus}
                      </span>
                      <span className={styles.cardMeta}>{elapsedLabel(movement, now)}</span>
                    </header>
                    {parallel ? <span className={styles.parallelBadge}>Parallel referral</span> : null}
                    {notice ? (
                      <span
                        className={notice.level === "voluntary_on_locked" ? styles.noticeProminent : styles.notice}
                        data-testid={`ward-restriction-notice-${movement.id}`}
                        data-level={notice.level}
                      >
                        {notice.text}
                      </span>
                    ) : null}
                    <div className={styles.actionRow}>
                      <button
                        type="button"
                        data-testid={`ward-accept-${movement.id}`}
                        aria-disabled={blocked ? "true" : undefined}
                        aria-describedby={blocked ? `ward-accept-unavailable-${movement.id}` : undefined}
                        title={blocked ?? undefined}
                        className={styles.acceptButton}
                        onClick={
                          blocked
                            ? ignoreUnavailableActivation
                            : () =>
                                dispatch({
                                  type: "ACCEPT_IN_PRINCIPLE",
                                  role: "ward",
                                  now,
                                  movementId: movement.id,
                                  unitId: unit.id,
                                })
                        }
                      >
                        Accept in principle
                      </button>
                      <button
                        type="button"
                        data-testid={`ward-decline-toggle-${movement.id}`}
                        aria-disabled={blocked ? "true" : undefined}
                        aria-describedby={blocked ? `ward-decline-unavailable-${movement.id}` : undefined}
                        title={blocked ?? undefined}
                        aria-expanded={declineOpen}
                        className={styles.declineButton}
                        onClick={blocked ? ignoreUnavailableActivation : () => toggleDecline(movement.id)}
                      >
                        Decline
                      </button>
                    </div>
                    {blocked ? (
                      <>
                        <span id={`ward-accept-unavailable-${movement.id}`} className="sr-only">
                          {blocked}
                        </span>
                        <span id={`ward-decline-unavailable-${movement.id}`} className="sr-only">
                          {blocked}
                        </span>
                      </>
                    ) : null}
                    {declineOpen && !blocked ? (
                      <form
                        className={styles.declineForm}
                        onSubmit={(event) => submitDecline(event, movement.id)}
                        data-testid={`ward-decline-form-${movement.id}`}
                      >
                        <fieldset className={styles.declineFieldset}>
                          <legend className={styles.declineLegend}>Decline reason for {movement.id}</legend>
                          {DECLINE_REASONS.map((reason) => (
                            <label key={reason} className={styles.declineOption}>
                              <input
                                type="radio"
                                name={`decline-reason-${movement.id}`}
                                value={reason}
                                checked={declineReason === reason}
                                onChange={() => setDeclineReason(reason)}
                              />
                              {reason.replace(/_/g, " ")}
                            </label>
                          ))}
                        </fieldset>
                        <button type="submit" disabled={!declineReason} className={styles.declineSubmit}>
                          Confirm decline
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Accepted, held or en route" className={styles.listSection}>
          <h2 className={styles.sectionHeading}>Accepted, held or en route here</h2>
          {accepted.length === 0 ? (
            <p className={styles.placeholder}>No patient is currently accepted, held or en route to {unit.name}.</p>
          ) : (
            <ul className={styles.cardList}>
              {accepted.map((movement) => {
                const notice = restrictionNotice(movement, unit);
                const canHold = movement.stage === "accepted_awaiting_bed";
                const blocked = canHold ? holdBlockedReason(movement, unit) : undefined;
                return (
                  <li key={movement.id} data-testid={`ward-accepted-${movement.id}`} className={styles.card}>
                    <header className={styles.cardHeader}>
                      <strong>{movement.id}</strong>
                      <span className={styles.cardMeta}>{stageCopy[movement.stage].label}</span>
                    </header>
                    {notice ? (
                      <span
                        className={notice.level === "voluntary_on_locked" ? styles.noticeProminent : styles.notice}
                        data-testid={`ward-restriction-notice-${movement.id}`}
                        data-level={notice.level}
                      >
                        {notice.text}
                      </span>
                    ) : null}
                    {movement.stage === "bed_held" && movement.bedHeldUntil !== undefined ? (
                      <span className={styles.cardMeta}>
                        Bed hold {formatRemaining(minutesUntil(movement.bedHeldUntil, now))}
                      </span>
                    ) : null}
                    {canHold ? (
                      <div className={styles.actionRow}>
                        <button
                          type="button"
                          data-testid={`ward-hold-${movement.id}`}
                          aria-disabled={blocked ? "true" : undefined}
                          aria-describedby={blocked ? `ward-hold-unavailable-${movement.id}` : undefined}
                          title={blocked ?? undefined}
                          className={styles.acceptButton}
                          onClick={
                            blocked
                              ? ignoreUnavailableActivation
                              : () =>
                                  dispatch({
                                    type: "HOLD_BED",
                                    role: "ward",
                                    now,
                                    movementId: movement.id,
                                    unitId: unit.id,
                                  })
                          }
                        >
                          Hold a bed
                        </button>
                        {blocked ? (
                          <span id={`ward-hold-unavailable-${movement.id}`} className="sr-only">
                            {blocked}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Withdrawn referrals" className={styles.listSection}>
          <h2 className={styles.sectionHeading}>Withdrawn from {unit.name}</h2>
          {withdrawn.length === 0 ? (
            <p className={styles.placeholder}>No referral to {unit.name} has been withdrawn.</p>
          ) : (
            <ul className={styles.cardList}>
              {withdrawn.map((movement) => {
                // A movement carries one `withdrawnReferrals` entry per unit it withdrew from —
                // this reads the one that names THIS unit, never assuming index 0 (the same
                // reasoning `flow-diagram.tsx`'s `recordedDestinationIds` applies to referrals).
                const entry = movement.withdrawnReferrals.find((candidate) => candidate.unitId === unit.id);
                return (
                  <li key={movement.id} data-testid={`ward-withdrawn-${movement.id}`} className={styles.card}>
                    <strong>{movement.id}</strong>
                    <span className={styles.cardMeta}>{entry ? entry.reason : "Withdrawn — reason unresolved"}</span>
                    {entry ? <span className={styles.cardMeta}>{formatInstant(entry.at)}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
