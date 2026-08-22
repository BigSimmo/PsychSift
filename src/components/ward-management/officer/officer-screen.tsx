"use client";

import { useState } from "react";

import { elapsedLabel, stageCopy, transportLeg } from "@/components/ward-management/ward-derivations";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { ClinicalRail } from "@/components/ward-management/ward-management-navigation";
import type { Movement, TransportJob, Unit } from "@/components/ward-management/ward-model";
import { edById } from "@/components/ward-management/ward-sites";
import { ignoreUnavailableActivation } from "@/components/ui-primitives";

import styles from "./officer.module.css";

/**
 * `TRANSPORT_ACCEPTED`'s own preconditions (`ward-flow-reducer.ts`), named here so the Accepted
 * button can never advertise an action the reducer would refuse — the same discipline
 * `ward-screen.tsx`'s `referralAnswerBlocked`/`holdBlockedReason` and `shortlist-panel.tsx`'s
 * `canRefer` already hold to. The two branches below are read straight off the reducer's own
 * `case "TRANSPORT_ACCEPTED"`, in the same order, so the two can never silently drift apart.
 */
function acceptedBlockedReason(movement: Movement): string | undefined {
  if (movement.stage !== "handover_ready" || !movement.transport) {
    return `${movement.id} is ${stageCopy[movement.stage].label.toLowerCase()}, not ready for a transport handover.`;
  }
  if (movement.transport.acceptedAt !== undefined) {
    return `Transport for ${movement.id} was already accepted.`;
  }
  return undefined;
}

/** Mirrors `case "TRANSPORT_EN_ROUTE"` exactly. */
function enRouteBlockedReason(movement: Movement): string | undefined {
  if (movement.stage !== "handover_ready" || movement.transport?.acceptedAt === undefined) {
    return `Transport for ${movement.id} cannot go en route before it has been accepted.`;
  }
  if (movement.transport.enRouteAt !== undefined) {
    return `Transport for ${movement.id} is already en route.`;
  }
  return undefined;
}

/** Mirrors `case "PATIENT_COLLECTED"` exactly. The reducer carries no "already collected" check
 * of its own — collecting moves the stage to `moving`, so the stage guard above already covers a
 * second attempt — and this stays a faithful mirror rather than adding a check the reducer lacks. */
function collectedBlockedReason(movement: Movement): string | undefined {
  if (movement.stage !== "handover_ready" || movement.transport?.enRouteAt === undefined) {
    return `${movement.id} cannot be marked collected before transport is en route.`;
  }
  return undefined;
}

/**
 * Mirrors `case "PATIENT_ARRIVED"` exactly, including the floor guard on the receiving unit's
 * physically empty beds — the most consequential precondition on this screen, since it is the
 * one a driver could otherwise tap straight into a refusal for. `unit` is passed in already
 * resolved from the LIVE `units` array the provider hands back (never `unitById` from
 * `ward-sites.ts`, which reads the frozen fixture and would never see an earlier arrival that
 * already consumed the receiving unit's last empty bed).
 */
function arrivedBlockedReason(movement: Movement, unit: Unit | undefined): string | undefined {
  if (movement.stage !== "moving" || movement.transport?.collectedAt === undefined) {
    return `${movement.id} cannot be marked arrived before the patient has been collected.`;
  }
  if (!movement.acceptedUnitId) {
    return `${movement.id} has no accepted destination unit recorded.`;
  }
  if (!unit) {
    return `No synthetic unit matches the accepted destination id "${movement.acceptedUnitId}" for ${movement.id}.`;
  }
  if (unit.empty.value <= 0) {
    return `No physically empty bed remains at ${unit.name} for ${movement.id} to arrive into.`;
  }
  return undefined;
}

function formRequiredLabel(transport: TransportJob): string {
  return transport.formRequired ?? "No legal form required";
}

