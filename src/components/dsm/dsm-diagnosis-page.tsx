import Link from "next/link";
import { BookOpenCheck, ChevronRight, Search, GitCompareArrows, ShieldCheck, Signpost } from "lucide-react";

import { CrossModeLinksSection } from "@/components/clinical-dashboard/cross-mode-links";
import { DsmDiagnosisNavHeader } from "@/components/dsm/dsm-diagnosis-nav-header";
import { DsmDiagnosisNoteBuilder } from "@/components/dsm/dsm-diagnosis-note-builder";
import { DsmCodeCopy } from "@/components/dsm/dsm-code-copy";
import { RecordBody, RecordGlance, RecordIntro, RecordSection } from "@/components/clinical-record-panels";
import { InformationPageShell } from "@/components/information-page-shell";
import { buttonFaceClass } from "@/components/ui/button-face";
import { inPageActionRowClass } from "@/components/in-page-nav/in-page-nav-classes";
import { cn, codeText, metadataPill, pageContainer } from "@/components/ui-primitives";
import { DesktopSplitList, type DesktopSplitGroup } from "@/components/work-frame/desktop-split-list";
import { ClinicalSplit } from "@/components/work-frame/work-desktop-layout";
import {
  dsmCategories,
  dsmCriteriaView,
  dsmDifferentialParts,
  dsmSpecifierSplit,
  dsmDiagnoses,
  resolveDsmDifferential,
  type DsmDiagnosis,
  type DsmLabeledText,
} from "@/lib/dsm";
import { dsmNoteBuilderRecord } from "@/lib/dsm-note";

/**
 * Explicit singular and plural rather than appending "s", because the one that
 * matters here is irregular: "1 criterion" / "4 criteria".
 *
 * The zero branch is unreachable in the shipped catalogue — criteria, specifiers
 * and differentials are each populated on all 146 records — but the JSON is a
 * vendored upstream snapshot, so a re-export could introduce one and "0 criteria"
 * would read as a rendering fault rather than as a fact about the record.
 */
function countLabel(count: number, singular: string, plural: string) {
  if (count === 0) return "None in this record";
  return `${count} ${count === 1 ? singular : plural}`;
}

function CriteriaRow({
  criterion,
  index,
  isDsmCriteria,
}: {
  criterion: DsmLabeledText;
  index: number;
  isDsmCriteria: boolean;
}) {
  const ordinal = criterion.label || index + 1;
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 py-3.5">
      <span className="nums mt-0.5 grid h-7 w-7 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-bold text-[color:var(--text-heading)]">
        {ordinal}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          {isDsmCriteria ? `Core criterion ${ordinal}` : `Key feature ${ordinal}`}
        </p>
        <p className="mt-1 text-sm font-medium leading-6 text-[color:var(--text-heading)]">{criterion.text}</p>
      </div>
    </li>
  );
}

/**
 * The desktop list beside the record (from 1024px; not drawn below it): every
 * diagnosis by chapter, in the catalogue's chapter order, A to Z inside each,
 * with template entries ("[Specific substance] ...") after the named ones.
 */
function dsmSplitGroups(currentSlug: string): DesktopSplitGroup[] {
  const all = dsmDiagnoses;
  const isTemplate = (title: string) => title.trimStart().startsWith("[");
  const byTitle = (left: { title: string }, right: { title: string }) => {
    if (isTemplate(left.title) !== isTemplate(right.title)) return isTemplate(left.title) ? 1 : -1;
    return left.title.localeCompare(right.title, "en", { sensitivity: "base" });
  };
  return dsmCategories
    .map((category) => ({
      key: category.key,
      label: category.label,
      items: all
        .filter((item) => item.category.key === category.key)
        .sort(byTitle)
        .map((item) => ({
          key: item.slug,
          href: `/dsm/diagnoses/${item.slug}`,
          title: item.title,
          meta: item.icd_code,
          current: item.slug === currentSlug,
        })),
    }))
    .filter((group) => group.items.length > 0);
}

