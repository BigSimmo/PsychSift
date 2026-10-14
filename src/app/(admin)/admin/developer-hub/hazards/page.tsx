import type { Metadata } from "next";

import {
  CARD_CLASS,
  CountTile,
  META_CLASS,
  MONO_CLASS,
  PanelSection,
} from "@/components/developer-area/hub/panel-primitives";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { resolveFreshnessFrom } from "@/lib/developer-area/freshness";
import { DOCUMENT_CAUTIONS } from "@/lib/document-cautions";
import {
  loadHazardSnapshot,
  missingRegisters,
  reviewExpiredAtPerth,
  statusBreakdown,
  statusLabel,
  unmitigatedHazards,
  type HazardRegister,
  type HazardRow,
} from "@/lib/developer-area/hazard-register";

export const metadata: Metadata = {
  title: "Hazard register · Developer · PsychSift",
  description: "Known clinical risks, their controls, and the ones nothing controls yet.",
};

/**
 * The developer hub's hazard register.
 *
 * Two rules shape every decision on this page, both drawn from the documents it
 * renders rather than invented here.
 *
 * **It leads with what is not controlled.** The registers hold 44 rows, and a
 * page opening with "44 hazards" reads as thoroughness — the opposite of the
 * truth it is reporting. The four rows with no control at all come first,
 * before any total, because those are the ones that block a real-patient pilot.
 *
 * **It never merges the registers.** The answer pipeline's register is
 * machine-checked and states that it establishes static evidence only. Any
 * other register added here keeps its own section, because rendering them as
 * one list would manufacture a uniform coverage claim that no document in this
 * repository makes. Each section therefore carries its own authority sentence,
 * in that register's own words. Registers retired with their prototypes are
 * listed by name only, so their absence is explained rather than silent.
 */
const DANGER_CARD_CLASS =
  "grid gap-1 rounded-xl border border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)] p-4";

