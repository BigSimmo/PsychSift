import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  FileCheck2,
  Info,
  Layers,
  ListChecks,
  ShieldAlert,
  Stethoscope,
  Tags,
} from "lucide-react";

import {
  CategoryTag,
  DiagnosisChips,
  DsmBadge,
  QuickTile,
  ReviewStatusBadge,
  SectionHeading,
  SpecifierPageShell,
  SpecifierSafetyNote,
  categoryShortName,
  specifierCard,
} from "@/components/specifiers/specifier-ui";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { InformationPageHeader } from "@/components/information-page-shell";
import { SpecifierNavHeader } from "@/components/specifiers/specifier-nav-header";
import { MissingValue } from "@/components/ui/missing-value";
import { cn, eyebrowText } from "@/components/ui-primitives";
import {
  curatedEnrichmentFor,
  isSpecifierClinicianReviewed,
  relatedCatalogItems,
  specifierClinicianReviewLabel,
  type SpecifierCatalogItem,
  type SpecifierDefinitionStatus,
  type SpecifierSourceStatus,
} from "@/lib/specifiers-content";
import { SPECIFIERS_REQUIRE_OPTION_REVIEW_BADGE } from "@/lib/specifiers-governance";

const definitionStatusLabel: Record<SpecifierDefinitionStatus, string> = {
  defined: "Generated clinical anchor",
  "obvious-no-definition": "Self-explanatory label",
  "needs-manual-or-clinician-verification": "Needs manual verification",
};

// Same wording as the ReviewStatusBadge: a checked source is not a clinician sign-off
// (audit S6), so this page must not call it "verified" or show it in the success tone.
const sourceStatusLabel: Record<SpecifierSourceStatus, string> = {
  "source-verified": "Source checked, not signed off",
  "source-needs-formal-review": "Needs formal source review",
  "source-not-applicable": "Source not applicable",
};

// The dataset spans DSM-5-TR and ICD-11/WHO material. Label the source badge from
// the item's own provenance rather than always claiming DSM-5-TR: the "ICD-11
// Specifics" category, an ICD-11/WHO source family, or an "(ICD-11)" disorder name
// all indicate ICD-11 content.
function sourceManualLabel(item: SpecifierCatalogItem): string {
  const family = item.definition?.sourceFamily ?? item.review.sourceFamily ?? "";
  if (item.categoryId === "icd" || /icd-11|who/i.test(family) || /\(icd-11\)/i.test(item.disorderName)) {
    return "ICD-11";
  }
  return "DSM-5-TR";
}

