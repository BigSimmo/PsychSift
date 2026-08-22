"use client";

import {
  ArrowLeft,
  ArrowRight,
  BedSingle,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { ContextualBackLink } from "@/components/contextual-back-link";
import { formatInstant } from "@/components/ward-management/ward-clock";
import { eligibility } from "@/components/ward-management/ward-eligibility";
import {
  candidateReason,
  destinationUnit,
  eligibleCandidates,
  movementHealthService,
  movementTimeline,
  stageCopy,
  stageSummaries,
  transportStatusLabel,
} from "@/components/ward-management/ward-derivations";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import {
  MOVEMENT_STAGES,
  type LegalForm,
  type Movement,
  type MovementStage,
} from "@/components/ward-management/ward-model";
import { ClinicalRail } from "@/components/ward-management/ward-management-navigation";

import styles from "./ward-management.module.css";

/**
 * The "label (code) · …" line for a legal form, shared by the readiness card and the legal
 * panel below. Task 6A: a Form 3B honestly carries no `dueAt` (the Mental Health Act imposes no
 * post-examination deadline) — this states that absence explicitly rather than ever formatting
 * an undefined instant, which is how "due NaN:NaN" would ship.
 */
function legalFormReadinessLine(legalForm: LegalForm): string {
  const named = `${legalForm.label} (${legalForm.code})`;
  return legalForm.dueAt !== undefined
    ? `${named} · due ${formatInstant(legalForm.dueAt)}`
    : `${named} · no statutory deadline`;
}

const stageIcons = {
  placement_requested: FileCheck2,
  destination_review: Search,
  accepted_awaiting_bed: BedSingle,
  bed_held: CalendarDays,
  handover_ready: ShieldCheck,
  moving: Truck,
  arrived: CheckCircle2,
} satisfies Record<MovementStage, LucideIcon>;

function MovementPipeline({
  activeStage,
  onStageChange,
  stages,
}: {
  activeStage: MovementStage;
  onStageChange: (stage: MovementStage) => void;
  stages: ReturnType<typeof stageSummaries>;
}) {
  return (
    <nav className={styles.movementPipeline} aria-label="Patient movement stages">
      {stages.map((stage, index) => {
        const Icon = stageIcons[stage.id];
        const active = stage.id === activeStage;
        return (
          <div className={styles.stageGroup} key={stage.id}>
            <button
              type="button"
              onClick={() => onStageChange(stage.id)}
              aria-current={active ? "step" : undefined}
              className={active ? styles.stageActive : styles.stage}
            >
              <Icon aria-hidden="true" />
              <span className={styles.stageNumber}>{index + 1}</span>
              <span>
                <strong>{stage.label}</strong>
                <b>{stage.count}</b>
              </span>
            </button>
            {index < stages.length - 1 ? <ArrowRight className={styles.stageArrow} aria-hidden="true" /> : null}
          </div>
        );
      })}
    </nav>
  );
}

export function WardPatientWorkspace({ patientId }: { patientId: string }) {
  const { movements, now, units } = useWardFlow();
  // Read the live, single source of truth rather than the frozen fixture — a patient just
  // referred on the coordinator screen must resolve here too, and a missing id must render an
  // explicit "not found" rather than ever substituting a different movement.
  const patient: Movement | undefined = movements.find((candidate) => candidate.id === patientId);
  const [confirmed, setConfirmed] = useState(false);
  const [activeSection, setActiveSection] = useState<"overview" | "legal" | "transport" | "timeline">("overview");
  const [activeStage, setActiveStage] = useState<MovementStage>(patient?.stage ?? MOVEMENT_STAGES[0]);

  if (!patient) {
    return (
      <div className={styles.patientWorkspace} data-testid="ward-patient-workspace">
        <ClinicalRail />
        <header className={styles.workspaceHeader}>
          <ContextualBackLink fallbackHref="/ward-management" aria-label="Back to Ward Flow">
            <ArrowLeft aria-hidden="true" />
          </ContextualBackLink>
          <div>
            <span>Ward Flow</span>
            <h1>Movement not found</h1>
          </div>
          <span className={styles.prototypeBadge}>Synthetic prototype</span>
        </header>
        <main id="main-content" className={styles.workspaceMain}>
          <p className={styles.governanceNote}>
            No synthetic movement matches &ldquo;{patientId}&rdquo;. It may have arrived and closed, or the id is
            incorrect.
          </p>
        </main>
      </div>
    );
  }

  // This workspace shows the movement's own record only — it never falls back to a
  // suggested/top-eligible unit, so `destination` here is always the real recorded destination
  // or nothing.
  const destination = destinationUnit(patient);
  const verdict = destination ? eligibility(patient, destination, now) : undefined;
  const candidates = eligibleCandidates(patient, now, 3, units).filter(
    (candidate) => candidate.unit.id !== destination?.id,
  );
  const timeline = movementTimeline(patient);

  return (
    <div className={styles.patientWorkspace} data-testid="ward-patient-workspace">
      <ClinicalRail />
      <header className={styles.workspaceHeader}>
        <ContextualBackLink fallbackHref="/ward-management" aria-label="Back to Ward Flow">
          <ArrowLeft aria-hidden="true" />
        </ContextualBackLink>
        <div>
          <span>Ward Flow</span>
          <h1>{patient.id} movement workspace</h1>
        </div>
        <span className={styles.prototypeBadge}>Synthetic prototype</span>
      </header>
      <main id="main-content" className={styles.workspaceMain}>
        <section className={styles.workspaceSummary}>
          <div>
            <span className={styles.aiLabel}>
              <Sparkles aria-hidden="true" /> Eligibility check
            </span>
            <h2>{destination ? destination.name : "No destination selected"}</h2>
            <p>
              {movementHealthService(patient) ?? "Unknown service"} · {patient.cohort} {patient.security}
            </p>
          </div>
          <div className={styles.workspaceScore}>
            <span>Eligibility</span>
            <strong>{verdict ? candidateReason(verdict) : "—"}</strong>
            <small>Tier {patient.urgency} leads</small>
          </div>
          <button
            type="button"
            onClick={() => setConfirmed(true)}
            className={confirmed ? styles.confirmedButton : styles.confirmButton}
            disabled={!destination}
          >
            {confirmed ? <Check aria-hidden="true" /> : null}
            {confirmed ? "Destination confirmed" : "Review & confirm"}
          </button>
        </section>

        <MovementPipeline activeStage={activeStage} onStageChange={setActiveStage} stages={stageSummaries(movements)} />

        <nav className={styles.workspaceTabs} aria-label="Patient movement sections">
          {(["overview", "legal", "transport", "timeline"] as const).map((section) => (
            <button
              type="button"
              key={section}
              onClick={() => setActiveSection(section)}
              aria-pressed={activeSection === section}
            >
              {section === "overview"
                ? "Overview"
                : section === "legal"
                  ? "Legal & forms"
                  : section === "transport"
                    ? "Transport"
                    : "Audit timeline"}
            </button>
          ))}
        </nav>

        <div className={styles.workspaceGrid}>
          <section>
            <h2>Movement facts</h2>
            <dl className={styles.factList}>
              <div>
                <dt>Current stage</dt>
                <dd>{stageCopy[patient.stage].label}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{patient.owner}</dd>
              </div>
              <div>
                <dt>Referral</dt>
                <dd>{destination ? destination.name : `${patient.referredUnitIds.length} referred`}</dd>
              </div>
              <div>
                <dt>Response</dt>
                <dd>{patient.blocker}</dd>
              </div>
              <div>
                <dt>Health service</dt>
                <dd>{movementHealthService(patient) ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Setting</dt>
                <dd>
                  {patient.cohort} · {patient.security}
                </dd>
              </div>
            </dl>
          </section>

          <section id="match-explanation">
            <h2>Why this match</h2>
            {verdict ? (
              <ul className={styles.reasonList}>
                {verdict.gates.map((gate) => (
                  <li key={gate.gate}>
                    {gate.pass ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />} {gate.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Select a destination to see eligibility checks.</p>
            )}
            <h3>Alternatives</h3>
            {candidates.map((candidate) => (
              <div className={styles.alternativeRow} key={candidate.unit.id}>
                <span>
                  <strong>{candidate.unit.name}</strong>
                  <small>{candidateReason(candidate.verdict)}</small>
                </span>
                <b>{candidate.verdict.eligible ? "Eligible" : "Not eligible"}</b>
              </div>
            ))}
          </section>

          <section>
            <h2>Readiness</h2>
            <ul className={styles.readinessList}>
              <li>
                <FileCheck2 aria-hidden="true" />
                <span>
                  <strong>Legal status</strong>
                  {patient.legalStatus}
                </span>
              </li>
              <li>
                <ShieldCheck aria-hidden="true" />
                <span>
                  <strong>Form readiness</strong>
                  {patient.legalForm ? legalFormReadinessLine(patient.legalForm) : "No legal form required"}
                </span>
              </li>
              <li>
                <Truck aria-hidden="true" />
                <span>
                  <strong>Transport</strong>
                  {transportStatusLabel(patient.transport)}
                </span>
              </li>
              <li>
                <CircleAlert aria-hidden="true" />
                <span>
                  <strong>Current blocker</strong>
                  {patient.blocker}
                </span>
              </li>
            </ul>
          </section>
        </div>

        {activeSection === "legal" ? (
          <section className={styles.contextPanel}>
            <h2>Legal and forms</h2>
            <p>{patient.legalStatus}</p>
            <p>
              {patient.legalForm
                ? legalFormReadinessLine(patient.legalForm)
                : "No Mental Health Act transport form required"}
            </p>
          </section>
        ) : null}
        {activeSection === "transport" ? (
          <section className={styles.contextPanel}>
            <h2>Transport chain</h2>
            <p>{transportStatusLabel(patient.transport)}</p>
            <p>
              Provider, ETA, risk documentation and legal-form readiness are visible here; dispatch and live vehicle
              tracking are not part of this prototype.
            </p>
          </section>
        ) : null}
        {activeSection === "timeline" ? (
          <section className={styles.contextPanel}>
            <h2>Synthetic audit timeline</h2>
            <ol className={styles.timeline}>
              {timeline.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <time>{formatInstant(event.at)}</time>
                  <span>{event.label}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <p className={styles.governanceNote}>
          Synthetic prototype only. Eligibility is checked automatically; an authorised human confirms every
          destination. This is not clinical severity.
        </p>
        <span className="sr-only" aria-live="polite">
          {confirmed ? `Destination confirmed for ${patient.id}` : ""}
        </span>
      </main>
    </div>
  );
}