/**
 * Task 9: the transport officer's phone. The model carries no officer identity —
 * `TransportJob` records a `provider` (an organisation), never a person — so this screen cannot
 * filter to "my jobs" without inventing an owner the data does not support. It shows every job
 * not yet arrived instead, and says so on screen (spec §7).
 *
 * Layout inherits Task 7's settled phone pattern rather than reinventing it: a scrollable list
 * of every open job (all fields always visible, per spec — "shows every job"), and the currently
 * selected job's four actions pinned to the literal viewport bottom via CSS
 * (`officer.module.css`, `@media (max-width: 48rem)`), the same `position: fixed` technique
 * `shortlist-panel.tsx`'s `.shortlistActionRow` uses. Only one job's action row can occupy the
 * viewport's bottom edge at a time, so — exactly like the coordinator's queue-plus-shortlist
 * pattern — one job is "active" and the rest are listed for picking up next. The active job's
 * card carries `data-testid="ward-officer-job-<id>"` and, being the one selected, contains
 * exactly its four action buttons and nothing else; every other job's card carries the same
 * testid prefix (so "shows every job" is provable by locator) but ends in a single "Work this
 * job" selector instead, which lives outside whichever card is currently active and so never
 * inflates that job's own button count.
 */
export function OfficerScreen() {
  const { movements, units, now, dispatch } = useWardFlow();

  // Every job not yet arrived — never filtered to an inferred "mine", per the model constraint
  // above. `movement.transport` guards existence; `arrivedAt` is the one stamp `PATIENT_ARRIVED`
  // writes, so its absence is exactly "not yet arrived" regardless of `movement.stage`.
  const jobs = movements.filter(
    (movement) => movement.transport !== undefined && movement.transport.arrivedAt === undefined,
  );

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  // Defaults to the first job in the live list when nothing is selected yet, or when a
  // previously selected job has left the list (it arrived, on a different tap, while this job
  // card was not the one in focus). This is display orientation only, exactly like
  // `shortlist-panel.tsx`'s own `shortlist[0]?.unit` default — every dispatch below still reads
  // `selectedJob.id` off this same live, freshly filtered array, never a stale closure, so a
  // fallback selection can never change what an action actually targets.
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? jobs[0];

  return (
    <div className={styles.screen} data-testid="ward-officer-screen">
      <ClinicalRail />
      <main className={styles.main}>
        <div className={styles.governanceBanner} data-testid="ward-officer-governance">
          <span className={styles.prototypeBadge}>Synthetic prototype</span>
          <p>
            No officer identity exists in this model &mdash; a transport job records an organisation such as &ldquo;St
            John WA&rdquo;, never a person. This screen therefore shows <strong>every</strong> transport job not yet
            arrived, not a filtered list of &ldquo;your&rdquo; jobs.
          </p>
        </div>

        {jobs.length === 0 ? (
          <p className={styles.placeholder} data-testid="ward-officer-empty">
            No transport job is currently outstanding &mdash; every job on record has arrived.
          </p>
        ) : (
          <ul className={styles.jobList} data-testid="ward-officer-joblist">
            {jobs.map((movement) => {
              const transport = movement.transport;
              // Unreachable given the `jobs` filter above (it only keeps movements with a
              // transport job), but this is TypeScript narrowing without a non-null assertion,
              // not a fallback that hides real data: if it were ever wrong, this renders nothing
              // for the one row rather than throwing or guessing at a job.
              if (!transport) return null;

              const active = movement.id === selectedJob.id;
              const originEd = edById(movement.originEdId);
              const destinationUnit = movement.acceptedUnitId
                ? units.find((unit) => unit.id === movement.acceptedUnitId)
                : undefined;
              const destinationLabel = movement.acceptedUnitId
                ? (destinationUnit?.name ?? `No synthetic unit matches "${movement.acceptedUnitId}"`)
                : "No accepted destination recorded";

              const acceptedBlocked = acceptedBlockedReason(movement);
              const enRouteBlocked = enRouteBlockedReason(movement);
              const collectedBlocked = collectedBlockedReason(movement);
              const arrivedBlocked = arrivedBlockedReason(movement, destinationUnit);

              return (
                <li
                  key={movement.id}
                  data-testid={`ward-officer-job-${movement.id}`}
                  className={active ? styles.jobCardActive : styles.jobCard}
                >
                  <header className={styles.jobHeader}>
                    <strong>{movement.id}</strong>
                    <span className={styles.jobMeta}>
                      {transportLeg(transport)} &middot; {elapsedLabel(movement, now)}
                    </span>
                  </header>

                  <dl className={styles.jobDetails}>
                    <div className={styles.jobDetailRow}>
                      <dt>Origin department</dt>
                      <dd>
                        {originEd
                          ? `${originEd.name} (${originEd.siteCode})`
                          : `No synthetic department matches "${movement.originEdId}"`}
                      </dd>
                    </div>
                    <div className={styles.jobDetailRow}>
                      <dt>Destination unit</dt>
                      <dd>{destinationLabel}</dd>
                    </div>
                    <div className={styles.jobDetailRow}>
                      <dt>Legal form required</dt>
                      <dd>{formRequiredLabel(transport)}</dd>
                    </div>
                    <div className={styles.jobDetailRow}>
                      <dt>Escort required</dt>
                      <dd>{transport.escortRequired ? "Yes" : "No"}</dd>
                    </div>
                  </dl>

                  {active ? (
                    <>
                      <div className={styles.actionRow}>
                        <button
                          type="button"
                          data-testid={`ward-officer-accept-${movement.id}`}
                          aria-disabled={acceptedBlocked ? "true" : undefined}
                          aria-describedby={
                            acceptedBlocked ? `ward-officer-accept-unavailable-${movement.id}` : undefined
                          }
                          title={acceptedBlocked ?? undefined}
                          className={styles.actionButton}
                          onClick={
                            acceptedBlocked
                              ? ignoreUnavailableActivation
                              : () =>
                                  dispatch({
                                    type: "TRANSPORT_ACCEPTED",
                                    role: "officer",
                                    now,
                                    movementId: movement.id,
                                  })
                          }
                        >
                          Accepted
                        </button>
                        <button
                          type="button"
                          data-testid={`ward-officer-enroute-${movement.id}`}
                          aria-disabled={enRouteBlocked ? "true" : undefined}
                          aria-describedby={
                            enRouteBlocked ? `ward-officer-enroute-unavailable-${movement.id}` : undefined
                          }
                          title={enRouteBlocked ?? undefined}
                          className={styles.actionButton}
                          onClick={
                            enRouteBlocked
                              ? ignoreUnavailableActivation
                              : () =>
                                  dispatch({
                                    type: "TRANSPORT_EN_ROUTE",
                                    role: "officer",
                                    now,
                                    movementId: movement.id,
                                  })
                          }
                        >
                          En route
                        </button>
                        <button
                          type="button"
                          data-testid={`ward-officer-collect-${movement.id}`}
                          aria-disabled={collectedBlocked ? "true" : undefined}
                          aria-describedby={
                            collectedBlocked ? `ward-officer-collect-unavailable-${movement.id}` : undefined
                          }
                          title={collectedBlocked ?? undefined}
                          className={styles.actionButton}
                          onClick={
                            collectedBlocked
                              ? ignoreUnavailableActivation
                              : () =>
                                  dispatch({ type: "PATIENT_COLLECTED", role: "officer", now, movementId: movement.id })
                          }
                        >
                          Collected
                        </button>
                        <button
                          type="button"
                          data-testid={`ward-officer-arrive-${movement.id}`}
                          aria-disabled={arrivedBlocked ? "true" : undefined}
                          aria-describedby={
                            arrivedBlocked ? `ward-officer-arrive-unavailable-${movement.id}` : undefined
                          }
                          title={arrivedBlocked ?? undefined}
                          className={styles.actionButton}
                          onClick={
                            arrivedBlocked
                              ? ignoreUnavailableActivation
                              : () =>
                                  dispatch({ type: "PATIENT_ARRIVED", role: "officer", now, movementId: movement.id })
                          }
                        >
                          Arrived
                        </button>
                      </div>
                      {acceptedBlocked ? (
                        <span id={`ward-officer-accept-unavailable-${movement.id}`} className="sr-only">
                          {acceptedBlocked}
                        </span>
                      ) : null}
                      {enRouteBlocked ? (
                        <span id={`ward-officer-enroute-unavailable-${movement.id}`} className="sr-only">
                          {enRouteBlocked}
                        </span>
                      ) : null}
                      {collectedBlocked ? (
                        <span id={`ward-officer-collect-unavailable-${movement.id}`} className="sr-only">
                          {collectedBlocked}
                        </span>
                      ) : null}
                      {arrivedBlocked ? (
                        <span id={`ward-officer-arrive-unavailable-${movement.id}`} className="sr-only">
                          {arrivedBlocked}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      data-testid={`ward-officer-select-${movement.id}`}
                      className={styles.selectButton}
                      onClick={() => setSelectedId(movement.id)}
                    >
                      Work this job
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