function InfoCard({
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(specifierCard, "grid gap-3 p-4 sm:p-5")}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className={eyebrowText}>{eyebrow}</p>
          <h2 className="mt-1 text-lg font-extrabold text-[color:var(--text-heading)]">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function ReasoningList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "success" | "warning" | "default";
}) {
  const dot =
    tone === "success"
      ? "bg-[color:var(--success)]"
      : tone === "warning"
        ? "bg-[color:var(--warning)]"
        : "bg-[color:var(--clinical-accent)]";
  return (
    <div className="grid gap-2">
      <p className="text-xs font-extrabold text-[color:var(--text-heading)]">{title}</p>
      <ul className="grid gap-2 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
        {items.map((entry) => (
          <li key={entry} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
            <span className={cn("mt-2 h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
            <span>{entry}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpecifierReferencePage({ item }: { item: SpecifierCatalogItem }) {
  const enrichment = curatedEnrichmentFor(item);
  const related = relatedCatalogItems(item);
  // Generated definition text is withheld for every row that has not been signed off —
  // including those whose SOURCE was verified. Automated review repeatedly found scattered
  // clinical errors among the "source-verified" generated definitions, so an unsigned
  // entry's meaning/clinical-note is never displayed as trusted; the page shows only the
  // specifier's structural facts (label, disorder, group, ICD-11 context), its review
  // status, and hand-authored curated guidance.
  //
  // The clinician sign-off (`npm run clinical:review -- --kind specifier`) exists to clear
  // exactly that: an entry that passes the fail-closed isSpecifierClinicianReviewed test
  // (status "clinician-reviewed" + named reviewer + parseable timestamp + nothing changed
  // since the sign-off) shows its
  // definition, attributed to the reviewer. The sign-off covers the definition and its
  // placement only, not the curated enrichment below, which keeps its own labelling. Every
  // "pending"/"reviewed" statement here reads the same helper, so a signed entry never
  // still reads as pending and an unsigned one never as reviewed.
  const clinicianReviewed = isSpecifierClinicianReviewed(item.review);
  const clinicianReviewLabel = specifierClinicianReviewLabel(item.review);
  // Only a real ("defined") definition is ever shown. The placeholder rows carry a stand-in
  // definition object that is not clinical content, and are not signable anyway.
  const reviewedDefinition = clinicianReviewed && item.definitionStatus === "defined" ? item.definition : null;
  const hasWithheldDefinition = Boolean(item.definition) && !reviewedDefinition;
  const sourceManual = sourceManualLabel(item);
  const description = reviewedDefinition
    ? `“${item.label}” is recorded for ${item.disorderName}; its definition below has been reviewed by a clinician — still confirm against the current DSM-5-TR / ICD-11 text.`
    : hasWithheldDefinition
      ? `“${item.label}” is recorded for ${item.disorderName}; its definition is pending qualified clinician verification — confirm against the current DSM-5-TR / ICD-11 text.`
      : `“${item.label}” is recorded for ${item.disorderName} without a separate definition — read it against the current ${sourceManual} text.`;

  return (
    <>
      <SpecifierNavHeader
        title={item.label}
        actions={
          // Both actions depend on curated enrichment. With none, no `actions`
          // is passed at all and the header renders no ellipsis control rather
          // than a button that opens an empty sheet.
          enrichment ? (
            <div className="grid gap-2">
              <Link href={`/specifiers/${enrichment.slug}`} className={inPageActionRowClass}>
                <BookOpenCheck className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                Deep guide
              </Link>
              <Link href={`/specifiers/builder?specifier=${enrichment.slug}`} className={inPageActionRowClass}>
                <ListChecks className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                Build wording
              </Link>
            </div>
          ) : null
        }
      />
      <SpecifierPageShell>
        {/* Hero */}
        <section
          id="specifier-overview"
          className={cn(inPageAnchor, "grid gap-5 border-b border-[color:var(--border)] pb-5")}
        >
          <InformationPageHeader
            eyebrow={`${categoryShortName(item.categoryName)} specifier`}
            title={item.label}
            subtitle={description}
            icon={Tags}
            badges={
              <>
                <DsmBadge label={sourceManual} />
                <span className="inline-flex min-h-6 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-inset)] px-2 text-2xs font-bold text-[color:var(--text-muted)]">
                  {item.groupLabel}
                </span>
                {SPECIFIERS_REQUIRE_OPTION_REVIEW_BADGE ? (
                  <ReviewStatusBadge status={item.review.sourceVerificationStatus} />
                ) : null}
                <CategoryTag categoryId={item.categoryId} name={item.categoryName} />
                <DiagnosisChips values={[item.disorderName]} />
              </>
            }
          />
        </section>

        {/* Quick tiles */}
        <section aria-label="At a glance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickTile icon={Stethoscope} label="Applies to" body={item.disorderName} tone="accent" />
          <QuickTile icon={Layers} label="Specifier group" body={item.groupLabel} />
          <QuickTile
            icon={FileCheck2}
            label="Definition"
            body={reviewedDefinition ? "Clinician-reviewed definition" : definitionStatusLabel[item.definitionStatus]}
            tone="info"
          />
          <QuickTile
            icon={item.review.sourceVerificationStatus === "source-verified" ? Info : ShieldAlert}
            label="Source status"
            body={sourceStatusLabel[item.review.sourceVerificationStatus]}
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="grid min-w-0 gap-5">
            <SectionHeading
              eyebrow="Reference"
              title="What this specifier records"
              body="Aide-memoire content for the specifier and how it sits within its diagnosis. Confirm against current DSM-5-TR / ICD-11 materials before documenting."
            />

            {reviewedDefinition ? (
              <InfoCard icon={BookOpenCheck} eyebrow="Definition" title="What this specifier means">
                <p className="text-sm font-medium leading-6 text-[color:var(--text-heading)]">
                  {reviewedDefinition.meaning}
                </p>
                {reviewedDefinition.clinicalNote ? (
                  <p className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                    {reviewedDefinition.clinicalNote}
                  </p>
                ) : null}
                <p className="text-xs font-bold leading-5 text-[color:var(--text-muted)]">{clinicianReviewLabel}</p>
              </InfoCard>
            ) : null}

            {hasWithheldDefinition ? (
              <InfoCard icon={ShieldAlert} eyebrow="At a glance" title="Definition pending verification">
                <p className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                  The generated definition for this specifier is withheld pending qualified clinician review. Confirm
                  the specifier against current DSM-5-TR / ICD-11 materials before documenting.
                </p>
              </InfoCard>
            ) : null}

            {enrichment ? (
              <section id="specifier-fit" className={cn(specifierCard, inPageAnchor, "grid gap-4 p-4 sm:p-5")}>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                    <Check className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className={eyebrowText}>Curated clinical reasoning</p>
                    <h2 className="mt-1 text-lg font-extrabold text-[color:var(--text-heading)]">Fit and exclusions</h2>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReasoningList title="When this fits" items={enrichment.fit} tone="success" />
                  <ReasoningList title="When this may not fit" items={enrichment.notFit} tone="warning" />
                </div>
                {enrichment.checks.length ? (
                  <ReasoningList title="Focused checks" items={enrichment.checks} tone="default" />
                ) : null}
              </section>
            ) : null}

            {item.icd11Context ? (
              <InfoCard icon={BookOpenCheck} eyebrow="Coding context" title="ICD-11 context">
                <p className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">{item.icd11Context}</p>
              </InfoCard>
            ) : null}
          </div>

          <aside aria-label="Review status" className="grid content-start gap-4 xl:sticky xl:top-20">
            <section className={cn(specifierCard, "overflow-hidden")}>
              <div className="border-b border-[color:var(--border)] px-4 py-3">
                <p className={eyebrowText}>Review status</p>
              </div>
              <dl className="divide-y divide-[color:var(--border)]">
                {/* SPEC §11: no source family means one of two different things, and a dash said
                    neither. All 20 of the 585 catalogue items that reach this fallback today carry
                    `source-not-applicable` — the specifier has no source family to name —
                    so the phrase is driven off that status rather than assumed, and an item that
                    ever lacks a family for any other reason reads as an omission, which it is. */}
                {(
                  [
                    ["Source", sourceStatusLabel[item.review.sourceVerificationStatus]],
                    ["Clinician review", clinicianReviewLabel],
                    [
                      "Source family",
                      item.definition?.sourceFamily ?? item.review.sourceFamily ?? (
                        <MissingValue
                          reason={
                            item.review.sourceVerificationStatus === "source-not-applicable"
                              ? "not_applicable"
                              : "not_recorded"
                          }
                          density="cell"
                        />
                      ),
                    ],
                    ["Content hash", item.review.contentHash],
                  ] satisfies Array<[string, ReactNode]>
                ).map(([label, body]) => (
                  <div key={label} className="px-4 py-3">
                    <dt className="text-xs font-extrabold text-[color:var(--text-heading)]">{label}</dt>
                    <dd className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">{body}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section id="specifier-wording" className={cn(specifierCard, inPageAnchor, "p-4")}>
              <p className={eyebrowText}>Diagnosis</p>
              <p className="mt-2 text-sm font-bold leading-6 text-[color:var(--text-heading)]">{item.disorderName}</p>
              <div className="mt-2">
                <CategoryTag categoryId={item.categoryId} name={item.categoryName} />
              </div>
            </section>

            {related.length ? (
              <section className={cn(specifierCard, "overflow-hidden")}>
                <div className="border-b border-[color:var(--border)] px-4 py-3">
                  <p className={eyebrowText}>More in this diagnosis</p>
                </div>
                <div className="divide-y divide-[color:var(--border)]">
                  {related.map((entry) => (
                    <Link
                      key={entry.slug}
                      href={`/specifiers/${entry.slug}`}
                      className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold text-[color:var(--text-heading)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{entry.label}</span>
                        <span className="block text-2xs font-semibold text-[color:var(--text-muted)]">
                          {entry.groupLabel}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>

        <SpecifierSafetyNote id="specifier-evidence" className={inPageAnchor} />
      </SpecifierPageShell>
    </>
  );
}