function StatusPill({ status }: { status: HazardRow["status"] }) {
  const tone =
    status === "unmitigated"
      ? "border-[color:var(--danger)]/50 text-[color:var(--danger)]"
      : "border-[color:var(--border-strong)] text-[color:var(--text-muted)]";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${tone}`}>{statusLabel(status)}</span>;
}

function RegisterAuthority({ register, now }: { register: HazardRegister; now: Date }) {
  const reviewExpired = reviewExpiredAtPerth(register.reviewExpiresAt, now);
  return (
    <div className="grid gap-1">
      <p className={META_CLASS}>{register.scope}</p>
      {/*
       * The register's own authority sentence, quoted rather than summarised.
       * Paraphrasing it is how "static evidence only" becomes "checked".
       */}
      <p className={META_CLASS}>{register.authority}</p>
      <p className={META_CLASS}>
        {register.signedOff ? "Signed off." : "Not signed off by a clinician."}
        {register.sourcePath ? ` Source: ${register.sourcePath}.` : ""}
        {register.gate ? ` Checked by ${register.gate}.` : ""}
        {register.reviewExpiresAt
          ? ` Review ${reviewExpired ? "EXPIRED" : "expires"} ${register.reviewExpiresAt}.`
          : ""}
      </p>
    </div>
  );
}

function HazardCard({ hazard, now }: { hazard: HazardRow; now: Date }) {
  const reviewExpired = reviewExpiredAtPerth(hazard.reviewExpiresAt, now);
  return (
    <li className={hazard.status === "unmitigated" ? DANGER_CARD_CLASS : CARD_CLASS}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={MONO_CLASS}>{hazard.id}</span>
        <StatusPill status={hazard.status} />
      </div>
      {hazard.title ? (
        <p className="text-sm font-bold leading-6 text-[color:var(--text-heading)]">{hazard.title}</p>
      ) : null}
      {hazard.residualRisk ? (
        <p className="text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-bold">What it does not cover: </span>
          {hazard.residualRisk}
        </p>
      ) : null}
      <p className={META_CLASS}>
        {hazard.owner ? `Owner: ${hazard.owner}.` : "No owner recorded."}
        {typeof hazard.controlCount === "number" ? ` ${hazard.controlCount} control file(s),` : ""}
        {typeof hazard.testCount === "number" ? ` ${hazard.testCount} test(s).` : ""}
        {reviewExpired && hazard.reviewExpiresAt ? ` Review expired ${hazard.reviewExpiresAt}.` : ""}
      </p>
    </li>
  );
}

export default function DeveloperHazardsPage() {
  const snapshot = loadHazardSnapshot();
  const now = new Date();
  const freshness = resolveFreshnessFrom(snapshot.generatedAt, now);
  const unmitigated = unmitigatedHazards(snapshot);
  const missing = missingRegisters(snapshot);

  return (
    <PanelPageShell testId="developer-hazards" title="Hazard register" freshness={freshness} freshnessLabel="Hazards">
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        One clinical area has a live register; registers retired with their prototypes are listed at the end by name
        only. Nothing here is clinical assurance: a control existing in code says the rule runs, not that it is the
        right rule.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile
          testId="developer-hazards-count-unmitigated"
          value={snapshot.counts.unmitigated}
          label="hazards with no control"
        />
        <CountTile
          testId="developer-hazards-count-missing"
          value={snapshot.counts.registersMissing}
          label="areas with no register"
        />
        <CountTile
          testId="developer-hazards-count-unsigned"
          value={snapshot.counts.registersUnsigned}
          label="registers nobody signed"
        />
        <CountTile testId="developer-hazards-count-total" value={snapshot.counts.hazards} label="hazards recorded" />
      </div>

      {unmitigated.length > 0 ? (
        <PanelSection
          testId="developer-hazards-unmitigated"
          headingId="developer-hazards-unmitigated-heading"
          heading="Nothing controls these"
          className="grid gap-3 rounded-xl border border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)] px-4 py-4"
        >
          <p className="text-sm leading-6 text-[color:var(--text-heading)]">
            Each of these blocks a pilot with a real patient. None is a defect in the code, and no code change closes
            any of them — they are reviews and decisions people have to perform.
          </p>
          <ul className="grid gap-2">
            {unmitigated.map(({ register, hazard }) => (
              <li key={`${register.id}-${hazard.id}`} className="text-sm leading-6 text-[color:var(--text-heading)]">
                <span className={MONO_CLASS}>{hazard.id}</span> {hazard.title}
                <span className={META_CLASS}>
                  {" "}
                  — {register.name}, owner: {hazard.owner ?? "nobody"}
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      {missing.map((register) => (
        <PanelSection
          key={register.id}
          testId={`developer-hazards-missing-${register.id}`}
          headingId={`developer-hazards-missing-${register.id}-heading`}
          heading={`${register.name} — no register exists`}
          className="grid gap-3 rounded-xl border border-[color:var(--danger)]/40 px-4 py-4"
        >
          {/*
           * An absent register renders as a finding, never as an empty section.
           * A heading with nothing under it reads as "no hazards", which is the
           * exact opposite of what is true here.
           */}
          <p className="text-sm leading-6 text-[color:var(--text-heading)]">{register.authority}</p>
          {register.ledgerMentions && register.ledgerMentions.length > 0 ? (
            <>
              <p className={META_CLASS}>
                The blocking ledger rows naming {register.name} are below. They are the only writing that exists — not a
                register, and not a complete list of this area&rsquo;s hazards.
              </p>
              <ul className="grid gap-2">
                {register.ledgerMentions.map((mention) => (
                  <li key={mention.id} className="text-sm leading-6 text-[color:var(--text-heading)]">
                    <span className={MONO_CLASS}>{mention.id}</span> {mention.summary}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </PanelSection>
      ))}

      {snapshot.registers
        .filter((register) => register.exists)
        .map((register) => (
          <PanelSection
            key={register.id}
            testId={`developer-hazards-register-${register.id}`}
            headingId={`developer-hazards-register-${register.id}-heading`}
            heading={register.name}
          >
            <RegisterAuthority register={register} now={now} />
            <p className={META_CLASS}>
              {statusBreakdown(register)
                .map((entry) => `${entry.count} ${statusLabel(entry.status).toLowerCase()}`)
                .join(" · ")}
            </p>
            {register.openAssuranceDecisions.length > 0 ? (
              <p className={META_CLASS}>
                Open assurance decisions: {register.openAssuranceDecisions.map((decision) => decision.id).join(", ")}.
              </p>
            ) : null}
            <ul className="grid gap-2">
              {register.hazards.map((hazard) => (
                <HazardCard key={hazard.id} hazard={hazard} now={now} />
              ))}
            </ul>
          </PanelSection>
        ))}

      {snapshot.retired && snapshot.retired.length > 0 ? (
        <PanelSection
          testId="developer-hazards-retired"
          headingId="developer-hazards-retired-heading"
          heading="Retired registers"
        >
          <ul className="grid gap-2">
            {snapshot.retired.map((entry) => (
              <li key={entry.name} className={META_CLASS}>
                {entry.name} — retired {entry.retiredAt}: {entry.status}.
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
      <PanelSection
        testId="developer-hazards-document-cautions"
        headingId="developer-hazards-document-cautions-heading"
        heading="Known errors in source documents"
      >
        <p className="text-sm leading-6 text-[color:var(--text-muted)]">
          Errors in a source document itself, which re-indexing cannot fix. Each keeps its caution on every answer that
          cites the document. The wording says &ldquo;appears&rdquo; because the caution asks the reader to check, it
          does not correct the source.
        </p>
        <ul className="grid gap-2">
          {DOCUMENT_CAUTIONS.map((caution) => (
            <li
              key={caution.id}
              data-testid={`developer-hazards-document-caution-${caution.id}`}
              className={CARD_CLASS}
            >
              <p className="text-sm leading-6 text-[color:var(--text-heading)]">{caution.message}</p>
              <p className="text-sm leading-6 text-[color:var(--text-heading)]">
                <span className="font-bold">Decision:</span> {caution.decision}
              </p>
              <p className={META_CLASS}>
                <span className={MONO_CLASS}>{caution.ledger}</span> · recorded {caution.recordedOn}
              </p>
            </li>
          ))}
        </ul>
      </PanelSection>
    </PanelPageShell>
  );
}
