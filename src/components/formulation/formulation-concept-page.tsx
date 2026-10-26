import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CircleHelp,
  ListChecks,
  Network,
  Route,
  ShieldAlert,
  Waypoints,
} from "lucide-react";

import { InformationPageHeader } from "@/components/information-page-shell";
import {
  EvidenceList,
  FormulationPageShell,
  FormulationSafetyNote,
  MechanismCaveats,
  MechanismDomainChips,
  RecordReviewBadge,
  RecordReviewNote,
  SectionHeading,
  formulationCard,
} from "@/components/formulation/formulation-ui";
import { FormulationNavHeader } from "@/components/formulation/formulation-nav-header";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import {
  formulationConceptGroup,
  formulationConceptsInGroup,
  type FormulationConcept,
  type FormulationGuide,
  type FormulationGuideSpan,
  publishedFormulationGuides,
} from "@/lib/formulation-concepts";
import { conceptReviewState } from "@/lib/formulation-review-status";

function Prose({ label, body }: { label: string; body: string | null }) {
  if (!body) return null;
  return (
    <div className="px-4 py-3 sm:px-5">
      <p className={eyebrowText}>{label}</p>
      <p className="mt-1.5 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{body}</p>
    </div>
  );
}

function Spans({ spans }: { spans: FormulationGuideSpan[] }) {
  return (
    <>
      {spans.map((span, index) =>
        span.strong ? (
          <strong key={index} className="font-extrabold text-[color:var(--text-heading)]">
            {span.text}
          </strong>
        ) : span.citation ? (
          <sup key={index} className="ml-0.5 font-bold text-[color:var(--clinical-accent)]">
            <a
              href={`#evidence-${span.citation}`}
              className="text-[color:var(--clinical-accent)] hover:underline"
              aria-label={`Jump to evidence ${span.citation}`}
            >
              {span.citation}
            </a>
          </sup>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Detail view for the 46 contextual concepts and six guide modules.
 *
 * Deliberately not the mechanism template: a concept such as housing
 * instability has no maintaining loop, no patient-phrase list and no treatment
 * leverage, and rendering empty mechanism panels for it would imply the record
 * is incomplete rather than a different kind of record.
 */
export function FormulationConceptPage({ record }: { record: FormulationConcept | FormulationGuide }) {
  const isGuide = "blocks" in record;
  const group = isGuide ? undefined : formulationConceptGroup(record.group);
  const siblings = group ? formulationConceptsInGroup(group.id).filter((item) => item.id !== record.id) : [];
  const reviewState = conceptReviewState(record);

  return (
    <>
      <FormulationNavHeader
        title={record.title}
        actions={
          <div className="grid gap-2">
            <Link href="/formulation/search" className={inPageActionRowClass}>
              <Network className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Back to search
            </Link>
            <Link href="/formulation/builder" className={inPageActionRowClass}>
              <ListChecks className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Open the builder
            </Link>
          </div>
        }
      />
      <FormulationPageShell>
        <section
          id="formulation-overview"
          className={cn(inPageAnchor, "grid gap-5 border-b border-[color:var(--border)] pb-5")}
        >
          <InformationPageHeader
            eyebrow={isGuide ? "Formulation guide" : (group?.label ?? "Formulation concept")}
            title={record.title}
            // A guide module whose opening paragraph is a table has no usable
            // one-line summary, so its summary falls back to its own title.
            // Repeating that under the heading says nothing.
            subtitle={record.summary === record.title ? undefined : record.summary}
            icon={isGuide ? Route : Waypoints}
            badges={
              <>
                <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2 text-xs font-bold text-[color:var(--text-muted)]">
                  {record.kind === "clinical_guide_module" ? "Guide module" : record.kind}
                </span>
                <RecordReviewBadge state={reviewState} />
                <MechanismDomainChips values={record.domains} />
              </>
            }
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="grid min-w-0 gap-5">
            {isGuide ? (
              <section
                id="formulation-guide-body"
                className={cn(formulationCard, inPageAnchor, "grid gap-3 p-4 sm:p-5")}
              >
                {record.blocks.map((block, index) =>
                  block.kind === "heading" ? (
                    <h2
                      key={index}
                      className="mt-2 text-base font-extrabold text-[color:var(--text-heading)] first:mt-0"
                    >
                      {block.text}
                    </h2>
                  ) : block.kind === "paragraph" ? (
                    <p key={index} className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                      <Spans spans={block.spans} />
                    </p>
                  ) : (
                    <ul
                      key={index}
                      className="grid gap-1.5 text-sm font-medium leading-6 text-[color:var(--text-muted)]"
                    >
                      {block.items.map((item, itemIndex) => (
                        <li key={itemIndex} className="flex gap-2">
                          <span
                            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--clinical-accent)]"
                            aria-hidden
                          />
                          <span>
                            <Spans spans={item} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ),
                )}
              </section>
            ) : (
              <>
                <SectionHeading
                  eyebrow="Fit, function and alternatives"
                  title="Test this factor against the case"
                  body="A contextual factor earns a place in the formulation when case evidence links it to the presentation, not because it is present."
                />
                <section
                  id="formulation-fit"
                  className={cn(formulationCard, inPageAnchor, "divide-y divide-[color:var(--border)] overflow-hidden")}
                >
                  <Prose label="When this applies" body={record.whenApplies} />
                  <Prose label="Candidate process" body={record.candidateLoop} />
                  <Prose label="Ask" body={record.clinicalQuestion} />
                  <Prose label="Check alternatives" body={record.alternatives ?? record.whenDoesNotApply} />
                  <Prose label="Clinical implication" body={record.actions} />
                  <Prose label="Next steps" body={record.nextSteps} />
                </section>
              </>
            )}

            {record.qualification ? (
              <section className={cn(formulationCard, "grid gap-2 p-4 sm:p-5")}>
                <div className="flex items-center gap-2 text-[color:var(--clinical-accent)]">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                  <p className={eyebrowText}>Qualification</p>
                </div>
                <p className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">{record.qualification}</p>
              </section>
            ) : null}

            <MechanismCaveats items={record.warnings} />
            <RecordReviewNote state={reviewState} />
          </div>

          <aside aria-label="Record status" className="grid content-start gap-4 xl:sticky xl:top-20">
            <section className={cn(formulationCard, "overflow-hidden")}>
              <div className="border-b border-[color:var(--border)] px-4 py-3">
                <p className={eyebrowText}>Record status</p>
              </div>
              <dl className="divide-y divide-[color:var(--border)]">
                {[
                  ["Record type", record.kind === "clinical_guide_module" ? "Clinical guide module" : record.kind],
                  ["Population", record.population],
                  // Was a hardcoded sentence, so it would have kept asserting
                  // "no named reviewer" on a record that had one. It reads the
                  // same review state as the badge and the note now.
                  ["Review", reviewState.label],
                ]
                  .filter((row): row is [string, string] => Boolean(row[1]))
                  .map(([label, body]) => (
                    <div key={label} className="px-4 py-3">
                      <dt className="text-xs font-extrabold text-[color:var(--text-heading)]">{label}</dt>
                      <dd className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">{body}</dd>
                    </div>
                  ))}
              </dl>
            </section>

            {record.evidence.length ? (
              <section className={cn(formulationCard, "overflow-hidden")}>
                <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-3">
                  <BookOpenCheck className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                  <p className={eyebrowText}>Evidence</p>
                </div>
                <div className="p-4">
                  <EvidenceList evidence={record.evidence} reviewed={reviewState.reviewed} />
                </div>
              </section>
            ) : null}

            {siblings.length ? (
              <section className={cn(formulationCard, "overflow-hidden")}>
                <div className="border-b border-[color:var(--border)] px-4 py-3">
                  <p className={eyebrowText}>{group?.label}</p>
                </div>
                <div className="divide-y divide-[color:var(--border)]">
                  {siblings.slice(0, 6).map((item) => (
                    <Link
                      key={item.id}
                      href={`/formulation/${item.id}`}
                      className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 text-sm font-bold text-[color:var(--text-heading)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]"
                    >
                      {item.title}
                      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className={cn(formulationCard, "overflow-hidden")} data-formulation-guide-nav>
              <div className="border-b border-[color:var(--border)] px-4 py-3">
                <p className={eyebrowText}>Guide modules</p>
              </div>
              <div className="divide-y divide-[color:var(--border)]">
                {publishedFormulationGuides
                  .filter((guide) => guide.id !== record.id)
                  .map((guide) => (
                    <Link
                      key={guide.id}
                      href={`/formulation/${guide.id}`}
                      className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 text-sm font-bold text-[color:var(--text-heading)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]"
                    >
                      {guide.title}
                      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                    </Link>
                  ))}
              </div>
            </section>

            <section className={cn(formulationCard, "grid gap-2 p-4")}>
              <div className="flex items-center gap-2 text-[color:var(--text-muted)]">
                <CircleHelp className="h-4 w-4 shrink-0" aria-hidden />
                <p className={eyebrowText}>How to use this</p>
              </div>
              <p className="text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                Record the case evidence yourself. Nothing here is a patient finding, and no factor becomes a cause
                because it appears in the formulation.
              </p>
            </section>
          </aside>
        </div>

        <FormulationSafetyNote id="formulation-evidence" className={inPageAnchor} />
      </FormulationPageShell>
    </>
  );
}
