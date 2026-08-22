"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileClock,
  Fingerprint,
  Info,
  LockKeyhole,
  MapPin,
  Scale,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { eligibility } from "@/components/ward-management/ward-eligibility";
import {
  buildActionInbox,
  candidateReason,
  destinationUnit,
  eligibleCandidates,
  elapsedLabel,
  isOpen,
  movementHealthService,
  movementTimeline,
  roleLabels,
  roleTaskLabel,
  stageSummaries,
  unitCapacity,
  type InboxItem,
  type WardRole,
} from "@/components/ward-management/ward-derivations";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { WardNetworkWorkspace } from "@/components/ward-management/ward-management-network";
import { ClinicalRail, type WardMode } from "@/components/ward-management/ward-management-navigation";
import { formatInstant } from "@/components/ward-management/ward-clock";
import type { Movement } from "@/components/ward-management/ward-model";
import { siteByCode, unitById } from "@/components/ward-management/ward-sites";

import styles from "./ward-management-modes.module.css";

const roleFocusCopy: Record<WardRole, { title: string; detail: string }> = {
  flow: {
    title: "Statewide coordination focus",
    detail: "Review matches, cross-catchment escalation, holds and owned exceptions.",
  },
  ed: {
    title: "ED readiness focus",
    detail: "Prioritise referral, legal/form timing, handover and transport request readiness.",
  },
  ward: {
    title: "Ward capacity focus",
    detail: "Prioritise capacity freshness, suitability response, acceptance and time-limited holds.",
  },
};

const modeCopy: Record<WardMode, { title: string; description: string }> = {
  command: { title: "Ward Flow", description: "Statewide command view" },
  network: {
    title: "Network diagram",
    description: "Services as nodes · movements as routes · fill shows bed pressure",
  },
  queue: { title: "Priority queue", description: "Human urgency first · eligibility within tier" },
  capacity: { title: "Capacity", description: "Ward-confirmed state, capability and freshness" },
  movements: { title: "Movements", description: "Seven-stage patient movement board" },
  exceptions: { title: "Action inbox", description: "Owned exceptions, deadlines and stale state" },
  transport: { title: "Transport", description: "Legal, document, booking and handover readiness" },
  governance: { title: "Governance", description: "Assurance, audit and synthetic data boundary" },
};

/** Same role-ordering rule as the command console: human urgency order stays, role just re-sorts by owner. */
function sortByRole(movements: Movement[], role: WardRole) {
  if (role === "flow") return movements;
  if (role === "ed")
    return [...movements].sort((a, b) => Number(b.owner.includes("ED")) - Number(a.owner.includes("ED")));
  return [...movements].sort((a, b) => Number(b.owner.includes("Ward")) - Number(a.owner.includes("Ward")));
}

function toneClass(tone: "good" | "warning" | "danger" | "neutral") {
  if (tone === "good") return styles.statusGood;
  if (tone === "warning") return styles.statusWarning;
  if (tone === "danger") return styles.statusDanger;
  return styles.statusNeutral;
}

/** A short, honest action phrase for each real inbox category. */
function inboxAction(item: InboxItem) {
  if (item.id.startsWith("legal-")) return "Escalate legal timing";
  if (item.id.startsWith("declines-")) return "Expand destination search";
  if (item.id.startsWith("transport-")) return "Follow up transport provider";
  if (item.id.startsWith("bed-hold-")) return "Reconfirm or release bed hold";
  return "Review movement";
}

