"use client";

import { Info } from "lucide-react";

import { MissingValue } from "@/components/ui/missing-value";
import { cn, eyebrowText } from "@/components/ui-primitives";

import { type CalculatorFixture } from "./calculator-fixtures";
import { partitionEvidenceSources, type CalculatorEvidenceSource } from "./calculator-evidence";
import { actionsForBand } from "./calculator-pathways";
import {
  BandLegend,
  CopyResultButton,
  FlagNotice,
  ResetButton,
  ScoreBandBar,
  SeverityPill,
  progressLabel,
  type DerivedCalculator,
} from "./calculator-ui";

/* ---------- detail view: score-linked panels ---------- */

function EvidenceLinkList({ sources }: { sources: CalculatorEvidenceSource[] }) {
  return (
    <>
      {sources.map((source, sourceIndex) => (
        <span key={source.id}>
          {sourceIndex ? ", " : null}
          <a href={source.url} className="underline underline-offset-2">
            {source.title}
          </a>
        </span>
      ))}
    </>
  );
}

/**
 * The governance reference is named, not linked (owner decision 2026-09-25,
 * #XSZ4XV): its target is a private engineering record a clinician cannot open,
 * so a link would only lead to a sign-in wall.
 */
function GovernanceReferenceList({ sources }: { sources: CalculatorEvidenceSource[] }) {
  return <>{sources.map((source) => source.title).join(", ")}</>;
}

/**
 * The internal governance record rides on every instrument's `sourceIds`, so it
 * would otherwise print beside a validation study as clinical evidence. It is
 * kept, as plain text, under its own label.
 */
function ActionEvidenceLines({ sourceIds }: { sourceIds: string[] }) {
  const { clinical, governance } = partitionEvidenceSources(sourceIds);
  if (!clinical.length && !governance.length) return null;

  return (
    <>
      {clinical.length ? (
        <span className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          Sources: <EvidenceLinkList sources={clinical} />
        </span>
      ) : null}
      {governance.length ? (
        <span className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          Governance reference: <GovernanceReferenceList sources={governance} />
        </span>
      ) : null}
    </>
  );
}

export function NextActionsPanel({ calc, derived }: { calc: CalculatorFixture; derived: DerivedCalculator }) {
  const actions = actionsForBand(calc, derived);

  return (
    <section
      aria-label="Clinical considerations"
      className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn(eyebrowText, "text-[color:var(--text-muted)]")}>Clinical considerations</h2>
      </div>

      <FlagNotice flags={derived.flags} provisional={!derived.complete} />

      {!derived.complete ? (
        <p className="rounded-md bg-[color:var(--surface-inset)] p-2.5 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
          Answer every item before source-linked clinical considerations are shown.
        </p>
      ) : (
        <>
          <ol className="grid gap-2">
            {actions.map((action, actionIndex) => (
              <li key={action.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] font-mono text-2xs font-bold text-[color:var(--clinical-accent)]">
                  {actionIndex + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm-minus font-semibold leading-5 text-[color:var(--text-heading)]">
                    {action.label}
                  </span>
                  <ActionEvidenceLines sourceIds={action.sourceIds} />
                </span>
              </li>
            ))}
          </ol>
          {derived.band ? (
            <p className="flex flex-wrap items-center gap-1.5 border-t border-[color:var(--border)] pt-2.5 text-2xs font-semibold text-[color:var(--text-muted)]">
              Completed result:
              <SeverityPill tone={derived.result.tone} label={derived.result.label} />— updates automatically as the
              score changes.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ScorePanel({
  calc,
  derived,
  onReset,
}: {
  calc: CalculatorFixture;
  derived: DerivedCalculator;
  onReset: () => void;
}) {
  const { clinical: evidenceSources, governance: governanceSources } = partitionEvidenceSources(calc.sourceIds);

  return (
    <section
      aria-label="Score"
      className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)]"
    >
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className={cn(eyebrowText, "text-[color:var(--text-muted)]")}>Score</p>
          {/* Unstarted is not a missing score: no score exists yet, so the fraction has no numerator. The scale's own
              endpoints stay visible in the ScoreBandBar directly below. */}
          {derived.started ? (
            <p className="font-mono text-2xl font-extrabold tabular-nums leading-8 text-[color:var(--text-heading)]">
              {derived.score}
              <span className="text-sm font-bold text-[color:var(--text-muted)]"> / {calc.maxScore}</span>
            </p>
          ) : (
            <p>
              <MissingValue reason="not_yet_calculated" />
            </p>
          )}
        </div>
        <SeverityPill tone={derived.result.tone} label={derived.started ? derived.result.label : "Not started"} />
      </div>
      <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
      <p className="text-2xs font-semibold leading-4 text-[color:var(--text-muted)]">{progressLabel(derived)}</p>
      <BandLegend calc={calc} activeBand={derived.started ? derived.band : undefined} />
      <div className="grid gap-2 border-t border-[color:var(--border)] pt-3">
        <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          <Info className="mt-0.5 size-icon-xs shrink-0 text-[color:var(--decoration-soft)]" aria-hidden="true" />
          {calc.scoringNote}
        </p>
        <div className="flex items-center justify-between gap-2">
          <CopyResultButton calc={calc} state={derived} />
          <ResetButton onReset={onReset} disabled={!derived.started} />
        </div>
        {evidenceSources.length ? (
          <p className="text-3xs font-semibold text-[color:var(--text-muted)]">
            Sources: <EvidenceLinkList sources={evidenceSources} />
          </p>
        ) : null}
        {governanceSources.length ? (
          <p className="text-3xs font-semibold text-[color:var(--text-muted)]">
            Governance reference: <GovernanceReferenceList sources={governanceSources} />
          </p>
        ) : null}
        {calc.disclaimer ? (
          <p className="text-2xs font-medium leading-4 text-[color:var(--text-muted)]">{calc.disclaimer}</p>
        ) : null}
      </div>
    </section>
  );
}
