"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Info, Network, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { eligibility } from "@/components/ward-management/ward-eligibility";
import {
  candidateReason,
  destinationUnit,
  eligibleCandidates,
  elapsedLabel,
  isOpen,
  movementHealthService,
  stageCopy,
  stageSummaries,
  transportStatusLabel,
  unitCapacity,
  wardServiceOrder,
} from "@/components/ward-management/ward-derivations";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { formatInstant, type Instant } from "@/components/ward-management/ward-clock";
import type { HealthService, Movement, Unit } from "@/components/ward-management/ward-model";
import { siteByCode, unitById } from "@/components/ward-management/ward-sites";

import styles from "./ward-management-network.module.css";

type BedStateKey = "available" | "held" | "potential" | "blocked";

const bedStateCopy: Record<BedStateKey, { label: string; detail: string }> = {
  available: { label: "Ready", detail: "Available now" },
  held: { label: "Held", detail: "Bed held" },
  potential: { label: "Potential", detail: "May become available" },
  blocked: { label: "Blocked", detail: "Not available" },
};

/** Left column carries the WA country service; right column carries the three metro services. */
const columnServices: { left: readonly HealthService[]; right: readonly HealthService[] } = {
  left: ["North Metro", "WACHS"],
  right: ["East Metro", "South Metro", "Private"],
};

type Connector = { id: string; path: string; kind: "demand" | "route" };
type Candidate = { unit: Unit; rank: number; etaLabel: string; verdict: ReturnType<typeof eligibility> };

function capabilityLabel(unit: Unit) {
  const cohortLabel = unit.cohort === "Older adult" ? "Older" : unit.cohort;
  return `${unit.security} · ${cohortLabel}`;
}

function candidatesFor(patient: Movement, now: Instant, units: readonly Unit[]): Candidate[] {
  // Only the movement's actual recorded destination may show a real transport state — the
  // other two candidates are computed shortlist entries the movement was never referred to,
  // and must not inherit a transport job that belongs to a different unit (Task 6 Important 3).
  const recordedDestinationId = destinationUnit(patient)?.id;
  return eligibleCandidates(patient, now, 3, units).map((candidate, index) => ({
    unit: candidate.unit,
    verdict: candidate.verdict,
    rank: index + 1,
    etaLabel: candidate.unit.id === recordedDestinationId ? transportStatusLabel(patient.transport) : "Not yet booked",
  }));
}

/**
 * Compares the candidate unit's health service against the *origin ED's* health service —
 * this is NOT catchment. Catchment is where the patient lives, not where they presented, and
 * `Movement` has no catchment field (see the doc comment on `movementHealthService` and the
 * glossary's Catchment entry). Naming this `catchmentFit` previously collapsed exactly the
 * distinction Accepted ADR 3 exists to keep separate.
 */
function originServiceFit(patient: Movement, unit: Unit) {
  const unitService = siteByCode(unit.siteCode)?.service;
  if (unitService && unitService === movementHealthService(patient)) return { label: "Best", tone: "good" as const };
  return { label: "Escalation", tone: "warning" as const };
}

function settingFit(patient: Movement, unit: Unit, now: Instant) {
  const verdict = eligibility(patient, unit, now);
  const cohortOk = verdict.gates.find((gate) => gate.gate === "cohort")?.pass ?? false;
  const securityOk = verdict.gates.find((gate) => gate.gate === "security")?.pass ?? false;
  if (cohortOk && securityOk) return { label: "Exact match", tone: "good" as const };
  if (cohortOk || securityOk) return { label: "Partial match", tone: "warning" as const };
  return { label: "Not eligible", tone: "danger" as const };
}

function transportTone(etaLabel: string) {
  return /requested|awaiting|not yet/i.test(etaLabel) ? "warning" : "good";
}

function BedStateChips({ unit, showTime }: { unit: Unit; showTime?: boolean }) {
  const capacity = unitCapacity(unit);
  return (
    <span className={styles.bedChips}>
      {(Object.keys(bedStateCopy) as BedStateKey[]).map((key) => (
        <span className={styles.bedChip} data-state={key} key={key} title={bedStateCopy[key].detail}>
          {capacity[key]}
        </span>
      ))}
      {showTime ? <span className={styles.bedTime}>{formatInstant(unit.allocatable.confirmedAt)}</span> : null}
    </span>
  );
}

