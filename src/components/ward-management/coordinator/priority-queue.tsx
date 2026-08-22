"use client";

import { clockState, type Instant } from "@/components/ward-management/ward-clock";
import { elapsedLabel } from "@/components/ward-management/ward-derivations";
import type { Movement } from "@/components/ward-management/ward-model";
import { operationalScore } from "@/components/ward-management/ward-priority";
import { allEmergencyDepartments } from "@/components/ward-management/ward-sites";

import styles from "./coordinator.module.css";

type PriorityQueueProps = {
  movements: Movement[];
  now: Instant;
  selectedId: string | undefined;
  onSelect: (movementId: string) => void;
  filterEdId: string | undefined;
  onClearFilter: () => void;
};

/**
 * Urgency tier text carries its own direction on every row (Task 5 ruling 2). With 16 tier-1,
 * 13 tier-2 and 12 tier-3 open movements, long runs of the same bare "Tier 1" badge are the
 * normal case and tell a coordinator nothing about which end of the scale that is. Tier 1 is
 * the clinician's most urgent judgement; tier 3 the least. `queueOrder` never lets the
 * operational score below reorder across a tier boundary — the score only breaks ties inside
 * one tier.
 */
const TIER_QUALIFIER: Record<Movement["urgency"], string> = {
  1: "most urgent",
  2: "urgent",
  3: "least urgent",
};

/**
 * The seven fields this column must carry at a fixed 14rem width (Task 5 ruling 1): movement
 * id, tier badge, elapsed wait, cohort, security, origin department and the operational score.
 * The column stays fixed so Task 6's three-column network diagram keeps its space; the row
 * grows taller instead of the column growing wider — five short lines rather than one cramped
 * one. The origin department renders as `siteCode` (e.g. "RPH"), never `ed.name`, which runs to
 * 50 characters on this fixture and would blow out the column on its own.
 */
export function PriorityQueue({ movements, now, selectedId, onSelect, filterEdId, onClearFilter }: PriorityQueueProps) {
  // Built once per render rather than called once per row (41 calls) — every row below reads
  // the same fixed department list, so a single lookup map replaces 41 redundant scans.
  const edsById = new Map(allEmergencyDepartments().map((ed) => [ed.id, ed]));
  // A one-line lookup keyed on a field the model already carries (`filterEdId`) — the same
  // reasoning `coordinator-screen.tsx` uses for its own ED lookup — not a derivation that
  // belongs in a ward-*.ts module. If the id it was given cannot be resolved, say so rather than
  // silently dropping the filter notice or naming the wrong department.
  const filterEd = filterEdId ? edsById.get(filterEdId) : undefined;

  return (
    <section className={styles.queueRegion} aria-label="Priority queue">
      <header className={styles.regionHeader}>
        <h2>Priority queue</h2>
        <span className={styles.regionCount}>{movements.length} open movements</span>
        {filterEdId ? (
          <p className={styles.filterNotice}>
            <span>
              {filterEd ? `Filtered to ${filterEd.siteCode} — ${filterEd.name}` : "Filtered — department unavailable"}
            </span>
            <button type="button" className={styles.clearSelectionButton} onClick={onClearFilter}>
              Clear filter
            </button>
          </p>
        ) : null}
      </header>
      <ul className={styles.queueList}>
        {movements.map((movement) => {
          const selected = movement.id === selectedId;
          // Same one-line lookup reasoning as `filterEd` above, keyed on
          // `Movement.originEdId`. An unresolved id renders as an explicit absence, never a
          // substituted department (Task 5 ruling 1).
          const originEd = edsById.get(movement.originEdId);
          // Unlabelled, "Secure · JHC" reads as a destination on a screen whose whole purpose is
          // finding one — JHC is where the patient currently is, not where they are going
          // (display-honesty rule; Task 5 review Minor 5). "from" makes the direction explicit.
          const originLabel = originEd ? `from ${originEd.siteCode}` : "from an unknown ED";
          const { score, factors } = operationalScore(movement, now);
          // `clockState` (not the presence of a factor) is the source of truth for "is this
          // breached" — the factor list is scoped to Task 7's expandable shortlist, not this
          // row, but a breached statutory deadline is the one thing this row must never let a
          // coordinator miss, so it always renders here regardless of what Task 7 later shows.
          // A form with no `dueAt` (Task 6A: a Form 3B honestly carries none) is never breached —
          // `undefined` must never reach `clockState`'s arithmetic.
          const legalDueAt = movement.legalForm?.dueAt;
          const legalBreached = legalDueAt !== undefined && clockState(legalDueAt, now) === "breached";
          const legalFactor = factors.find((factor) => factor.label === "Statutory timing");

          return (
            <li key={movement.id}>
              <button
                type="button"
                data-testid={`ward-queue-row-${movement.id}`}
                data-origin-ed={movement.originEdId}
                data-score={score}
                className={selected ? styles.queueRowSelected : styles.queueRow}
                aria-pressed={selected}
                onClick={() => onSelect(movement.id)}
              >
                <strong>{movement.id}</strong>
                <span className={styles.queueTier} data-tier={movement.urgency}>
                  Tier {movement.urgency} · {TIER_QUALIFIER[movement.urgency]}
                </span>
                <span>{elapsedLabel(movement, now)}</span>
                <span>
                  {movement.cohort} · {movement.security} · {originLabel}
                </span>
                {/* Labelled "Operational" — this is how badly the movement is going
                    operationally, never a restatement of clinical severity, acuity or risk. */}
                <span className={styles.queueScore}>Operational {score}</span>
                {legalBreached ? (
                  <span className={styles.queueLegalBreach}>
                    {legalFactor ? legalFactor.detail : "Legal deadline breached"}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
