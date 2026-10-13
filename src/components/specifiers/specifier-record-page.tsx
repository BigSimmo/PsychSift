import Link from "next/link";
import { ArrowRight, GitCompareArrows, ListChecks } from "lucide-react";

import {
  DiagnosisChips,
  SectionHeading,
  SpecifierFamilyBadge,
  SpecifierPageShell,
  SpecifierSafetyNote,
} from "@/components/specifiers/specifier-ui";
import {
  compareRecordsHref,
  RecordBody,
  RecordBulletList,
  RecordCautions,
  RecordGlance,
  RecordIntro,
  RecordSection,
} from "@/components/clinical-record-panels";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { SpecifierNavHeader } from "@/components/specifiers/specifier-nav-header";
import { buttonFaceClass } from "@/components/ui/button-face";
import { cn } from "@/components/ui-primitives";
import { relatedSpecifiers, type SpecifierRecord } from "@/lib/specifiers";

export function SpecifierRecordPage({ record }: { record: SpecifierRecord }) {
  const related = relatedSpecifiers(record);
  const primaryRelated = related[0];

  return (
    <>
      <SpecifierNavHeader
        title={record.shortName}
        actions={
          <div className="grid gap-2">
            <Link
              href={compareRecordsHref("/specifiers/compare", record.slug, primaryRelated?.slug)}
              className={inPageActionRowClass}
            >
              <GitCompareArrows className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Compare
            </Link>
            <Link href={`/specifiers/builder?specifier=${record.slug}`} className={inPageActionRowClass}>
              <ListChecks className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Build wording
            </Link>
          </div>
        }
      />
      <SpecifierPageShell>
        <RecordBody>
          <section id="specifier-overview" className={inPageAnchor}>
            <RecordIntro
              eyebrow="Psychiatric specifier"
              title={record.name}
              line={record.summary}
              tags={
                <>
                  <SpecifierFamilyBadge record={record} />
                  <DiagnosisChips values={record.appliesTo} />
                </>
              }
              actions={
                <Link
                  href={compareRecordsHref("/specifiers/compare", record.slug, primaryRelated?.slug)}
                  className={buttonFaceClass({ variant: "secondary" })}
                >
                  <GitCompareArrows className="h-4 w-4 shrink-0" aria-hidden />
                  Compare
                </Link>
              }
            />
          </section>

          <RecordGlance
            id="what-matters-now"
            facts={[
              { label: "Applies to", value: record.appliesTo.slice(0, 2).join(" · ") },
              { label: "Deciding signal", value: record.clinicalSignal, wide: true },
              { label: "Ask this", value: record.decisionQuestion, wide: true },
              { label: "Wording outcome", value: record.wording, wide: true },
            ]}
          />

          {record.notFit.length ? (
            <RecordCautions title="When this may not fit">
              <RecordBulletList items={record.notFit} tone="warning" />
            </RecordCautions>
          ) : null}

          <section id="specifier-fit" className={cn(inPageAnchor, "flex min-w-0 flex-col gap-7")}>
            <SectionHeading
              eyebrow="Fit and exclusions"
              title="Make the specifier earn its place"
              body="Start with the deciding signal, then test chronology, competing explanations, and the effect on diagnostic wording."
            />
            <RecordSection title="When this fits" headingLevel="h3">
              <RecordBulletList items={record.fit} />
            </RecordSection>
            <RecordSection title="Focused checks" headingLevel="h3">
              <RecordBulletList items={record.checks} />
            </RecordSection>
            <RecordSection title="Patient language" headingLevel="h3">
              <RecordBulletList items={record.patientLanguage.map((item) => `“${item}”`)} />
            </RecordSection>
          </section>

          <RecordSection title="How this changes the plan">
            <p className="m-0 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{record.treatmentLens}</p>
          </RecordSection>

          <RecordSection title="Quick reference">
            <dl className="m-0 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
              {[
                ["Focus", record.comparison.focus],
                ["Time course", record.comparison.timeCourse],
                ["Look for", record.comparison.lookFor],
                ["Avoid", record.comparison.caution],
              ].map(([label, body]) => (
                <div key={label} className="py-3">
                  <dt className="text-sm font-bold text-[color:var(--text-heading)]">{label}</dt>
                  <dd className="m-0 mt-1 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{body}</dd>
                </div>
              ))}
            </dl>
          </RecordSection>

          <RecordSection id="specifier-wording" title="Example wording">
            <p className="m-0 text-base font-bold leading-7 text-[color:var(--text-heading)]">{record.wording}</p>
            <Link
              href={`/specifiers/builder?specifier=${record.slug}`}
              className={cn(buttonFaceClass({ variant: "primary", block: true }), "mt-3")}
            >
              Use in builder
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </RecordSection>

          {related.length ? (
            <RecordSection title="Compare next">
              <div className="divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
                {related.map((item) => (
                  <Link
                    key={item.slug}
                    href={compareRecordsHref("/specifiers/compare", record.slug, item.slug)}
                    className="flex min-h-14 items-center justify-between gap-3 py-2.5 text-sm font-semibold text-[color:var(--text-heading)] hover:text-[color:var(--clinical-accent)]"
                  >
                    {item.shortName}
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                  </Link>
                ))}
              </div>
            </RecordSection>
          ) : null}

          <SpecifierSafetyNote id="specifier-evidence" className={inPageAnchor} />
        </RecordBody>
      </SpecifierPageShell>
    </>
  );
}