function ModeHeader({
  mode,
  role,
  onRoleChange,
}: {
  mode: WardMode;
  role: WardRole;
  onRoleChange: (role: WardRole) => void;
}) {
  const { now } = useWardFlow();
  const copy = modeCopy[mode];
  return (
    <header className={styles.modeHeader}>
      <div className={styles.modeIdentity}>
        <span>
          <strong>Clinical KB</strong>
          <small>Source-backed clinical search</small>
        </span>
        <div className={styles.modeTitle}>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
      </div>
      <label className={styles.roleSelect}>
        <UserRound aria-hidden="true" />
        <span className="sr-only">Current role</span>
        <select value={role} onChange={(event) => onRoleChange(event.target.value as WardRole)}>
          {Object.entries(roleLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" />
      </label>
      <div className={styles.headerMeta}>
        <span className={styles.prototypeBadge}>Synthetic prototype</span>
        <span>Updated {formatInstant(now)}</span>
        <span>15 Aug 2026 · WA</span>
      </div>
    </header>
  );
}

function DecisionPanel({
  patient,
  role,
  selectedId,
  onSelectId,
}: {
  patient: Movement;
  role: WardRole;
  selectedId: string | undefined;
  onSelectId: (id: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const { now, units } = useWardFlow();
  const candidates = useMemo(() => eligibleCandidates(patient, now, 3, units), [patient, now, units]);
  // Never fall back to candidates[0] when the id in play isn't one of this movement's own
  // shortlisted candidates — that would silently describe the wrong unit (Task 6 Critical 1).
  const selected = candidates.find((candidate) => candidate.unit.id === selectedId);
  const offShortlistUnit = !selected && selectedId ? unitById(selectedId) : undefined;
  const offShortlistVerdict = offShortlistUnit ? eligibility(patient, offShortlistUnit, now) : undefined;
  const recordedDestination = destinationUnit(patient);
  const isSuggested = selected !== undefined && selected.unit.id !== recordedDestination?.id;

  return (
    <aside className={`${styles.panel} ${styles.decisionPanel}`} aria-label={`AI best-fit review for ${patient.id}`}>
      <header className={styles.decisionHeader}>
        <div>
          <span className={styles.aiBadge}>
            <Sparkles aria-hidden="true" /> {isSuggested ? "Suggested destination" : "Eligibility check"}
          </span>
          <h2>{patient.id}</h2>
        </div>
        <span className={toneClass(patient.urgency === 1 ? "danger" : "warning")}>P{patient.urgency}</span>
      </header>

      <dl className={styles.patientFacts}>
        <div>
          <dt>Health service</dt>
          <dd>{movementHealthService(patient) ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Required setting</dt>
          <dd>
            {patient.cohort} · {patient.security}
          </dd>
        </div>
        <div>
          <dt>Legal state</dt>
          <dd>{patient.legalStatus}</dd>
        </div>
        <div>
          <dt>Wait / eligibility</dt>
          <dd>
            {elapsedLabel(patient, now)}
            {selected ? ` · ${candidateReason(selected.verdict)}` : ""}
          </dd>
        </div>
      </dl>

      <div className={styles.candidateTable} aria-label="Explainable destination shortlist">
        {candidates.map((candidate, index) => (
          <button
            type="button"
            key={candidate.unit.id}
            onClick={() => {
              onSelectId(candidate.unit.id);
              setConfirmed(false);
            }}
            aria-pressed={selected?.unit.id === candidate.unit.id}
            className={selected?.unit.id === candidate.unit.id ? styles.candidateRowSelected : styles.candidateRow}
          >
            <span className={styles.candidateRank}>{index + 1}</span>
            <span>
              <strong>{candidate.unit.name}</strong>
              <small>{candidateReason(candidate.verdict)}</small>
            </span>
            <span className={styles.score}>{candidate.verdict.eligible ? "Eligible" : "Not eligible"}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <ul className={styles.reasonList}>
          {/* Failing gates sort first so a fixed slice can never hide the one reason a
              movement isn't eligible — see Task 6 Critical 1 (whole-branch review). */}
          {[...selected.verdict.gates]
            .sort((a, b) => Number(a.pass) - Number(b.pass))
            .slice(0, 4)
            .map((gate) => (
              <li key={gate.gate}>
                {gate.pass ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />} {gate.detail}
              </li>
            ))}
        </ul>
      ) : offShortlistUnit && offShortlistVerdict ? (
        <>
          <p className={styles.microCopy}>
            {offShortlistUnit.name} is not in {patient.id}&rsquo;s eligible shortlist.
          </p>
          <ul className={styles.reasonList}>
            {[...offShortlistVerdict.gates]
              .sort((a, b) => Number(a.pass) - Number(b.pass))
              .slice(0, 4)
              .map((gate) => (
                <li key={gate.gate}>
                  {gate.pass ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />} {gate.detail}
                </li>
              ))}
          </ul>
        </>
      ) : null}

      <div className={styles.buttonRow}>
        <button type="button" onClick={() => setConfirmed(true)} className={styles.primaryButton} disabled={!selected}>
          {confirmed ? <Check aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
          {confirmed ? "Match confirmed" : roleTaskLabel[role]}
        </button>
        <Link className={styles.secondaryButton} href={`/ward-management/patients/${patient.id}`}>
          Full record <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      <p className={styles.microCopy}>
        Eligibility computed automatically · authorised human confirms or overrides · no automatic allocation
      </p>
    </aside>
  );
}

function QueueView({ role }: { role: WardRole }) {
  const { movements, now, units } = useWardFlow();
  const [selectedId, setSelectedId] = useState(movements[0].id);
  const rolePatients = useMemo(() => sortByRole(movements, role).filter(isOpen), [movements, role]);
  // Hold only the id and derive the record from the live `movements` list on every render —
  // matching `WardNetworkWorkspace` (Task 6 fix round 3, Finding 2). Holding the movement object
  // itself would freeze it at whatever it looked like on mount, so a referral made elsewhere would
  // never show up here even though `movements` had already moved on. `selectedId` is only ever set
  // from a real movement's own id (see the queue button below), so the `.find()` can't miss today —
  // but the guard still lives in the JSX below, not as an early return, so every hook above it keeps
  // running unconditionally regardless of future callers.
  const selected = useMemo(() => movements.find((candidate) => candidate.id === selectedId), [movements, selectedId]);
  return (
    <div className={styles.pageGrid} data-testid="ward-queue-view">
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <h2>Placement-ready movements</h2>
            <p>Human tier remains primary. Eligibility explains ordering within tier.</p>
          </div>
          <span className={styles.prototypeBadge}>{rolePatients.length} synthetic records</span>
        </header>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Priority</th>
              <th scope="col">Wait</th>
              <th scope="col">Need</th>
              <th scope="col">Health service</th>
              <th scope="col">Blocker</th>
              <th scope="col">Top candidate</th>
            </tr>
          </thead>
          <tbody>
            {rolePatients.map((patient) => {
              const top = eligibleCandidates(patient, now, 1, units)[0];
              return (
                <tr key={patient.id} data-selected={selected?.id === patient.id}>
                  <td>
                    <button type="button" onClick={() => setSelectedId(patient.id)} className={styles.secondaryButton}>
                      {patient.id}
                    </button>
                  </td>
                  <td>P{patient.urgency}</td>
                  <td>{elapsedLabel(patient, now)}</td>
                  <td>
                    {patient.cohort} · {patient.security}
                  </td>
                  <td>{movementHealthService(patient) ?? "Unknown"}</td>
                  <td>{patient.blocker}</td>
                  <td className={styles.score}>
                    {top ? (top.verdict.eligible ? top.unit.name : "None eligible") : "None eligible"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {selected ? (
        <DecisionPanel
          patient={selected}
          role={role}
          selectedId={destinationUnit(selected)?.id ?? eligibleCandidates(selected, now, 3, units)[0]?.unit.id}
          onSelectId={() => undefined}
        />
      ) : (
        // Never fall back to `movements[0]` or any other record here — showing a different
        // patient under the selected patient's heading is the exact class of defect this project
        // keeps finding (Task 6 Critical 1, Task 6 fix round 3 Finding 2).
        <aside className={`${styles.panel} ${styles.decisionPanel}`} aria-label="AI best-fit review unavailable">
          <p className={styles.microCopy}>No synthetic movement matches the current selection.</p>
        </aside>
      )}
    </div>
  );
}

function CapacityView() {
  const { units, now } = useWardFlow();
  const capacities = units.map((unit) => ({ unit, capacity: unitCapacity(unit) }));
  const totals = {
    available: capacities.reduce((sum, entry) => sum + entry.capacity.available, 0),
    held: capacities.reduce((sum, entry) => sum + entry.capacity.held, 0),
    potential: capacities.reduce((sum, entry) => sum + entry.capacity.potential, 0),
    blocked: capacities.reduce((sum, entry) => sum + entry.capacity.blocked, 0),
    occupied: capacities.reduce((sum, entry) => sum + entry.capacity.occupied, 0),
  };
  return (
    <section className={styles.panel} data-testid="ward-capacity-view">
      <header className={styles.panelHeader}>
        <div>
          <h2>Ward-confirmed capacity</h2>
          <p>Availability is not suitability. Every count includes a freshness signal.</p>
        </div>
        <span className={styles.prototypeBadge}>Synthetic counts</span>
      </header>
      <div className={styles.capacitySummary}>
        {Object.entries(totals).map(([label, value]) => (
          <article className={styles.summaryCard} key={label}>
            <span>{label.replace(/^./, (character) => character.toUpperCase())}</span>
            <strong>{value}</strong>
            <small>Across {units.length} synthetic units</small>
          </article>
        ))}
      </div>
      <table className={styles.dataTable}>
        <thead>
          <tr>
            <th scope="col">Unit</th>
            <th scope="col">Health service</th>
            <th scope="col">Capability cue</th>
            <th scope="col">Five bed states</th>
            <th scope="col">Freshness</th>
          </tr>
        </thead>
        <tbody>
          {capacities.map(({ unit, capacity }) => {
            const fresh = now - unit.allocatable.confirmedAt <= unit.allocatable.staleAfterMinutes;
            return (
              <tr key={unit.id}>
                <td>
                  <strong>{unit.name}</strong>
                  <div className={styles.microCopy}>{unit.beds} total beds</div>
                </td>
                <td>{siteByCode(unit.siteCode)?.service ?? "Unknown"}</td>
                <td>
                  {unit.cohort} · {unit.security} {unit.authorised ? "" : "· not MHA-authorised"}
                </td>
                <td>
                  <div className={styles.bedStates}>
                    <span>
                      <strong>{capacity.available}</strong>Now
                    </span>
                    <span>
                      <strong>{capacity.held}</strong>Held
                    </span>
                    <span>
                      <strong>{capacity.potential}</strong>Potential
                    </span>
                    <span>
                      <strong>{capacity.blocked}</strong>Blocked
                    </span>
                    <span>
                      <strong>{capacity.occupied}</strong>Occupied
                    </span>
                  </div>
                </td>
                <td>
                  <span className={fresh ? styles.statusGood : styles.statusWarning}>
                    {fresh ? "Current" : "Review soon"} · {formatInstant(unit.allocatable.confirmedAt)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.notice}>
        Potential capacity requires a named action and estimate. No departing-patient details are shown in this
        prototype.
      </p>
    </section>
  );
}

function MovementsView() {
  const { movements, now } = useWardFlow();
  const stages = stageSummaries(movements);
  return (
    <section className={styles.panel} data-testid="ward-movements-view">
      <header className={styles.panelHeader}>
        <div>
          <h2>Patient movement board</h2>
          <p>Cross-catchment escalation remains a flag, not an extra stage.</p>
        </div>
        <span className={styles.prototypeBadge}>Shared record · role-owned actions</span>
      </header>
      <div className={styles.stageBoard}>
        {stages.map((stage) => (
          <section className={styles.stageColumn} key={stage.id} aria-labelledby={`movement-${stage.id}`}>
            <header>
              <h2 id={`movement-${stage.id}`}>{stage.label}</h2>
              <strong>{stage.count}</strong>
            </header>
            {movements
              .filter((patient) => patient.stage === stage.id)
              .slice(0, 4)
              .map((patient) => (
                <Link className={styles.movementCard} href={`/ward-management/patients/${patient.id}`} key={patient.id}>
                  <span className={styles.rowTop}>
                    <strong>{patient.id}</strong>
                    <span className={toneClass(patient.urgency === 1 ? "danger" : "neutral")}>P{patient.urgency}</span>
                  </span>
                  <span className={styles.rowMeta}>
                    {elapsedLabel(patient, now)} · {movementHealthService(patient) ?? "Unknown"} · {patient.security}
                  </span>
                  <span className={styles.rowMeta}>{patient.owner}</span>
                </Link>
              ))}
          </section>
        ))}
      </div>
    </section>
  );
}

function ExceptionsView() {
  const { movements, now } = useWardFlow();
  // Whole-branch review Minor 6: same open-movement scoping as the coordinator screen — a closed
  // record must never appear on a live exception work list.
  const items = buildActionInbox(movements.filter(isOpen), now);
  // Task 8 review (Minor 7): `tone === "danger"` also matches the parallel-referral-cap
  // category, which is a capacity dead end, not a passed deadline — counting it under a label
  // that says "overdue" overstated the true breach count by one once Ruling 1 started emitting
  // every qualifying movement instead of at most one. "Overdue" means a legal deadline has
  // actually passed, so this counts only the `legal-` category, matching what the label claims.
  const overdue = items.filter((item) => item.id.startsWith("legal-")).length;
  return (
    <div className={styles.pageGrid} data-testid="ward-exceptions-view">
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <h2>Action exceptions</h2>
            <p>Only items with an owner and required next action appear here.</p>
          </div>
          <span className={styles.statusDanger}>{overdue} overdue</span>
        </header>
        <div className={styles.exceptionList}>
          {items.map((item) => (
            <article className={styles.exceptionRow} key={item.id}>
              <CircleAlert aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.movementId} · {inboxAction(item)}
                </small>
              </div>
              <div>
                <span className={toneClass(item.tone)}>{item.detail}</span>
                <small>{item.owner}</small>
              </div>
              <Link className={styles.secondaryButton} href={`/ward-management/patients/${item.movementId}`}>
                Open <ArrowRight aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <aside className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <h2>Exception rules</h2>
            <p>Actionable, owned and time-bounded</p>
          </div>
        </header>
        <ul className={styles.reasonList}>
          {["Legal timing breached", "Every parallel referral declined", "Transport accepted but not yet en route"].map(
            (rule) => (
              <li key={rule}>
                <CheckCircle2 aria-hidden="true" /> {rule}
              </li>
            ),
          )}
        </ul>
      </aside>
    </div>
  );
}

function TransportView() {
  const { movements } = useWardFlow();
  const transportPatients = movements.filter((patient) => patient.stage !== "arrived" && patient.transport).slice(0, 8);
  return (
    <div className={styles.pageGrid} data-testid="ward-transport-view">
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <h2>Transport readiness</h2>
            <p>Metro and country pathways retain distinct documentation and escalation cues.</p>
          </div>
          <span className={styles.prototypeBadge}>No dispatch integration</span>
        </header>
        <div className={styles.transportList}>
          {transportPatients.map((patient) => {
            const stalled =
              patient.transport?.acceptedAt !== undefined &&
              patient.transport.enRouteAt === undefined &&
              patient.transport.cancelledAt === undefined;
            return (
              <article className={styles.transportRow} key={patient.id}>
                <Truck aria-hidden="true" />
                <div>
                  <strong>{patient.id}</strong>
                  <small>
                    {movementHealthService(patient) ?? "Unknown"} · {patient.legalStatus}
                  </small>
                </div>
                <div>
                  <span className={stalled ? styles.statusWarning : styles.statusGood}>
                    {patient.transport ? `${patient.transport.provider}: ` : ""}
                    {patient.transport?.enRouteAt !== undefined
                      ? "En route"
                      : patient.transport?.acceptedAt !== undefined
                        ? "Accepted, awaiting departure"
                        : "Requested"}
                  </span>
                  <small>
                    {patient.legalForm
                      ? `${patient.legalForm.label} (${patient.legalForm.code})`
                      : "No legal form required"}
                  </small>
                </div>
                <Link className={styles.secondaryButton} href={`/ward-management/patients/${patient.id}`}>
                  Review <ArrowRight aria-hidden="true" />
                </Link>
              </article>
            );
          })}
        </div>
      </section>
      <aside className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <h2>Safe transfer chain</h2>
            <p>Visible prerequisites before a movement advances</p>
          </div>
        </header>
        <ul className={styles.reasonList}>
          <li>
            <FileCheck2 aria-hidden="true" /> Legal form and transport risk documentation ready
          </li>
          <li>
            <ShieldCheck aria-hidden="true" /> Receiving service and handover acceptance recorded
          </li>
          <li>
            <Truck aria-hidden="true" /> Provider, booking state and estimated time visible
          </li>
          <li>
            <MapPin aria-hidden="true" /> WACHS pathway and escalation ownership shown for country transfers
          </li>
        </ul>
        <p className={styles.notice}>
          Police transport is represented only as an escalation state; this prototype does not dispatch or track
          vehicles.
        </p>
      </aside>
    </div>
  );
}

function GovernanceView() {
  const { movements } = useWardFlow();
  const sources = [
    ["WA Health System Flow Centre", "https://www.health.wa.gov.au/Improving-WA-Health/System-Flow-Centre"],
    [
      "Mental Health Act 2014 forms",
      "https://www.chiefpsychiatrist.wa.gov.au/laws-and-rights/legislation/mental-health-act-2014-forms/",
    ],
    ["WA mental health patient transport", "https://www.health.wa.gov.au/Articles/J_M/Mental-health-patient-transport"],
    [
      "WA Health Artificial Intelligence Policy",
      "https://www.health.wa.gov.au/about-us/policy-frameworks/digital-health/mandatory-requirements/artificial-intelligence-policy",
    ],
  ];
  const sample = movements[0];
  const timeline = movementTimeline(sample);
  return (
    <div data-testid="ward-governance-view">
      <section className={styles.assuranceGrid}>
        <article className={styles.governanceCard}>
          <Sparkles aria-hidden="true" />
          <h2>Explainable proposal</h2>
          <p>
            Eligibility is checked before ranking. Positive reasons, exclusions, alternatives and calculation time
            remain inspectable.
          </p>
        </article>
        <article className={styles.governanceCard}>
          <UserRound aria-hidden="true" />
          <h2>Human authority</h2>
          <p>
            An authorised user confirms or overrides every destination. The system never changes the human urgency tier
            or allocates a bed.
          </p>
        </article>
        <article className={styles.governanceCard}>
          <LockKeyhole aria-hidden="true" />
          <h2>Minimum data</h2>
          <p>
            Synthetic ID and operational fields only. No name, MRN, DOB, address, diagnosis, narrative history or
            treatment details.
          </p>
        </article>
        <article className={styles.governanceCard}>
          <Scale aria-hidden="true" />
          <h2>Contestable outcome</h2>
          <p>Users can select an alternative, record an override reason and see which gate changed the ordering.</p>
        </article>
        <article className={styles.governanceCard}>
          <Fingerprint aria-hidden="true" />
          <h2>Immutable ownership</h2>
          <p>
            The production concept requires role-based access and an immutable audit of source updates, recommendations
            and decisions.
          </p>
        </article>
        <article className={styles.governanceCard}>
          <Info aria-hidden="true" />
          <h2>Prototype boundary</h2>
          <p>
            No live systems, cloud AI, transport provider, police, PAS, PSOLIS or bed-management integration is used
            here.
          </p>
        </article>
      </section>
      <div className={`${styles.pageGrid} ${styles.governanceLowerGrid}`}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>Synthetic decision audit</h2>
              <p>Representative review trail for {sample.id}</p>
            </div>
          </header>
          <ol className={styles.auditList}>
            {timeline.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                {index === 0 ? (
                  <FileClock aria-hidden="true" />
                ) : index % 2 === 0 ? (
                  <Clock3 aria-hidden="true" />
                ) : (
                  <CalendarDays aria-hidden="true" />
                )}{" "}
                {formatInstant(event.at)} · {event.label}
              </li>
            ))}
          </ol>
        </section>
        <aside className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>Public grounding</h2>
              <p>Wireframe context, not internal operational policy</p>
            </div>
          </header>
          <ul className={styles.sourceList}>
            {sources.map(([label, href]) => (
              <li key={href}>
                <CheckCircle2 aria-hidden="true" />
                <a href={href} target="_blank" rel="noreferrer">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function RoleFocus({ role }: { role: WardRole }) {
  const focus = roleFocusCopy[role];
  return (
    <section className={styles.roleFocus} aria-live="polite">
      <strong>{focus.title}</strong>
      <span>{focus.detail}</span>
    </section>
  );
}

function ModeBody({ mode, role }: { mode: Exclude<WardMode, "command">; role: WardRole }) {
  if (mode === "network") return <WardNetworkWorkspace />;
  if (mode === "queue") return <QueueView role={role} />;
  if (mode === "capacity") return <CapacityView />;
  if (mode === "movements") return <MovementsView />;
  if (mode === "exceptions") return <ExceptionsView />;
  if (mode === "transport") return <TransportView />;
  return <GovernanceView />;
}

export function WardModeWorkspace({ mode }: { mode: Exclude<WardMode, "command"> }) {
  const [role, setRole] = useState<WardRole>("flow");
  return (
    <div className={styles.modeShell} data-testid={`ward-mode-${mode}`} data-role={role}>
      <ClinicalRail activeMode={mode} />
      <ModeHeader mode={mode} role={role} onRoleChange={setRole} />
      <main id="main-content" className={styles.modeContent}>
        <RoleFocus role={role} />
        <ModeBody mode={mode} role={role} />
      </main>
    </div>
  );
}