export function DsmDiagnosisPage({ diagnosis }: { diagnosis: DsmDiagnosis }) {
  const { rows: criteria, isDsmCriteria } = dsmCriteriaView(diagnosis);
  const { specifiers, absentNotes } = dsmSpecifierSplit(diagnosis);
  const compareHref = `/dsm/compare?ids=${encodeURIComponent(diagnosis.slug)}`;

  // The sidebar shows the first six and links out for the rest. Nine records
  // carry more than six, and before this the extra ones simply vanished with no
  // sign that the list had been cut.
  const sidebarDifferentials = diagnosis.differentials.slice(0, 6);
  const hiddenDifferentialCount = diagnosis.differentials.length - sidebarDifferentials.length;

  // "4 criteria, A-D" / "1 criterion, A". Twelve records carry a single criterion,
  // so the range is appended only when there are at least two to span — otherwise
  // it would read "A-A". Labels fall back to the ordinal the list rows already use.
  //
  // 145 of the 146 records supply no `criteria_display`, so on all but Bipolar II
  // these rows are the record's key-feature summary. Calling that "4 criteria"
  // under a heading reading "Core diagnostic criteria / All criteria are shown"
  // stated the DSM-5-TR standard on the reader's behalf. The noun now follows the
  // provenance, and the summary itself is unchanged and still fully shown.
  const criteriaCountLabel = isDsmCriteria
    ? countLabel(criteria.length, "criterion", "criteria")
    : countLabel(criteria.length, "key feature", "key features");
  const firstCriterionLabel = criteria[0]?.label || "1";
  const lastCriterionLabel = criteria.at(-1)?.label || String(criteria.length);
  const criteriaSummary =
    criteria.length > 1
      ? `${criteriaCountLabel}, ${firstCriterionLabel}\u2013${lastCriterionLabel}`
      : criteria.length === 1
        ? `${criteriaCountLabel}, ${firstCriterionLabel}`
        : criteriaCountLabel;

  return (
    <>
      <DsmDiagnosisNavHeader
        title={diagnosis.title}
        criteriaLabel={isDsmCriteria ? "Criteria" : "Key features"}
        actions={
          <div className="grid gap-2">
            <Link href="/dsm/search" className={inPageActionRowClass}>
              <Search className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Search diagnoses
            </Link>
            <Link href={compareHref} className={inPageActionRowClass}>
              <GitCompareArrows className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Compare
            </Link>
            <Link href={`/dsm/diagnoses/${diagnosis.slug}/differentials`} className={inPageActionRowClass}>
              <Signpost className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Review all considerations
            </Link>
          </div>
        }
      />
      <InformationPageShell as="div" testId="dsm-diagnosis-page" width="bleed" className="pb-8">
        <ClinicalSplit
          listLabel="DSM diagnoses"
          testId="dsm-diagnosis-split"
          className="lg:mx-auto lg:w-full lg:max-w-[104rem] lg:px-6 lg:pt-5"
          list={<DesktopSplitList heading="Diagnoses by chapter" groups={dsmSplitGroups(diagnosis.slug)} />}
          detail={
            <>
              <div className={cn(pageContainer, "px-4 py-5 sm:px-6 sm:py-6 lg:px-0 lg:pb-0")}>
                <RecordBody className="mx-auto max-w-reading">
                  <RecordIntro
                    eyebrow="Diagnosis information"
                    title={diagnosis.title}
                    line={
                      isDsmCriteria
                        ? "Core diagnostic criteria, specifiers, differential considerations, and documentation support in one open, scan-friendly view."
                        : "Key features, specifiers, differential considerations, and documentation support in one open, scan-friendly view. Full DSM-5-TR criteria are not included in this record."
                    }
                    tags={
                      <>
                        <span className={metadataPill}>{diagnosis.category.label}</span>
                        <span className={metadataPill}>Local clinical reference</span>
                      </>
                    }
                    actions={
                      <>
                        <DsmCodeCopy code={diagnosis.icd_code} />
                        <Link href={compareHref} className={buttonFaceClass({ variant: "secondary" })}>
                          <GitCompareArrows className="h-4 w-4 shrink-0" aria-hidden />
                          Compare
                        </Link>
                      </>
                    }
                  />

                  {/*
                  The shape of the record, not its content: counts, never the
                  criteria themselves, which the section below lists in full.
                  Every field read here is populated on all 146 records. `icd_code`
                  and the category are deliberately absent: the intro already
                  carries both.
                */}
                  <RecordGlance
                    facts={[
                      { label: isDsmCriteria ? "Criteria" : "Key features", value: criteriaSummary, wide: false },
                      {
                        label: "Specifiers",
                        value: countLabel(specifiers.length, "specifier", "specifiers"),
                        wide: false,
                      },
                      {
                        label: "Differentials",
                        value: countLabel(diagnosis.differentials.length, "consideration", "considerations"),
                        wide: false,
                      },
                      {
                        label: "Severity specifier",
                        value: diagnosis.severity_specifier_supported ? "Supported" : "None in DSM-5-TR",
                        wide: false,
                      },
                    ]}
                  />

                  <RecordSection
                    id="criteria"
                    headingId="criteria-title"
                    title={isDsmCriteria ? "Core diagnostic criteria" : "Key features"}
                  >
                    <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">
                      {isDsmCriteria
                        ? "All criteria are shown. No expand controls or hidden sections."
                        : "The full DSM-5-TR criteria are not included in this record. Everything the record does hold is shown below. Check DSM-5-TR before recording the diagnosis."}
                    </p>
                    {criteria.length ? (
                      <ol className="m-0 mt-3 list-none divide-y divide-[color:var(--border)] border-y border-[color:var(--border)] p-0">
                        {criteria.map((criterion, index) => (
                          <CriteriaRow
                            key={`${criterion.label}-${criterion.text}`}
                            criterion={criterion}
                            index={index}
                            isDsmCriteria={isDsmCriteria}
                          />
                        ))}
                      </ol>
                    ) : (
                      <p className="m-0 mt-3 text-sm font-medium text-[color:var(--text-muted)]">
                        Neither criteria nor key features were included in the supplied record. This is not a statement
                        that DSM-5-TR defines none.
                      </p>
                    )}
                  </RecordSection>

                  {diagnosis.key_features.length > 0 && diagnosis.criteria_display.length > 0 ? (
                    <RecordSection id="key-features" headingId="key-features-title" title="Key features">
                      <ul className="m-0 grid list-none gap-2 p-0">
                        {diagnosis.key_features.map((feature) => (
                          <li
                            key={`${feature.label}-${feature.text}`}
                            className="text-sm font-medium leading-6 text-[color:var(--text-heading)]"
                          >
                            <strong className="mr-1.5 text-[color:var(--clinical-accent)]">{feature.label}.</strong>
                            {feature.text}
                          </li>
                        ))}
                      </ul>
                    </RecordSection>
                  ) : null}

                  <RecordSection
                    id="specifiers"
                    headingId="specifiers-title"
                    title="Specifiers"
                    action={
                      <span className="text-xs font-bold text-[color:var(--text-muted)]">{specifiers.length}</span>
                    }
                  >
                    {specifiers.length ? (
                      <dl className="m-0 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
                        {specifiers.map((specifier) => (
                          <div
                            key={`${specifier.name}-${specifier.description}`}
                            className="grid gap-1 py-3 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] sm:gap-4"
                          >
                            <dt className="text-sm font-bold text-[color:var(--text-heading)]">{specifier.name}</dt>
                            <dd className="m-0 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                              {specifier.description || "No additional description supplied."}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <div className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                        {absentNotes.length ? (
                          absentNotes.map((note) => (
                            <p key={note.name}>
                              <strong className="text-[color:var(--text-heading)]">{note.name}.</strong>
                              {note.description ? ` ${note.description}` : ""}
                            </p>
                          ))
                        ) : (
                          <p>No specifiers were included in the supplied record.</p>
                        )}
                      </div>
                    )}
                  </RecordSection>

                  <DsmDiagnosisNoteBuilder record={dsmNoteBuilderRecord(diagnosis)} />

                  {/* Differentials (compare-next), the record's provenance and the
                    reference notice close the record, the shared record order. */}
                  <div className="flex min-w-0 flex-col gap-7" role="group" aria-label="Diagnosis reference summary">
                    <RecordSection
                      title="Differential considerations"
                      action={
                        hiddenDifferentialCount > 0 ? (
                          <span className="text-2xs font-bold text-[color:var(--text-muted)]">
                            {sidebarDifferentials.length} of {diagnosis.differentials.length}
                          </span>
                        ) : null
                      }
                    >
                      <ul className="m-0 list-none divide-y divide-[color:var(--border)] border-y border-[color:var(--border)] p-0">
                        {sidebarDifferentials.map((differential) => {
                          const match = resolveDsmDifferential(differential);
                          const { name, discriminator } = dsmDifferentialParts(differential);

                          /*
                           * Every row is actionable. Rows that resolve to a record
                           * open it; the rest — "Medical cause (cardiac, respiratory,
                           * endocrine)" and its kind, which name a category rather
                           * than a DSM record — search for the name.
                           */
                          const href = match
                            ? `/dsm/diagnoses/${match.slug}`
                            : `/dsm/search?q=${encodeURIComponent(name)}&run=1`;

                          return (
                            <li key={differential} className="py-1.5">
                              <div className="flex items-center gap-1.5">
                                <Link
                                  href={href}
                                  className="group flex min-h-tap min-w-0 flex-1 flex-col justify-center text-sm font-semibold leading-5 text-[color:var(--text-heading)] hover:text-[color:var(--clinical-accent)]"
                                >
                                  <span className="flex items-start justify-between gap-2">
                                    <span className="min-w-0">{name}</span>
                                    {match ? (
                                      <ChevronRight
                                        className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] group-hover:text-[color:var(--clinical-accent)]"
                                        aria-hidden
                                      />
                                    ) : (
                                      <Search
                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--decoration-soft)] group-hover:text-[color:var(--clinical-accent)]"
                                        aria-hidden
                                      />
                                    )}
                                  </span>
                                  {discriminator ? (
                                    <span className="mt-0.5 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                                      {discriminator}
                                    </span>
                                  ) : null}
                                </Link>
                                {match ? (
                                  <Link
                                    href={`/dsm/compare?ids=${encodeURIComponent(diagnosis.slug)},${encodeURIComponent(match.slug)}`}
                                    aria-label={`Compare ${diagnosis.title} with ${name}`}
                                    title={`Compare with ${name}`}
                                    // A full tap target, not a 28px icon box: the glyph
                                    // stays small; the hit area is what has to be 48px.
                                    className="grid min-h-tap min-w-tap shrink-0 place-items-center rounded-md text-[color:var(--decoration-soft)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]"
                                  >
                                    <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
                                  </Link>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      <Link
                        href={`/dsm/diagnoses/${diagnosis.slug}/differentials`}
                        className={cn(buttonFaceClass({ variant: "secondary", block: true }), "mt-3")}
                      >
                        Review all considerations
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </RecordSection>

                    {/* Renders nothing when no other mode holds a match for this
                      diagnosis, so a record with no medication, service or form
                      match keeps the page exactly as it was. */}
                    <CrossModeLinksSection queries={[diagnosis.title]} />

                    {/* Provenance, not counts: the record id and the catalogue it
                      came from, labelled. */}
                    <RecordSection id="record-summary" title="Record summary">
                      <dl className="m-0 grid gap-2.5 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="font-medium text-[color:var(--text-muted)]">Category</dt>
                          <dd className="m-0 text-right font-semibold text-[color:var(--text-heading)]">
                            {diagnosis.category.label}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="font-medium text-[color:var(--text-muted)]">Record</dt>
                          <dd className={cn("m-0 text-right font-semibold text-[color:var(--text-heading)]", codeText)}>
                            {diagnosis.record_id}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="font-medium text-[color:var(--text-muted)]">Source</dt>
                          <dd className="m-0 text-right font-semibold text-[color:var(--text-heading)]">
                            Supplied local catalogue
                          </dd>
                        </div>
                      </dl>
                    </RecordSection>

                    <p className="m-0 flex items-start gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4 text-xs font-semibold leading-5 text-[color:var(--text-heading)]">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--info)]" aria-hidden />
                      Clinical reference aid only. Confirm the full assessment, exclusions, cultural context, and
                      current diagnostic standard.
                    </p>

                    <Link href="/dsm/search" className={buttonFaceClass({ variant: "secondary" })}>
                      <BookOpenCheck className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                      Browse diagnoses
                    </Link>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-4">
                    <span className={metadataPill}>DSM-5 Diagnosis</span>
                  </div>
                </RecordBody>
              </div>
            </>
          }
        />
      </InformationPageShell>
    </>
  );
}
