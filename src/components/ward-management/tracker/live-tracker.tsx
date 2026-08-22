"use client";

import Link from "next/link";

import { isOpen } from "@/components/ward-management/ward-derivations";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { ClinicalRail } from "@/components/ward-management/ward-management-navigation";
import { edById } from "@/components/ward-management/ward-sites";

import { stampAgeText, trackerRowState } from "./tracker-derivations";
import styles from "./live-tracker.module.css";

/**
 * Task 10: the coordinator's live tracker (`/ward-management/transport`, rewritten — spec §7:
 * "the existing route... the coordinator's view of every vehicle: which patient, which leg, how
 * long since the last stamp").
 *
 * **Scope decision — which movements are "a vehicle".** `TransportJob` is the model's only
 * concept of a vehicle; a movement without one has never had a job created for it at all (the
 * reducer's `HANDOVER_READY` case is the only thing that creates one). 33 of the 48 seed
 * movements have no transport job (re-measured against the branch this task landed on — see the
 * task report, not the earlier preflight numbers, which predate a fixture fix). Listing all 33 as
 * tracker rows with a fabricated "no leg" placeholder would dilute a screen whose entire job is
 * naming a leg and an age; it would also contradict the prior `/transport` route and the officer
 * screen (Task 9), both of which already filter to movements that carry a transport job. This
 * screen keeps that precedent — every row is a real vehicle — and states the exclusion on screen
 * instead of silently dropping those movements, the same honesty discipline the officer screen
 * uses for "no officer identity exists in this model" (Task 9). `isOpen` (not a raw stage check)
 * additionally keeps a movement whose journey already closed off the tracker: a "live" tracker of
 * vehicles in transit has nothing left to say about a record the patient has already left.
 *
 * **Leg and age.** `transportLeg` (via `trackerRowState`) decides the leg exactly the way every
 * other screen in this phase does; `stampAgeText` reads the one stamp that corresponds to that
 * leg and reports it as "<duration> ago", falling back to an explicit "no timestamp" sentence for
 * the `"Requested"` leg, which the model never stamps at all (see `tracker-derivations.ts`). No
 * row can therefore claim a leg it has not reached: the leg text and the age text both come from
 * the same single source of truth, never independently guessed.
 */
export function LiveTracker() {
  const { movements, units, now } = useWardFlow();

  const openMovements = movements.filter(isOpen);
  const vehicles = openMovements.filter((movement) => movement.transport !== undefined);
  const withoutTransport = openMovements.length - vehicles.length;

  return (
    <div className={styles.screen} data-testid="ward-mode-transport">
      <ClinicalRail activeMode="transport" />
      <main className={styles.main} data-testid="ward-live-tracker">
        <div className={styles.governanceBanner} data-testid="ward-tracker-governance">
          <span className={styles.prototypeBadge}>Synthetic prototype</span>
          <p>
            The coordinator&rsquo;s view of every vehicle currently in transit &mdash; which patient, which leg, and how
            long since its last recorded stamp. {withoutTransport} of {openMovements.length} open movements have no
            transport job at all right now and are not listed below: there is no vehicle yet to track for them.
          </p>
        </div>

        {vehicles.length === 0 ? (
          <p className={styles.placeholder} data-testid="ward-tracker-empty">
            No transport job is currently open &mdash; nothing to track right now.
          </p>
        ) : (
          <ul className={styles.vehicleList} data-testid="ward-tracker-list">
            {vehicles.map((movement) => {
              const transport = movement.transport;
              // Unreachable given the `vehicles` filter above (it only keeps movements with a
              // transport job), but this is TypeScript narrowing without a non-null assertion,
              // not a fallback that hides real data.
              if (!transport) return null;

              const { leg, stampAt } = trackerRowState(transport);
              // Same unreachable-but-real-narrowing shape: `trackerRowState` only returns an
              // undefined leg when its transport argument is undefined, which cannot happen here.
              if (!leg) return null;

              const originEd = edById(movement.originEdId);
              const destinationUnit = movement.acceptedUnitId
                ? units.find((unit) => unit.id === movement.acceptedUnitId)
                : undefined;
              const destinationLabel = movement.acceptedUnitId
                ? (destinationUnit?.name ?? `No synthetic unit matches "${movement.acceptedUnitId}"`)
                : "No accepted destination recorded";

              return (
                <li key={movement.id} data-testid={`ward-tracker-row-${movement.id}`} className={styles.vehicleRow}>
                  <div className={styles.vehicleHeader}>
                    <strong>{movement.id}</strong>
                    <span className={leg === "Cancelled" ? styles.legBadgeCancelled : styles.legBadge}>{leg}</span>
                  </div>
                  <dl className={styles.vehicleDetails}>
                    <div className={styles.vehicleDetailRow}>
                      <dt>Provider</dt>
                      <dd>{transport.provider}</dd>
                    </div>
                    <div className={styles.vehicleDetailRow}>
                      <dt>Origin department</dt>
                      <dd>
                        {originEd
                          ? `${originEd.name} (${originEd.siteCode})`
                          : `No synthetic department matches "${movement.originEdId}"`}
                      </dd>
                    </div>
                    <div className={styles.vehicleDetailRow}>
                      <dt>Destination unit</dt>
                      <dd>{destinationLabel}</dd>
                    </div>
                    <div className={styles.vehicleDetailRow}>
                      <dt>Last stamp</dt>
                      <dd>{stampAgeText(stampAt, now)}</dd>
                    </div>
                  </dl>
                  <Link className={styles.reviewLink} href={`/ward-management/patients/${movement.id}`}>
                    Review patient
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
