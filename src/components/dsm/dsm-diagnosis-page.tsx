import Link from "next/link";
import type { ComponentType } from "react";
import {
  BookOpenCheck,
  ChevronRight,
  Search,
  ClipboardList,
  GitCompareArrows,
  Gauge,
  ListChecks,
  ShieldCheck,
  Signpost,
  SlidersHorizontal,
} from "lucide-react";

import { CrossModeLinksSection } from "@/components/clinical-dashboard/cross-mode-links";
import { DsmDiagnosisNavHeader } from "@/components/dsm/dsm-diagnosis-nav-header";
import { DsmDiagnosisNoteBuilder } from "@/components/dsm/dsm-diagnosis-note-builder";
import { DsmPageHeader } from "@/components/dsm/dsm-page-header";
import { InformationPageShell } from "@/components/information-page-shell";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
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

/** One label/value pair in the at-a-glance row. Non-interactive by design. */
function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-[var(--shadow-inset)]">
      <dt className="flex items-center gap-1.5 text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1.5 text-xs font-semibold leading-5 text-[color:var(--text-heading)] sm:text-sm-minus">
        {value}
      </dd>
    </div>
  );
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
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-[color:var(--border)] px-3 py-3.5 last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:px-4">
      <span className="grid h-9 w-9 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-xs font-extrabold text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
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
      <InformationPageShell testId="dsm-diagnosis-page" width="bleed" className="pb-8">
        <ClinicalSplit
          listLabel="DSM diagnoses"
          testId="dsm-diagnosis-split"
          className="lg:mx-auto lg:w-full lg:max-w-[104rem] lg:px-6 lg:pt-5"
          list={<DesktopSplitList heading="Diagnoses by chapter" groups={dsmSplitGroups(diagnosis.slug)} />}
          detail={
            <>
              <DsmPageHeader
                className="lg:rounded-xl lg:border"
                eyebrow="Diagnosis information"
                title={diagnosis.title}
                description={
                  isDsmCriteria
                    ? "Core diagnostic criteria, specifiers, differential considerations, and documentation support in one open, scan-friendly view."
                    : "Key features, specifiers, differential considerations, and documentation support in one open, scan-friendly view. Full DSM-5-TR criteria are not included in this record."
                }
                code={diagnosis.icd_code}
                copyCode
                category={diagnosis.category.label}
                breadcrumb={false}
              />

              <div className={cn(pageContainer, "space-y-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-0 lg:pb-0")}>
                {/*
                The shape of the record, not its content. This row previously rendered
                `criteria.slice(0, 4)` verbatim, which the `#criteria` panel below already
                lists in full — so every diagnosis stated its criteria twice, the second
                time truncated. It also rendered `min(criteria.length, 4)` cards, and only
                86 of 146 records carry four or more criteria, so the row was a ragged one
                to four tiles rather than a stable strip.

                Every field read here is populated on all 146 records, so this is always
                exactly four tiles. `icd_code` and the category are deliberately absent:
                the page header already carries both as chips, and repeating them would be
                the same defect in a new place.
              */}
                <section aria-label="At a glance" className="grid gap-2.5">
                  <dl className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                    <SummaryTile
                      icon={ListChecks}
                      label={isDsmCriteria ? "Criteria" : "Key features"}
                      value={criteriaSummary}
                    />
                    <SummaryTile
                      icon={SlidersHorizontal}
                      label="Specifiers"
                      value={countLabel(specifiers.length, "specifier", "specifiers")}
                    />
                    <SummaryTile
                      icon={GitCompareArrows}
                      label="Differentials"
                      value={countLabel(diagnosis.differentials.length, "consideration", "considerations")}
                    />
                    <SummaryTile
                      icon={Gauge}
                      label="Severity specifier"
                      value={diagnosis.severity_specifier_supported ? "Supported" : "None in DSM-5-TR"}
                    />
                  </dl>
                </section>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
                  <div className="grid min-w-0 gap-4">
                    <section
                      id="criteria"
                      aria-labelledby="criteria-title"
                      className={cn(
                        inPageAnchor,
                        "overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e2)]",
                      )}
                    >
                      <div className="flex items-start gap-3 border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 sm:px-4">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                          <ListChecks className="h-5 w-5" aria-hidden />
                        </span>
                        <div>
                          <h2 id="criteria-title" className="text-base font-extrabold text-[color:var(--text-heading)]">
                            {isDsmCriteria ? "Core diagnostic criteria" : "Key features"}
                          </h2>
                          <p className="mt-0.5 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                            {isDsmCriteria
                              ? "All criteria are shown. No expand controls or hidden sections."
                              : "The full DSM-5-TR criteria are not included in this record. Everything the record does hold is shown below. Check DSM-5-TR before recording the diagnosis."}
                          </p>
                        </div>
                      </div>
                      {criteria.length ? (
                        <ol>
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
                        <p className="px-4 py-5 text-sm font-medium text-[color:var(--text-muted)]">
                          Neither criteria nor key features were included in the supplied record. This is not a
                          statement that DSM-5-TR defines none.
                        </p>
                      )}
                    </section>

                    {diagnosis.key_features.length > 0 && diagnosis.criteria_display.length > 0 ? (
                      <section
                        id="key-features"
                        aria-labelledby="key-features-title"
                        className={cn(
                          inPageAnchor,
                          "rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Signpost className="h-5 w-5 text-[color:var(--clinical-accent)]" aria-hidden />
                          <h2
                            id="key-features-title"
                            className="text-base font-extrabold text-[color:var(--text-heading)]"
                          >
                            Key features
                          </h2>
                        </div>
                        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                          {diagnosis.key_features.map((feature) => (
                            <li
                              key={`${feature.label}-${feature.text}`}
                              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2.5 text-sm font-medium leading-6 text-[color:var(--text-heading)]"
                            >
                              <strong className="mr-1.5 text-[color:var(--clinical-accent)]">{feature.label}.</strong>
                              {feature.text}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    <section
                      id="specifiers"
                      aria-labelledby="specifiers-title"
                      className={cn(
                        inPageAnchor,
                        "overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]",
                      )}
                    >
                      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-3">
                        <SlidersHorizontal className="h-5 w-5 text-[color:var(--clinical-accent)]" aria-hidden />
                        <h2 id="specifiers-title" className="text-base font-extrabold text-[color:var(--text-heading)]">
                          Specifiers
                        </h2>
                        <span className="ml-auto text-xs font-bold text-[color:var(--text-muted)]">
                          {specifiers.length}
                        </span>
                      </div>
                      {specifiers.length ? (
                        <dl className="divide-y divide-[color:var(--border)]">
                          {specifiers.map((specifier) => (
                            <div
                              key={`${specifier.name}-${specifier.description}`}
                              className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] sm:gap-4"
                            >
                              <dt className="text-sm font-extrabold text-[color:var(--text-heading)]">
                                {specifier.name}
                              </dt>
                              <dd className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                                {specifier.description || "No additional description supplied."}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <div className="px-4 py-4 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
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
                    </section>

                    <DsmDiagnosisNoteBuilder record={dsmNoteBuilderRecord(diagnosis)} />

                    {/* Renders nothing when no other mode holds a match for this
                      diagnosis, so a record with no medication, service or form
                      match keeps the page exactly as it was. */}
                    <CrossModeLinksSection queries={[diagnosis.title]} />
                  </div>

                  <aside className="grid gap-3 xl:sticky xl:top-20" aria-label="Diagnosis reference summary">
                    <section className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]">
                      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-3 py-2.5">
                        <GitCompareArrows className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                        <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">
                          Differential considerations
                        </h2>
                        {hiddenDifferentialCount > 0 ? (
                          <span className="ml-auto text-2xs font-bold text-[color:var(--text-muted)]">
                            {sidebarDifferentials.length} of {diagnosis.differentials.length}
                          </span>
                        ) : null}
                      </div>
                      <ul className="divide-y divide-[color:var(--border)]">
                        {sidebarDifferentials.map((differential) => {
                          const match = resolveDsmDifferential(differential);
                          const { name, discriminator } = dsmDifferentialParts(differential);

                          /*
                           * Every row is actionable, which it was not before. Rows that
                           * resolve to a record open it; the rest — "Medical cause
                           * (cardiac, respiratory, endocrine)" and its kind, which name
                           * a category rather than a DSM record — search for the name.
                           * Previously those rendered as inert text beside linked
                           * siblings with nothing to explain the difference, so the
                           * list looked half-broken rather than deliberate.
                           */
                          const href = match
                            ? `/dsm/diagnoses/${match.slug}`
                            : `/dsm/search?q=${encodeURIComponent(name)}&run=1`;

                          return (
                            <li key={differential} className="px-3 py-2.5">
                              <div className="flex items-start gap-1.5">
                                <Link
                                  href={href}
                                  className="group min-w-0 flex-1 text-xs font-semibold leading-5 text-[color:var(--text-heading)] hover:text-[color:var(--clinical-accent)]"
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
                                    <span className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
                                      {discriminator}
                                    </span>
                                  ) : null}
                                </Link>
                                {match ? (
                                  <Link
                                    href={`/dsm/compare?ids=${encodeURIComponent(diagnosis.slug)},${encodeURIComponent(match.slug)}`}
                                    aria-label={`Compare ${diagnosis.title} with ${name}`}
                                    title={`Compare with ${name}`}
                                    // A full tap target, not a 28px icon box: this is a
                                    // phone control in a dense list, where the row above
                                    // and below are other diagnoses. The glyph stays
                                    // small; the hit area is what has to be 48px.
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
                      <div className="border-t border-[color:var(--border)] p-2.5">
                        <Link
                          href={`/dsm/diagnoses/${diagnosis.slug}/differentials`}
                          className="inline-flex min-h-tap w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-xs font-extrabold text-[color:var(--clinical-accent)]"
                        >
                          Review all considerations
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </Link>
                      </div>
                    </section>

                    <section
                      id="record-summary"
                      className={cn(
                        inPageAnchor,
                        "rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-[var(--shadow-inset)]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                        <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">Record summary</h2>
                      </div>
                      {/*
                      Provenance, not counts. This card used to repeat Criteria,
                      Specifiers and Severity from the at-a-glance strip a screen
                      above it, and ICD-10 from the chip in the page header, so the
                      most valuable block in the sidebar said nothing the reader had
                      not already been told twice. What was genuinely only here — the
                      record id and the catalogue it came from — was stranded in the
                      footer pills, where nothing labelled it.
                    */}
                      <dl className="mt-3 grid gap-2.5 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="font-semibold text-[color:var(--text-muted)]">Category</dt>
                          <dd className="text-right font-extrabold text-[color:var(--text-heading)]">
                            {diagnosis.category.label}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="font-semibold text-[color:var(--text-muted)]">Record</dt>
                          <dd className={cn("text-right font-extrabold text-[color:var(--text-heading)]", codeText)}>
                            {diagnosis.record_id}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="font-semibold text-[color:var(--text-muted)]">Source</dt>
                          <dd className="text-right font-extrabold text-[color:var(--text-heading)]">
                            Supplied local catalogue
                          </dd>
                        </div>
                      </dl>
                    </section>

                    <p className="flex items-start gap-2 rounded-xl border border-[color:var(--info-border)] bg-[color:var(--info-soft)]/45 p-3 text-xs font-semibold leading-5 text-[color:var(--text-heading)]">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--info)]" aria-hidden />
                      Clinical reference aid only. Confirm the full assessment, exclusions, cultural context, and
                      current diagnostic standard.
                    </p>

                    <Link
                      href="/dsm/search"
                      className="inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-bold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)]"
                    >
                      <BookOpenCheck className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                      Browse diagnoses
                    </Link>
                  </aside>
                </div>

                {/* The record id and catalogue moved into the Record summary card,
                  which labels them. Repeating them here left the page ending on two
                  unlabelled pills that said the same thing. */}
                <div className="flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-4">
                  <span className={metadataPill}>DSM-5 Diagnosis</span>
                </div>
              </div>
            </>
          }
        />
      </InformationPageShell>
    </>
  );
}