function ServiceCard({
  unit,
  routed,
  selected,
  onSelect,
  registerRef,
}: {
  unit: Unit;
  routed: boolean;
  selected: boolean;
  onSelect: () => void;
  registerRef: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const capacity = unitCapacity(unit);
  return (
    <button
      type="button"
      ref={(node) => registerRef(unit.id, node)}
      onClick={onSelect}
      aria-pressed={selected}
      data-routed={routed ? "true" : undefined}
      data-testid={`ward-network-card-${unit.id}`}
      className={styles.serviceCard}
      aria-label={`${unit.name}. ${capabilityLabel(unit)}. ${capacity.available} ready, ${capacity.held} held, ${capacity.potential} potential, ${capacity.blocked} blocked, of ${unit.beds} beds. Confirmed ${formatInstant(unit.allocatable.confirmedAt)}.`}
    >
      <span className={styles.serviceName}>{unit.name}</span>
      <span className={styles.serviceCapability}>{capabilityLabel(unit)}</span>
      <BedStateChips unit={unit} showTime />
    </button>
  );
}

export function WardNetworkWorkspace() {
  const { movements, units, now } = useWardFlow();
  const [selectedPatientId, setSelectedPatientId] = useState(movements[0].id);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [factorsOpen, setFactorsOpen] = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(true);

  // `selectedPatientId` is only ever set from a real movement's own id (see the queue button
  // below), so this can't miss today — but every hook after this one must still run
  // unconditionally, so the guard lives in the JSX at the bottom, not as an early return here
  // (Task 6 Critical 3).
  const patient = useMemo(
    () => movements.find((candidate) => candidate.id === selectedPatientId),
    [movements, selectedPatientId],
  );
  const candidates = useMemo(() => (patient ? candidatesFor(patient, now, units) : []), [patient, now, units]);
  const routedIds = useMemo(() => new Set(candidates.map((candidate) => candidate.unit.id)), [candidates]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const hubRef = useRef<HTMLDivElement | null>(null);
  const clusterRefs = useRef(new Map<string, HTMLElement | null>());
  const cardRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const [connectors, setConnectors] = useState<Connector[]>([]);

  const registerCard = useCallback((id: string, node: HTMLButtonElement | null) => {
    cardRefs.current.set(id, node);
  }, []);
  const registerCluster = useCallback((service: string, node: HTMLElement | null) => {
    clusterRefs.current.set(service, node);
  }, []);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    const hub = hubRef.current;
    if (!canvas || !hub) return;
    const base = canvas.getBoundingClientRect();
    const hubBox = hub.getBoundingClientRect();
    const hubLeft = { x: hubBox.left - base.left, y: hubBox.top - base.top + hubBox.height / 2 };
    const hubRight = { x: hubBox.right - base.left, y: hubLeft.y };
    const next: Connector[] = [];

    /** Elbow: leave the source edge, run along a mid trunk, then enter the target edge. */
    const elbow = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const trunk = from.x + (to.x - from.x) / 2;
      return `M ${from.x} ${from.y} H ${trunk} V ${to.y} H ${to.x}`;
    };

    for (const service of wardServiceOrder) {
      const node = clusterRefs.current.get(service);
      if (!node) continue;
      const box = node.getBoundingClientRect();
      const onLeft = (columnServices.left as readonly string[]).includes(service);
      const from = { x: (onLeft ? box.right : box.left) - base.left, y: box.top - base.top + box.height / 2 };
      next.push({ id: `demand-${service}`, path: elbow(from, onLeft ? hubLeft : hubRight), kind: "demand" });
    }

    for (const candidate of candidates) {
      const node = cardRefs.current.get(candidate.unit.id);
      if (!node) continue;
      const box = node.getBoundingClientRect();
      const service = siteByCode(candidate.unit.siteCode)?.service;
      const onLeft = service ? (columnServices.left as readonly string[]).includes(service) : true;
      const to = { x: (onLeft ? box.right : box.left) - base.left, y: box.top - base.top + box.height / 2 };
      next.push({
        id: `route-${candidate.unit.id}`,
        path: elbow(onLeft ? hubLeft : hubRight, to),
        kind: "route",
      });
    }

    setConnectors(next);
  }, [candidates]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const detail = selectedUnitId ? unitById(selectedUnitId) : null;
  // Arrived and self-discharged movements have left the pathway (spec §7), so this must not
  // be the raw stage-count sum — that includes them and overstates live demand.
  const openMovements = movements.filter(isOpen).length;
  const primary = candidates[0];

  if (!patient) {
    return (
      <div className={styles.networkPage} data-testid="ward-network-view">
        <p className={styles.assurance}>No synthetic movement matches the current selection.</p>
      </div>
    );
  }

  return (
    <div
      className={styles.networkPage}
      data-testid="ward-network-view"
      data-shortlist={shortlistOpen ? "open" : "collapsed"}
    >
      <section className={styles.pipeline} aria-label="Movement pipeline">
        {stageSummaries(movements).map((stage, index) => (
          <span className={styles.pipelineStage} key={stage.id}>
            <span className={styles.pipelineLabel}>
              {index + 1} {stage.label}
            </span>
            <strong>{stage.count}</strong>
          </span>
        ))}
      </section>

      <div className={styles.networkGrid}>
        <section className={styles.queuePanel} aria-label="Priority queue">
          <header className={styles.panelHeader}>
            <h2>Priority queue</h2>
            <span className={styles.count}>{movements.length}</span>
          </header>
          <div className={styles.queueList}>
            {movements.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                onClick={() => {
                  setSelectedPatientId(candidate.id);
                  setSelectedUnitId(null);
                }}
                aria-pressed={candidate.id === patient.id}
                data-testid={`ward-network-queue-${candidate.id}`}
                className={styles.queueRow}
              >
                <span className={styles.queueTop}>
                  <strong>{candidate.id}</strong>
                  <span className={styles.elapsed}>{elapsedLabel(candidate, now)}</span>
                </span>
                <span className={styles.queueMeta}>
                  <span className={styles.tier} data-tier={candidate.urgency}>
                    {candidate.urgency}
                  </span>
                  {candidate.cohort} · {candidate.security} ward
                </span>
                <span className={styles.queueMeta}>
                  {movementHealthService(candidate) ?? "Unknown"} · {candidate.legalStatus}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.canvasPanel} aria-label="Operational constellation">
          <header className={styles.panelHeader}>
            <h2>
              <Network aria-hidden="true" /> Operational constellation
            </h2>
            <span className={styles.headerActions}>
              <span className={styles.schematicBadge}>
                <Info aria-hidden="true" /> Schematic, not geographic
              </span>
              <button
                type="button"
                className={styles.focusToggle}
                aria-expanded={shortlistOpen}
                onClick={() => setShortlistOpen((open) => !open)}
              >
                {shortlistOpen ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
                {shortlistOpen ? "Focus diagram" : "Show shortlist"}
              </button>
            </span>
          </header>

          <div className={styles.canvas} ref={canvasRef}>
            <svg className={styles.connectorLayer} aria-hidden="true">
              <defs>
                <marker id="ward-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M 0 0 L 7 3.5 L 0 7 z" className={styles.arrowHead} />
                </marker>
                <marker id="ward-arrow-route" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M 0 0 L 7 3.5 L 0 7 z" className={styles.arrowHeadRoute} />
                </marker>
              </defs>
              {connectors.map((connector) => (
                <path
                  key={connector.id}
                  d={connector.path}
                  className={connector.kind === "route" ? styles.connectorRoute : styles.connector}
                  markerEnd={connector.kind === "route" ? "url(#ward-arrow-route)" : "url(#ward-arrow)"}
                />
              ))}
            </svg>

            {(["left", "right"] as const).map((side) => (
              <div className={styles.column} data-side={side} key={side}>
                {columnServices[side].map((service) => (
                  <section
                    className={styles.cluster}
                    key={service}
                    ref={(node) => registerCluster(service, node)}
                    aria-labelledby={`ward-network-${service}`}
                  >
                    <header className={styles.clusterHeader}>
                      <strong id={`ward-network-${service}`}>{service.toUpperCase()}</strong>
                      <span>
                        {units
                          .filter((unit) => siteByCode(unit.siteCode)?.service === service)
                          .reduce((sum, unit) => sum + unit.allocatable.value, 0)}{" "}
                        ready
                      </span>
                    </header>
                    <div className={styles.clusterCards}>
                      {units
                        .filter((unit) => siteByCode(unit.siteCode)?.service === service)
                        .map((unit) => (
                          <ServiceCard
                            key={unit.id}
                            unit={unit}
                            routed={routedIds.has(unit.id)}
                            selected={detail?.id === unit.id}
                            onSelect={() => setSelectedUnitId(detail?.id === unit.id ? null : unit.id)}
                            registerRef={registerCard}
                          />
                        ))}
                    </div>
                  </section>
                ))}
              </div>
            ))}

            <div className={styles.hub} ref={hubRef}>
              <Network aria-hidden="true" />
              <strong>STATEWIDE FLOW</strong>
              <span>Coordinated visibility and placement</span>
              <span className={styles.hubMeta}>
                {patient.id} routing · {openMovements} open movements
              </span>
            </div>
          </div>

          <footer className={styles.legend}>
            <span className={styles.legendTitle}>Legend</span>
            {(Object.keys(bedStateCopy) as BedStateKey[]).map((key) => (
              <span className={styles.legendItem} key={key}>
                <i className={styles.legendSwatch} data-state={key} aria-hidden="true" />
                <b>{bedStateCopy[key].label}</b> {bedStateCopy[key].detail}
              </span>
            ))}
            <span className={styles.legendItem}>
              <i className={styles.legendRoute} aria-hidden="true" />
              <b>Shortlisted</b> Route for selected movement
            </span>
            <span className={styles.legendItem}>
              <i className={styles.legendDemand} aria-hidden="true" />
              <b>Demand</b> Health service into statewide flow
            </span>
          </footer>
        </section>

        <aside className={styles.shortlistPanel} aria-label="Explainable shortlist" aria-live="polite">
          <header className={styles.panelHeader}>
            <h2>
              <Sparkles aria-hidden="true" /> Explainable shortlist · {patient.id}
            </h2>
          </header>
          <p className={styles.patientLine}>
            <span className={styles.tier} data-tier={patient.urgency}>
              {patient.urgency}
            </span>
            {patient.cohort} · {patient.security} ward · {movementHealthService(patient) ?? "Unknown"} service
          </p>
          <p className={styles.patientSubLine}>
            {patient.legalStatus} ·{" "}
            {patient.legalForm ? `${patient.legalForm.label} (${patient.legalForm.code})` : "No legal form required"}
          </p>
          <p className={styles.patientSubLine}>
            {stageCopy[patient.stage].label} · waiting {elapsedLabel(patient, now)}
          </p>

          <div className={styles.tableScroll}>
            <table className={styles.compareTable}>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Comparison factor</span>
                  </th>
                  {candidates.map((candidate) => (
                    <th scope="col" key={candidate.unit.id}>
                      {candidate.rank} {candidate.unit.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Same health service as origin</th>
                  {candidates.map((candidate) => {
                    const fit = originServiceFit(patient, candidate.unit);
                    return (
                      <td key={candidate.unit.id} data-tone={fit.tone}>
                        {fit.label}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">Open/secure fit</th>
                  {candidates.map((candidate) => {
                    const fit = settingFit(patient, candidate.unit, now);
                    return (
                      <td key={candidate.unit.id} data-tone={fit.tone}>
                        {fit.label}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">Current bed state</th>
                  {candidates.map((candidate) => (
                    <td key={candidate.unit.id}>
                      <BedStateChips unit={candidate.unit} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Transport state</th>
                  {candidates.map((candidate) => (
                    <td key={candidate.unit.id} data-tone={transportTone(candidate.etaLabel)}>
                      {candidate.etaLabel}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Eligibility</th>
                  {candidates.map((candidate) => (
                    <td key={candidate.unit.id} title={candidateReason(candidate.verdict)}>
                      <strong>{candidate.verdict.eligible ? "Eligible" : "Not eligible"}</strong>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <p className={styles.tierNote}>
            <span className={styles.tier} data-tier={patient.urgency}>
              {patient.urgency}
            </span>
            <b>Urgency tier leads.</b> Eligibility only orders candidates inside a tier. It is not clinical severity.
          </p>

          <button
            type="button"
            className={styles.factorsToggle}
            aria-expanded={factorsOpen}
            onClick={() => setFactorsOpen((open) => !open)}
          >
            Eligibility gates ({primary ? primary.verdict.gates.length : 0})
            <ChevronDown aria-hidden="true" data-open={factorsOpen ? "true" : undefined} />
          </button>
          {factorsOpen && primary ? (
            <ul className={styles.factorList}>
              {primary.verdict.gates.map((gate) => (
                <li key={gate.gate}>{gate.detail}</li>
              ))}
            </ul>
          ) : null}

          <div className={styles.ownerBlock}>
            <span className={styles.ownerLabel}>Current owner</span>
            <strong>{patient.owner}</strong>
            <span>Next action: {patient.blocker}</span>
          </div>

          <Link className={styles.primaryLink} href={`/ward-management/patients/${patient.id}`}>
            Open movement workspace
          </Link>
          <p className={styles.assurance}>System suggests, you decide. No automatic allocation.</p>

          {detail ? (
            <section className={styles.detailBlock} aria-label="Selected service detail">
              <h3>{detail.name}</h3>
              <p>
                {siteByCode(detail.siteCode)?.service ?? "Unknown service"} · {capabilityLabel(detail)} · confirmed{" "}
                {formatInstant(detail.allocatable.confirmedAt)}
              </p>
              <BedStateChips unit={detail} />
              <p className={styles.detailMeta}>
                {unitCapacity(detail).occupied} occupied of {detail.beds} beds. Potential beds are a subset of occupied
                and are not allocatable yet.
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
