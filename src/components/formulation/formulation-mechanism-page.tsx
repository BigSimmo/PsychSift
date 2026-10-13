import Link from "next/link";
import { ArrowRight, Check, ChevronDown, GitCompareArrows, ListChecks } from "lucide-react";

import {
  EvidenceList,
  FormulationPageShell,
  FormulationSafetyNote,
  MechanismBadge,
  MechanismDomainChips,
  RecordReviewBadge,
  RecordReviewNote,
  SectionHeading,
} from "@/components/formulation/formulation-ui";
import {
  compareRecordsHref,
  RecordBody,
  RecordBulletList,
  RecordCautions,
  RecordGlance,
  RecordIntro,
  RecordSection,
} from "@/components/clinical-record-panels";
import { FormulationNavHeader } from "@/components/formulation/formulation-nav-header";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { buttonFaceClass } from "@/components/ui/button-face";
import { cn } from "@/components/ui-primitives";
import { formulationSourceLibrary, relatedFormulationMechanisms, type FormulationMechanism } from "@/lib/formulation";
import { mechanismReviewState } from "@/lib/formulation-review-status";

function FactorColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <h3 className="m-0 text-base font-bold text-[color:var(--text-heading)]">{title}</h3>
      <ul className="m-0 mt-2 grid list-none gap-2 p-0 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--clinical-accent)]" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FormulationMechanismPage({ mechanism }: { mechanism: FormulationMechanism }) {
  const related = relatedFormulationMechanisms(mechanism);
  const primaryRelated = related[0];
  const reviewState = mechanismReviewState(mechanism);
  const sources = mechanism.sources
    .map((sourceId) => formulationSourceLibrary[sourceId])
    .filter((source): source is NonNullable<typeof source> => Boolean(source));

  return (
    <>
      <FormulationNavHeader
        title={mechanism.name}
        actions={
          <div className="grid gap-2">
            <Link
              href={compareRecordsHref("/formulation/compare", mechanism.id, primaryRelated?.id)}
              className={inPageActionRowClass}
            >
              <GitCompareArrows className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Compare
            </Link>
            <Link href={`/formulation/builder?mechanism=${mechanism.id}`} className={inPageActionRowClass}>
              <ListChecks className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Use in formulation
            </Link>
          </div>
        }
      />
      <FormulationPageShell>
        <RecordBody>
          <section id="formulation-overview" className={inPageAnchor}>
            <RecordIntro
              eyebrow="Formulation mechanism"
              title={mechanism.name}
              line={mechanism.definition}
              tags={
                <>
                  <MechanismBadge />
                  <RecordReviewBadge state={reviewState} />
                  <MechanismDomainChips values={mechanism.domains} />
                </>
              }
              actions={
                <Link
                  href={compareRecordsHref("/formulation/compare", mechanism.id, primaryRelated?.id)}
                  className={buttonFaceClass({ variant: "secondary" })}
                >
                  <GitCompareArrows className="h-4 w-4 shrink-0" aria-hidden />
                  Compare
                </Link>
              }
            />
          </section>

          <RecordGlance
            id="formulation-what-matters-now"
            titleId="formulation-what-matters-now-label"
            facts={[
              { label: "Core process", value: mechanism.coreProcess, wide: true },
              { label: "Maintaining cycle", value: mechanism.maintainingCycles[0], wide: true },
              { label: "Patient language", value: `“${mechanism.patientPhrases[0]}”`, wide: true },
              { label: "Treatment leverage", value: mechanism.treatmentLeverage, wide: true },
            ]}
          />

          {/* The record's own caveats, directly after At a glance and in full:
              the limits that belong to this mechanism, not a generic note. */}
          {mechanism.caveats.length ? (
            <RecordCautions title={<span id="formulation-caveats-label">Caveats for this record</span>}>
              <RecordBulletList items={mechanism.caveats} tone="warning" />
            </RecordCautions>
          ) : null}

          <section id="formulation-fit" className={cn(inPageAnchor, "flex min-w-0 flex-col gap-7")}>
            <SectionHeading
              eyebrow="Fit, function, and alternatives"
              title="Test the mechanism against the case"
              body="Use sequence, function, patient language, and disconfirming evidence to decide whether this hypothesis adds explanatory value."
            />
            <RecordSection title="When this fits" headingLevel="h3">
              <RecordBulletList items={mechanism.fitIndicators} />
            </RecordSection>
            <RecordSection title="When this may not fit" headingLevel="h3">
              <RecordBulletList items={mechanism.poorFitIndicators} />
            </RecordSection>
            <RecordSection title="Clinical clues" headingLevel="h3">
              <RecordBulletList items={mechanism.clinicalClues} />
            </RecordSection>
            <RecordSection title="Patient language" headingLevel="h3">
              <RecordBulletList items={mechanism.patientPhrases.map((item) => `“${item}”`)} />
            </RecordSection>
          </section>

          <RecordSection id="formulation-five-ps" title="Predisposing, precipitating, and perpetuating factors">
            <div className="grid gap-5 md:grid-cols-3">
              <FactorColumn title="Predisposing" items={mechanism.predisposing} />
              <FactorColumn title="Precipitating" items={mechanism.precipitating} />
              <FactorColumn title="Perpetuating" items={mechanism.perpetuating} />
            </div>
          </RecordSection>

          <RecordSection title="Short case example">
            <p className="m-0 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{mechanism.caseExample}</p>
          </RecordSection>

          <RecordSection title="Formulation language">
            <p className="m-0 text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
              {mechanism.exampleSentence}
            </p>
          </RecordSection>

          <RecordSection id="formulation-treatment" title="Translate the hypothesis into a testable target">
            <ul className="m-0 grid list-none gap-2 p-0 text-sm font-medium leading-6 text-[color:var(--text-muted)] sm:grid-cols-2">
              {mechanism.treatmentImplications.map((item) => (
                <li key={item} className="flex gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-[color:var(--success)]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <p className="m-0 mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
              {mechanism.treatmentTargetExample}
            </p>
          </RecordSection>

          {/* Whether anyone has checked what the mechanism does. */}
          <RecordReviewNote state={reviewState} />

          <RecordSection title="Quick reference">
            <dl className="m-0 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
              {[
                ["Common symptoms", mechanism.symptoms.slice(0, 4).join(" · ")],
                ["Clinical contexts", mechanism.diagnosticContexts.slice(0, 3).join(" · ")],
                ["Development", mechanism.development],
                ["Formulation use", mechanism.formulationUse],
              ].map(([label, body]) => (
                <div key={label} className="py-3">
                  <dt className="text-sm font-bold text-[color:var(--text-heading)]">{label}</dt>
                  <dd className="m-0 mt-1 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{body}</dd>
                </div>
              ))}
            </dl>
          </RecordSection>

          <RecordSection title="Add to a draft">
            <p className="m-0 text-base font-bold leading-7 text-[color:var(--text-heading)]">
              {mechanism.exampleSentence}
            </p>
            <Link
              href={`/formulation/builder?mechanism=${mechanism.id}`}
              className={cn(buttonFaceClass({ variant: "primary", block: true }), "mt-3")}
            >
              Use in formulation
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </RecordSection>

          {related.length ? (
            <RecordSection title="Compare next">
              <div className="divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
                {related.map((item) => (
                  <Link
                    key={item.id}
                    href={compareRecordsHref("/formulation/compare", mechanism.id, item.id)}
                    className="flex min-h-14 items-center justify-between gap-3 py-2.5 text-sm font-semibold text-[color:var(--text-heading)] hover:text-[color:var(--clinical-accent)]"
                  >
                    {item.name}
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                  </Link>
                ))}
              </div>
            </RecordSection>
          ) : null}

          {sources.length ? (
            <details className="group border-y border-[color:var(--border)]">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                <span className="flex-1 text-lg font-bold tracking-tight text-[color:var(--text-heading)]">
                  Evidence notes
                </span>
                <ChevronDown
                  className="h-4 w-4 text-[color:var(--decoration-soft)] transition group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="grid gap-2 pb-4">
                {sources.map((source) => (
                  <a
                    key={source.id}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold leading-6 text-[color:var(--clinical-accent)] hover:underline"
                  >
                    {source.title}
                  </a>
                ))}
                {/* The citations the 2026-09-16 patch set attached to this
                    record's definition and candidate process, rendered where
                    the claim is rather than as Markdown inside a text field. */}
                <EvidenceList evidence={mechanism.evidence} label="Teaching" reviewed={reviewState.reviewed} />
                <p className="mt-1 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
                  Teaching references only. Check current local guidance and clinical applicability.
                </p>
              </div>
            </details>
          ) : null}

          <FormulationSafetyNote id="formulation-evidence" className={inPageAnchor} />
        </RecordBody>
      </FormulationPageShell>
    </>
  );
}
